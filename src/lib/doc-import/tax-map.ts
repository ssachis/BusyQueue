/**
 * Printed tax percent(s) → a tax code the seller country's engine accepts.
 *
 * The model copies the percents it sees ("8.25", or "9" and "9" for CGST +
 * SGST); this code adds them up with the decimal library and looks the total
 * up in `taxCodes()`. A percent that isn't one of the country's rates is not
 * rounded to the nearest one: the code is left empty and flagged, and the
 * person picks. Pure.
 */
import { dec, isDecimalString } from "#/lib/money/index.ts";
import {
	CA_PROVINCES,
	EXEMPT,
	type TaxCountry,
	taxCodes,
	US_SALES,
	ZERO,
} from "#/lib/tax/index.ts";

export interface TaxMapping {
	/** "" when no code fits; the review screen asks the person to pick. */
	taxCode: string;
	/** US-SALES only. */
	rate?: string;
	doubtful: boolean;
	reason?: string;
}

/** The "no tax" code for a country: zero-rated where it exists, else exempt. */
export function noTaxCode(country: TaxCountry): string {
	return taxCodes(country).some((o) => o.code === ZERO) ? ZERO : EXEMPT;
}

/** "9 + 9" style display of printed percents. */
export const showRates = (rates: readonly string[]) =>
	rates.map((r) => `${r}%`).join(" + ");

export function mapTaxRate(input: {
	country: TaxCountry;
	/** Buyer's province for CA (decides the combined rate). */
	region?: string;
	/** Printed percents for the line, as decimal strings (no % sign). */
	rates: readonly string[];
	/** False when the line is marked non-taxable / exempt. */
	taxable?: boolean | null;
	/** A non-zero tax amount is printed somewhere on the document. */
	taxPrinted?: boolean;
}): TaxMapping {
	const { country, region, rates } = input;
	const none = noTaxCode(country);

	if (rates.some((r) => !isDecimalString(r) || r.startsWith("-"))) {
		return {
			taxCode: "",
			doubtful: true,
			reason: `Couldn't read the tax rate "${rates.join(", ")}"`,
		};
	}
	if (input.taxable === false) {
		return { taxCode: none, doubtful: false };
	}
	if (rates.length === 0) {
		return input.taxPrinted
			? {
					taxCode: none,
					doubtful: true,
					reason:
						"Tax is printed on the document but no rate for this line; check whether it's taxable",
				}
			: { taxCode: none, doubtful: false };
	}

	const total = rates.reduce((acc, r) => acc.plus(dec(r)), dec("0"));
	const printed = showRates(rates);
	if (total.eq("0")) return { taxCode: none, doubtful: false };

	if (country === "US") {
		return total.gt("100")
			? {
					taxCode: US_SALES,
					rate: total.toFixed(),
					doubtful: true,
					reason: `${printed} is above 100%`,
				}
			: { taxCode: US_SALES, rate: total.toFixed(), doubtful: false };
	}

	if (country === "CA") {
		const province = region ? CA_PROVINCES[region.toUpperCase()] : undefined;
		if (!province) {
			return {
				taxCode: "CA-STD",
				doubtful: true,
				reason: `Printed ${printed}; the buyer's province decides the rate, and it isn't known`,
			};
		}
		const [option] = taxCodes("CA", region?.toUpperCase());
		return dec(option.rate).eq(total)
			? { taxCode: option.code, doubtful: false }
			: {
					taxCode: option.code,
					doubtful: true,
					reason: `Printed ${printed}, but ${province.name} is ${option.rate}%`,
				};
	}

	const options = taxCodes(country).filter(
		(o) => o.rate !== "" && !dec(o.rate).eq("0"),
	);
	const match = options.find((o) => dec(o.rate).eq(total));
	if (match) {
		return rates.length > 1
			? {
					taxCode: match.code,
					doubtful: false,
					reason: `${printed} = ${total.toFixed()}%`,
				}
			: { taxCode: match.code, doubtful: false };
	}
	return {
		taxCode: "",
		doubtful: true,
		reason: `Printed ${printed} isn't a ${country} rate (${options.map((o) => `${o.rate}%`).join(", ")}); pick a code`,
	};
}
