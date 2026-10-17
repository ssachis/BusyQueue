/**
 * Price lookup, v2: the fix for the v1 failure cluster.
 * - Vendor: normalised and resolved to one canonical price-list vendor.
 * - Unit: synonyms collapse ("lbs" → "lb", "CS" → "case").
 * - Packs: a line billed per pack is priced at unitPrice × packSize
 *   (one case of chicken = 40 lb × $2.10 = $84.00 per case).
 * The agreed price returned is always per the unit the line is billed in, so
 * `compareLines` works unchanged.
 */
import { fail, ok } from "#/lib/busyq/types.ts";
import { dec } from "#/lib/money/index.ts";
import { normalizeItem, normalizeUnit, resolveVendor } from "./aliases.ts";
import type { PriceLookup } from "./lookup.ts";

export const lookupPricesV2: PriceLookup = (prices, vendor, line) => {
	const canonical = [...new Set(prices.map((p) => p.vendor))];
	const resolved = resolveVendor(vendor, canonical);
	if (!resolved.ok) {
		return fail(
			"price_not_found",
			resolved.reason === "ambiguous"
				? `Vendor "${vendor}" matches more than one vendor on the price list: ${resolved.candidates.join(", ")}`
				: `Vendor "${vendor}" is not on the price list`,
			{ vendor, candidates: resolved.candidates },
		);
	}

	const item = normalizeItem(line.item);
	const rows = prices.filter(
		(p) => p.vendor === resolved.vendor && normalizeItem(p.item) === item,
	);
	if (rows.length === 0) {
		return fail(
			"price_not_found",
			`No agreed price for "${line.item}" from ${resolved.vendor}`,
			{ vendor, resolvedVendor: resolved.vendor, item: line.item },
		);
	}

	const unit = normalizeUnit(line.unit);
	for (const row of rows) {
		if (normalizeUnit(row.unit) === unit) {
			return ok({ row, agreedUnitPrice: row.unitPrice });
		}
	}
	for (const row of rows) {
		if (row.packUnit && row.packSize && normalizeUnit(row.packUnit) === unit) {
			return ok({
				row,
				agreedUnitPrice: dec(row.unitPrice).times(dec(row.packSize)).toString(),
			});
		}
	}
	return fail(
		"unit_mismatch",
		`"${line.item}" is billed per "${line.unit}", but the agreed price is per ${rows
			.map((r) =>
				r.packUnit ? `${r.unit} (or ${r.packUnit} of ${r.packSize})` : r.unit,
			)
			.join(", ")}`,
		{
			vendor,
			resolvedVendor: resolved.vendor,
			item: line.item,
			unit: line.unit,
		},
	);
};
