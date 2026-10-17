/**
 * Items catalog: validation shared by the item form and the server functions,
 * and the mapping to the editor's draft line. Prices stay decimal strings.
 */
import { z } from "zod";
import { DraftLine } from "#/lib/documents/types.ts";
import {
	DECIMAL_PATTERN,
	dec,
	isCurrencyCode,
	minorUnitDigits,
} from "#/lib/money/index.ts";
import {
	isTaxCountry,
	type TaxCodeOption,
	taxCodes,
	US_SALES,
} from "#/lib/tax/index.ts";

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
	trimmed(max)
		.transform((v) => (v === "" ? null : v))
		.nullable();

const nonNegativeDecimal = (label: string) =>
	z
		.string()
		.trim()
		.regex(DECIMAL_PATTERN, `${label}: use a number like 12.50`)
		.refine((v) => !v.startsWith("-"), `${label} can't be negative`);

export const CatalogItemInput = z.object({
	name: trimmed(200).min(1, "Name is required"),
	description: optionalText(500),
	unit: optionalText(20),
	unitPrice: nonNegativeDecimal("Price"),
	currency: z
		.string()
		.trim()
		.toUpperCase()
		.refine(isCurrencyCode, "Use an ISO 4217 code like USD"),
	taxCode: trimmed(40).min(1, "Pick a tax code"),
	/** US sales-tax percent; only with US-SALES. */
	rate: z
		.union([z.literal(""), nonNegativeDecimal("Rate")])
		.transform((v) => (v === "" ? null : v))
		.nullable(),
	hsnSac: z
		.union([
			z.literal(""),
			z
				.string()
				.trim()
				.regex(/^\d{4,8}$/, "Use a 4 to 8 digit HSN/SAC code"),
		])
		.transform((v) => (v === "" ? null : v))
		.nullable(),
	code: optionalText(40),
});
export type CatalogItemInput = z.output<typeof CatalogItemInput>;
export type CatalogItemFormInput = z.input<typeof CatalogItemInput>;

export interface CatalogItemRecord extends CatalogItemInput {
	id: string;
	archivedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

/** Tax codes a catalog item may default to, for the business's country. */
export function catalogTaxCodes(businessCountry: string): TaxCodeOption[] {
	return isTaxCountry(businessCountry) ? taxCodes(businessCountry) : [];
}

export type FieldErrors = Record<string, string>;

/**
 * Rules that depend on the business country: the tax code must be one the
 * tax engine knows for it, a rate goes with US-SALES only (and is required
 * there), and HSN/SAC is India-only.
 */
export function catalogItemErrors(
	item: CatalogItemInput,
	businessCountry: string,
): FieldErrors {
	const errors: FieldErrors = {};
	const codes = catalogTaxCodes(businessCountry).map((c) => c.code);
	if (!codes.includes(item.taxCode)) {
		errors.taxCode = `Not a tax code for ${businessCountry}`;
	}
	if (item.taxCode === US_SALES) {
		if (item.rate === null) {
			errors.rate = "Enter the sales-tax rate";
		} else if (dec(item.rate).gt(dec("100"))) {
			errors.rate = "Rate is a percent (0 to 100)";
		}
	} else if (item.rate !== null) {
		errors.rate = "A rate only goes with US sales tax";
	}
	if (item.hsnSac !== null && businessCountry !== "IN") {
		errors.hsnSac = "HSN/SAC only applies in India";
	}
	return errors;
}

/** Parse form input and apply the country rules; field errors keyed by path. */
export function parseCatalogItem(
	input: unknown,
	businessCountry: string,
): { ok: true; item: CatalogItemInput } | { ok: false; errors: FieldErrors } {
	const parsed = CatalogItemInput.safeParse(input);
	if (!parsed.success) {
		const errors: FieldErrors = {};
		for (const issue of parsed.error.issues) {
			const key = issue.path.join(".");
			errors[key] ??= issue.message;
		}
		return { ok: false, errors };
	}
	const errors = catalogItemErrors(parsed.data, businessCountry);
	return Object.keys(errors).length > 0
		? { ok: false, errors }
		: { ok: true, item: parsed.data };
}

/** Line description from an item: "Name - description", capped at 500. */
export function lineDescription(
	item: Pick<CatalogItemInput, "name" | "description">,
): string {
	const text = item.description
		? `${item.name} - ${item.description}`
		: item.name;
	return text.slice(0, 500);
}

/** A draft line (quantity 1) filled from a catalog item. */
export function catalogItemToLine(
	item: Pick<
		CatalogItemRecord,
		| "id"
		| "name"
		| "description"
		| "unit"
		| "unitPrice"
		| "taxCode"
		| "rate"
		| "hsnSac"
	>,
	lineNo: number,
): DraftLine {
	const line: DraftLine = {
		lineNo,
		description: lineDescription(item),
		quantity: "1",
		unitPrice: item.unitPrice,
		taxCode: item.taxCode,
		catalogItemId: item.id,
	};
	if (item.unit) line.unit = item.unit;
	if (item.taxCode === US_SALES && item.rate) line.rate = item.rate;
	if (item.hsnSac) line.hsnSac = item.hsnSac;
	return DraftLine.parse(line);
}

/**
 * Unit price for display, e.g. "$4.25" or "$0.125". Shows at least the
 * currency's minor digits and never drops digits that were entered.
 */
export function formatUnitPrice(
	unitPrice: string,
	currency: string,
	locale = "en-US",
): string {
	const entered = unitPrice.split(".")[1]?.length ?? 0;
	const digits = minorUnitDigits(currency);
	// Intl formats numeric strings exactly; no float conversion.
	return new Intl.NumberFormat(locale, {
		style: "currency",
		currency,
		minimumFractionDigits: digits,
		maximumFractionDigits: Math.max(digits, entered),
	}).format(unitPrice as unknown as number);
}
