/**
 * The small Nicrron call that classifies an attachment when the rules in
 * src/lib/inbox/classify.ts are unsure. Text only: it sees the redacted
 * subject, the filename, the sender's domain and the start of the redacted
 * body, never the document or anyone's contact details. Traced as an `llm`
 * span plus a `validate_classification` tool span on the email's tracer.
 *
 * No env or binding imports, so tests can pass a fake client.
 */
import type OpenAI from "openai";
import {
	type ModelClassification,
	parseClassificationReply,
} from "#/lib/inbox/classify.ts";
import type { RunTracer } from "#/server/prism.ts";

export const CLASSIFY_PROMPT = `You sort email attachments for a business's accounts-payable inbox.
Classify ONE attachment as exactly one of:
- "invoice_in": a bill from a vendor, supplier or carrier to the business, asking the business to pay (freight bills included).
- "invoice_out": an invoice, quote or receipt the business itself issued to someone else.
- "contract": a contract, rate agreement, bid award, tender, price agreement, renewal or amendment.
- "ignore": anything else (newsletters, logos, proof-of-delivery photos, marketing, signatures).
Known vendors are listed. Use only the information given; do not guess amounts.
Reply with JSON only: {"kind": "...", "reason": "one short sentence"}.`;

export interface ClassifyModelInput {
	/** All values must already be redacted. */
	subject: string;
	filename: string;
	contentType: string;
	senderDomain: string | null;
	bodyExcerpt: string;
	vendors: readonly string[];
	rulesGuess: string;
}

export async function classifyWithModel(input: {
	client: OpenAI;
	tracer: RunTracer;
	models: string[];
	attachment: ClassifyModelInput;
}): Promise<
	| { ok: true; value: ModelClassification; model: string }
	| { ok: false; error: string }
> {
	const { client, tracer, models, attachment } = input;
	const requested = models[0] ?? "nicrron/cheapest";
	const user = JSON.stringify(attachment, null, 1);
	let reply: { content: string; model: string };
	try {
		reply = await tracer.traceModelCall(
			requested,
			{ instructions: "CLASSIFY_PROMPT", attachment, models },
			async () => {
				const res = await client.chat.completions.create({
					model: requested,
					// Nicrron extension: ordered fallbacks on 429/5xx.
					models,
					messages: [
						{ role: "system", content: CLASSIFY_PROMPT },
						{ role: "user", content: user },
					],
					temperature: 0,
					max_tokens: 200,
					response_format: { type: "json_object" },
				} as OpenAI.ChatCompletionCreateParamsNonStreaming);
				return {
					content: res.choices[0]?.message?.content ?? "",
					model: res.model || requested,
					tokensIn: res.usage?.prompt_tokens,
					tokensOut: res.usage?.completion_tokens,
				};
			},
			(r) => ({
				output: r.content,
				model: r.model,
				tokensIn: r.tokensIn,
				tokensOut: r.tokensOut,
				metadata: { purpose: "inbox_classification" },
			}),
		);
	} catch (e) {
		return {
			ok: false,
			error: `Model call failed: ${e instanceof Error ? e.message : String(e)}`,
		};
	}
	const parsed = await tracer.traceToolCall(
		"validate_classification",
		{ servedBy: reply.model },
		() => {
			const r = parseClassificationReply(reply.content);
			return r.ok
				? { ok: true as const, data: r.value }
				: {
						ok: false as const,
						error: { code: "invalid_output", message: r.error },
					};
		},
	);
	return parsed.ok
		? { ok: true, value: parsed.data, model: reply.model }
		: { ok: false, error: parsed.error.message };
}
