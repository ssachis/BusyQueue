import type { AgentVersion } from "#/lib/busyq/types.ts";
import { lookupPrices, type PriceLookup } from "#/lib/rules/index.ts";

/**
 * Price lookup per agent version. v1 is the deliberately naive exact match;
 * v2 (aliases + pack-size conversion) plugs in here when it lands.
 */
export const LOOKUPS: Partial<Record<AgentVersion, PriceLookup>> = {
	v1: lookupPrices,
};
