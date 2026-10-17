/**
 * PRISM ingest over HTTP (there is no TypeScript SDK).
 *
 * - `emitTrace`: one flat trace per model turn (`POST /api/traces`).
 * - `RunTracer`: one agent run as a span tree (`POST /api/spans/ingest`) plus a
 *   trajectory (`POST /api/trajectories`), so PRISM shows every tool call with
 *   its status and error.
 *
 * `sessionId` groups traces into a session; use one value per conversation or
 * agent run.
 *
 * Wire formats come from PRISM's OpenAPI spec (`GET /openapi.json` with the
 * API key: `SpanIngestRequest`, `SpanInput`, `TrajectoryCreate`,
 * `TrajectoryStep`) and mirror the official Python SDK's ClaudeTracer
 * (prismtrace-sdk 0.5.3). Span types PRISM understands: "chain" (root),
 * "agent", "llm", "tool". Status is "ok" | "error" on spans and
 * "success" | "error" on trajectory steps.
 */

export interface PrismConfig {
	apiKey: string;
	projectId: string;
	host: string;
}

export interface TraceMessage {
	role: string;
	content: string;
}

export interface PrismTrace {
	model: string;
	inputMessages: TraceMessage[];
	outputMessage: string;
	latencyMs: number;
	sessionId: string;
}

