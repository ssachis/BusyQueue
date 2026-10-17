/**
 * "Write summary" on the projections page: the model narrates the forecast,
 * code checks every figure it quotes. Server-only.
 *
 * The forecast is recomputed here from D1 (the client's copy is never
 * trusted), formatted into facts by code, and sent to Nicrron with the
 * `models` fallback list. If the text quotes a money amount or percentage
 * that is not in the facts, the model gets one retry with the bad figures
 * named; a second failure is returned flagged, never silently shown.
 *
 * Traced to PRISM as one session per summary (agent `busyq-digest`): the
 * forecast build and each figure check are `tool` spans, each model call an
 * `llm` span.
 */
import type OpenAI from "openai";
import { fail, ok } from "#/lib/busyq/types.ts";
import {
	checkDigestText,
	DIGEST_SYSTEM_PROMPT,
	type DigestCheck,
	digestFacts,
	digestRetryPrompt,
	digestUserPrompt,
} from "#/lib/projections/digest.ts";
import { prismConfig } from "#/server/agent/tracing.ts";
import { getServerEnv } from "./env.ts";
import { fallbackList, getNicrron } from "./nicrron.ts";
import { RunTracer } from "./prism.ts";
import { loadProjections } from "./projections-store.ts";

export const DIGEST_AGENT = "busyq-digest";

export interface DigestResult {
	text: string;
	asOf: string;
	check: DigestCheck;
	/** Model attempts (1, or 2 after a rejected first draft). */
	attempts: number;
	/** The model hit its output limit, so the text may stop mid-sentence. */
	truncated: boolean;
	requestedModel: string;
	model: string;
	prismTraceId: string;
}

export async function writeDigest(asOf?: string): Promise<DigestResult> {
	const env = getServerEnv();
	const models = fallbackList(env.DIGEST_MODEL, env.DIGEST_FALLBACK_MODELS);
	const sessionId = `digest-${crypto.randomUUID().slice(0, 8)}`;
	const tracer = new RunTracer(prismConfig(env), {
		sessionId,
		name: "busyq_projections_digest",
		agentName: DIGEST_AGENT,
		input: { asOf: asOf ?? "default" },
		metadata: {
			digest_id: sessionId,
			requested_model: env.DIGEST_MODEL,
			fallback_models: env.DIGEST_FALLBACK_MODELS,
		},
	});

	try {
		const built = await tracer.traceToolCall(
			"build_forecast",
			{ asOf: asOf ?? "default" },
			async () => {
				const data = await loadProjections(asOf);
				return ok({
					asOf: data.asOf,
					facts: digestFacts(data.digestInput),
					openItems: data.forecast.calendar.items.length,
					priceRises: data.forecast.priceRises.length,
					trend: data.forecast.trend.status,
				});
			},
		);
		if (!built.ok) throw new Error(built.error.message);
		const { facts } = built.data;

		const messages: OpenAI.ChatCompletionMessageParam[] = [
			{ role: "system", content: DIGEST_SYSTEM_PROMPT },
			{ role: "user", content: digestUserPrompt(facts) },
		];
		const client = getNicrron(env);
		const complete = (attempt: number) =>
			tracer.traceModelCall(
				env.DIGEST_MODEL,
				messages,
				() =>
					client.chat.completions.create({
						model: env.DIGEST_MODEL,
						// Nicrron extension: ordered fallbacks on 429/5xx.
						...(models.length > 1 ? { models } : {}),
						messages,
						temperature: 0,
						// Room for the model's reasoning tokens as well as the text.
						max_tokens: 3000,
					} as OpenAI.ChatCompletionCreateParamsNonStreaming),
				(res) => ({
					output: res.choices[0]?.message?.content ?? null,
					model: res.model || env.DIGEST_MODEL,
					tokensIn: res.usage?.prompt_tokens,
					tokensOut: res.usage?.completion_tokens,
					metadata: {
						gateway: "nicrron",
						requested_model: env.DIGEST_MODEL,
						fallback_used: Boolean(res.model) && res.model !== env.DIGEST_MODEL,
						finish_reason: res.choices[0]?.finish_reason ?? null,
						attempt,
					},
				}),
			);
		const checkText = async (
			text: string,
			attempt: number,
		): Promise<DigestCheck> => {
			const check = checkDigestText(text, facts);
			await tracer.traceToolCall(
				"check_digest_figures",
				{ attempt, chars: text.length },
				() =>
					check.ok
						? ok(check)
						: fail(
								"invalid_input",
								"The summary quotes figures that are not in the forecast.",
								{
									unknownAmounts: check.unknownAmounts,
									unknownPercents: check.unknownPercents,
								},
							),
			);
			return check;
		};

		let attempts = 1;
		let reply = await complete(attempts);
		let text = reply.choices[0]?.message?.content?.trim() ?? "";
		let check = await checkText(text, attempts);
		if (!check.ok) {
			attempts = 2;
			messages.push(
				{ role: "assistant", content: text },
				{ role: "user", content: digestRetryPrompt(check) },
			);
			reply = await complete(attempts);
			text = reply.choices[0]?.message?.content?.trim() ?? "";
			check = await checkText(text, attempts);
		}
		if (!text) throw new Error("The model returned an empty summary.");

		const model = reply.model || env.DIGEST_MODEL;
		const truncated = reply.choices[0]?.finish_reason === "length";
		await tracer.finish({
			output: { asOf: built.data.asOf, text, check },
			metadata: {
				as_of: built.data.asOf,
				attempts,
				figures_ok: check.ok,
				truncated,
				resolved_model: model,
			},
			...(check.ok
				? {}
				: { error: "Summary rejected: figures not in the forecast." }),
		});
		return {
			text,
			asOf: built.data.asOf,
			check,
			attempts,
			truncated,
			requestedModel: env.DIGEST_MODEL,
			model,
			prismTraceId: tracer.traceId,
		};
	} catch (error) {
		await tracer.finish({ error });
		throw error;
	}
}
