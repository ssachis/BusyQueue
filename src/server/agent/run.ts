/**
 * The agent loop: one run audits one invoice. The model chooses tools and
 * writes prose; tools (code) produce every finding and amount. Each model
 * call and tool call is traced to PRISM through the run's tracer.
 */
import type OpenAI from "openai";
import type { AgentVersion, Finding } from "#/lib/busyq/types.ts";
import { type Money, zero } from "#/lib/money/index.ts";
import type { RunTracer } from "#/server/prism.ts";
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
	model: string;
	content: string | null;
	toolCalls: { id: string; name: string; arguments: string }[];
	tokensIn?: number;
	tokensOut?: number;
}

/** One chat-completion round trip with tools. Swappable in tests. */
export type ChatModel = (
	messages: Message[],
	tools: OpenAI.ChatCompletionTool[],
) => Promise<ModelReply>;

export function nicrronChatModel(client: OpenAI, model: string): ChatModel {
	return async (messages, tools) => {
		const res = await client.chat.completions.create({
			model,
			messages,
			tools,
			tool_choice: "auto",
			temperature: 0,
		});
		const message = res.choices[0]?.message;
		return {
			model: res.model || model,
			content: message?.content ?? null,
			toolCalls: (message?.tool_calls ?? [])
				.filter((c) => c.type === "function")
				.map((c) => ({
					id: c.id,
					name: c.function.name,
					arguments: c.function.arguments,
				})),
			tokensIn: res.usage?.prompt_tokens,
			tokensOut: res.usage?.completion_tokens,
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

export interface RunResult {
	runId: string;
	invoiceId: string;
	version: AgentVersion;
	status: "completed" | "failed";
	model: string | null;
	explanation: string | null;
	error: string | null;
	toolCalls: number;
	findings: Finding[];
	unpricedLines: number;
	total: Money;
	draft: DraftRecord | null;
	prismTraceId: string;
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
	let error: string | null = null;
	let toolCalls = 0;
	let nudges = 0;

	try {
		for (let turn = 0; turn < (deps.maxModelCalls ?? 16); turn++) {
			const reply = await tracer.traceModelCall(
				deps.modelName,
				messages.at(-1),
				() => deps.model(messages, TOOL_SPECS),
				(r) => ({
					output: r.content ?? r.toolCalls.map((c) => c.name).join(", "),
					model: r.model,
					tokensIn: r.tokensIn,
					tokensOut: r.tokensOut,
					toolCalls: r.toolCalls.length > 0,
				}),
			);
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
					throw new Error(
						`Agent finished without calling: ${missing.join(", ")}`,
					);
				}
				explanation = reply.content?.trim() || null;
				break;
			}

			for (const call of reply.toolCalls) {
				called.add(call.name);
				toolCalls++;
				const result = await tracer.traceToolCall(
					call.name,
					call.arguments,
					() => executeTool(call.name, call.arguments, state, deps.store),
				);
				messages.push({
					role: "tool",
					tool_call_id: call.id,
					content: JSON.stringify(result),
				});
			}
		}
		if (explanation === null && error === null) {
			throw new Error("Agent did not finish within the model-call limit");
		}
	} catch (e) {
		error = e instanceof Error ? e.message : String(e);
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
	};

	try {
		await deps.store.finishRun({
			id: runId,
			invoiceId: input.invoiceId,
			status: result.status,
			model,
			explanation,
			error,
			toolCalls,
			findings: result.findings,
			draft,
		});
	} finally {
		await tracer.finish(
			error ? { error } : { output: explanation ?? undefined },
		);
	}
	return result;
}
