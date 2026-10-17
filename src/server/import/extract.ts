/**
 * Read one uploaded document through Nicrron and turn the reply into an
 * editable draft. The model call and the validation step are both PRISM
 * spans on the import's tracer.
 *
 * No env or binding imports here, so tests can pass a fake client.
 */
import { Buffer } from "node:buffer";
import type OpenAI from "openai";
import {
	type Extraction,
	parseExtractionReply,
	type UploadType,
} from "#/lib/import/extraction.ts";
import type { RunTracer } from "#/server/prism.ts";
import { EXTRACTION_PROMPT } from "./prompt.ts";

export interface ImportModels {
	/** Photos and scans: primary vision model. */
	image: string;
	/** Nicrron cascades to these, in order, if the primary fails. */
	imageFallbacks: string[];
	/** PDFs: only models that read `file` parts through Nicrron. */
	pdf: string[];
}

/** Nicrron's `models` list for a content type, primary first, no repeats. */
export function modelsFor(type: UploadType, models: ImportModels): string[] {
	const list =
		type === "application/pdf"
			? models.pdf
			: [models.image, ...models.imageFallbacks];
	return [...new Set(list)];
}

/** The document as a chat content part: images inline, PDFs as a `file` part. */
export function documentPart(
	bytes: Uint8Array,
	type: UploadType,
	filename: string,
): OpenAI.ChatCompletionContentPart {
	const dataUrl = `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
	return type === "application/pdf"
		? { type: "file", file: { filename, file_data: dataUrl } }
		: { type: "image_url", image_url: { url: dataUrl, detail: "high" } };
}

export type ExtractResult =
	| {
			ok: true;
			extraction: Extraction;
			requestedModel: string;
			/** The model Nicrron says answered. */
			model: string;
			fallbackUsed: boolean;
	  }
	| { ok: false; error: string; requestedModel: string; model: string | null };

const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

export async function extractInvoice(input: {
	client: OpenAI;
	tracer: RunTracer;
	bytes: Uint8Array;
	type: UploadType;
	filename: string;
	models: string[];
}): Promise<ExtractResult> {
	const { client, tracer, bytes, type, filename, models } = input;
	const requestedModel = models[0];
	const messages: OpenAI.ChatCompletionMessageParam[] = [
		{ role: "system", content: EXTRACTION_PROMPT },
		{
			role: "user",
			content: [
				{ type: "text", text: `Transcribe this invoice (${filename}).` },
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
				instructions: "EXTRACTION_PROMPT",
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
					max_tokens: 4000,
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

	const fallbackUsed = reply.model !== requestedModel;
	const parsed = await tracer.traceToolCall(
		"validate_extraction",
		{ servedBy: reply.model, requestedModel, fallbackUsed },
		() => {
			const result = parseExtractionReply(reply.content);
			return result.ok
				? {
						ok: true as const,
						data: {
							lines: result.extraction.draft.lines.length,
							uncertain: result.extraction.uncertain,
							issues: result.extraction.issues,
						},
						extraction: result.extraction,
					}
				: {
						ok: false as const,
						error: { code: "invalid_output", message: result.error },
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
	return {
		ok: true,
		extraction: parsed.extraction,
		requestedModel,
		model: reply.model,
		fallbackUsed,
	};
}
