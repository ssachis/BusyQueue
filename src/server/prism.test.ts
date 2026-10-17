import { describe, expect, it, vi } from "vitest";
import { emitTrace, emitTraceSafe, RunTracer } from "./prism.ts";

const config = {
	apiKey: "pt-sk-test",
	projectId: "project-1",
	host: "https://prism.example",
};
const trace = {
	model: "nicrron/auto",
	inputMessages: [{ role: "user", content: "hello" }],
	outputMessage: "hi",
	latencyMs: 119.6,
	sessionId: "session-1",
};

describe("emitTrace", () => {
	it("posts the ingest payload with the PRISM key header", async () => {
		const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
		await emitTrace(config, trace, fetchImpl);

		const [url, init] = fetchImpl.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		expect(url).toBe("https://prism.example/api/traces");
		expect(new Headers(init.headers).get("X-PRISMtrace-Key")).toBe(
			"pt-sk-test",
		);
		expect(JSON.parse(init.body as string)).toEqual({
			project_id: "project-1",
			model: "nicrron/auto",
			input_messages: [{ role: "user", content: "hello" }],
			output_message: "hi",
			latency_ms: 120,
			session_id: "session-1",
		});
	});

	it("throws with the response body on non-2xx", async () => {
		const fetchImpl = vi.fn(async () => new Response("nope", { status: 403 }));
		await expect(emitTrace(config, trace, fetchImpl)).rejects.toThrow(
			"PRISM /api/traces 403: nope",
		);
	});
});

describe("emitTraceSafe", () => {
	it("is a no-op when tracing is not configured", async () => {
		await expect(emitTraceSafe(null, trace)).resolves.toBeUndefined();
	});
});

