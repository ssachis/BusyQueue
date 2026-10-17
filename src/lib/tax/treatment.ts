import { dec } from "#/lib/money/index.ts";
import type { CodeMeaning } from "./codes.ts";
import {
	CA_PROVINCES,
	type ComponentRate,
	EU_COUNTRIES,
	IN_STATE_CODE,
	IN_UTGST_CODES,
} from "./rates.ts";
import {
	hasTaxId,
	type SupplyType,
	type TaxComponentCode,
	type TaxContext,
	TaxError,
} from "./types.ts";

/**
 * Statutory note texts. Sources are in rates.ts next to each country's table.
 * IN: third proviso to Rule 46, CGST Rules 2017 (as amended by Notification
 * 17/2017-Central Tax).
 */
export const NOTES = {
	IN_EXPORT_LUT:
		"SUPPLY MEANT FOR EXPORT/SUPPLY TO SEZ UNIT OR SEZ DEVELOPER FOR AUTHORISED OPERATIONS UNDER BOND OR LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX",
	DE_REVERSE_CHARGE:
		"Steuerschuldnerschaft des Leistungsempfängers (reverse charge: the customer accounts for the VAT).",
	FR_REVERSE_CHARGE:
		"Auto-liquidation (reverse charge: the customer accounts for the VAT).",
	DE_OUTSIDE_EU:
		"Not subject to German VAT: supply to a customer outside the EU (steuerfreie Ausfuhr / nicht im Inland steuerbar).",
	FR_OUTSIDE_EU:
		"Not subject to French VAT: supply to a customer outside the EU (exonération / hors champ de la TVA française).",
	GB_REVERSE_CHARGE:
		"Reverse charge: outside the scope of UK VAT. The customer accounts for any VAT due in their country.",
	GB_EXPORT: "Zero-rated: supply to a customer outside the UK.",
	AE_REVERSE_CHARGE:
		"Reverse charge: the recipient is required to account for the tax.",
	AE_EXPORT: "Zero-rated: supply to a recipient outside the UAE.",
	AU_EXPORT: "GST-free export: supply to a recipient outside Australia.",
	CA_EXPORT: "Zero-rated export: supply to a recipient outside Canada.",
} as const;

export interface Treatment {
	/** Domestic supplies are taxed by code; the others carry no tax. */
	kind: "domestic" | "reverse_charge" | "export";
	supplyType?: SupplyType;
	notes: string[];
	/** Tax components for a line code that is taxable in this supply. */
	components: (meaning: CodeMeaning, userRate?: string) => ComponentRate[];
}

const HALF = dec("2");

const noTax = (): ComponentRate[] => [];

function single(code: TaxComponentCode) {
	return (meaning: CodeMeaning): ComponentRate[] =>
		meaning.kind === "rate" ? [{ code, rate: meaning.rate }] : [];
}

const domestic = (
	components: Treatment["components"],
	extra: Partial<Treatment> = {},
): Treatment => ({ kind: "domestic", notes: [], components, ...extra });

const zeroRated = (
	kind: "reverse_charge" | "export",
	notes: string[],
	extra: Partial<Treatment> = {},
): Treatment => ({ kind, notes, components: noTax, ...extra });

function inStateCode(value: string | undefined, what: string): string {
	if (value === undefined) {
		throw new TaxError(
			"missing_region",
			`India: ${what} state code is required`,
		);
	}
	if (!IN_STATE_CODE.test(value)) {
		throw new TaxError(
			"invalid_input",
			`India: ${what} must be a two-digit GST state code, got "${value}"`,
		);
	}
	return value;
}

/**
 * India GST. Buyer outside India → export under LUT (no IGST). Otherwise the
 * place of supply (explicit, else buyer state) decides: same state as the
 * seller → CGST + SGST (UTGST in union territories without a legislature),
 * each at half the rate; different state → IGST at the full rate.
 */
function india(ctx: TaxContext): Treatment {
	const sellerState = inStateCode(ctx.seller.region, "seller");
	if (ctx.buyer.country !== "IN") {
		return zeroRated("export", [NOTES.IN_EXPORT_LUT], { supplyType: "export" });
	}
	const pos = inStateCode(
		ctx.placeOfSupply ?? ctx.buyer.region,
		"place of supply",
	);
	if (pos === sellerState) {
		const local: TaxComponentCode = IN_UTGST_CODES.has(pos) ? "UTGST" : "SGST";
		return domestic(
			(m) => {
				if (m.kind !== "rate") return [];
				const half = dec(m.rate).div(HALF).toString();
				return [
					{ code: "CGST", rate: half },
					{ code: local, rate: half },
				];
			},
			{ supplyType: "intra_state" },
		);
	}
	return domestic(single("IGST"), { supplyType: "inter_state" });
}

