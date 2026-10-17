import { dec } from "#/lib/money/index.ts";
import {
	AE_VAT_RATE,
	AU_GST_RATE,
	CA_PROVINCES,
	DE_VAT_RATES,
	FR_VAT_RATES,
	GB_VAT_RATES,
	IN_GST_RATES,
} from "./rates.ts";
import {
	isTaxCountry,
	type TaxCodeOption,
	type TaxCountry,
	TaxError,
} from "./types.ts";

/** No tax on the line (zero-rated / nil-rated / GST-free). */
export const ZERO = "ZERO";
/** No tax on the line (exempt / input taxed). */
export const EXEMPT = "EXEMPT";
/** Canada: taxable at the place-of-supply province's GST/HST/PST/QST. */
export const CA_STD = "CA-STD";
/** US: taxable at the percent the user entered on the line. */
export const US_SALES = "US-SALES";

/** What a tax code means, before the place of supply and parties are applied. */
export type CodeMeaning =
	| { kind: "rate"; rate: string }
	| { kind: "province" }
	| { kind: "user_rate" }
	| { kind: "none" };

interface CodeDef extends TaxCodeOption {
	meaning: CodeMeaning;
}

const fixed = (code: string, label: string, rate: string): CodeDef => ({
	code,
	label,
	rate,
	meaning: { kind: "rate", rate },
});

const none = (code: string, label: string): CodeDef => ({
	code,
	label,
	rate: "0",
	meaning: { kind: "none" },
});

function caStandard(region?: string): CodeDef {
	const meaning: CodeMeaning = { kind: "province" };
	if (region === undefined) {
		return {
			code: CA_STD,
			label: "Taxable (GST/HST/PST by province)",
			rate: "",
			meaning,
		};
	}
	const province = CA_PROVINCES[region];
	if (!province) {
		throw new TaxError(
			"invalid_input",
			`Unknown Canadian province "${region}"`,
		);
	}
	const parts = province.components.map((c) => `${c.code} ${c.rate}%`);
	const total = province.components
		.reduce((acc, c) => acc.plus(dec(c.rate)), dec("0"))
		.toString();
	return {
		code: CA_STD,
		label: `Taxable: ${parts.join(" + ")} (${province.name})`,
		rate: total,
		meaning,
	};
}

function definitions(country: TaxCountry, region?: string): CodeDef[] {
	switch (country) {
		case "IN":
			return [
				...IN_GST_RATES.map((r) => fixed(`IN-GST-${r}`, `GST ${r}%`, r)),
				none(ZERO, "Nil rated (0%)"),
				none(EXEMPT, "Exempt"),
			];
		case "DE":
			return [
				...DE_VAT_RATES.map((r) =>
					fixed(
						`DE-VAT-${r}`,
						r === "19" ? "VAT 19% (Regelsteuersatz)" : `VAT ${r}% (ermäßigt)`,
						r,
					),
				),
				none(ZERO, "Zero rate (0%)"),
				none(EXEMPT, "Exempt (steuerfrei)"),
			];
		case "FR":
			return [
				...FR_VAT_RATES.map((r) => fixed(`FR-VAT-${r}`, `TVA ${r}%`, r)),
				none(EXEMPT, "Exonéré (exempt)"),
			];
		case "GB":
			return [
				...GB_VAT_RATES.map((r) =>
					fixed(
						`GB-VAT-${r}`,
						r === "20" ? "Standard rate 20%" : `Reduced rate ${r}%`,
						r,
					),
				),
				none(ZERO, "Zero rate (0%)"),
				none(EXEMPT, "Exempt"),
			];
		case "AU":
			return [
				fixed(`AU-GST-${AU_GST_RATE}`, `GST ${AU_GST_RATE}%`, AU_GST_RATE),
				none(ZERO, "GST-free"),
				none(EXEMPT, "Input taxed"),
			];
		case "AE":
			return [
				fixed(`AE-VAT-${AE_VAT_RATE}`, `VAT ${AE_VAT_RATE}%`, AE_VAT_RATE),
				none(ZERO, "Zero-rated (0%)"),
				none(EXEMPT, "Exempt"),
			];
		case "CA":
			return [
				caStandard(region),
				none(ZERO, "Zero-rated"),
				none(EXEMPT, "Exempt"),
			];
		case "US":
			return [
				{
					code: US_SALES,
					label: "Sales tax (enter rate)",
					rate: "",
					meaning: { kind: "user_rate" },
				},
				none(EXEMPT, "Exempt"),
			];
	}
}

export function assertTaxCountry(
	country: string,
): asserts country is TaxCountry {
	if (!isTaxCountry(country)) {
		throw new TaxError("unknown_country", `No tax rules for "${country}"`);
	}
}

/**
 * Tax codes for the editor's dropdown. For CA, pass the buyer's province to
 * get the combined rate in the label; without it `CA-STD` has rate "".
 * `US-SALES` always has rate "" (the user enters it per line).
 */
export function taxCodes(
	country: TaxCountry,
	region?: string,
): TaxCodeOption[] {
	assertTaxCountry(country);
	return definitions(country, region).map(({ code, label, rate }) => ({
		code,
		label,
		rate,
	}));
}

/** Resolve a line's tax code for the seller country, or throw `unknown_tax_code`. */
export function codeMeaning(country: TaxCountry, code: string): CodeMeaning {
	const def = definitions(country).find((d) => d.code === code);
	if (!def) {
		throw new TaxError(
			"unknown_tax_code",
			`Tax code "${code}" is not valid for ${country}`,
		);
	}
	return def.meaning;
}
