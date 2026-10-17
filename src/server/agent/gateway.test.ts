import OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { gatewayMetadata, replyMetadata, summarizeGateway } from "./gateway.ts";
import { type ModelReply, nicrronChatModel } from "./run.ts";

/**
 * A fake Nicrron: answers chat completions as `answeredBy` with the given
 * cache header, and the cost lookup with `cost`. Records request bodies.
 */
function fakeGateway(opts: {
	answeredBy: string;
	cache?: "HIT" | "MISS";
	cost?: string;
}) {
	const bodies: Record<string, unknown>[] = [];
	const urls: string[] = [];
	const fetchImpl = (async (
		input: string | URL | Request,
		init?: RequestInit,
	) => {
		const url = String(input instanceof Request ? input.url : input);
		urls.push(url);
		if (url.includes("/generation?id=")) {
			return new Response(
				opts.cost === undefined
					? '{"error":"not found"}'
					: `{"data":{"id":"gen-abc","total_cost":${opts.cost}}}`,
				{ status: opts.cost === undefined ? 404 : 200 },
			);
		}
		bodies.push(JSON.parse(String(init?.body)));
		return new Response(
			JSON.stringify({
				id: "gen-abc",
				object: "chat.completion",
				created: 1,
				model: opts.answeredBy,
				provider: "anthropic",
				choices: [
					{
						index: 0,
						finish_reason: "tool_calls",
						message: {
							role: "assistant",
							content: null,
							tool_calls: [
								{
									id: "call-1",
									type: "function",
									function: {
										name: "get_invoice",
										arguments: '{"invoice_id":"inv-1003"}',
									},
								},
							],
						},
					},
				],
				usage: {
					prompt_tokens: 398,
					completion_tokens: 57,
					total_tokens: 455,
					cache_read_tokens: 0,
				},
			}),
			{
				status: 200,
				headers: {
					"content-type": "application/json",
					"x-nicrron-cache": opts.cache ?? "MISS",
					"x-request-id": "gen-abc",
				},
			},
		);
	}) as typeof fetch;
	const client = new OpenAI({
		apiKey: "sk-test",
		baseURL: "https://gw.example/v1",
		fetch: fetchImpl,
		maxRetries: 0,
	});
	return { client, fetchImpl, bodies, urls };
}

const messages: OpenAI.ChatCompletionMessageParam[] = [
	{ role: "user", content: "Audit invoice inv-1003." },
];

describe("nicrronChatModel", () => {
	it("sends the models fallback list and reports a fallback, cache miss and cost", async () => {
		const gw = fakeGateway({
			answeredBy: "openai/gpt-6-sol",
			cache: "MISS",
			cost: "0.00412",
		});
		const model = nicrronChatModel(gw.client, {
			model: "anthropic/claude-sonnet-5-5",
			fallbacks: ["openai/gpt-6-sol", "anthropic/claude-haiku-5-5"],
			fetchImpl: gw.fetchImpl,
		});
		const reply = await model(messages, []);

		expect(gw.bodies[0]).toMatchObject({
			model: "anthropic/claude-sonnet-5-5",
			models: [
				"anthropic/claude-sonnet-5-5",
				"openai/gpt-6-sol",
				"anthropic/claude-haiku-5-5",
			],
			temperature: 0,
			tool_choice: "auto",
		});
		expect(gw.urls[1]).toBe("https://gw.example/v1/generation?id=gen-abc");
		expect(reply).toMatchObject({
			model: "openai/gpt-6-sol",
			requestedModel: "anthropic/claude-sonnet-5-5",
			fallback: true,
			cacheHit: false,
			costUsd: "0.00412",
			requestId: "gen-abc",
			tokensIn: 398,
			tokensOut: 57,
			promptCacheReadTokens: 0,
			toolCalls: [{ id: "call-1", name: "get_invoice" }],
		});
		expect(reply.latencyMs).toBeGreaterThanOrEqual(0);
	});

	it("reads X-Nicrron-Cache: HIT and treats a preset's choice as routing, not fallback", async () => {
		const gw = fakeGateway({
			answeredBy: "anthropic/claude-haiku-5-5",
			cache: "HIT",
			cost: "0",
		});
		const reply = await nicrronChatModel(gw.client, {
			model: "nicrron/auto",
			fetchImpl: gw.fetchImpl,
		})(messages, []);
		// A single model sends no `models` array.
		expect(gw.bodies[0]).not.toHaveProperty("models");
		expect(reply).toMatchObject({
			model: "anthropic/claude-haiku-5-5",
			fallback: false,
			cacheHit: true,
			costUsd: "0",
		});
	});

	it("leaves cost unset when the lookup fails or is turned off", async () => {
		const gw = fakeGateway({ answeredBy: "anthropic/claude-sonnet-5-5" });
		const reply = await nicrronChatModel(gw.client, {
			model: "anthropic/claude-sonnet-5-5",
			fetchImpl: gw.fetchImpl,
		})(messages, []);
		expect(reply.fallback).toBe(false);
		expect(reply).not.toHaveProperty("costUsd");

		const off = fakeGateway({ answeredBy: "x/y", cost: "1" });
		await nicrronChatModel(off.client, {
			model: "x/y",
			lookupCost: false,
			fetchImpl: off.fetchImpl,
		})(messages, []);
		expect(off.urls).toHaveLength(1);
	});
});

