import { describe, expect, it } from "vitest";
import { outcomeFromResponse, RunResponse } from "#/lib/busyq/batch.ts";
import { invoices, payments, priceList } from "#/lib/busyq/fixtures/index.ts";
import { RunTracer } from "#/server/prism.ts";
import { amountsIn, checkDraftAmounts } from "./draft-guard.ts";
import { type ChatModel, type ModelReply, runAgent } from "./run.ts";
import type { AgentStore, FinishedRun } from "./store.ts";

function memoryStore() {
	const runs: Record<string, unknown>[] = [];
	const finished: FinishedRun[] = [];
	const store: AgentStore = {
		getInvoice: async (id) => invoices.find((i) => i.id === id) ?? null,
		getPriceList: async () => priceList,
		getPaymentsForInvoice: async (n) =>
			payments.filter((p) => p.invoiceNumber === n),
		startRun: async (r) => {
			runs.push(r);
		},
		finishRun: async (r) => {
			finished.push(r);
		},
	};
	return { store, runs, finished };
}

const call = (name: string, args: Record<string, unknown>) => ({
	id: `call-${name}-${Math.random().toString(36).slice(2, 8)}`,
	name,
	arguments: JSON.stringify(args),
});

/** A model that replays a fixed script of replies and records what it saw. */
function scripted(replies: Partial<ModelReply>[]) {
	const seen: unknown[][] = [];
	let i = 0;
	const model: ChatModel = async (messages) => {
		seen.push(structuredClone(messages));
		const r = replies[i++];
		if (!r) throw new Error("script exhausted");
		return { model: "test/model", content: null, toolCalls: [], ...r };
	};
	return { model, seen };
}

const allChecks = (id: string) => [
	call("get_invoice", { invoice_id: id }),
	call("lookup_vendor_prices", { invoice_id: id }),
	call("compare_lines", { invoice_id: id }),
	call("check_invoice", { invoice_id: id }),
	call("check_payments", { invoice_id: id }),
	call("calculate_impact", { invoice_id: id }),
];

const deps = (store: AgentStore, model: ChatModel) => ({
	store,
	model,
	modelName: "test/model",
	tracerFor: (runId: string) =>
		new RunTracer(null, { sessionId: runId, name: "t", agentName: "t" }),
});

const toolResults = (messages: unknown[]) =>
	(messages as { role: string; content: string }[])
		.filter((m) => m.role === "tool")
		.map((m) => JSON.parse(m.content));

