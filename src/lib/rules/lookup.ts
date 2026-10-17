/**
 * Price lookup, v1. Deliberately naive: exact string match on vendor, item and
 * unit. It fails the same way on every invoice whose vendor or unit is spelled
 * differently from the price list, which is the repeated failure PRISM
 * clusters. The v2 lookup (aliases, pack-size conversion) is a separate issue
 * and plugs in through the `PriceLookup` type.
 */
import {
	fail,
	type InvoiceLine,
	ok,
	type PriceRow,
	type ToolResult,
} from "#/lib/busyq/types.ts";

export type PriceMatch = {
	row: PriceRow;
	/** Agreed price per the unit the invoice line is billed in, as a decimal string. */
	agreedUnitPrice: string;
};

export type PriceLookup = (
	prices: readonly PriceRow[],
	vendor: string,
	line: Pick<InvoiceLine, "item" | "unit">,
) => ToolResult<PriceMatch>;

export const lookupPrices: PriceLookup = (prices, vendor, line) => {
	const row = prices.find(
		(r) => r.vendor === vendor && r.item === line.item && r.unit === line.unit,
	);
	if (!row) {
		return fail(
			"price_not_found",
			`No agreed price for vendor "${vendor}", item "${line.item}", unit "${line.unit}"`,
			{ vendor, item: line.item, unit: line.unit },
		);
	}
	return ok({ row, agreedUnitPrice: row.unitPrice });
};
