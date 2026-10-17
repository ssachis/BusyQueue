/**
 * Document numbering (#16). Pure: the issue store turns this into SQL so the
 * sequence itself is taken from the counter row inside the issuing batch.
 *
 *   INV-0001          no series, no fiscal year (US, GB, DE, FR, AU, CA, AE)
 *   INV-A-0001        series "A"
 *   INV/26-27/0001    India, financial year 2026-27
 *   INV-A/26-27/0001  India, series "A" (16 characters, the legal maximum)
 *
 * India: CGST Rules 2017, rule 46(b) requires "a consecutive serial number not
 * exceeding sixteen characters, in one or multiple series, containing
 * alphabets or numerals or special characters- hyphen or dash and slash
 * ... unique for a financial year". The financial year runs 1 April to
 * 31 March, so India numbers restart each April and carry the year in the
 * number (which keeps them unique across years for the same series).
 * Source: https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule46_v1.00.html
 *
 * Other supported countries have no fiscal-year reset: one sequence per
 * business, type and series, forever (fiscal year "").
 */
import type { DocumentType } from "./types.ts";

export const NUMBER_PREFIXES: Record<DocumentType, string> = {
	invoice: "INV",
	quote: "QUO",
	proforma: "PRO",
	credit_note: "CN",
	receipt: "RCT",
	delivery_note: "DN",
};

/** Minimum digits in the sequence (zero-padded; grows past 9999 if needed). */
export const SEQUENCE_DIGITS = 4;

/** Optional series: up to 6 capital letters or digits, e.g. "A", "KITCH2". */
export const SERIES_PATTERN = /^[A-Z0-9]{0,6}$/;

/** India's rule 46(b) limit; other countries have no length limit. */
const MAX_LENGTH: Partial<Record<string, number>> = { IN: 16 };

export class NumberingError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "NumberingError";
	}
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The fiscal year a document dated `isoDate` is numbered in. India: April to
 * March, as "2026-27". Elsewhere "" (no reset).
 */
export function fiscalYearFor(country: string, isoDate: string): string {
	const m = ISO_DATE.exec(isoDate);
	if (!m) throw new NumberingError(`Not a date: ${isoDate}`);
	if (country !== "IN") return "";
	const year = Number(m[1]);
	const month = Number(m[2]);
	const start = month >= 4 ? year : year - 1;
	return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

/** Everything before the sequence, e.g. "INV-", "INV-A-", "INV/26-27/". */
export function numberPrefix(input: {
	type: DocumentType;
	series: string;
	fiscalYear: string;
}): string {
	const head = input.series
		? `${NUMBER_PREFIXES[input.type]}-${input.series}`
		: NUMBER_PREFIXES[input.type];
	// "2026-27" prints as "26-27" to stay inside India's 16 characters.
	return input.fiscalYear
		? `${head}/${input.fiscalYear.slice(2)}/`
		: `${head}-`;
}

/** The full number. Must match the SQL in the issue store (see sequenceSql). */
export function formatDocumentNumber(prefix: string, sequence: number): string {
	if (!Number.isSafeInteger(sequence) || sequence < 1) {
		throw new NumberingError(`Not a sequence number: ${sequence}`);
	}
	return `${prefix}${String(sequence).padStart(SEQUENCE_DIGITS, "0")}`;
}

/** SQLite printf format that pads like formatDocumentNumber. */
export const SEQUENCE_PRINTF = `%0${SEQUENCE_DIGITS}d`;

export interface NumberingPlan {
	/** Counter key part; "" when the country has no fiscal-year reset. */
	fiscalYear: string;
	prefix: string;
	/** Longest number the country allows, or null for no limit. */
	maxLength: number | null;
}

/**
 * How a document will be numbered. Throws NumberingError on a bad series or a
 * prefix that leaves no room for the sequence under the country's limit.
 */
export function planNumbering(input: {
	country: string;
	type: DocumentType;
	series: string;
	date: string;
}): NumberingPlan {
	if (!SERIES_PATTERN.test(input.series)) {
		throw new NumberingError(
			`Series "${input.series}" must be up to 6 capital letters or digits`,
		);
	}
	const fiscalYear = fiscalYearFor(input.country, input.date);
	const prefix = numberPrefix({
		type: input.type,
		series: input.series,
		fiscalYear,
	});
	const maxLength = MAX_LENGTH[input.country] ?? null;
	if (maxLength !== null && prefix.length + SEQUENCE_DIGITS > maxLength) {
		throw new NumberingError(
			`Numbers in ${input.country} can be at most ${maxLength} characters; use a shorter series`,
		);
	}
	return { fiscalYear, prefix, maxLength };
}
