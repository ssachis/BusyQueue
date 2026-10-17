/**
 * Rate tables. Percent values are decimal strings. Every table carries the
 * source it was checked against and the date it was checked. Re-check before
 * changing a rate; never derive one from memory.
 */
import type { RoundingLevel, TaxComponentCode, TaxCountry } from "./types.ts";

export interface ComponentRate {
	code: TaxComponentCode;
	rate: string;
}

// --- India (GST 2.0) --------------------------------------------------------
// Source: Notification No. 9/2025-Central Tax (Rate), dated 17 Sep 2025,
// effective 22 Sep 2025 (56th GST Council). CGST schedules: I 2.5% (5% GST),
// II 9% (18%), III 20% (40%), IV 1.5% (3%), V 0.125% (0.25%), VI 0.75% (1.5%).
//   https://taxguru.in/goods-and-service-tax/gst-mega-reforms-india-rates-slabs-key-2025.html
//   https://cleartax.in/s/gst-rates
// Schedule VII (28%: tobacco, pan masala) lapsed on 1 Feb 2026, when those goods
// moved to 40% (Notification No. 19/2025-Central Tax (Rate), 31 Dec 2025):
//   https://taxguru.in/?p=1015570
//   https://www.newsonair.gov.in/govt-notifies-february-1st-as-date-from-which-additional-excise-duty-to-be-levied-on-tobacco-products/
// Not modelled: the optional 12% brick scheme (Notification 14/2025-CTR) and
// compensation/health cesses. Checked 2026-10-17.
export const IN_GST_RATES = ["0.25", "1.5", "3", "5", "18", "40"] as const;

/**
 * Union territories without a legislature levy UTGST instead of SGST (UTGST
 * Act 2017): Chandigarh 04, Daman & Diu 25 (legacy code), Dadra & Nagar Haveli
 * and Daman & Diu 26, Lakshadweep 31, Andaman & Nicobar 35, Ladakh 38, Other
 * Territory 97. Delhi 07, Puducherry 34 and J&K 01 have legislatures → SGST.
 */
export const IN_UTGST_CODES: ReadonlySet<string> = new Set([
	"04",
	"25",
	"26",
	"31",
	"35",
	"38",
	"97",
]);

export const IN_STATE_CODE = /^\d{2}$/;

// --- Canada -----------------------------------------------------------------
// Source: CRA "GST/HST calculator (and rates)", table "on or after April 1, 2025":
//   https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate/calculator.html
// AB/NT/NU/YT 5% GST; BC 5% + 7% PST; MB 5% + 7% RST; SK 5% + 6% PST;
// QC 5% + 9.975% QST; ON 13% HST; NS 14% HST ("As of April 1, 2025, the HST
// rate has decreased to 14% in Nova Scotia"); NB/NL/PE 15% HST. Checked 2026-10-17.
// Manitoba's RST is reported under the "PST" component code.
export const CA_PROVINCES: Record<
	string,
	{ name: string; components: ComponentRate[] }
> = {
	AB: { name: "Alberta", components: [{ code: "GST", rate: "5" }] },
	BC: {
		name: "British Columbia",
		components: [
			{ code: "GST", rate: "5" },
			{ code: "PST", rate: "7" },
		],
	},
	MB: {
		name: "Manitoba",
		components: [
			{ code: "GST", rate: "5" },
			{ code: "PST", rate: "7" },
		],
	},
	NB: { name: "New Brunswick", components: [{ code: "HST", rate: "15" }] },
	NL: {
		name: "Newfoundland and Labrador",
		components: [{ code: "HST", rate: "15" }],
	},
	NS: { name: "Nova Scotia", components: [{ code: "HST", rate: "14" }] },
	NT: {
		name: "Northwest Territories",
		components: [{ code: "GST", rate: "5" }],
	},
	NU: { name: "Nunavut", components: [{ code: "GST", rate: "5" }] },
	ON: { name: "Ontario", components: [{ code: "HST", rate: "13" }] },
	PE: {
		name: "Prince Edward Island",
		components: [{ code: "HST", rate: "15" }],
	},
	QC: {
		name: "Quebec",
		components: [
			{ code: "GST", rate: "5" },
			{ code: "QST", rate: "9.975" },
		],
	},
	SK: {
		name: "Saskatchewan",
		components: [
			{ code: "GST", rate: "5" },
			{ code: "PST", rate: "6" },
		],
	},
	YT: { name: "Yukon", components: [{ code: "GST", rate: "5" }] },
};

// --- Germany ----------------------------------------------------------------
// Standard 19%, reduced 7% (§12 UStG); from 1 Jan 2026 restaurant/catering food
// is permanently at 7% (Steueränderungsgesetz 2025), which needs no new rate.
//   https://meridianglobalservices.com/germany-to-permanently-reduce-vat-on-restaurant-and-catering-services-to-7-from-1-1-2026/
//   https://trykintsugi.com/sales-tax-guides/europe/germany
// Reverse-charge wording "Steuerschuldnerschaft des Leistungsempfängers":
// §14a Abs. 1 and 5 UStG, https://www.gesetze-im-internet.de/ustg_1980/__14a.html
// Checked 2026-10-17.
export const DE_VAT_RATES = ["19", "7"] as const;

