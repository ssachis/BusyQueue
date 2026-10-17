import OpenAI from "openai";
import { Decimal } from "#/lib/money/index.ts";
import type { ServerEnv } from "./env.ts";

let cached: { key: string; baseURL: string; client: OpenAI } | undefined;

/**
 * Nicrron is OpenAI-compatible: the stock `openai` SDK pointed at its base URL.
 * Reused per isolate so the connection pool isn't rebuilt per request.
 */
export function getNicrron(env: ServerEnv): OpenAI {
	if (!env.NICRRON_API_KEY) {
		throw new Error("NICRRON_API_KEY is not set (see .env.example)");
	}
	if (
		cached?.key !== env.NICRRON_API_KEY ||
		cached.baseURL !== env.NICRRON_BASE_URL
	) {
		cached = {
			key: env.NICRRON_API_KEY,
			baseURL: env.NICRRON_BASE_URL,
			client: new OpenAI({
				apiKey: env.NICRRON_API_KEY,
				baseURL: env.NICRRON_BASE_URL,
			}),
		};
	}
	return cached.client;
}

/**
 * Virtual routing slugs (`nicrron/auto`, `nicrron/fastest`, `nicrron/cheapest`,
 * `nicrron/reasoning`, `nicrron/coding`). The gateway picks the model, so a
 * different resolved model is routing, not a fallback.
 */
export function isRoutingPreset(model: string): boolean {
	return model.startsWith("nicrron/");
}

/**
 * The ordered `models` list Nicrron cascades through on 429/5xx (and on an
 * unknown model id): primary first, then fallbacks, without duplicates.
 */
export function fallbackList(
	primary: string,
	fallbacks: readonly string[],
): string[] {
	return [...new Set([primary, ...fallbacks].filter((m) => m.length > 0))];
}

/** Response header Nicrron sets on every completion: `HIT` or `MISS`. */
export const CACHE_HEADER = "x-nicrron-cache";

/**
 * Reads `total_cost` from a `GET /v1/generation` body as a plain decimal
 * string. The value is taken from the raw JSON text, never parsed as a float.
 */
export function parseGenerationCost(text: string): string | undefined {
	const match = /"total_cost"\s*:\s*(\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(
		text,
	);
	return match?.[1] ? new Decimal(match[1]).toFixed() : undefined;
}

/**
 * What Nicrron settled for one completion, in USD, from
 * `GET /v1/generation?id=<completion id>`. Not in the public docs but live on
 * the gateway (checked 2026-10-17): it answers right after the completion and
 * reports 0 for exact-cache hits. Best effort: `undefined` on any failure.
 */
export async function generationCost(
	client: Pick<OpenAI, "baseURL" | "apiKey">,
	id: string,
	fetchImpl: typeof fetch = fetch,
): Promise<string | undefined> {
	try {
		const res = await fetchImpl(
			`${client.baseURL.replace(/\/+$/, "")}/generation?id=${encodeURIComponent(id)}`,
			{
				headers: { Authorization: `Bearer ${client.apiKey}` },
				signal: AbortSignal.timeout(2000),
			},
		);
		return res.ok ? parseGenerationCost(await res.text()) : undefined;
	} catch {
		return undefined;
	}
}
