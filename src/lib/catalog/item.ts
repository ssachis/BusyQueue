/**
 * Catalog items: reusable lines (price, unit, tax rate, code) that fill in a
 * document line. Prices are decimal strings as entered, never floats.
 */
import { z } from "zod";
import type { DraftLine } from "#/lib/documents/types.ts";
import { DECIMAL_PATTERN } from "#/lib/money/index.ts";

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
	trimmed(max)
		.transform((v) => (v === "" ? null : v))
		.nullable();

export const CatalogItemInput = z.object({
	/** Short unique code (SKU), e.g. "DM-001". Optional. */
	code: trimmed(40)
		.transform((v) => (v === "" ? null : v.toUpperCase()))
		.nullable(),
	name: trimmed(200).min(1, "Name is required"),
	unitPrice: z
		.string()
		.trim()
		.regex(DECIMAL_PATTERN, "Use a number like 12.50")
		.refine((v) => !v.startsWith("-"), "Can't be negative"),
	unit: optionalText(20),
	/** A code from the tax engine for the business's country, e.g. "US-SALES". */
	taxCode: trimmed(40).min(1, "Tax code is required"),
	/** US sales-tax percent, only with taxCode "US-SALES". */
	rate: z
		.string()
		.trim()
		.transform((v) => (v === "" ? null : v))
		.nullable()
		.refine(
			(v) => v === null || (DECIMAL_PATTERN.test(v) && !v.startsWith("-")),
			"Use a number like 7.25",
		),
	hsnSac: optionalText(20),
});
export type CatalogItemInput = z.infer<typeof CatalogItemInput>;
export type CatalogItemFormInput = z.input<typeof CatalogItemInput>;

export type CatalogItemFields = CatalogItemInput & { id: string };

/** A document line pre-filled from a catalog item; the user sets quantity. */
export function itemToLine(
	item: CatalogItemFields,
	lineNo: number,
	quantity = "1",
): DraftLine {
	return {
		lineNo,
		description: item.name,
		quantity,
		...(item.unit ? { unit: item.unit } : {}),
		unitPrice: item.unitPrice,
		taxCode: item.taxCode,
		...(item.rate ? { rate: item.rate } : {}),
		...(item.hsnSac ? { hsnSac: item.hsnSac } : {}),
		catalogItemId: item.id,
	};
}
