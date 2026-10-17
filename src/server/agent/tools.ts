/**
 * Agent tools. Thin wrappers over the rules engine: every number comes from
 * code, and tools return `ToolResult` instead of throwing.
 *
 * The run is bound to one invoice. Tools read the invoice from run state, not
 * from model arguments, so the model can't "fix" a vendor name or unit and
 * hide the v1 lookup failure.
 */
import type OpenAI from "openai";
import { z } from "zod";
import {
	type Finding,
	fail,
	type Invoice,
	ok,
	type PriceRow,
	type ToolResult,
} from "#/lib/busyq/types.ts";
import { formatMoney, toMajor } from "#/lib/money/index.ts";
import {
	calculateImpact,
	checkInvoice,
	checkInvoicePayments,
	compareLines,
	type ImpactSummary,
	type PriceLookup,
	type UnpricedLine,
} from "#/lib/rules/index.ts";
import { distinctLines } from "#/lib/rules/util.ts";
import { checkDraftAmounts } from "./draft-guard.ts";
import type { AgentStore } from "./store.ts";

export interface RunState {
	invoiceId: string;
	lookup: PriceLookup;
	invoice?: Invoice;
	prices?: PriceRow[];
	agreedPrices: string[];
	compared?: { findings: Finding[]; unpriced: UnpricedLine[] };
	invoiceChecks?: Finding[];
	paymentChecks?: Finding[];
	impact?: ImpactSummary;
	draft?: { subject: string; body: string };
}

