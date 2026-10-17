export * from "./aliases.ts";
export * from "./check.ts";
export * from "./compare.ts";
export * from "./impact.ts";
export * from "./lookup.ts";
export * from "./lookup-v2.ts";
export * from "./payments.ts";
export * from "./score.ts";

import type { AgentVersion } from "#/lib/busyq/types.ts";
import { lookupPrices, type PriceLookup } from "./lookup.ts";
import { lookupPricesV2 } from "./lookup-v2.ts";

/** The price lookup each agent version uses. One map for the agent and the batch runner. */
export const LOOKUPS: Record<AgentVersion, PriceLookup> = {
	v1: lookupPrices,
	v2: lookupPricesV2,
};
