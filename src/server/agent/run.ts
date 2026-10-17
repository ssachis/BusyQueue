/**
 * The agent loop: one run audits one invoice. The model chooses tools and
 * writes prose; tools (code) produce every finding and amount. Each model
 * call and tool call is traced to PRISM through the run's tracer.
 */
import type OpenAI from "openai";
import type { AgentVersion, Finding } from "#/lib/busyq/types.ts";
import { type Money, zero } from "#/lib/money/index.ts";
import {
	CACHE_HEADER,
	fallbackList,
	generationCost,
	isRoutingPreset,
} from "#/server/nicrron.ts";
import type { RunTracer } from "#/server/prism.ts";
import {
	type GatewaySummary,
	gatewayMetadata,
	replyMetadata,
	summarizeGateway,
} from "./gateway.ts";
import { SYSTEM_PROMPT } from "./prompt.ts";
import type { AgentStore, DraftRecord } from "./store.ts";
import {
	allFindings,
	executeTool,
	REQUIRED_TOOLS,
	type RunState,
	TOOL_SPECS,
} from "./tools.ts";
import { LOOKUPS } from "./versions.ts";

type Message = OpenAI.ChatCompletionMessageParam;

export interface ModelReply {
	/** The model that answered (resolved by Nicrron). */
	model: string;
	content: string | null;
	toolCalls: { id: string; name: string; arguments: string }[];
	tokensIn?: number;
	tokensOut?: number;
	// ── Gateway details (Nicrron) ──
	/** The model asked for: first in the `models` list, or a nicrron/* preset. */
	requestedModel?: string;
	/** Answered by a model further down the fallback list. */
	fallback?: boolean;
	/** Served from Nicrron's exact cache (`X-Nicrron-Cache: HIT`). */
	cacheHit?: boolean;
	/** Round trip to the gateway, excluding the cost lookup. */
	latencyMs?: number;
	/** USD Nicrron settled for this call, as a decimal string. */
	costUsd?: string;
	/** Nicrron's completion id (`gen-...`, also the `x-request-id` header). */
	requestId?: string;
	/** Provider prompt-cache reads Nicrron passes through (`usage.cache_read_tokens`). */
	promptCacheReadTokens?: number;
}

/** One chat-completion round trip with tools. Swappable in tests. */
export type ChatModel = (
	messages: Message[],
	tools: OpenAI.ChatCompletionTool[],
) => Promise<ModelReply>;

export interface NicrronModelOptions {
	/** Primary model or nicrron/* routing preset. */
	model: string;
	/** Ordered fallbacks, sent as Nicrron's `models` array after the primary. */
	fallbacks?: readonly string[];
	/** Look up what Nicrron charged per call. Default true. */
	lookupCost?: boolean;
	/** For the cost lookup; tests pass a fake. */
	fetchImpl?: typeof fetch;
}

export function nicrronChatModel(
	client: OpenAI,
	options: NicrronModelOptions,
): ChatModel {
	const { model } = options;
	const models = fallbackList(model, options.fallbacks ?? []);
	return async (messages, tools) => {
		const t0 = performance.now();
		const { data: res, response } = await client.chat.completions
			.create({
				model,
				// Nicrron extension, not in the OpenAI types: cascade on 429/5xx.
				...(models.length > 1 ? { models } : {}),
				messages,
				tools,
				tool_choice: "auto",
				temperature: 0,
			} as OpenAI.ChatCompletionCreateParamsNonStreaming)
			.withResponse();
		const latencyMs = performance.now() - t0;
		const resolved = res.model || model;
		const costUsd =
			options.lookupCost === false || !res.id
				? undefined
				: await generationCost(client, res.id, options.fetchImpl);
		const usage = res.usage as
			| (OpenAI.CompletionUsage & { cache_read_tokens?: number })
			| undefined;
		const message = res.choices[0]?.message;
		return {
			model: resolved,
			content: message?.content ?? null,
			toolCalls: (message?.tool_calls ?? [])
				.filter((c) => c.type === "function")
				.map((c) => ({
					id: c.id,
					name: c.function.name,
					arguments: c.function.arguments,
				})),
			tokensIn: usage?.prompt_tokens,
			tokensOut: usage?.completion_tokens,
			requestedModel: model,
			// With a preset the gateway chooses the model, so only a concrete
			// primary can be said to have fallen back.
			fallback: !isRoutingPreset(model) && resolved !== model,
			cacheHit: response.headers.get(CACHE_HEADER)?.toUpperCase() === "HIT",
			latencyMs,
			...(costUsd !== undefined ? { costUsd } : {}),
			...(res.id ? { requestId: res.id } : {}),
			...(usage?.cache_read_tokens !== undefined
				? { promptCacheReadTokens: usage.cache_read_tokens }
				: {}),
		};
	};
}