const reply = (r: Partial<ModelReply>): ModelReply => ({
	model: "anthropic/claude-sonnet-5-5",
	content: null,
	toolCalls: [],
	...r,
});

describe("summarizeGateway", () => {
	it("counts fallbacks and cache hits, lists models in first-use order, and sums cost exactly", () => {
		const summary = summarizeGateway("anthropic/claude-sonnet-5-5", [
			reply({ costUsd: "0.1", cacheHit: false }),
			reply({ model: "openai/gpt-6-sol", fallback: true, costUsd: "0.2" }),
			reply({ cacheHit: true, costUsd: "0" }),
		]);
		expect(summary).toEqual({
			requestedModel: "anthropic/claude-sonnet-5-5",
			modelCalls: 3,
			modelsUsed: ["anthropic/claude-sonnet-5-5", "openai/gpt-6-sol"],
			fallbacks: 1,
			cacheHits: 1,
			// 0.1 + 0.2 in floats would be 0.30000000000000004.
			costUsd: "0.3",
		});
	});

	it("omits cost when any call has none, and when there were no calls", () => {
		expect(
			summarizeGateway("m", [reply({ costUsd: "0.1" }), reply({})]),
		).not.toHaveProperty("costUsd");
		expect(summarizeGateway("m", [])).toEqual({
			requestedModel: "m",
			modelCalls: 0,
			modelsUsed: [],
			fallbacks: 0,
			cacheHits: 0,
		});
	});

	it("shapes span and root metadata for PRISM", () => {
		expect(
			replyMetadata(
				reply({
					requestedModel: "anthropic/claude-sonnet-5-5",
					model: "openai/gpt-6-sol",
					fallback: true,
					cacheHit: false,
					costUsd: "0.2",
					latencyMs: 812.4,
					requestId: "gen-1",
				}),
			),
		).toEqual({
			gateway: "nicrron",
			requested_model: "anthropic/claude-sonnet-5-5",
			resolved_model: "openai/gpt-6-sol",
			fallback_used: true,
			cache_hit: false,
			cost_usd: "0.2",
			gateway_latency_ms: 812,
			nicrron_request_id: "gen-1",
		});
		expect(
			gatewayMetadata({
				requestedModel: "m",
				modelCalls: 2,
				modelsUsed: ["m"],
				fallbacks: 0,
				cacheHits: 1,
			}),
		).toEqual({
			gateway: "nicrron",
			requested_model: "m",
			models_used: ["m"],
			model_calls: 2,
			fallbacks: 0,
			cache_hits: 1,
		});
	});
});
