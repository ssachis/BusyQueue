import type OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { RunTracer } from "#/server/prism.ts";
import { documentPart, extractInvoice, modelsFor } from "./extract.ts";

const MODELS = {
	image: "anthropic/claude-sonnet-5-5",
	imageFallbacks: ["openai/gpt-5.4", "anthropic/claude-sonnet-5-5"],
	pdf: ["openai/gpt-5.4", "openai/gpt-5.4-mini"],
};

const REPLY = JSON.stringify({
	documentType: "invoice",
	vendor: "Valley Fresh Produce",
	invoiceNumber: "VF-1003",
	issueDate: "2026-08-07",
	dueDate: "2026-09-06",
	currency: "USD",
	statedTotal: "1,982.00",
	lines: [
		{
			item: "Apples",
			quantity: "20",
			unit: "case",
			unitPrice: "24.00",
			amount: "480.00",
		},
	],
	uncertain: [],
	notes: null,
});

/** Records the request and answers as `servedBy`. */
function fakeClient(content: string, servedBy?: string) {
	const requests: Record<string, unknown>[] = [];
	const client = {
		chat: {
			completions: {
				create: async (body: Record<string, unknown>) => {
					requests.push(body);
					return {
						model: servedBy ?? body.model,
						choices: [{ message: { content } }],
						usage: { prompt_tokens: 800, completion_tokens: 200 },
					};
				},
			},
		},
	} as unknown as OpenAI;
	return { client, requests };
}

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("modelsFor", () => {
	it("puts the primary first and drops repeats for images", () => {
		expect(modelsFor("image/png", MODELS)).toEqual([
			"anthropic/claude-sonnet-5-5",
			"openai/gpt-5.4",
		]);
	});
	it("uses the PDF list for PDFs", () => {
		expect(modelsFor("application/pdf", MODELS)).toEqual(MODELS.pdf);
	});
});

describe("documentPart", () => {
	it("sends images as a data-URL image part", () => {
		const part = documentPart(png, "image/png", "a.png");
		expect(part).toMatchObject({
			type: "image_url",
			image_url: {
				url: expect.stringMatching(/^data:image\/png;base64,iVBORw0KGgo/),
			},
		});
	});
	it("sends PDFs as a file part", () => {
		const part = documentPart(
			new Uint8Array([0x25]),
			"application/pdf",
			"a.pdf",
		);
		expect(part).toEqual({
			type: "file",
			file: {
				filename: "a.pdf",
				file_data: "data:application/pdf;base64,JQ==",
			},
		});
	});
});

describe("extractInvoice", () => {
	const run = (client: OpenAI) =>
		extractInvoice({
			client,
			tracer: new RunTracer(null, {
				sessionId: "s",
				name: "t",
				agentName: "busyq-importer",
			}),
			bytes: png,
			type: "image/png",
			filename: "inv-1003.png",
			models: modelsFor("image/png", MODELS),
		});

	it("asks Nicrron with the fallback list and JSON mode", async () => {
		const { client, requests } = fakeClient(REPLY);
		const result = await run(client);
		expect(requests[0]).toMatchObject({
			model: "anthropic/claude-sonnet-5-5",
			models: ["anthropic/claude-sonnet-5-5", "openai/gpt-5.4"],
			response_format: { type: "json_object" },
			temperature: 0,
		});
		expect(result).toMatchObject({
			ok: true,
			model: "anthropic/claude-sonnet-5-5",
			fallbackUsed: false,
		});
		if (result.ok) expect(result.extraction.draft.statedTotal).toBe("1982.00");
	});

	it("reports when Nicrron answered with a fallback model", async () => {
		const { client } = fakeClient(REPLY, "openai/gpt-5.4");
		expect(await run(client)).toMatchObject({
			ok: true,
			requestedModel: "anthropic/claude-sonnet-5-5",
			model: "openai/gpt-5.4",
			fallbackUsed: true,
		});
	});

	it("returns an error, not a draft, when the reply is unusable", async () => {
		const { client } = fakeClient("I don't see a document attached.");
		expect(await run(client)).toEqual({
			ok: false,
			error: "The model did not return a JSON object",
			requestedModel: "anthropic/claude-sonnet-5-5",
			model: "anthropic/claude-sonnet-5-5",
		});
	});

	it("returns an error when the model call fails", async () => {
		const client = {
			chat: {
				completions: {
					create: async () => {
						throw new Error("503 all models unavailable");
					},
				},
			},
		} as unknown as OpenAI;
		expect(await run(client)).toMatchObject({
			ok: false,
			error: "Model call failed: 503 all models unavailable",
			model: null,
		});
	});
});
