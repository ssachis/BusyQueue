/**
 * Which vendor a contract belongs to. Uses the same resolver as the v2 price
 * lookup: an exact normalised name, or a unique word-prefix ("Harbor Foods,
 * Inc." → "Harbor Foods"). Anything else is left to the director.
 */
import { resolveVendor } from "#/lib/rules/aliases.ts";

export interface VendorRef {
	id: string;
	name: string;
}

export type VendorMatch =
	| { status: "matched"; vendor: VendorRef }
	| { status: "ambiguous"; candidates: VendorRef[] }
	| { status: "unknown" }
	| { status: "missing" };

export function matchContractVendor(
	printed: string | null,
	vendors: readonly VendorRef[],
): VendorMatch {
	if (!printed?.trim()) return { status: "missing" };
	const resolved = resolveVendor(
		printed,
		vendors.map((v) => v.name),
	);
	if (resolved.ok) {
		const vendor = vendors.find((v) => v.name === resolved.vendor);
		if (vendor) return { status: "matched", vendor };
	} else if (resolved.reason === "ambiguous") {
		return {
			status: "ambiguous",
			candidates: vendors.filter((v) => resolved.candidates.includes(v.name)),
		};
	}
	return { status: "unknown" };
}

/** Vendor id from its name, the same slug the seed script uses. */
export const vendorSlug = (name: string) =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");

/** A new vendor's name as the director typed it, whitespace collapsed. */
export const cleanVendorName = (name: string) =>
	name.trim().replace(/\s+/g, " ");
