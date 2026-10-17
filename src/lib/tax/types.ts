import { z } from "zod";
import { DECIMAL_PATTERN, isCurrencyCode } from "#/lib/money/index.ts";

/** Seller countries the engine knows the rules for. */
export const TAX_COUNTRIES = [
	"IN",
	"US",
	"GB",
	"DE",
	"FR",
	"AU",
	"CA",
	"AE",
] as const;
export type TaxCountry = (typeof TAX_COUNTRIES)[number];

export const DOCUMENT_TYPES = [
	"invoice",
	"quote",
	"proforma",
	"credit_note",
	"receipt",
	"delivery_note",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export interface TaxParty {
	/** ISO 3166-1 alpha-2. The buyer may be in any country. */
	country: string;
	/** IN: GST state code ("27"); CA: province ("ON", "QC"); US: state code. */
	region?: string;
	/** GSTIN / VAT ID / ABN / TRN / BN. Presence decides the B2B rules. */
	taxId?: string;
}

export interface TaxContext {
	seller: TaxParty & { country: TaxCountry };
	buyer: TaxParty;
	/** ISO 4217. */
	currency: string;
	/** IN only: GST state code of the place of supply. Defaults to `buyer.region`. */
	placeOfSupply?: string;
}

export interface TaxLineInput {
	lineNo: number;
	/** Decimal string, >= 0. */
	quantity: string;
	/** Decimal string, tax-exclusive, >= 0. */
	unitPrice: string;
	/** Decimal string amount off the line, >= 0 and <= quantity × unitPrice. */
	discount?: string;
	/** A code from `taxCodes(sellerCountry)`, e.g. "IN-GST-18", "DE-VAT-19", "CA-STD", "EXEMPT". */
	taxCode: string;
	/** US only (code "US-SALES"): sales-tax percent entered by the user, e.g. "8.875". */
	rate?: string;
	/** IN: HSN (goods) / SAC (services) code, carried through to the output. */
	hsnSac?: string;
}

export type TaxComponentCode =
	| "CGST"
	| "SGST"
	| "UTGST"
	| "IGST"
	| "VAT"
	| "GST"
	| "HST"
	| "PST"
	| "QST"
	| "SALES_TAX";

export interface TaxComponent {
	code: TaxComponentCode;
	/** Percent as a decimal string, e.g. "9" for 9%. */
	rate: string;
	amountMinor: number;
}

export interface LineTax {
	lineNo: number;
	/** quantity × unitPrice − discount, rounded once to minor units. */
	netMinor: number;
	components: TaxComponent[];
	taxMinor: number;
	totalMinor: number;
	hsnSac?: string;
}

export interface TaxTotal {
	code: TaxComponentCode;
	rate: string;
	taxableMinor: number;
	amountMinor: number;
}

export type SupplyType = "intra_state" | "inter_state" | "export";

export interface TaxResult {
	currency: string;
	lines: LineTax[];
	subtotalMinor: number;
	/** Grouped by code + rate, in order of first appearance. */
	taxTotals: TaxTotal[];
	taxMinor: number;
	totalMinor: number;
	reverseCharge: boolean;
	/** IN only. */
	supplyType?: SupplyType;
	/** Statutory notes to print (reverse charge, export wording). */
	notes: string[];
	/** How tax was rounded for this seller country. */
	rounding: RoundingLevel;
}

/**
 * - `line`: each tax component of each line is rounded to minor units.
 * - `invoice`: each (component, rate) group is rounded once on the invoice
 *   total; the per-line amounts are an allocation of that total.
 */
export type RoundingLevel = "line" | "invoice";

export interface TaxCodeOption {
	code: string;
	label: string;
	/** Combined percent as a decimal string; "" when the user enters it (US). */
	rate: string;
}

export type TaxErrorCode =
	| "unknown_country"
	| "unknown_tax_code"
	| "missing_region"
	| "invalid_input";

export class TaxError extends Error {
	readonly code: TaxErrorCode;

	constructor(code: TaxErrorCode, message: string) {
		super(message);
		this.name = "TaxError";
		this.code = code;
	}
}

// --- zod boundary schemas -------------------------------------------------

const decimalString = z.string().regex(DECIMAL_PATTERN, "Not a decimal string");
const nonNegativeDecimal = decimalString.refine(
	(v) => !v.startsWith("-"),
	"Must not be negative",
);

const PartySchema = z.object({
	country: z.string().regex(/^[A-Z]{2}$/, "Not an ISO 3166-1 alpha-2 code"),
	region: z.string().trim().min(1).optional(),
	taxId: z.string().optional(),
});

export const TaxContextSchema = z.object({
	seller: PartySchema,
	buyer: PartySchema,
	currency: z.string().refine(isCurrencyCode, "Not an ISO 4217 code"),
	placeOfSupply: z.string().trim().min(1).optional(),
});

export const TaxLineInputSchema = z.object({
	lineNo: z.number().int().positive(),
	quantity: nonNegativeDecimal,
	unitPrice: nonNegativeDecimal,
	discount: nonNegativeDecimal.optional(),
	taxCode: z.string().min(1),
	rate: nonNegativeDecimal.optional(),
	hsnSac: z.string().optional(),
});

export function isTaxCountry(value: string): value is TaxCountry {
	return (TAX_COUNTRIES as readonly string[]).includes(value);
}

/** A tax ID counts only if it has non-blank content. */
export function hasTaxId(party: TaxParty): boolean {
	return (party.taxId ?? "").trim().length > 0;
}
