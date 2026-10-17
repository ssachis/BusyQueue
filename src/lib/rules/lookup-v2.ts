/**
 * Price lookup, v2. Fixes the two causes of the v1 failure cluster:
 *  1. vendor names spelled differently from the price list (aliases), and
 *  2. lines billed per pack (case) when the contract price is per base unit
 *     (lb): the agreed price is `unitPrice x packSize`. Multiply, never
 *     divide, so amounts stay exact.
 * Still never guesses: an unknown vendor, item or unit is a structured error.
 */
import {
	fail,
	ok,
	type PriceRow,
	type ToolResult,
} from "#/lib/busyq/types.ts";
import { dec } from "#/lib/money/index.ts";
import { normalizeItem, normalizeUnit, sameVendor } from "./aliases.ts";
import type { PriceLookup, PriceMatch } from "./lookup.ts";

export const lookupPricesV2: PriceLookup = (prices, vendor, line) => {
	const item = normalizeItem(line.item);
	const unit = normalizeUnit(line.unit);
	const candidates = prices.filter(
		(r) => sameVendor(r.vendor, vendor) && normalizeItem(r.item) === item,
	);
	const miss = (): ToolResult<PriceMatch> =>
		fail(
			"price_not_found",
			`No agreed price for vendor "${vendor}", item "${line.item}", unit "${line.unit}"`,
			{ vendor, item: line.item, unit: line.unit },
		);

	const direct = candidates.find((r) => normalizeUnit(r.unit) === unit);
	if (direct) return ok({ row: direct, agreedUnitPrice: direct.unitPrice });

	const packed = candidates.find(
		(r: PriceRow) =>
			r.packUnit != null &&
			r.packSize != null &&
			normalizeUnit(r.packUnit) === unit,
	);
	if (packed?.packSize) {
		return ok({
			row: packed,
			agreedUnitPrice: dec(packed.unitPrice).times(dec(packed.packSize)).toFixed(),
		});
	}
	return candidates.length > 0 && candidates.every((r) => normalizeUnit(r.unit) !== unit)
		? fail(
				"unit_mismatch",
				`Item "${line.item}" is priced per ${candidates.map((r) => r.unit).join("/")}, invoice bills "${line.unit}" and no pack size converts it`,
				{ vendor, item: line.item, unit: line.unit },
			)
		: miss();
};
