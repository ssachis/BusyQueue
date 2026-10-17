/**
 * Display formatting for printed documents (#19). Pure: no I/O, no clock.
 *
 * Every amount printed comes from integer minor units (`formatMoney`) or from
 * the decimal strings the user entered (quantity, unit price, discount),
 * which are formatted exactly: Intl.NumberFormat is given the decimal string,
 * never a float.
 */
import { dec, minorUnitDigits } from "#/lib/money/index.ts";
import type { TaxComponentCode } from "#/lib/tax/index.ts";

/** Number-format locale per seller country. Headings stay English everywhere. */
const LOCALES: Record<string, string> = {
	IN: "en-IN",
	US: "en-US",
	GB: "en-GB",
	CA: "en-CA",
	AU: "en-AU",
	AE: "en-AE",
	DE: "de-DE",
	FR: "fr-FR",
};

export function localeFor(country: string): string {
	return LOCALES[country] ?? "en-US";
}

const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

/** "2026-10-17" → "17 Oct 2026". Unambiguous in every country; no time zone. */
export function formatDate(iso: string): string {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
	if (!m) return iso;
	const month = MONTHS[Number(m[2]) - 1];
	if (!month) return iso;
	return `${Number(m[3])} ${month} ${m[1]}`;
}

/** Digits after the point in a decimal string ("12.500" → 3). */
function decimals(value: string): number {
	const point = value.indexOf(".");
	return point === -1 ? 0 : value.length - point - 1;
}

/** Normalised plain decimal string (no exponent), e.g. "2.500" → "2.5". */
function plain(value: string): string {
	return dec(value).toFixed();
}

/** Quantity as entered, with locale grouping: "1000" → "1,000", "2.50" → "2.5". */
export function formatQuantity(value: string, locale: string): string {
	const exact = plain(value);
	return new Intl.NumberFormat(locale, {
		maximumFractionDigits: Math.min(decimals(exact), 20),
	}).format(exact as unknown as number);
}

/**
 * A unit price or discount as entered, in the document currency. Keeps at
 * least the currency's minor digits and any extra the user typed
 * ("0.125" USD → "$0.125"), so the printed price is never rounded.
 */
export function formatUnitAmount(
	value: string,
	currency: string,
	locale: string,
): string {
	const exact = plain(value);
	const digits = minorUnitDigits(currency);
	return new Intl.NumberFormat(locale, {
		style: "currency",
		currency,
		minimumFractionDigits: digits,
		maximumFractionDigits: Math.min(Math.max(digits, decimals(exact)), 20),
	}).format(exact as unknown as number);
}

const COMPONENT_NAMES: Record<TaxComponentCode, string> = {
	CGST: "CGST",
	SGST: "SGST",
	UTGST: "UTGST",
	IGST: "IGST",
	VAT: "VAT",
	GST: "GST",
	HST: "HST",
	PST: "PST",
	QST: "QST",
	SALES_TAX: "Sales tax",
};

export function componentName(code: TaxComponentCode): string {
	return COMPONENT_NAMES[code] ?? code;
}

/** "9" → "9%", "9.975" → "9.975%". */
export function formatRate(rate: string): string {
	return `${plain(rate)}%`;
}

/** Label of a tax total row, e.g. "CGST 9%", "Sales tax 8.875%". */
export function taxRowLabel(code: TaxComponentCode, rate: string): string {
	return `${componentName(code)} ${formatRate(rate)}`;
}

/** What the buyer's tax ID is called in their country. */
export function buyerTaxIdLabel(country: string): string {
	switch (country) {
		case "IN":
			return "GSTIN";
		case "AU":
			return "ABN";
		case "AE":
			return "TRN";
		case "CA":
			return "BN";
		case "US":
			return "Tax ID";
		default:
			return "VAT ID";
	}
}

let regionNames: Intl.DisplayNames | null = null;

/** "DE" → "Germany". Falls back to the code. */
export function countryName(code: string): string {
	try {
		regionNames ??= new Intl.DisplayNames(["en"], { type: "region" });
		return regionNames.of(code) ?? code;
	} catch {
		return code;
	}
}

/**
 * India GST state codes (first two digits of a GSTIN), for "Place of supply".
 * 96 and 97 are the codes GSTN uses for a foreign country and other territory.
 */
export const IN_STATES: Record<string, string> = {
	"01": "Jammu and Kashmir",
	"02": "Himachal Pradesh",
	"03": "Punjab",
	"04": "Chandigarh",
	"05": "Uttarakhand",
	"06": "Haryana",
	"07": "Delhi",
	"08": "Rajasthan",
	"09": "Uttar Pradesh",
	"10": "Bihar",
	"11": "Sikkim",
	"12": "Arunachal Pradesh",
	"13": "Nagaland",
	"14": "Manipur",
	"15": "Mizoram",
	"16": "Tripura",
	"17": "Meghalaya",
	"18": "Assam",
	"19": "West Bengal",
	"20": "Jharkhand",
	"21": "Odisha",
	"22": "Chhattisgarh",
	"23": "Madhya Pradesh",
	"24": "Gujarat",
	"25": "Daman and Diu",
	"26": "Dadra and Nagar Haveli and Daman and Diu",
	"27": "Maharashtra",
	"28": "Andhra Pradesh (old)",
	"29": "Karnataka",
	"30": "Goa",
	"31": "Lakshadweep",
	"32": "Kerala",
	"33": "Tamil Nadu",
	"34": "Puducherry",
	"35": "Andaman and Nicobar Islands",
	"36": "Telangana",
	"37": "Andhra Pradesh",
	"38": "Ladakh",
	"96": "Other Country",
	"97": "Other Territory",
};

/** "27" → "Maharashtra (27)"; unknown codes print as given. */
export function inStateLabel(code: string): string {
	const name = IN_STATES[code];
	return name ? `${name} (${code})` : code;
}

/**
 * Text colour that reads on the accent band: "light" (white) on dark
 * accents, "dark" on light ones. WCAG relative luminance, threshold where
 * black and white text have equal contrast.
 */
export function inkOn(hex: string): "light" | "dark" {
	const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
	if (!m) return "light";
	const channel = (h: string) => {
		const c = Number.parseInt(h, 16) / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	};
	const l =
		0.2126 * channel(m[1]) + 0.7152 * channel(m[2]) + 0.0722 * channel(m[3]);
	return l > 0.179 ? "dark" : "light";
}
