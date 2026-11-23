// Copied into src/routes/api/ by .github/workflows/pages-demo.yml only (never on main).
// Runs the real BusyQ agent loop on every seeded invoice with a scripted, deterministic
// stand-in for the model: it calls the same tools in the prescribed order, and the dispute
// email quotes only amounts the tools returned (the draft guard still checks them).
import { createFileRoute } from "@tanstack/react-router";
import { getDb } from "#/db/index.ts";
import { invoices } from "#/db/schema/busyq.ts";
import type { AgentVersion } from "#/lib/busyq/types.ts";
import { type ChatModel, runAgent } from "#/server/agent/run.ts";
import { createD1Store } from "#/server/agent/store.ts";
import { RunTracer } from "#/server/prism.ts";

type Msg = { role: string; content?: unknown; tool_calls?: unknown };
const KIND: Record<string, string> = {
	overcharge: "billed above the agreed price",
	duplicate_line: "the same line billed twice",
	wrong_total: "the lines do not add up to the invoice total",
	duplicate_payment: "this invoice was paid more than once",
	orphan_payment: "a payment with no matching invoice",
};

function scriptedModel(invoiceId: string): ChatModel {
	let turn = 0;
	return async (messages) => {
		turn++;
		const call = (name: string, args: Record<string, unknown>) => ({
			id: `call-${name}-${turn}`,
			name,
			arguments: JSON.stringify(args),
		});
		if (turn === 1) {
			return {
				model: "demo/scripted",
				content: null,
				toolCalls: [
					"get_invoice",
					"lookup_vendor_prices",
					"compare_lines",
					"check_invoice",
					"check_payments",
					"calculate_impact",
				].map((n) => call(n, { invoice_id: invoiceId })),
			};
		}
		const results = (messages as Msg[])
			.filter((m) => m.role === "tool")
			.map((m) => {
				try {
					return JSON.parse(String(m.content));
				} catch {
					return null;
				}
			});
		const flat = (o: unknown): Record<string, unknown>[] => {
			if (!o || typeof o !== "object") return [];
			const r = o as Record<string, unknown>;
			return [r, ...Object.values(r).flatMap(flat)];
		};
		const all = results.flatMap(flat);
		const impact = all.find((r) => typeof r.total === "string" && "byKind" in r);
		const total = (impact?.total as string) ?? "$0.00";
		const findings = all
			.filter((r) => Array.isArray(r.findings))
			.flatMap((r) => r.findings as Record<string, unknown>[]);
		const draftSaved = all.some((r) => "subject" in r || "draftId" in r);
		const hasImpact = total !== "$0.00" && findings.length > 0;
		if (turn === 2 && hasImpact) {
			const lines = findings.map((f) => {
				const where = f.line ? `Line ${f.line}` : f.payment ? `Payment ${f.payment}` : "Invoice";
				return `- ${where}: ${KIND[String(f.kind)] ?? String(f.kind)} (${f.impact})`;
			});
			return {
				model: "demo/scripted",
				content: null,
				toolCalls: [
					call("save_dispute_draft", {
						subject: `Credit request for invoice ${invoiceId}`,
						body: [
							"Hello,",
							"",
							"While reconciling this invoice against our agreed prices we found the following:",
							...lines,
							"",
							`Total to be credited: ${total}.`,
							"Please send a credit memo or a corrected invoice.",
							"",
							"Thank you,",
							"Food Services Office, Northfield Unified School District",
						].join("\n"),
					}),
				],
			};
		}
		const content = hasImpact
			? `Found ${findings.length} problem${findings.length === 1 ? "" : "s"} on this invoice, ${total} recoverable in total.${draftSaved ? " A credit request is drafted and waiting for your approval." : ""}`
			: "No problems found: every line matches the agreed price and the invoice was paid once.";
		return { model: "demo/scripted", content, toolCalls: [] };
	};
}

export const Route = createFileRoute("/api/demo-seed")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const version = (new URL(request.url).searchParams.get("v") ?? "v2") as AgentVersion;
				const db = getDb();
				const store = createD1Store(db);
				const rows = await db.select({ id: invoices.id }).from(invoices);
				const out: unknown[] = [];
				for (const { id } of rows) {
					try {
						const r = await runAgent(
							{ invoiceId: id, version },
							{
								store,
								model: scriptedModel(id),
								modelName: "demo/scripted",
								tracerFor: (runId) =>
									new RunTracer(null, { sessionId: runId, name: "demo", agentName: "demo" }),
							},
						);
						out.push({ id, status: r.status });
					} catch (e) {
						out.push({ id, error: String(e) });
					}
				}
				return Response.json({ version, runs: out });
			},
		},
	},
});