describe("RunTracer", () => {
	type Call = { url: string; body: Record<string, unknown> };
	function recorder(status = 200) {
		const calls: Call[] = [];
		const fetchImpl = vi.fn(
			async (url: string | URL | Request, init?: RequestInit) => {
				calls.push({
					url: String(url),
					body: JSON.parse(init?.body as string),
				});
				return new Response("{}", { status });
			},
		) as unknown as typeof fetch;
		return { calls, fetchImpl };
	}
	const options = {
		sessionId: "run-1",
		name: "busyq_invoice_run",
		agentName: "busyq-auditor",
		input: { invoiceId: "inv-variant" },
		metadata: { agent_version: "v1" },
	};

	it("flushes a span tree and trajectory with tool status and errors", async () => {
		const { calls, fetchImpl } = recorder();
		const run = new RunTracer(config, options, fetchImpl);

		await run.traceModelCall(
			"nicrron/auto",
			[{ role: "user", content: "audit" }],
			async () => ({ text: "", model: "anthropic/claude-haiku-5-5" }),
			(r) => ({ model: r.model, tokensIn: 10, tokensOut: 5, toolCalls: true }),
		);
		const found = await run.traceToolCall(
			"get_invoice",
			{ id: "inv-variant" },
			() => ({
				ok: true,
				data: { vendor: "SYSCO Foods" },
			}),
		);
		const missing = await run.traceToolCall(
			"lookup_vendor_prices",
			{ vendor: "SYSCO Foods" },
			() => ({
				ok: false,
				error: {
					code: "price_not_found",
					message: "No agreed prices for SYSCO Foods",
				},
			}),
		);
		expect(found.ok).toBe(true);
		expect(missing.ok).toBe(false);
		expect(run.hasErrors).toBe(true);

		await run.finish({ output: "done" });
		expect(calls.map((c) => c.url)).toEqual([
			"https://prism.example/api/spans/ingest",
			"https://prism.example/api/trajectories",
		]);

		const ingest = calls[0].body as {
			trace_id: string;
			session_id: string;
			spans: Array<Record<string, unknown>>;
		};
		expect(ingest.trace_id).toBe(run.traceId);
		expect(ingest.session_id).toBe("run-1");
		const [root, llm, toolOk, toolErr] = ingest.spans;
		expect(root).toMatchObject({
			span_type: "chain",
			parent_span_id: null,
			status: "ok",
		});
		expect(root.metadata).toMatchObject({ agent_version: "v1", tool_calls: 2 });
		expect(llm).toMatchObject({
			span_type: "llm",
			model: "anthropic/claude-haiku-5-5",
			token_count_input: 10,
			parent_span_id: root.span_id,
		});
		expect(toolOk).toMatchObject({
			span_type: "tool",
			name: "get_invoice",
			status: "ok",
		});
		expect(toolErr).toMatchObject({
			span_type: "tool",
			name: "lookup_vendor_prices",
			status: "error",
			error_message: "price_not_found: No agreed prices for SYSCO Foods",
		});

		expect(calls[1].body).toMatchObject({
			conversation_id: "run-1",
			request_id: run.traceId,
			agent_name: "busyq-auditor",
			final_status: "error",
		});
		const steps = (calls[1].body as { steps: Array<Record<string, unknown>> })
			.steps;
		expect(steps.map((s) => [s.step_type, s.status])).toEqual([
			["reasoning", "success"],
			["tool_call", "success"],
			["tool_call", "error"],
		]);
	});

	it("adds per-call metadata to llm spans and run metadata to the root", async () => {
		const { calls, fetchImpl } = recorder();
		const run = new RunTracer(config, options, fetchImpl);
		await run.traceModelCall(
			"anthropic/claude-sonnet-5-5",
			"audit",
			async () => ({ model: "openai/gpt-6-sol" }),
			(r) => ({
				model: r.model,
				metadata: { fallback_used: true, cost_usd: "0.0017" },
			}),
		);
		await run.finish({ output: "done", metadata: { fallbacks: 1 } });
		const [root, llm] = (
			calls[0].body as { spans: Array<Record<string, unknown>> }
		).spans;
		expect(llm).toMatchObject({
			model: "openai/gpt-6-sol",
			metadata: { fallback_used: true, cost_usd: "0.0017", iteration: 1 },
		});
		expect(root.metadata).toMatchObject({
			agent_version: "v1",
			fallbacks: 1,
			tool_calls: 0,
		});
	});

	it("records a thrown tool error and rethrows it", async () => {
		const { calls, fetchImpl } = recorder();
		const run = new RunTracer(config, options, fetchImpl);
		await expect(
			run.traceToolCall("compare_lines", {}, () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		await run.finish();
		const spans = (calls[0].body as { spans: Array<Record<string, unknown>> })
			.spans;
		expect(spans[1]).toMatchObject({ status: "error", error_message: "boom" });
	});

	it("marks the root span failed when the run errors", async () => {
		const { calls, fetchImpl } = recorder();
		const run = new RunTracer(config, options, fetchImpl);
		await run.finish({ error: new Error("model timeout") });
		const spans = (calls[0].body as { spans: Array<Record<string, unknown>> })
			.spans;
		expect(spans[0]).toMatchObject({
			status: "error",
			error_message: "model timeout",
		});
		// No steps recorded, so no trajectory.
		expect(calls).toHaveLength(1);
	});

	it("never throws when PRISM is down, and flushes once", async () => {
		const { fetchImpl } = recorder(500);
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const run = new RunTracer(config, options, fetchImpl);
		await run.traceToolCall("get_invoice", {}, () => ({ ok: true, data: {} }));
		await expect(run.finish()).resolves.toBeUndefined();
		await run.finish();
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(error).toHaveBeenCalledTimes(2);
		error.mockRestore();
	});

	it("only runs the wrapped functions when tracing is off", async () => {
		const run = new RunTracer(null, options);
		expect(await run.traceToolCall("get_invoice", {}, () => 42)).toBe(42);
		await expect(run.finish()).resolves.toBeUndefined();
	});
});
