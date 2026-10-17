import type { AgentVersion } from "#/lib/busyq/types.ts";
import {
	lookupPrices,
	lookupPricesV2,
	type PriceLookup,
} from "#/lib/rules/index.ts";

/**
 * Price lookup per agent version. v1 is the deliberately naive exact match;
 * v2 adds vendor aliases and unit conversion through pack size.
 */
export const LOOKUPS: Partial<Record<AgentVersion, PriceLookup>> = {
	v1: lookupPrices,
	v2: lookupPricesV2,
};