export interface RunInput {
	invoiceId: string;
	version: AgentVersion;
}

export interface RunDeps {
	store: AgentStore;
	model: ChatModel;
	/** Requested model name, recorded until the gateway reports the resolved one. */
	modelName: string;
	tracerFor: (runId: string) => RunTracer;
	runId?: string;
	maxModelCalls?: number;
}

/** One tool call as the batch runner and UI see it. */
export interface ToolCallSummary {
	name: string;
	status: "ok" | "error";
	errorCode?: string;
	/** The tool's own error message and structured details (e.g. unmatched lines). */
	errorMessage?: string;
	details?: Record<string, unknown>;
}

export type RunErrorCode =
	| "model_error"
	| "incomplete"
	| "max_turns"
	| "internal";

/** A run-level failure (not a tool returning an error, which is normal). */
export class AgentRunError extends Error {
	constructor(
		readonly code: RunErrorCode,
		message: string,
	) {
		super(message);
	}
}

/** Response of `POST /api/runs`; matches `RunResponse` in src/lib/busyq/batch.ts. */
export interface RunResult {
	runId: string;
	invoiceId: string;
	version: AgentVersion;
	status: "completed" | "failed";
	model: string | null;
	explanation: string | null;
	error?: { code: RunErrorCode; message: string };
	toolCalls: ToolCallSummary[];
	findings: Finding[];
	unpricedLines: number;
	total: Money;
	draft: DraftRecord | null;
	prismTraceId: string;
	/** What the Nicrron gateway did: models used, fallbacks, cache hits, cost. */
	gateway: GatewaySummary;
}

const MAX_NUDGES = 2;

