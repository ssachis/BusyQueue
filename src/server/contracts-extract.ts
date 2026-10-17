/**
 * Read a contract with a model through Nicrron, check what it transcribed,
 * and save it as a draft for the director to review. Server-only.
 *
 * Traced to PRISM as one session per contract (`sessionId = contractId`):
 * the model call is an `llm` span (with the model that actually answered,
 * after Nicrron's fallbacks), and each code step is a `tool` span, so a
 * blocked price or an unmatched vendor shows up as a failed step.
 */
import type OpenAI from "openai";
import { fail, ok } from "#/lib/busyq/types.ts";
import {
	CONTRACT_SYSTEM_PROMPT,
	contractUserPrompt,
	diffPriceList,
	matchContractVendor,
	type ParsedContract,
	parseExtraction,
	parseModelJson,
} from "#/lib/contracts/index.ts";
import { prismConfig } from "#/server/agent/tracing.ts";
import {
	insertContractDraft,
	listVendors,
	pricesByVendor,
} from "./contracts-store.ts";
import { getServerEnv } from "./env.ts";
import { getNicrron } from "./nicrron.ts";
import { RunTracer } from "./prism.ts";

export const CONTRACTS_AGENT = "busyq-contracts";

export interface ExtractInput {
	text: string;
	sourceName: string | null;
}

export interface ExtractResult {
	id: string;
	model: string;
	prismTraceId: string;
}

export class ContractReadError extends Error {}

export async function extractContract(
	input: ExtractInput,
): Promise<ExtractResult> {
	const env = getServerEnv();
	const id = `ctr-${crypto.randomUUID().slice(0, 8)}`;
	const tracer = new RunTracer(prismConfig(env), {
		sessionId: id,
		name: "busyq_contract_extraction",
		agentName: CONTRACTS_AGENT,
		input: {
			contractId: id,
			sourceName: input.sourceName,
			chars: input.text.length,
		},
		metadata: {
			contract_id: id,
			step: "extract",
			requested_model: env.CONTRACT_MODEL,
			fallback_models: env.CONTRACT_FALLBACK_MODELS,
		},
	});

	try {
		const messages: OpenAI.ChatCompletionMessageParam[] = [
			{ role: "system", content: CONTRACT_SYSTEM_PROMPT },
			{
				role: "user",
				content: contractUserPrompt(input.text, input.sourceName),
			},
		];
		const completion = await tracer.traceModelCall(
			env.CONTRACT_MODEL,
			messages,
			() =>
				getNicrron(env).chat.completions.create({
					model: env.CONTRACT_MODEL,
					messages,
					temperature: 0,
					response_format: { type: "json_object" },
					// Nicrron extension: ordered fallbacks on error / rate limit.
					...(env.CONTRACT_FALLBACK_MODELS.length
						? { models: env.CONTRACT_FALLBACK_MODELS }
						: {}),
				} as OpenAI.ChatCompletionCreateParamsNonStreaming),
			(res) => ({
				output: res.choices[0]?.message?.content ?? null,
				model: res.model || env.CONTRACT_MODEL,
				tokensIn: res.usage?.prompt_tokens,
				tokensOut: res.usage?.completion_tokens,
			}),
		);
		const model = completion.model || env.CONTRACT_MODEL;
		const content = completion.choices[0]?.message?.content ?? null;

		// A contract with no usable prices is still saved so the director can
		// see why; only an unreadable reply stops here.
		let parsed: ParsedContract | null = null;
		const parseStep = await tracer.traceToolCall(
			"parse_extraction",
			{ chars: content?.length ?? 0 },
			() => {
				const json = parseModelJson(content);
				if (!json.ok) return fail("invalid_input", json.error);
				parsed = parseExtraction(json.value, {
					sourceText: input.text,
					defaultCurrency: "USD",
				});
				const usable = parsed.prices.filter((p) => !p.blocked).length;
				const summary = {
					prices: parsed.prices.length,
					usable,
					flags: parsed.flags.map(
						(f) => `${f.severity} ${f.path}: ${f.message}`,
					),
				};
				return usable === 0
					? fail(
							"invalid_input",
							"No usable agreed prices were found.",
							summary,
						)
					: ok(summary);
			},
		);
		if (!parsed) {
			throw new ContractReadError(
				parseStep.ok ? "Could not read the contract." : parseStep.error.message,
			);
		}
		const { terms, prices, flags }: ParsedContract = parsed;

		const [vendors, byVendor] = await Promise.all([
			listVendors(),
			pricesByVendor(),
		]);
		// Not an error when unmatched: the director picks or creates the vendor.
		const match = await tracer.traceToolCall(
			"match_vendor",
			{ printed: terms.vendorName },
			() => ({
				ok: true as const,
				data: matchContractVendor(terms.vendorName, vendors),
			}),
		);
		await tracer.traceToolCall(
			"diff_price_list",
			{
				vendorId: match.data.status === "matched" ? match.data.vendor.id : null,
			},
			() => {
				const current =
					match.data.status === "matched"
						? (byVendor[match.data.vendor.id] ?? [])
						: [];
				const diff = diffPriceList(current, prices, terms.currency);
				return {
					ok: true as const,
					data: {
						counts: diff.counts,
						changed: diff.rows
							.filter((r) => r.status === "changed")
							.map(
								(r) =>
									`${r.item} ${r.unit}: ${r.oldUnitPrice} -> ${r.newUnitPrice}`,
							),
						new: diff.rows
							.filter((r) => r.status === "new")
							.map((r) => `${r.item} ${r.unit}: ${r.newUnitPrice}`),
						skipped: diff.skipped,
					},
				};
			},
		);
		await tracer.traceToolCall(
			"save_contract_draft",
			{ contractId: id },
			async () => {
				await insertContractDraft({
					id,
					terms,
					prices,
					flags,
					sourceName: input.sourceName,
					sourceText: input.text,
					rawExtraction: content,
					model,
					prismTraceId: tracer.traceId,
				});
				return { ok: true as const, data: { id } };
			},
		);

		await tracer.finish({
			output: {
				contractId: id,
				model,
				vendor: terms.vendorName,
				prices: prices.length,
				flags: flags.length,
			},
		});
		return { id, model, prismTraceId: tracer.traceId };
	} catch (error) {
		await tracer.finish({ error });
		throw error;
	}
}
