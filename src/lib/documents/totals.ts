/**
 * Document totals = the tax engine applied to the document's lines. The one
 * place editor previews, issuing snapshots and payments get their numbers.
 */
import type { BusinessProfile } from "#/lib/business/profile.ts";
import {
	computeTax,
	isTaxCountry,
	TaxError,
	type TaxResult,
} from "#/lib/tax/index.ts";
import type { DocumentDraft, PartySnapshot } from "./types.ts";

/** The business as it prints on a document. */
export function sellerSnapshot(b: BusinessProfile): PartySnapshot & {
	taxIds: BusinessProfile["taxIds"];
} {
	return {
		name: b.legalName,
		addressLines: [b.addressLine1, b.addressLine2].filter((l): l is string =>
			Boolean(l),
		),
		city: b.city ?? undefined,
		region: b.region ?? undefined,
		postalCode: b.postalCode ?? undefined,
		country: b.country,
		taxId: b.taxIds[0]?.value,
		taxIds: b.taxIds,
	};
}

/**
 * Totals for a draft or issued document. Throws `TaxError` (with a code) on
 * input the tax rules reject, e.g. an unknown tax code for the seller country.
 */
export function documentTotals(
	seller: Pick<PartySnapshot, "country" | "region" | "taxId">,
	doc: Pick<DocumentDraft, "buyer" | "currency" | "placeOfSupply" | "lines">,
): TaxResult {
	if (!isTaxCountry(seller.country)) {
		throw new TaxError(
			"unknown_country",
			`No tax rules for seller country ${seller.country}`,
		);
	}
	return computeTax(
		{
			seller: {
				country: seller.country,
				region: seller.region,
				taxId: seller.taxId,
			},
			buyer: {
				country: doc.buyer.country,
				region: doc.buyer.region,
				taxId: doc.buyer.taxId,
			},
			currency: doc.currency,
			placeOfSupply: doc.placeOfSupply,
		},
		doc.lines.map((l) => ({
			lineNo: l.lineNo,
			quantity: l.quantity,
			unitPrice: l.unitPrice,
			discount: l.discount,
			taxCode: l.taxCode,
			rate: l.rate,
			hsnSac: l.hsnSac,
		})),
	);
}