export async function runAgent(
	input: RunInput,
	deps: RunDeps,
): Promise<RunResult> {
	const lookup = LOOKUPS[input.version];
	if (!lookup)
		throw new Error(`Agent version ${input.version} is not available yet`);

	const runId = deps.runId ?? crypto.randomUUID();
	const tracer = deps.tracerFor(runId);
	const state: RunState = {
		invoiceId: input.invoiceId,
		lookup,
		agreedPrices: [],
	};
	const called = new Set<string>();
	const messages: Message[] = [
		{ role: "system", content: SYSTEM_PROMPT },
		{ role: "user", content: `Audit invoice ${input.invoiceId}.` },
	];

	await deps.store.startRun({
		id: runId,
		invoiceId: input.invoiceId,
		version: input.version,
		prismTraceId: tracer.traceId,
	});

	let model: string | null = null;
	let explanation: string | null = null;
	let error: { code: RunErrorCode; message: string } | undefined;
	const toolCalls: ToolCallSummary[] = [];
	const replies: ModelReply[] = [];
	let nudges = 0;

	try {
		for (let turn = 0; turn < (deps.maxModelCalls ?? 16); turn++) {
			const reply = await tracer.traceModelCall(
				deps.modelName,
				messages.at(-1),
				() =>
					deps.model(messages, TOOL_SPECS).catch((e: unknown) => {
						throw new AgentRunError(
							"model_error",
							e instanceof Error ? e.message : String(e),
						);
					}),
				(r) => ({
					output: r.content ?? r.toolCalls.map((c) => c.name).join(", "),
					model: r.model,
					tokensIn: r.tokensIn,
					tokensOut: r.tokensOut,
					toolCalls: r.toolCalls.length > 0,
					metadata: replyMetadata(r),
				}),
			);
			replies.push(reply);
			model = reply.model;
			messages.push({
				role: "assistant",
				content: reply.content,
				...(reply.toolCalls.length
					? {
							tool_calls: reply.toolCalls.map((c) => ({
								id: c.id,
								type: "function" as const,
								function: { name: c.name, arguments: c.arguments },
							})),
						}
					: {}),
			});

			if (reply.toolCalls.length === 0) {
				const missing = REQUIRED_TOOLS.filter((t) => !called.has(t));
				const needsDraft = (state.impact?.total.minor ?? 0) > 0 && !state.draft;
				if ((missing.length > 0 || needsDraft) && nudges < MAX_NUDGES) {
					nudges++;
					messages.push({
						role: "user",
						content: missing.length
							? `You haven't called: ${missing.join(", ")}. Call them before finishing.`
							: "The total impact is above zero. Call save_dispute_draft before finishing.",
					});
					continue;
				}
				if (missing.length > 0) {
					throw new AgentRunError(
						"incomplete",
						`Agent finished without calling: ${missing.join(", ")}`,
					);
				}
				explanation = reply.content?.trim() || null;
				break;
			}

			for (const call of reply.toolCalls) {
				called.add(call.name);
				const result = await tracer.traceToolCall(
					call.name,
					call.arguments,
					() => executeTool(call.name, call.arguments, state, deps.store),
				);
				toolCalls.push(
					result.ok
						? { name: call.name, status: "ok" }
						: {
								name: call.name,
								status: "error",
								errorCode: result.error.code,
								errorMessage: result.error.message,
								...(result.error.details
									? { details: result.error.details }
									: {}),
							},
				);
				messages.push({
					role: "tool",
					tool_call_id: call.id,
					content: JSON.stringify(result),
				});
			}
		}
		if (explanation === null) {
			throw new AgentRunError(
				"max_turns",
				"Agent did not finish within the model-call limit",
			);
		}
	} catch (e) {
		error =
			e instanceof AgentRunError
				? { code: e.code, message: e.message }
				: {
						code: "internal",
						message: e instanceof Error ? e.message : String(e),
					};
	}

	const currency = state.invoice?.currency ?? "USD";
	const total = state.impact?.total ?? zero(currency);
	const draft: DraftRecord | null =
		state.draft && total.minor > 0
			? {
					id: crypto.randomUUID(),
					subject: state.draft.subject,
					body: state.draft.body,
					totalImpactMinor: total.minor,
					currency: total.currency,
				}
			: null;
	const result: RunResult = {
		runId,
		invoiceId: input.invoiceId,
		version: input.version,
		status: error ? "failed" : "completed",
		model,
		explanation,
		error,
		toolCalls,
		findings: allFindings(state),
		unpricedLines: state.compared?.unpriced.length ?? 0,
		total,
		draft,
		prismTraceId: tracer.traceId,
		gateway: summarizeGateway(deps.modelName, replies),
	};

	try {
		await deps.store.finishRun({
			id: runId,
			invoiceId: input.invoiceId,
			status: result.status,
			model,
			explanation,
			error: error ? `${error.code}: ${error.message}` : null,
			toolCalls,
			findings: result.findings,
			draft,
		});
	} finally {
		await tracer.finish({
			...(error
				? { error: `${error.code}: ${error.message}` }
				: { output: explanation ?? undefined }),
			metadata: gatewayMetadata(result.gateway),
		});
	}
	return result;
}
