/**
 * Read one of the business's own documents through Nicrron and turn the
 * reply into a reviewable form. The model call is an `llm` span (with the
 * model Nicrron says answered and whether it fell back); each code step that
 * follows (read, tax-code mapping, totals check) is a `tool` span on the same
 * import tracer.
 *
 * No env or binding imports here, so tests can pass a fake client.
 */
import type OpenAI from "openai";
import {
	type DocExtraction,
	parseDocReply,
} from "#/lib/doc-import/extraction.ts";
import type { SellerContext } from "#/lib/doc-import/form.ts";
import { checkTotals, formTotals } from "#/lib/doc-import/validate.ts";
import type { UploadType } from "#/lib/import/extraction.ts";
import { documentPart } from "#/server/import/extract.ts";
import { isRoutingPreset } from "#/server/nicrron.ts";
import type { RunTracer } from "#/server/prism.ts";
import { DOC_IMPORT_PROMPT } from "./prompt.ts";

export type DocExtractResult =
	| {
			ok: true;
			extraction: DocExtraction;
			requestedModel: string;
			/** The model Nicrron says answered. */
			model: string;
			fallbackUsed: boolean;
	  }
	| { ok: false; error: string; requestedModel: string; model: string | null };

const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

export async function extractDocument(input: {
	client: OpenAI;
	tracer: RunTracer;
	bytes: Uint8Array;
	type: UploadType;
	filename: string;
	/** Nicrron `models` list, primary first. */
	models: string[];
	seller: SellerContext;
}): Promise<DocExtractResult> {
	const { client, tracer, bytes, type, filename, models, seller } = input;
	const requestedModel = models[0];
	const messages: OpenAI.ChatCompletionMessageParam[] = [
		{ role: "system", content: DOC_IMPORT_PROMPT },
		{
			role: "user",
			content: [
				{
					type: "text",
					text: `Transcribe this document (${filename}). It was issued by ${seller.name}; the buyer is its customer.`,
				},
				documentPart(bytes, type, filename),
			],
		},
	];

	let reply: { content: string; model: string };
	try {
		reply = await tracer.traceModelCall(
			requestedModel,
			// The document itself stays out of PRISM; its name and size go in.
			{
				instructions: "DOC_IMPORT_PROMPT",
				document: `${filename} (${type}, ${kb(bytes.length)})`,
				models,
			},
			async () => {
				const res = await client.chat.completions.create({
					model: requestedModel,
					// Nicrron extension: ordered fallbacks on 429/5xx.
					models,
					messages,
					temperature: 0,
					max_tokens: 6000,
					response_format: { type: "json_object" },
				} as OpenAI.ChatCompletionCreateParamsNonStreaming);
				return {
					content: res.choices[0]?.message?.content ?? "",
					model: res.model || requestedModel,
					tokensIn: res.usage?.prompt_tokens,
					tokensOut: res.usage?.completion_tokens,
				};
			},
			(r) => ({
				output: r.content,
				model: r.model,
				tokensIn: r.tokensIn,
				tokensOut: r.tokensOut,
				metadata: {
					gateway: "nicrron",
					requested_model: requestedModel,
					resolved_model: r.model,
					fallback_models: models.slice(1),
					fallback_used: isFallback(requestedModel, r.model),
				},
			}),
		);
	} catch (e) {
		return {
			ok: false,
			error: `Model call failed: ${e instanceof Error ? e.message : String(e)}`,
			requestedModel,
			model: null,
		};
	}

	const fallbackUsed = isFallback(requestedModel, reply.model);
	const parsed = await tracer.traceToolCall(
		"read_document",
		{ servedBy: reply.model, requestedModel, fallbackUsed },
		() => {
			const result = parseDocReply(reply.content, seller);
			if (!result.ok) {
				return {
					ok: false as const,
					error: { code: "invalid_output", message: result.error },
				};
			}
			const { form, uncertain, issues } = result.extraction;
			return {
				ok: true as const,
				data: {
					type: form.type,
					lines: form.lines.length,
					uncertain,
					issues,
				},
				extraction: result.extraction,
			};
		},
	);
	if (!parsed.ok) {
		return {
			ok: false,
			error: parsed.error.message,
			requestedModel,
			model: reply.model,
		};
	}
	const { extraction } = parsed;

	await tracer.traceToolCall(
		"map_tax_codes",
		{
			sellerCountry: seller.country,
			buyerRegion: extraction.form.buyer.region,
		},
		() => ({
			ok: true,
			data: extraction.form.lines.map((l, i) => ({
				line: i + 1,
				printed: l.printedRate || null,
				taxCode: l.taxCode || null,
				rate: l.rate || undefined,
				flagged: extraction.uncertain.includes(`lines.${i}.taxCode`),
				reason: extraction.reasons[`lines.${i}.taxCode`],
			})),
		}),
	);

	// Printed totals are compared with the tax engine's, never trusted.
	await tracer.traceToolCall(
		"check_totals",
		{ printed: extraction.form.printed },
		() => {
			const totals = formTotals(extraction.form, seller);
			if (!totals.ok) {
				return {
					ok: true,
					data: { computed: false, reason: totals.error },
				};
			}
			const { mismatches } = checkTotals(extraction.form, totals.result);
			return {
				ok: true,
				data: {
					computed: true,
					subtotalMinor: totals.result.subtotalMinor,
					taxMinor: totals.result.taxMinor,
					totalMinor: totals.result.totalMinor,
					currency: totals.result.currency,
					mismatch: Object.keys(mismatches).length > 0,
					mismatches,
				},
			};
		},
	);

	return {
		ok: true,
		extraction,
		requestedModel,
		model: reply.model,
		fallbackUsed,
	};
}

/** A different model answering a concrete request is a fallback; a preset resolving is routing. */
function isFallback(requested: string, served: string): boolean {
	return !isRoutingPreset(requested) && served !== requested;
}
