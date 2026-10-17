/**
 * Turn the model's transcription of a contract into checked terms and price
 * rows. No I/O and no model: every check here is code, so a value the model
 * got wrong (or made up) is flagged rather than silently trusted.
 *
 * The key guard: every agreed price must appear, as a number, in the
 * contract text itself. A price the model invented can't pass.
 */
import { z } from "zod";
import { dec, isCurrencyCode } from "#/lib/money/index.ts";
import { normalizeItem, normalizeUnit } from "#/lib/rules/aliases.ts";
import {
	type ContractPrice,
	type ContractTerms,
	type ExtractionFlag,
	type ParsedContract,
	RawExtraction,
	RawPriceRow,
} from "./types.ts";

const IsoDate = z.iso.date();

/** Top-level fields the model may mark as uncertain. */
const TERM_FIELDS = [
	"vendor",
	"title",
	"startDate",
	"endDate",
	"noticeDays",
	"autoRenew",
	"currency",
] as const;

/**
 * "$1,234.50", "USD 2.10", " 16.80 " → "1234.50" / "2.10" / "16.80". Returns
 * null for anything that isn't a plain positive decimal once the currency
 * marker and thousands separators are gone. String clean-up only; nothing is
 * rounded or converted.
 */
export function normalizePrintedDecimal(
	value: string | number | null | undefined,
): string | null {
	if (value === null || value === undefined) return null;
	const raw = typeof value === "number" ? String(value) : value;
	const cleaned = raw
		.trim()
		.replace(/^(usd|us\$|\$|€|£|₹|eur|gbp|inr)\s*/i, "")
		.replace(/(\d),(?=\d{3}(\D|$))/g, "$1")
		.trim();
	if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
	if (!/[1-9]/.test(cleaned)) return null;
	return cleaned;
}

/**
 * A pack size, allowing the row's own unit after the number ("40 lb" on a
 * per-lb row → "40"). Any other trailing word is rejected.
 */
export function normalizePackSize(
	value: string | number | null | undefined,
	unit: string,
): string | null {
	if (typeof value === "string") {
		const m = value.trim().match(/^([\d.,]+)\s*([a-z]+\.?)$/i);
		if (m?.[1] && m[2]) {
			return normalizeUnit(m[2]) === normalizeUnit(unit)
				? normalizePrintedDecimal(m[1])
				: null;
		}
	}
	return normalizePrintedDecimal(value);
}

/** Every number printed in the text, in canonical form ("16.80" → "16.8"). */
export function numbersInText(text: string): Set<string> {
	const withoutSeparators = text.replace(/(\d),(?=\d{3}(\D|$))/g, "$1");
	const found = new Set<string>();
	for (const match of withoutSeparators.matchAll(/\d+(?:\.\d+)?/g)) {
		found.add(dec(match[0]).toString());
	}
	return found;
}

const canonical = (decimal: string) => dec(decimal).toString();

const trimmedOrNull = (v: string | null | undefined, max = 200) => {
	const t = v?.trim().replace(/\s+/g, " ");
	return t ? t.slice(0, max) : null;
};

export interface ParseOptions {
	/** The contract text the model read; prices are checked against it. */
	sourceText: string;
	/** Used (and flagged) when the contract states no currency. */
	defaultCurrency: string;
}

/**
 * Validate the model's JSON. Never throws on bad content: a malformed field
 * becomes a flag, and a price row with an error flag is `blocked`.
 */