describe("runAgent", () => {
	it("audits the $72 overcharge: code finds it, the draft must quote it", async () => {
		const { store, finished } = memoryStore();
		const { model, seen } = scripted([
			{ toolCalls: allChecks("inv-overcharge") },
			{
				toolCalls: [
					call("save_dispute_draft", {
						subject: "Invoice SY-1002",
						body: "Chicken breast was billed at $2.16 instead of $2.10. Please credit $75.00.",
					}),
				],
			},
			{
				toolCalls: [
					call("save_dispute_draft", {
						subject: "Invoice SY-1002",
						body: "Chicken breast was billed at $2.16 per lb instead of the agreed $2.10 on 1,200 lb. Please credit $72.00.",
					}),
				],
			},
			{ content: "One overcharge on chicken breast; $72.00 is recoverable." },
		]);

		const result = await runAgent(
			{ invoiceId: "inv-overcharge", version: "v1" },
			deps(store, model),
		);

		expect(result.status).toBe("completed");
		expect(result.toolCalls).toHaveLength(8);
		// The rejected draft shows up as a failed tool call, then the retry succeeds.
		expect(result.toolCalls.slice(-2)).toEqual([
			{
				name: "save_dispute_draft",
				status: "error",
				errorCode: "invalid_input",
			},
			{ name: "save_dispute_draft", status: "ok" },
		]);
		expect(result.total).toEqual({ minor: 7200, currency: "USD" });
		expect(result.findings).toHaveLength(1);
		expect(result.findings[0]).toMatchObject({
			kind: "overcharge",
			impactMinor: 7200,
		});
		expect(result.draft?.body).toContain("$72.00");
		expect(result.explanation).toContain("$72.00");

		// The invented $75.00 was rejected before the corrected draft was saved.
		const rejected = toolResults(seen[2] as unknown[]).at(-1);
		expect(rejected).toMatchObject({
			ok: false,
			error: { code: "invalid_input" },
		});
		expect(rejected.error.message).toContain("$75.00");

		expect(finished[0]).toMatchObject({ status: "completed", toolCalls: 8 });
		expect(finished[0]?.draft?.totalImpactMinor).toBe(7200);
	});

	it("records the v1 lookup failure on a vendor/unit variant and keeps going", async () => {
		const { store } = memoryStore();
		const { model, seen } = scripted([
			{ toolCalls: allChecks("inv-variant") },
			{
				content:
					"The vendor name on this invoice did not match the price list.",
			},
		]);

		const result = await runAgent(
			{ invoiceId: "inv-variant", version: "v1" },
			deps(store, model),
		);

		expect(result.status).toBe("completed");
		expect(result.unpricedLines).toBe(1);
		expect(result.toolCalls[1]).toEqual({
			name: "lookup_vendor_prices",
			status: "error",
			errorCode: "price_not_found",
		});
		expect(result.total.minor).toBe(0);
		expect(result.draft).toBeNull();
		const lookup = toolResults(seen[1] as unknown[])[1];
		expect(lookup).toMatchObject({
			ok: false,
			error: { code: "price_not_found", details: { vendor: "SYSCO Foods" } },
		});
	});

	it("ignores model attempts to audit a different invoice", async () => {
		const { store } = memoryStore();
		const { model, seen } = scripted([
			{ toolCalls: [call("get_invoice", { invoice_id: "inv-clean" })] },
			{ toolCalls: allChecks("inv-overcharge") },
			{
				toolCalls: [
					call("save_dispute_draft", {
						subject: "SY-1002",
						body: "Please credit $72.00.",
					}),
				],
			},
			{ content: "Done." },
		]);
		const result = await runAgent(
			{ invoiceId: "inv-overcharge", version: "v1" },
			deps(store, model),
		);
		expect(toolResults(seen[1] as unknown[])[0]).toMatchObject({
			ok: false,
			error: { code: "invalid_input" },
		});
		expect(result.status).toBe("completed");
	});

	it("nudges a model that stops early, then fails the run if it still skips checks", async () => {
		const { store, finished } = memoryStore();
		const { model, seen } = scripted([
			{ toolCalls: [call("get_invoice", { invoice_id: "inv-clean" })] },
			{ content: "Looks fine." },
			{ content: "Looks fine." },
			{ content: "Looks fine." },
		]);
		const result = await runAgent(
			{ invoiceId: "inv-clean", version: "v1" },
			deps(store, model),
		);
		expect(result.status).toBe("failed");
		expect(result.error?.code).toBe("incomplete");
		expect(result.error?.message).toContain("lookup_vendor_prices");
		expect(JSON.stringify(seen[2])).toContain("You haven't called");
		expect(finished[0]?.status).toBe("failed");
	});

	it("reports a failing model as a model_error, not a crash", async () => {
		const { store, finished } = memoryStore();
		const model: ChatModel = async () => {
			throw new Error("429 quota exceeded");
		};
		const result = await runAgent(
			{ invoiceId: "inv-clean", version: "v1" },
			deps(store, model),
		);
		expect(result.status).toBe("failed");
		expect(result.error).toEqual({
			code: "model_error",
			message: "429 quota exceeded",
		});
		expect(finished[0]?.error).toBe("model_error: 429 quota exceeded");
	});

	it("matches the batch runner's RunResponse contract", async () => {
		const { store } = memoryStore();
		const { model } = scripted([
			{ toolCalls: allChecks("inv-variant") },
			{ content: "Could not price the lines." },
		]);
		const result = await runAgent(
			{ invoiceId: "inv-variant", version: "v1" },
			deps(store, model),
		);
		const parsed = RunResponse.parse(JSON.parse(JSON.stringify(result)));
		expect(outcomeFromResponse(parsed, 0).toolErrors).toEqual([
			{ name: "lookup_vendor_prices", code: "price_not_found" },
		]);
	});

	it("v2 resolves the vendor variant and pack unit, and finds the $72 overcharge", async () => {
		const { store } = memoryStore();
		const { model } = scripted([
			{ toolCalls: allChecks("inv-variant") },
			{
				toolCalls: [
					call("save_dispute_draft", {
						subject: "Invoice SY-1003",
						body: "Chicken breast was billed at $86.40 per case against the agreed $84.00. Please credit $72.00.",
					}),
				],
			},
			{ content: "One overcharge, $72.00 recoverable." },
		]);
		const result = await runAgent(
			{ invoiceId: "inv-variant", version: "v2" },
			deps(store, model),
		);
		expect(result.status).toBe("completed");
		expect(result.unpricedLines).toBe(0);
		expect(result.toolCalls.every((t) => t.status === "ok")).toBe(true);
		expect(result.findings[0]).toMatchObject({
			kind: "overcharge",
			expected: "84.00",
			actual: "86.40",
			impactMinor: 7200,
		});
		expect(result.draft?.totalImpactMinor).toBe(7200);
	});
});

describe("draft guard", () => {
	it("extracts dollar amounts with or without thousands separators", () => {
		expect(amountsIn("pay $1,234.50 and $72 or $ 3.10, not 4.00")).toEqual([
			"1234.50",
			"72",
			"3.10",
		]);
	});

	it("accepts only known amounts and requires the total", () => {
		const allowed = ["72", "2.10", "2.16", "2592.00"];
		expect(checkDraftAmounts("Credit $72.00 please", allowed, "72")).toEqual({
			ok: true,
		});
		expect(checkDraftAmounts("Credit $80.00", allowed, "72")).toEqual({
			ok: false,
			unknown: ["80.00"],
			missingTotal: true,
		});
	});
});
