import { describe, expect, it, vi } from "vitest";
import {
	fallbackList,
	generationCost,
	isRoutingPreset,
	parseGenerationCost,
} from "./nicrron.ts";

describe("fallbackList", () => {
	it("puts the primary first and drops duplicates and blanks", () => {
		expect(
			fallbackList("anthropic/claude-sonnet-5-5", [
				"openai/gpt-6-sol",
				"anthropic/claude-sonnet-5-5",
				"",
				"anthropic/claude-haiku-5-5",
			]),
		).toEqual([
			"anthropic/claude-sonnet-5-5",
			"openai/gpt-6-sol",
			"anthropic/claude-haiku-5-5",
		]);
	});
});

describe("isRoutingPreset", () => {
	it("recognises nicrron/* slugs only", () => {
		expect(isRoutingPreset("nicrron/auto")).toBe(true);
		expect(isRoutingPreset("nicrron/cheapest")).toBe(true);
		expect(isRoutingPreset("anthropic/claude-sonnet-5-5")).toBe(false);
	});
});

describe("parseGenerationCost", () => {
	it("reads total_cost as an exact decimal string, including exponent form", () => {
		expect(parseGenerationCost('{"data":{"total_cost":0.00003644}}')).toBe(
			"0.00003644",
		);
		expect(parseGenerationCost('{"data":{"total_cost":4.62e-6}}')).toBe(
			"0.00000462",
		);
		expect(parseGenerationCost('{"data":{"total_cost":0}}')).toBe("0");
		expect(parseGenerationCost('{"data":{}}')).toBeUndefined();
	});
});

describe("generationCost", () => {
	const client = { baseURL: "https://gw.example/v1/", apiKey: "sk-test" };

	it("asks GET /generation for the completion id with the API key", async () => {
		const fetchImpl = vi.fn(
			async () =>
				new Response('{"data":{"id":"gen-1","total_cost":0.0123}}', {
					status: 200,
				}),
		);
		expect(await generationCost(client, "gen-1", fetchImpl)).toBe("0.0123");
		const [url, init] = fetchImpl.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		expect(url).toBe("https://gw.example/v1/generation?id=gen-1");
		expect(new Headers(init.headers).get("Authorization")).toBe(
			"Bearer sk-test",
		);
	});

	it("returns undefined instead of throwing when the lookup fails", async () => {
		expect(
			await generationCost(
				client,
				"gen-1",
				vi.fn(async () => new Response("nope", { status: 404 })),
			),
		).toBeUndefined();
		expect(
			await generationCost(
				client,
				"gen-1",
				vi.fn(async () => {
					throw new Error("network down");
				}),
			),
		).toBeUndefined();
	});
});