// --- France -----------------------------------------------------------------
// Metropolitan rates 20% (normal), 10% (intermediate), 5.5% (reduced),
// 2.1% (super-reduced):
//   https://www.superindep.fr/blog/2025/differents-taux-tva-microentreprise/
//   https://www.maxcompta.com/blogs/blog-tva-fiscalite/taux-tva-france-normal-reduit-intermediaire
// Reverse-charge mention « Auto-liquidation » (service-public, verified 11 Aug 2026):
//   https://entreprendre.service-public.gouv.fr/vosdroits/F31808
// Corsica/DOM rates not modelled. Checked 2026-10-17.
export const FR_VAT_RATES = ["20", "10", "5.5", "2.1"] as const;

// --- United Kingdom ---------------------------------------------------------
// Standard 20%, reduced 5%, zero 0%: https://www.gov.uk/vat-rates
// Rounding: VAT Notice 700 §17.5 (updated 25 Jun 2026),
//   https://www.gov.uk/guidance/vat-guide-notice-700
// Checked 2026-10-17.
export const GB_VAT_RATES = ["20", "5"] as const;

// --- Australia --------------------------------------------------------------
// GST 10%; GST-free and input-taxed supplies carry no GST. Tax invoices must be
// headed "Tax invoice"; the ATO calls a credit note an "adjustment note".
// Rounding: nearest cent, 0.5 cent up; "total invoice rule" allowed.
//   https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/tax-invoices
//   https://sprintlaw.com.au/articles/ato-tax-invoice-requirements-what-must-be-on-your-invoices/
// Checked 2026-10-17 (ato.gov.au blocks automated fetch; content via search excerpts).
export const AU_GST_RATE = "10";

// --- United Arab Emirates ---------------------------------------------------
// VAT 5% standard; zero-rated (exports, international transport) and exempt
// supplies. "Tax Invoice" heading per Executive Regulation Art. 59 (amended by
// Cabinet Decision 100/2025); line items rounded to the nearest fils.
//   https://www.numeral.com/blog/uae-vat-rates-and-compliance
//   https://mondaq.com/sales-taxes-vat-gst/670546/tax-invoice-under-uae-vat-law
//   https://farahatco.com/?p=20481
// Checked 2026-10-17.
export const AE_VAT_RATE = "5";

// --- EU membership (for DE/FR reverse charge) -------------------------------
// ISO codes (Greece is "GR" here, not the VAT prefix "EL").
export const EU_COUNTRIES: ReadonlySet<string> = new Set([
	"AT",
	"BE",
	"BG",
	"HR",
	"CY",
	"CZ",
	"DK",
	"EE",
	"FI",
	"FR",
	"DE",
	"GR",
	"HU",
	"IE",
	"IT",
	"LV",
	"LT",
	"LU",
	"MT",
	"NL",
	"PL",
	"PT",
	"RO",
	"SK",
	"SI",
	"ES",
	"SE",
]);

/**
 * Where tax is rounded, per seller country. Always half-up (commercial
 * rounding) to the currency's minor unit.
 *
 * - IN `line`: the GST e-invoice schema carries CGST/SGST/IGST amounts per
 *   item, so each component of each line is rounded to paise. Section 170 CGST
 *   Act (round to the nearest rupee) applies to tax paid, not invoice lines,
 *   and is not applied here.
 * - GB `line`: VAT Notice 700 §17.5.1 allows line-by-line rounding to the
 *   nearest 1p, applied consistently. (The optional round-down of the invoice
 *   total is a concession, not a requirement.)
 * - AE `line`: FTA clarification on tax invoices: line amounts rounded to the
 *   nearest fils.
 * - DE, FR `invoice`: the invoice must state the tax amount per rate (§14
 *   Abs. 4 Nr. 8 UStG; art. 242 nonies A ann. II CGI), so tax is rounded once
 *   per rate on the invoice.
 * - AU `invoice`: ATO "total invoice rule": total the unrounded GST, round
 *   once to the nearest cent (0.5 up).
 * - CA `invoice`: CRA lets you total the prices taxed at the same rate,
 *   calculate the tax, then round to the nearest cent (0.5 up); done per
 *   component (GST, HST, PST, QST).
 * - US `invoice`: no national rule; states generally compute on the invoice
 *   total per rate.
 */
export const ROUNDING: Record<TaxCountry, RoundingLevel> = {
	IN: "line",
	GB: "line",
	AE: "line",
	DE: "invoice",
	FR: "invoice",
	AU: "invoice",
	CA: "invoice",
	US: "invoice",
};