export const TOOL_NAMES = [
	"get_invoice",
	"lookup_vendor_prices",
	"compare_lines",
	"check_invoice",
	"check_payments",
	"calculate_impact",
	"save_dispute_draft",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** Tools a run must call before it can finish. */
export const REQUIRED_TOOLS: readonly ToolName[] = TOOL_NAMES.slice(0, 6);

const InvoiceArgs = z.object({ invoice_id: z.string().min(1) });
const DraftArgs = z.object({
	subject: z.string().min(1).max(200),
	body: z.string().min(1).max(5000),
});

const invoiceParam = {
	type: "object",
	properties: {
		invoice_id: { type: "string", description: "The invoice being audited." },
	},
	required: ["invoice_id"],
	additionalProperties: false,
} as const;

export const TOOL_SPECS: OpenAI.ChatCompletionTool[] = [
	{
		name: "get_invoice",
		description:
			"Load the invoice: vendor as printed, dates, lines and stated total.",
	},
	{
		name: "lookup_vendor_prices",
		description:
			"Find the agreed contract price for every line. Fails with price_not_found if a vendor, item or unit has no agreed price.",
	},
	{
		name: "compare_lines",
		description:
			"Compare billed unit prices with agreed prices. Returns overcharges with dollar impact, and lines that could not be priced.",
	},
	{
		name: "check_invoice",
		description:
			"Check for duplicate lines and line or invoice totals that don't add up.",
	},
	{
		name: "check_payments",
		description: "Check whether this invoice was paid more than once.",
	},
	{
		name: "calculate_impact",
		description:
			"Total recoverable amount from all findings. Call after compare_lines, check_invoice and check_payments.",
	},
].map((t) => ({
	type: "function" as const,
	function: { ...t, parameters: invoiceParam },
}));

TOOL_SPECS.push({
	type: "function",
	function: {
		name: "save_dispute_draft",
		description:
			"Save the email to the vendor asking for a credit. Only when the total impact is above zero. Quote dollar amounts exactly as the tools returned them; the total must appear.",
		parameters: {
			type: "object",
			properties: {
				subject: { type: "string" },
				body: { type: "string" },
			},
			required: ["subject", "body"],
			additionalProperties: false,
		},
	},
});

const money = (minor: number, currency: string) =>
	formatMoney({ minor, currency });

const summarize = (f: Finding) => ({
	kind: f.kind,
	line: f.lineNo,
	payment: f.paymentId,
	impact: money(f.impactMinor, f.currency),
	detail: f.detail,
});

const allFindings = (s: RunState): Finding[] => [
	...(s.compared?.findings ?? []),
	...(s.invoiceChecks ?? []),
	...(s.paymentChecks ?? []),
];

export { allFindings };

async function loadPrices(state: RunState, store: AgentStore) {
	state.prices ??= await store.getPriceList();
	return state.prices;
}

/** Every amount the draft may quote: impacts, totals, prices and amounts from the invoice. */
export function allowedAmounts(state: RunState): string[] {
	const inv = state.invoice;
	const findings = allFindings(state);
	const fromFindings = findings.flatMap((f) => [
		toMajor({ minor: f.impactMinor, currency: f.currency }).toString(),
		...(f.expected ? [f.expected] : []),
		...(f.actual ? [f.actual] : []),
	]);
	const fromInvoice = inv
		? [inv.statedTotal, ...inv.lines.flatMap((l) => [l.unitPrice, l.amount])]
		: [];
	const total = state.impact ? [toMajor(state.impact.total).toString()] : [];
	return [...fromFindings, ...fromInvoice, ...state.agreedPrices, ...total];
}

export async function executeTool(
	name: string,
	rawArgs: string,
	state: RunState,
	store: AgentStore,
): Promise<ToolResult<unknown>> {
	let args: unknown;
	try {
		args = rawArgs ? JSON.parse(rawArgs) : {};
	} catch {
		return fail("invalid_input", "Arguments must be valid JSON");
	}

	if (name === "save_dispute_draft") return saveDraft(args, state);
	if (!(TOOL_NAMES as readonly string[]).includes(name)) {
		return fail("invalid_input", `Unknown tool "${name}"`);
	}

	const parsed = InvoiceArgs.safeParse(args);
	if (!parsed.success) return fail("invalid_input", "invoice_id is required");
	if (parsed.data.invoice_id !== state.invoiceId) {
		return fail(
			"invalid_input",
			`This run audits ${state.invoiceId} only, not ${parsed.data.invoice_id}`,
		);
	}

	if (name === "get_invoice") {
		const invoice = await store.getInvoice(state.invoiceId);
		if (!invoice) return fail("not_found", `No invoice ${state.invoiceId}`);
		state.invoice = invoice;
		return ok(invoice);
	}

	const invoice = state.invoice;
	if (!invoice) return fail("invalid_input", "Call get_invoice first");

	switch (name) {
		case "lookup_vendor_prices": {
			const prices = await loadPrices(state, store);
			const matched: {
				line: number;
				item: string;
				agreed: string;
				unit: string;
			}[] = [];
			const unmatched: { line: number; item: string; unit: string }[] = [];
			for (const line of distinctLines(invoice)) {
				const r = state.lookup(prices, invoice.vendor, line);
				if (r.ok) {
					matched.push({
						line: line.lineNo,
						item: line.item,
						agreed: r.data.agreedUnitPrice,
						unit: line.unit,
					});
					state.agreedPrices.push(r.data.agreedUnitPrice);
				} else {
					unmatched.push({
						line: line.lineNo,
						item: line.item,
						unit: line.unit,
					});
				}
			}
			if (unmatched.length > 0) {
				return fail(
					"price_not_found",
					`No agreed price for ${unmatched.length} of ${unmatched.length + matched.length} lines from vendor "${invoice.vendor}"`,
					{ vendor: invoice.vendor, unmatched, matched },
				);
			}
			return ok({ vendor: invoice.vendor, matched });
		}

		case "compare_lines": {
			const prices = await loadPrices(state, store);
			state.compared = compareLines(invoice, prices, state.lookup);
			return ok({
				overcharges: state.compared.findings.map(summarize),
				unpriced: state.compared.unpriced.map((u) => ({
					line: u.lineNo,
					item: u.item,
					unit: u.unit,
					reason: u.error.code,
				})),
			});
		}

		case "check_invoice": {
			state.invoiceChecks = checkInvoice(invoice);
			return ok({ findings: state.invoiceChecks.map(summarize) });
		}

		case "check_payments": {
			const paid = await store.getPaymentsForInvoice(invoice.invoiceNumber);
			state.paymentChecks = checkInvoicePayments(invoice, paid);
			return ok({
				payments: paid.length,
				findings: state.paymentChecks.map(summarize),
			});
		}

		case "calculate_impact": {
			const missing = (
				[
					["compare_lines", state.compared],
					["check_invoice", state.invoiceChecks],
					["check_payments", state.paymentChecks],
				] as const
			)
				.filter(([, v]) => v === undefined)
				.map(([n]) => n);
			if (missing.length > 0) {
				return fail("invalid_input", `Call ${missing.join(", ")} first`);
			}
			state.impact = calculateImpact(allFindings(state), invoice.currency);
			const { total, byKind } = state.impact;
			return ok({
				total: money(total.minor, total.currency),
				findings: allFindings(state).length,
				unpricedLines: state.compared?.unpriced.length ?? 0,
				byKind: Object.fromEntries(
					Object.entries(byKind).map(([k, v]) => [
						k,
						{
							count: v.count,
							impact: money(v.impact.minor, v.impact.currency),
						},
					]),
				),
			});
		}
	}
	return fail("internal", `Unhandled tool "${name}"`);
}

function saveDraft(args: unknown, state: RunState): ToolResult<unknown> {
	const parsed = DraftArgs.safeParse(args);
	if (!parsed.success)
		return fail("invalid_input", "subject and body are required");
	if (!state.impact)
		return fail("invalid_input", "Call calculate_impact first");
	if (state.impact.total.minor <= 0) {
		return fail("invalid_input", "Nothing to dispute: total impact is zero");
	}
	const total = toMajor(state.impact.total).toString();
	const guard = checkDraftAmounts(
		`${parsed.data.subject}\n${parsed.data.body}`,
		allowedAmounts(state),
		total,
	);
	if (!guard.ok) {
		const problems = [
			...(guard.unknown.length
				? [
						`these amounts did not come from the tools: ${guard.unknown.map((a) => `$${a}`).join(", ")}`,
					]
				: []),
			...(guard.missingTotal
				? [
						`the total ${money(state.impact.total.minor, state.impact.total.currency)} must appear`,
					]
				: []),
		];
		return fail(
			"invalid_input",
			`Draft rejected: ${problems.join("; ")}. Rewrite it.`,
		);
	}
	state.draft = parsed.data;
	return ok({
		saved: true,
		total: money(state.impact.total.minor, state.impact.total.currency),
	});
}
