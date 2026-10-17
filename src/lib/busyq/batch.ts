/**
 * Pure pieces of the batch runner (`scripts/run-batch.ts`): argument parsing,
 * a bounded-concurrency pool, the run-response contract, a rules-only runner,
 * and the scoring report. No I/O, no model.
 */
import { z } from "zod";
import { formatMoney } from "#/lib/money/index.ts";
import {
	checkInvoice,
	checkInvoicePayments,
	compareLines,
	LOOKUPS,
	scoreRun,
} from "#/lib/rules/index.ts";
import {
	type AgentVersion,
	type AnswerKeyRow,
	Finding,
	type Invoice,
	type Payment,
	type PriceRow,
} from "./types.ts";

// ── Run response contract ────────────────────────────────────────────

/**
 * What `POST /api/runs { invoiceId, version }` must return (issue #5). Fields
 * after `findings` are optional so a minimal agent works; richer ones feed the
 * failure summary.
 */
export const RunResponse = z.object({
	runId: z.string().optional(),
	invoiceId: z.string().min(1),
	status: z.enum(["completed", "failed"]),
	findings: z.array(Finding).optional(),
	error: z.object({ code: z.string().min(1), message: z.string() }).optional(),
	toolCalls: z
		.array(
			z.object({
				name: z.string().min(1),
				status: z.enum(["ok", "error"]),
				errorCode: z.string().optional(),
			}),
		)
		.optional(),
});
export type RunResponse = z.infer<typeof RunResponse>;

export type RunOutcome = {
	invoiceId: string;
	repeat: number;
	status: "completed" | "failed";
	findings: Finding[];
	/** Why the run failed (provider quota, bad response, ...): a tool failure, not a model miss. */
	error?: { code: string; message: string };
	/** Failed tool calls inside a completed run, e.g. lookup_vendor_prices:price_not_found. */
	toolErrors: { name: string; code: string }[];
};

export function outcomeFromResponse(
	res: RunResponse,
	repeat: number,
): RunOutcome {
	return {
		invoiceId: res.invoiceId,
		repeat,
		status: res.status,
		findings: res.findings ?? [],
		error: res.error,
		toolErrors: (res.toolCalls ?? [])
			.filter((t) => t.status === "error")
			.map((t) => ({ name: t.name, code: t.errorCode ?? "unknown" })),
	};
}

export const failedOutcome = (
	invoiceId: string,
	repeat: number,
	code: string,
	message: string,
): RunOutcome => ({
	invoiceId,
	repeat,
	status: "failed",
	findings: [],
	error: { code, message },
	toolErrors: [],
});

// ── Rules-only runner (no server, no model) ──────────────────────────

export type RulesData = {
	prices: readonly PriceRow[];
	payments: readonly Payment[];
};

/** Run the deterministic rules for one invoice, shaped like an agent run. */
export function runWithRules(
	invoice: Invoice,
	repeat: number,
	data: RulesData,
	version: AgentVersion,
): RunOutcome {
	const compared = compareLines(invoice, data.prices, LOOKUPS[version]);
	return {
		invoiceId: invoice.id,
		repeat,
		status: "completed",
		findings: [
			...compared.findings,
			...checkInvoice(invoice),
			...checkInvoicePayments(invoice, data.payments),
		],
		toolErrors: compared.unpriced.map((u) => ({
			name: "lookup_vendor_prices",
			code: u.error.code,
		})),
	};
}

// ── Concurrency ──────────────────────────────────────────────────────

/** Map with at most `limit` calls in flight; results keep input order. */
export async function runPool<T, R>(
	items: readonly T[],
	limit: number,
	fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const i = next++;
			results[i] = await fn(items[i] as T, i);
		}
	};
	await Promise.all(
		Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker),
	);
	return results;
}

// ── Arguments ────────────────────────────────────────────────────────

export type BatchArgs = {
	mode: "http" | "rules";
	url: string | null;
	version: AgentVersion;
	concurrency: number;
	repeat: number;
	limit: number | null;
	json: boolean;
};

export function parseArgs(argv: readonly string[]): BatchArgs {
	const args: BatchArgs = {
		mode: "http",
		url: null,
		version: "v1",
		concurrency: 2,
		repeat: 1,
		limit: null,
		json: false,
	};
	const positiveInt = (flag: string, v: string | undefined): number => {
		const n = Number(v);
		if (!Number.isInteger(n) || n < 1) {
			throw new Error(
				`${flag} needs a positive whole number, got "${v ?? ""}"`,
			);
		}
		return n;
	};
	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i];
		const value = argv[i + 1];
		switch (flag) {
			case "--url":
				if (!value) throw new Error("--url needs a base URL");
				args.url = value.replace(/\/+$/, "");
				i++;
				break;
			case "--version":
				if (value !== "v1" && value !== "v2") {
					throw new Error(`--version must be v1 or v2, got "${value ?? ""}"`);
				}
				args.version = value;
				i++;
				break;
			case "--concurrency":
				args.concurrency = positiveInt(flag, value);
				i++;
				break;
			case "--repeat":
				args.repeat = positiveInt(flag, value);
				i++;
				break;
			case "--limit":
				args.limit = positiveInt(flag, value);
				i++;
				break;
			case "--mode":
				if (value !== "http" && value !== "rules") {
					throw new Error(`--mode must be http or rules, got "${value ?? ""}"`);
				}
				args.mode = value;
				i++;
				break;
			case "--json":
				args.json = true;
				break;
			default:
				throw new Error(`Unknown argument "${flag}"`);
		}
	}
	if (args.mode === "http" && !args.url) {
		throw new Error("--url <base> is required (or use --mode rules)");
	}
	return args;
}

