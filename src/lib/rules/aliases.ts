/**
 * Name and unit normalisation for the v2 price lookup. Pure string work; no
 * amounts are touched here.
 */

const COMPANY_SUFFIXES = new Set([
	"inc",
	"llc",
	"co",
	"corp",
	"company",
	"ltd",
]);

/** Lowercase tokens of a vendor name with punctuation and company suffixes removed. */
export function vendorTokens(name: string): string[] {
	const tokens = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.split(" ")
		.filter(Boolean);
	while (tokens.length > 1 && COMPANY_SUFFIXES.has(tokens[tokens.length - 1] ?? "")) {
		tokens.pop();
	}
	return tokens;
}

/**
 * Two vendor names match when their tokens are equal or one is a leading
 * prefix of the other ("Valley Fresh" vs "Valley Fresh Produce"). A shared
 * first word alone is not enough.
 */
export function sameVendor(a: string, b: string): boolean {
	const ta = vendorTokens(a);
	const tb = vendorTokens(b);
	const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
	if (short.length < 2 && long.length > short.length) return false;
	return short.length > 0 && short.every((t, i) => t === long[i]);
}

const UNIT_ALIASES: Record<string, string> = {
	lb: "lb",
	lbs: "lb",
	pound: "lb",
	pounds: "lb",
	case: "case",
	cases: "case",
	cs: "case",
	bag: "bag",
	bags: "bag",
	bg: "bag",
};

/** Canonical unit ("CS", "Case", "cases" -> "case"); unknown units are only lowercased. */
export function normalizeUnit(unit: string): string {
	const key = unit.trim().toLowerCase().replace(/\./g, "");
	return UNIT_ALIASES[key] ?? key;
}

export const normalizeItem = (item: string): string =>
	item.trim().toLowerCase().replace(/\s+/g, " ");