/**
 * Canada. Simplification: place of supply is the buyer's province (the
 * engine does not apply the goods/services place-of-supply rules), and PST is
 * applied to every taxable line in BC/MB/SK. QST is charged on the price
 * excluding GST.
 */
function canada(ctx: TaxContext): Treatment {
	if (ctx.buyer.country !== "CA") {
		return zeroRated("export", [NOTES.CA_EXPORT]);
	}
	const region = ctx.buyer.region;
	if (region === undefined) {
		throw new TaxError("missing_region", "Canada: buyer province is required");
	}
	const province = CA_PROVINCES[region];
	if (!province) {
		throw new TaxError(
			"invalid_input",
			`Unknown Canadian province "${region}"`,
		);
	}
	return domestic((m) => (m.kind === "province" ? province.components : []));
}

/**
 * Germany / France. Same country → domestic VAT. Another EU country and the
 * buyer has a VAT ID → reverse charge. Another EU country without a VAT ID →
 * seller's VAT (simplification: OSS/distance-selling rules not modelled).
 * Outside the EU → no VAT with an export/outside-scope note. Goods and
 * services are not distinguished.
 */
function eu(ctx: TaxContext, country: "DE" | "FR"): Treatment {
	const buyer = ctx.buyer.country;
	if (buyer === country) return domestic(single("VAT"));
	if (EU_COUNTRIES.has(buyer)) {
		if (!hasTaxId(ctx.buyer)) return domestic(single("VAT"));
		const wording =
			country === "DE" ? NOTES.DE_REVERSE_CHARGE : NOTES.FR_REVERSE_CHARGE;
		return zeroRated("reverse_charge", [
			wording,
			`Customer VAT ID: ${ctx.buyer.taxId?.trim()}`,
		]);
	}
	return zeroRated("export", [
		country === "DE" ? NOTES.DE_OUTSIDE_EU : NOTES.FR_OUTSIDE_EU,
	]);
}

/**
 * UK and UAE. Buyer abroad with a tax ID → reverse charge (B2B services
 * treatment); buyer abroad without one → zero-rated export. Simplification:
 * goods vs services and B2C place-of-supply rules are not distinguished.
 */
function crossBorderVat(
	ctx: TaxContext,
	home: "GB" | "AE",
	reverseChargeNotes: string[],
	exportNote: string,
): Treatment {
	if (ctx.buyer.country === home) return domestic(single("VAT"));
	if (hasTaxId(ctx.buyer)) {
		return zeroRated("reverse_charge", reverseChargeNotes);
	}
	return zeroRated("export", [exportNote]);
}

/** Australia: buyer outside Australia → GST-free export. */
function australia(ctx: TaxContext): Treatment {
	if (ctx.buyer.country !== "AU") return zeroRated("export", [NOTES.AU_EXPORT]);
	return domestic(single("GST"));
}

/** US: always the user-entered rate; no nexus or export logic. */
function unitedStates(): Treatment {
	return domestic((m, userRate) =>
		m.kind === "user_rate" && userRate !== undefined
			? [{ code: "SALES_TAX", rate: userRate }]
			: [],
	);
}

export function treatmentFor(ctx: TaxContext): Treatment {
	switch (ctx.seller.country) {
		case "IN":
			return india(ctx);
		case "CA":
			return canada(ctx);
		case "DE":
		case "FR":
			return eu(ctx, ctx.seller.country);
		case "GB":
			return crossBorderVat(
				ctx,
				"GB",
				[NOTES.GB_REVERSE_CHARGE],
				NOTES.GB_EXPORT,
			);
		case "AE":
			return crossBorderVat(
				ctx,
				"AE",
				[NOTES.AE_REVERSE_CHARGE, NOTES.AE_EXPORT],
				NOTES.AE_EXPORT,
			);
		case "AU":
			return australia(ctx);
		case "US":
			return unitedStates();
	}
}
