/**
 * What the Nicrron gateway did during one run: which models answered, how
 * often it fell back or served from its exact cache, and what it charged.
 * Pure: built from the per-call model replies.
 */
import { sum } from "#/lib/money/index.ts";
import type { ModelReply } from "./run.ts";

export interface GatewaySummary {
	/** The model the run asked for (AGENT_MODEL): a concrete model or a nicrron/* preset. */
	requestedModel: string;
	/** Model calls that got a reply. */
	modelCalls: number;
	/** Models that actually answered, in first-use order. */
	modelsUsed: string[];
	/** Calls answered by a model further down the `models` fallback list. */
	fallbacks: number;
	/** Calls served from Nicrron's exact cache (`X-Nicrron-Cache: HIT`). */
	cacheHits: number;
	/**
	 * Total USD Nicrron settled for the run, as a decimal string. Only set when
	 * every call reported a cost, so a partial sum is never shown as the total.
	 */
	costUsd?: string;
}

export function summarizeGateway(
	requestedModel: string,
	replies: readonly ModelReply[],
): GatewaySummary {
	const costs = replies.flatMap((r) =>
		r.costUsd === undefined ? [] : [r.costUsd],
	);
	return {
		requestedModel,
		modelCalls: replies.length,
		modelsUsed: [...new Set(replies.map((r) => r.model))],
		fallbacks: replies.filter((r) => r.fallback).length,
		cacheHits: replies.filter((r) => r.cacheHit).length,
		...(replies.length > 0 && costs.length === replies.length
			? { costUsd: sum(costs).toFixed() }
			: {}),
	};
}

/** The summary as PRISM root-span metadata. */
export function gatewayMetadata(g: GatewaySummary): Record<string, unknown> {
	return {
		gateway: "nicrron",
		requested_model: g.requestedModel,
		models_used: g.modelsUsed,
		model_calls: g.modelCalls,
		fallbacks: g.fallbacks,
		cache_hits: g.cacheHits,
		...(g.costUsd !== undefined ? { cost_usd: g.costUsd } : {}),
	};
}

/** One model call's gateway details as PRISM `llm` span metadata. */
export function replyMetadata(r: ModelReply): Record<string, unknown> {
	const meta: Record<string, unknown> = {
		gateway: "nicrron",
		resolved_model: r.model,
	};
	if (r.requestedModel !== undefined) meta.requested_model = r.requestedModel;
	if (r.fallback !== undefined) meta.fallback_used = r.fallback;
	if (r.cacheHit !== undefined) meta.cache_hit = r.cacheHit;
	if (r.costUsd !== undefined) meta.cost_usd = r.costUsd;
	if (r.latencyMs !== undefined)
		meta.gateway_latency_ms = Math.round(r.latencyMs);
	if (r.requestId !== undefined) meta.nicrron_request_id = r.requestId;
	if (r.promptCacheReadTokens !== undefined)
		meta.prompt_cache_read_tokens = r.promptCacheReadTokens;
	return meta;
}
