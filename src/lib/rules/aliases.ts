/**
 * Name normalisation for the v2 lookup. Invoices spell vendors and units
 * however the vendor's billing system likes ("HARBOR FOODS INC",
 * "Harbor Foods, Inc.", "LB", "lbs", "CS"); the price list uses one canonical
 * spelling. These rules are generic: no per-vendor hard-coding is needed for
 * the common cases, and `VENDOR_ALIASES` covers anything they can't.
 */

/** Words that say what kind of company it is, not which one. */
const LEGAL_SUFFIXES = new Set([
	"inc",
	"incorporated",
	"llc",
	"co",
	"corp",
	"corporation",
	"company",
	"ltd",
	"limited",
	"the",
]);

/** Explicit overrides: normalised invoice spelling → canonical price-list name. */
export const VENDOR_ALIASES: Readonly<Record<string, string>> = {};

/** "Harbor Foods, Inc." → "harbor foods"; "Dairy-Pure" → "dairy pure". */
export function normalizeVendor(name: string): string {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.split(" ")
		.filter((t) => t && !LEGAL_SUFFIXES.has(t))
		.join(" ");
}

const startsWithTokens = (longer: string[], shorter: string[]) =>
	shorter.length > 0 && shorter.every((t, i) => longer[i] === t);

export type VendorResolution =
	| { ok: true; vendor: string }
	| { ok: false; reason: "unknown" | "ambiguous"; candidates: string[] };

/**
 * Map a printed vendor name to one canonical vendor. Exact (normalised) match
 * wins; otherwise one name must be a word-prefix of the other ("Valley Fresh"
 * → "Valley Fresh Produce"), and only if exactly one vendor fits.
 */
export function resolveVendor(
	printed: string,
	canonical: readonly string[],
): VendorResolution {
	const norm = normalizeVendor(printed);
	const alias = VENDOR_ALIASES[norm];
	if (alias && canonical.includes(alias)) return { ok: true, vendor: alias };

	const exact = canonical.filter((c) => normalizeVendor(c) === norm);
	if (exact.length === 1) return { ok: true, vendor: exact[0] as string };

	const tokens = norm.split(" ").filter(Boolean);
	const prefixed = canonical.filter((c) => {
		const ct = normalizeVendor(c).split(" ").filter(Boolean);
		return startsWithTokens(ct, tokens) || startsWithTokens(tokens, ct);
	});
	if (prefixed.length === 1) return { ok: true, vendor: prefixed[0] as string };
	return {
		ok: false,
		reason: prefixed.length > 1 || exact.length > 1 ? "ambiguous" : "unknown",
		candidates: prefixed.length ? prefixed : exact,
	};
}

const UNIT_SYNONYMS: Readonly<Record<string, string>> = {
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
	gal: "gal",
	gallon: "gal",
	gallons: "gal",
	ea: "each",
	each: "each",
	doz: "dozen",
	dozen: "dozen",
};

/** "LB", "lbs", "Pounds" → "lb"; "CS", "Case" → "case". Unknown units pass through lowercased. */
export function normalizeUnit(unit: string): string {
	const u = unit.trim().toLowerCase().replace(/\.$/, "");
	return UNIT_SYNONYMS[u] ?? u;
}

/** Item names compare case- and whitespace-insensitively. */
export const normalizeItem = (item: string) =>
	item.trim().toLowerCase().replace(/\s+/g, " ");