// ── Report ───────────────────────────────────────────────────────────

export type CountRow = { key: string; count: number };

export type BatchReport = {
	version: AgentVersion;
	invoices: number;
	repeats: number;
	runs: number;
	completed: number;
	failed: number;
	truePositives: number;
	falsePositives: number;
	falseNegatives: number;
	/** tp / (tp + fp) over all runs; 1 when nothing was flagged. */
	precision: number;
	/** tp / (tp + fn) counting failed runs as misses. */
	recall: number;
	/** Same, but only over runs that completed (separates tool failures from misses). */
	recallCompleted: number;
	foundMinor: number;
	plantedMinor: number;
	missedByKind: CountRow[];
	/** Failed runs grouped by error code. */
	runFailures: (CountRow & { example: string })[];
	/** Failed tool calls inside completed runs, grouped by tool:code. */
	toolErrors: CountRow[];
};

const countRows = (m: Map<string, number>): CountRow[] =>
	[...m.entries()]
		.map(([key, count]) => ({ key, count }))
		.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

const ratio = (num: number, den: number) => (den === 0 ? 1 : num / den);

export function summarize(
	version: AgentVersion,
	outcomes: readonly RunOutcome[],
	invoiceIds: readonly string[],
	answerKey: readonly AnswerKeyRow[],
): BatchReport {
	const repeats = new Set(outcomes.map((o) => o.repeat));
	let tp = 0;
	let fp = 0;
	let fn = 0;
	let tpC = 0;
	let fnC = 0;
	let foundMinor = 0;
	let plantedMinor = 0;
	const missed = new Map<string, number>();
	const allIds = new Set(invoiceIds);

	for (const repeat of [...repeats].sort((a, b) => a - b)) {
		const these = outcomes.filter((o) => o.repeat === repeat);
		const all = scoreRun(
			these.flatMap((o) => o.findings),
			answerKey,
			allIds,
		);
		tp += all.truePositives;
		fp += all.falsePositives.length;
		fn += all.falseNegatives.length;
		foundMinor += all.foundMinor;
		plantedMinor += all.plantedMinor;
		for (const m of all.falseNegatives) {
			missed.set(m.kind, (missed.get(m.kind) ?? 0) + 1);
		}
		const done = these.filter((o) => o.status === "completed");
		const doneScore = scoreRun(
			done.flatMap((o) => o.findings),
			answerKey,
			new Set(done.map((o) => o.invoiceId)),
		);
		tpC += doneScore.truePositives;
		fnC += doneScore.falseNegatives.length;
	}

	const failures = new Map<string, { count: number; example: string }>();
	const toolErrors = new Map<string, number>();
	for (const o of outcomes) {
		if (o.status === "failed" && o.error) {
			const slot = failures.get(o.error.code) ?? {
				count: 0,
				example: o.error.message,
			};
			failures.set(o.error.code, {
				count: slot.count + 1,
				example: slot.example,
			});
		}
		for (const t of o.toolErrors) {
			const key = `${t.name}:${t.code}`;
			toolErrors.set(key, (toolErrors.get(key) ?? 0) + 1);
		}
	}

	return {
		version,
		invoices: invoiceIds.length,
		repeats: repeats.size,
		runs: outcomes.length,
		completed: outcomes.filter((o) => o.status === "completed").length,
		failed: outcomes.filter((o) => o.status === "failed").length,
		truePositives: tp,
		falsePositives: fp,
		falseNegatives: fn,
		precision: ratio(tp, tp + fp),
		recall: ratio(tp, tp + fn),
		recallCompleted: ratio(tpC, tpC + fnC),
		foundMinor,
		plantedMinor,
		missedByKind: countRows(missed),
		runFailures: countRows(
			new Map([...failures].map(([k, v]) => [k, v.count])),
		).map((r) => ({ ...r, example: failures.get(r.key)?.example ?? "" })),
		toolErrors: countRows(toolErrors),
	};
}

const pct = (r: number) => `${(r * 100).toFixed(1)}%`;

export function formatReport(r: BatchReport, currency = "USD"): string {
	const lines = [
		`BusyQ batch report: agent ${r.version}`,
		`${r.invoices} invoices x ${r.repeats} repeat(s) = ${r.runs} runs: ${r.completed} completed, ${r.failed} failed`,
		"",
		`Precision        ${pct(r.precision)}   (${r.truePositives} correct, ${r.falsePositives} false flags)`,
		`Recall           ${pct(r.recall)}   (${r.falseNegatives} planted problems missed; failed runs count as misses)`,
		`Recall, completed runs only  ${pct(r.recallCompleted)}`,
		`Dollars found    ${formatMoney({ minor: r.foundMinor, currency })} of ${formatMoney({ minor: r.plantedMinor, currency })} planted`,
	];
	if (r.missedByKind.length > 0) {
		lines.push("", "Missed by kind:");
		for (const m of r.missedByKind) lines.push(`  ${m.key}: ${m.count}`);
	}
	if (r.runFailures.length > 0) {
		lines.push(
			"",
			"Run failures (tool or provider problems, not model misses):",
		);
		for (const f of r.runFailures)
			lines.push(`  ${f.key} x ${f.count}   e.g. ${f.example}`);
	}
	if (r.toolErrors.length > 0) {
		lines.push("", "Failed tool calls inside completed runs:");
		for (const t of r.toolErrors) lines.push(`  ${t.key} x ${t.count}`);
	}
	return lines.join("\n");
}
