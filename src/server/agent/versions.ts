import type { AgentVersion } from "#/lib/busyq/types.ts";
import {
	type PriceLookup,
	LOOKUPS as RULE_LOOKUPS,
} from "#/lib/rules/index.ts";

/**
 * Price lookup per agent version: v1 is the deliberately naive exact match,
 * v2 resolves vendor aliases and converts units through pack size.
 */
export const LOOKUPS: Partial<Record<AgentVersion, PriceLookup>> = RULE_LOOKUPS;