export function parseExtraction(
	raw: unknown,
	{ sourceText, defaultCurrency }: ParseOptions,
): ParsedContract {
	const flags: ExtractionFlag[] = [];
	const flag = (
		path: string,
		severity: ExtractionFlag["severity"],
		message: string,
		source: ExtractionFlag["source"] = "validation",
	) => flags.push({ path, severity, source, message });

	const top = RawExtraction.safeParse(raw);
	if (!top.success) {
		flag(
			"",
			"error",
			`The model's answer was not in the expected shape: ${top.error.issues[0]?.message ?? "invalid"}`,
		);
		return {
			terms: emptyTerms(defaultCurrency),
			prices: [],
			flags,
		};
	}
	const x = top.data;

	for (const field of x.uncertainFields ?? []) {
		if ((TERM_FIELDS as readonly string[]).includes(field)) {
			flag(field, "warning", "The model was not sure about this.", "model");
		}
	}

	// ── Terms ──
	const vendorName = trimmedOrNull(x.vendor);
	if (!vendorName) {
		flag("vendor", "warning", "No counterparty found. Pick the vendor below.");
	}

	const date = (field: "startDate" | "endDate") => {
		const value = x[field]?.trim();
		if (!value) {
			flag(field, "warning", "Not found in the contract.");
			return null;
		}
		if (!IsoDate.safeParse(value).success) {
			flag(field, "warning", `"${value}" is not a valid date.`);
			return null;
		}
		return value;
	};
	const startDate = date("startDate");
	const endDate = date("endDate");
	if (startDate && endDate && endDate < startDate) {
		flag("endDate", "warning", "Ends before it starts.");
	}

	let noticeDays: number | null = null;
	if (x.noticeDays !== null && x.noticeDays !== undefined) {
		const n =
			typeof x.noticeDays === "string" && /^\s*\d+\s*$/.test(x.noticeDays)
				? Number.parseInt(x.noticeDays, 10)
				: x.noticeDays;
		if (typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 3650) {
			noticeDays = n;
		} else {
			flag("noticeDays", "warning", `"${x.noticeDays}" is not a day count.`);
		}
	}

	let currency = defaultCurrency;
	const printedCurrency = x.currency?.trim().toUpperCase();
	if (printedCurrency && isCurrencyCode(printedCurrency)) {
		currency = printedCurrency;
	} else {
		flag(
			"currency",
			"warning",
			printedCurrency
				? `"${x.currency}" is not a currency code; assumed ${defaultCurrency}.`
				: `No currency stated; assumed ${defaultCurrency}.`,
		);
	}

	const terms: ContractTerms = {
		vendorName,
		title: trimmedOrNull(x.title),
		startDate,
		endDate,
		noticeDays,
		autoRenew: x.autoRenew ?? null,
		currency,
	};

	// ── Prices ──
	const printedNumbers = numbersInText(sourceText);
	const normalizedText = normalizeItem(sourceText);
	const seen = new Map<string, number>();
	const prices: ContractPrice[] = x.prices.map((entry, i) => {
		const lineNo = i + 1;
		const path = `prices.${lineNo}`;
		const parsed = RawPriceRow.safeParse(entry);
		const row = parsed.success ? parsed.data : {};
		const price: ContractPrice = {
			lineNo,
			item: trimmedOrNull(row.item) ?? "",
			unit: trimmedOrNull(row.unit, 40) ?? "",
			unitPrice: null,
			packUnit: null,
			packSize: null,
			blocked: false,
		};
		const block = (field: string, message: string) => {
			price.blocked = true;
			flag(`${path}.${field}`, "error", message);
		};

		if (!parsed.success) {
			block("item", "Unreadable price row.");
			return price;
		}
		if (!price.item) block("item", "Missing item name.");
		else if (!normalizedText.includes(normalizeItem(price.item))) {
			flag(
				`${path}.item`,
				"warning",
				`"${price.item}" is not spelled this way in the contract.`,
			);
		}
		if (!price.unit) block("unit", "Missing pricing unit.");

		const unitPrice = normalizePrintedDecimal(row.unitPrice);
		if (!unitPrice) {
			block(
				"unitPrice",
				row.unitPrice === null || row.unitPrice === undefined
					? "Missing unit price."
					: `"${row.unitPrice}" is not a price.`,
			);
		} else if (!printedNumbers.has(canonical(unitPrice))) {
			block(
				"unitPrice",
				`${unitPrice} does not appear in the contract text, so it was not transcribed from it.`,
			);
		} else {
			price.unitPrice = unitPrice;
		}

		const packUnit = trimmedOrNull(row.packUnit, 40);
		const packSizeRaw = row.packSize;
		if (packUnit || (packSizeRaw !== null && packSizeRaw !== undefined)) {
			const packSize = normalizePackSize(packSizeRaw, price.unit);
			if (!packUnit || packSizeRaw === null || packSizeRaw === undefined) {
				flag(
					`${path}.packSize`,
					"warning",
					"Pack needs both a unit and a size; pack ignored.",
				);
			} else if (!packSize) {
				flag(
					`${path}.packSize`,
					"warning",
					`"${packSizeRaw}" is not a pack size; pack ignored.`,
				);
			} else if (!printedNumbers.has(canonical(packSize))) {
				flag(
					`${path}.packSize`,
					"warning",
					`Pack size ${packSize} does not appear in the contract; pack ignored.`,
				);
			} else {
				price.packUnit = packUnit;
				price.packSize = packSize;
			}
		}

		if (row.uncertain) {
			flag(
				path,
				"warning",
				row.note?.trim()
					? `The model was not sure: ${row.note.trim()}`
					: "The model was not sure about this row.",
				"model",
			);
		}

		if (!price.blocked) {
			const key = priceKey(price.item, price.unit);
			const first = seen.get(key);
			if (first !== undefined) {
				block("item", `Same item and unit as line ${first}.`);
			} else {
				seen.set(key, lineNo);
			}
		}
		return price;
	});

	if (!prices.some((p) => !p.blocked)) {
		flag("prices", "error", "No usable agreed prices were found.");
	}

	return { terms, prices, flags };
}

/**
 * The model's reply as JSON. Tolerates a ```json fence or prose around one
 * object; anything else is an error for the caller to flag.
 */
export function parseModelJson(
	content: string | null | undefined,
): { ok: true; value: unknown } | { ok: false; error: string } {
	const text = content?.trim() ?? "";
	if (!text) return { ok: false, error: "The model returned nothing." };
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1];
	const candidate = fenced ?? text;
	const start = candidate.indexOf("{");
	const end = candidate.lastIndexOf("}");
	if (start === -1 || end <= start) {
		return { ok: false, error: "The model's reply had no JSON object." };
	}
	try {
		return { ok: true, value: JSON.parse(candidate.slice(start, end + 1)) };
	} catch (error) {
		return {
			ok: false,
			error: `The model's JSON did not parse: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

/** Identity of a price-list row: item and unit, spelling-insensitive. */
export const priceKey = (item: string, unit: string) =>
	`${normalizeItem(item)}|${normalizeUnit(unit)}`;

function emptyTerms(currency: string): ContractTerms {
	return {
		vendorName: null,
		title: null,
		startDate: null,
		endDate: null,
		noticeDays: null,
		autoRenew: null,
		currency,
	};
}

/** True when nothing blocks confirming (some price row is usable). */
export const hasUsablePrices = (parsed: ParsedContract) =>
	parsed.prices.some((p) => !p.blocked);