async function post(
	config: PrismConfig,
	path: string,
	body: unknown,
	fetchImpl: typeof fetch,
): Promise<void> {
	const res = await fetchImpl(`${config.host}${path}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			// PRISM API keys use this header, not `Authorization: Bearer`.
			"X-PRISMtrace-Key": config.apiKey,
		},
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		throw new Error(`PRISM ${path} ${res.status}: ${await res.text()}`);
	}
}

function logPrismError(error: unknown): void {
	console.error(
		`[prism] ${error instanceof Error ? error.message : String(error)}`,
	);
}

export async function emitTrace(
	config: PrismConfig,
	trace: PrismTrace,
	fetchImpl: typeof fetch = fetch,
): Promise<void> {
	await post(
		config,
		"/api/traces",
		{
			project_id: config.projectId,
			model: trace.model,
			input_messages: trace.inputMessages,
			output_message: trace.outputMessage,
			latency_ms: Math.round(trace.latencyMs),
			session_id: trace.sessionId,
		},
		fetchImpl,
	);
}

/**
 * Best-effort variant for request paths: tracing must never fail the user's
 * request. Awaited by callers so a Worker isn't frozen mid-POST.
 */
export async function emitTraceSafe(
	config: PrismConfig | null,
	trace: PrismTrace,
): Promise<void> {
	if (!config) return;
	try {
		await emitTrace(config, trace);
	} catch (error) {
		logPrismError(error);
	}
}

// ── Agent runs: span tree + trajectory ───────────────────────────────

export type SpanType = "chain" | "agent" | "llm" | "tool";
export type SpanStatus = "ok" | "error";

/** `SpanInput` on the wire. */
export interface SpanInput {
	span_id: string;
	parent_span_id: string | null;
	name: string;
	span_type: SpanType;
	input_text: string | null;
	output_text: string | null;
	metadata: Record<string, unknown> | null;
	start_time: string;
	end_time: string | null;
	duration_ms: number | null;
	status: SpanStatus;
	error_message: string | null;
	token_count_input: number | null;
	token_count_output: number | null;
	model: string | null;
}

/** `TrajectoryStep` on the wire. */
export interface TrajectoryStep {
	step_type: "reasoning" | "final_answer" | "tool_call";
	label: string;
	input_summary: string | null;
	output_summary: string | null;
	tool_name: string | null;
	duration_ms: number | null;
	token_count: number | null;
	status: "success" | "error";
}

export interface RunTracerOptions {
	/** Groups this run in PRISM's Sessions view. */
	sessionId: string;
	/** Root span name, e.g. "busyq_invoice_run". */
	name: string;
	/** Shown as the agent in PRISM (trajectory agent_id / agent_name). */
	agentName: string;
	/** Root input, e.g. the invoice id being audited. */
	input?: unknown;
	/** Attached to the root span and the ingest request (e.g. agent version). */
	metadata?: Record<string, unknown>;
	/** Also post a trajectory for PRISM evaluation. Default true. */
	trajectory?: boolean;
}

export interface ModelCallUsage {
	output?: string | null;
	model?: string;
	tokensIn?: number;
	tokensOut?: number;
	/** True when the model asked for tools rather than answering. */
	toolCalls?: boolean;
	/** Extra `llm` span metadata, e.g. gateway fallback, cache hit and cost. */
	metadata?: Record<string, unknown>;
}

const MAX_TEXT = 10_000;
const MAX_SUMMARY = 200;

function asText(value: unknown, max = MAX_TEXT): string | null {
	if (value === undefined || value === null) return null;
	const text = typeof value === "string" ? value : JSON.stringify(value);
	return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Tool failures are returned, not thrown (`{ ok: false, error: { message } }`),
 * so a structurally-typed check keeps this module free of agent imports.
 */
function failureMessage(result: unknown): string | null {
	if (
		typeof result === "object" &&
		result !== null &&
		"ok" in result &&
		(result as { ok: unknown }).ok === false
	) {
		const error = (result as { error?: { code?: string; message?: string } })
			.error;
		const code = error?.code ? `${error.code}: ` : "";
		return `${code}${error?.message ?? "tool returned an error"}`;
	}
	return null;
}

/**
 * Records one agent run and flushes it to PRISM as a span tree and a
 * trajectory. Wrap every model call with `traceModelCall` and every tool call
 * with `traceToolCall`, then `await finish()` once. Tracing never throws into
 * the run, and with a null config it only runs the wrapped functions.
 */
export class RunTracer {
	readonly traceId = crypto.randomUUID();
	private readonly rootSpanId = crypto.randomUUID();
	private readonly startedAt = new Date().toISOString();
	private readonly startedMs = performance.now();
	private readonly spans: SpanInput[] = [];
	private readonly steps: TrajectoryStep[] = [];
	private lastModel: string | null = null;
	private finished = false;

	constructor(
		private readonly config: PrismConfig | null,
		private readonly options: RunTracerOptions,
		private readonly fetchImpl: typeof fetch = fetch,
	) {}

	/** Time a tool call. Records `error` when it throws or returns `{ ok: false }`. */
	async traceToolCall<T>(
		name: string,
		input: unknown,
		fn: () => T | Promise<T>,
	): Promise<T> {
		const startTime = new Date().toISOString();
		const t0 = performance.now();
		let result: T | undefined;
		let thrown: unknown;
		try {
			result = await fn();
		} catch (error) {
			thrown = error;
		}
		const durationMs = performance.now() - t0;
		const errorMessage =
			thrown !== undefined
				? thrown instanceof Error
					? thrown.message
					: String(thrown)
				: failureMessage(result);
		const status: SpanStatus = errorMessage ? "error" : "ok";
		const output = asText(thrown === undefined ? result : errorMessage);

		this.spans.push({
			span_id: crypto.randomUUID(),
			parent_span_id: this.rootSpanId,
			name,
			span_type: "tool",
			input_text: asText(input),
			output_text: output,
			metadata: { tool_name: name },
			start_time: startTime,
			end_time: new Date().toISOString(),
			duration_ms: durationMs,
			status,
			error_message: errorMessage,
			token_count_input: null,
			token_count_output: null,
			model: null,
		});
		this.steps.push({
			step_type: "tool_call",
			label: name,
			input_summary: asText(input, MAX_SUMMARY),
			output_summary: asText(output, MAX_SUMMARY),
			tool_name: name,
			duration_ms: Math.round(durationMs),
			token_count: 0,
			status: status === "ok" ? "success" : "error",
		});

		if (thrown !== undefined) throw thrown;
		return result as T;
	}

	/** Time a model call. `usage` pulls output, model and token counts from the response. */
	async traceModelCall<T>(
		model: string,
		input: unknown,
		fn: () => Promise<T>,
		usage: (response: T) => ModelCallUsage = () => ({}),
	): Promise<T> {
		const startTime = new Date().toISOString();
		const t0 = performance.now();
		let response: T | undefined;
		let thrown: unknown;
		try {
			response = await fn();
		} catch (error) {
			thrown = error;
		}
		const durationMs = performance.now() - t0;
		const info = thrown === undefined ? usage(response as T) : {};
		const resolvedModel = info.model ?? model;
		const errorMessage =
			thrown === undefined
				? null
				: thrown instanceof Error
					? thrown.message
					: String(thrown);
		this.lastModel = resolvedModel;

		this.spans.push({
			span_id: crypto.randomUUID(),
			parent_span_id: this.rootSpanId,
			name: `llm:${resolvedModel}`,
			span_type: "llm",
			input_text: asText(input),
			output_text: asText(info.output ?? errorMessage),
			metadata: { ...info.metadata, iteration: this.steps.length + 1 },
			start_time: startTime,
			end_time: new Date().toISOString(),
			duration_ms: durationMs,
			status: errorMessage ? "error" : "ok",
			error_message: errorMessage,
			token_count_input: info.tokensIn ?? null,
			token_count_output: info.tokensOut ?? null,
			model: resolvedModel,
		});
		this.steps.push({
			step_type: info.toolCalls ? "reasoning" : "final_answer",
			label: `LLM call (${resolvedModel})`,
			input_summary: null,
			output_summary: asText(info.output ?? errorMessage, MAX_SUMMARY),
			tool_name: null,
			duration_ms: Math.round(durationMs),
			token_count: (info.tokensIn ?? 0) + (info.tokensOut ?? 0) || null,
			status: errorMessage ? "error" : "success",
		});

		if (thrown !== undefined) throw thrown;
		return response as T;
	}

	/** Whether any recorded span failed so far. */
	get hasErrors(): boolean {
		return this.spans.some((s) => s.status === "error");
	}

	/**
	 * Flush to PRISM. Call once, after the run (also on failure, with
	 * `error`). `metadata` is added to the root span (e.g. a gateway summary
	 * only known at the end). Awaited so a Worker isn't frozen mid-POST; never
	 * throws.
	 */
	async finish(
		result: {
			output?: unknown;
			error?: unknown;
			metadata?: Record<string, unknown>;
		} = {},
	): Promise<void> {
		if (this.finished) return;
		this.finished = true;
		if (!this.config) return;

		const runError =
			result.error === undefined
				? null
				: result.error instanceof Error
					? result.error.message
					: String(result.error);
		const { sessionId, name, agentName, input, metadata = {} } = this.options;
		const root: SpanInput = {
			span_id: this.rootSpanId,
			parent_span_id: null,
			name,
			span_type: "chain",
			input_text: asText(input),
			output_text: asText(result.output ?? runError),
			metadata: {
				...metadata,
				...result.metadata,
				tool_calls: this.steps.filter((s) => s.tool_name).length,
			},
			start_time: this.startedAt,
			end_time: new Date().toISOString(),
			duration_ms: performance.now() - this.startedMs,
			status: runError ? "error" : "ok",
			error_message: runError,
			token_count_input: null,
			token_count_output: null,
			model: this.lastModel,
		};

		const requests: Promise<void>[] = [
			post(
				this.config,
				"/api/spans/ingest",
				{
					trace_id: this.traceId,
					project_id: this.config.projectId,
					session_id: sessionId,
					metadata: { source: "busyq", agent_name: agentName, ...metadata },
					spans: [root, ...this.spans],
				},
				this.fetchImpl,
			),
		];
		if (this.options.trajectory !== false && this.steps.length > 0) {
			requests.push(
				post(
					this.config,
					"/api/trajectories",
					{
						project_id: this.config.projectId,
						conversation_id: sessionId,
						request_id: this.traceId,
						agent_id: agentName,
						agent_name: agentName,
						steps: this.steps,
						total_duration_ms: Math.round(performance.now() - this.startedMs),
						final_status: runError || this.hasErrors ? "error" : "success",
						model: this.lastModel,
					},
					this.fetchImpl,
				),
			);
		}
		for (const outcome of await Promise.allSettled(requests)) {
			if (outcome.status === "rejected") logPrismError(outcome.reason);
		}
	}
}
