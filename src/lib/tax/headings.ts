import { assertTaxCountry } from "./codes.ts";
import {
	DOCUMENT_TYPES,
	type DocumentType,
	type TaxCountry,
	TaxError,
} from "./types.ts";

/**
 * Document titles. All headings are in English for every country (one
 * consistent language for the editor and print layouts); local statutory
 * wording goes in the notes instead.
 *
 * - IN: "Tax Invoice" (Rule 46 CGST Rules), "Receipt Voucher" for advances
 *   (Rule 50), "Delivery Challan" (Rule 55).
 * - AU: "Tax Invoice" (ATO: the words must appear); the ATO calls a credit
 *   note an "Adjustment Note".
 * - AE: "Tax Invoice" and "Tax Credit Note" (Executive Regulation Art. 59, 60).
 * - GB: "VAT Invoice" (conventional; Notice 700 §16 lists required contents
 *   but no mandatory title).
 * - DE, FR, CA, US: "Invoice".
 * A reverse-charge invoice appends "(Reverse Charge)" where VAT applies
 * (GB, DE, FR, AE); IN/AU/CA/US have no reverse-charge heading here.
 */
const BASE: Record<DocumentType, string> = {
	invoice: "Invoice",
	quote: "Quote",
	proforma: "Pro Forma Invoice",
	credit_note: "Credit Note",
	receipt: "Receipt",
	delivery_note: "Delivery Note",
};

const OVERRIDES: Record<TaxCountry, Partial<Record<DocumentType, string>>> = {
	IN: {
		invoice: "Tax Invoice",
		quote: "Quotation",
		receipt: "Receipt Voucher",
		delivery_note: "Delivery Challan",
	},
	AU: { invoice: "Tax Invoice", credit_note: "Adjustment Note" },
	AE: { invoice: "Tax Invoice", credit_note: "Tax Credit Note" },
	GB: { invoice: "VAT Invoice" },
	DE: {},
	FR: {},
	CA: {},
	US: {},
};

const REVERSE_CHARGE_COUNTRIES: ReadonlySet<TaxCountry> = new Set([
	"GB",
	"DE",
	"FR",
	"AE",
]);

export function documentHeading(
	country: TaxCountry,
	type: DocumentType,
	opts: { reverseCharge?: boolean } = {},
): string {
	assertTaxCountry(country);
	if (!(DOCUMENT_TYPES as readonly string[]).includes(type)) {
		throw new TaxError("invalid_input", `Unknown document type "${type}"`);
	}
	const heading = OVERRIDES[country][type] ?? BASE[type];
	const charged = type === "invoice" || type === "credit_note";
	if (opts.reverseCharge && charged && REVERSE_CHARGE_COUNTRIES.has(country)) {
		return `${heading} (Reverse Charge)`;
	}
	return heading;
}
