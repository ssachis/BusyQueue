/**
 * AI import of the business's own documents: everything after the model has
 * answered. The model only transcribes; this module normalises what it
 * printed (formatting only), classifies the type, maps printed tax rates to
 * the seller country's codes, and flags every field a person must check:
 * ones the model was unsure of, ones it couldn't find, ones that needed a
 * guess to normalise, ones that fail validation, and printed totals that
 * don't match what the tax engine computes.
 *
 * Pure: no I/O.
 */
import { z } from "zod";
import { normalizeDecimal, parseModelJson } from "#/lib/import/extraction.ts";
import { dec, isCurrencyCode } from "#/lib/money/index.ts";
import { classifyDocumentType } from "./classify.ts";
import {
	BUYER_FIELDS,
	buyerPath,
	type DocImportForm,
	type DocImportLine,
	LINE_FIELDS,
	type LineField,
	linePath,
	PRINTED_FIELDS,
	printedPath,
	type SellerContext,
} from "./form.ts";
import { mapTaxRate, showRates } from "./tax-map.ts";
import { checkTotals, formTotals, validateForm } from "./validate.ts";

// ── What the model returns ───────────────────────────────────────────

/** Strings are expected; numbers are tolerated but flagged (they went through a float). */
const RawValue = z.union([z.string(), z.number()]).nullish();
const FieldList = z
	.array(z.string())
	.nullish()
	.transform((v) => v ?? []);
const RateList = z
	.union([z.array(z.union([z.string(), z.number()])), z.string(), z.number()])
	.nullish()
	.transform((v) => (v === null || v === undefined ? [] : [v].flat()));

export const RawDocLine = z.object({
	description: RawValue,
	quantity: RawValue,
	unit: RawValue,
	unitPrice: RawValue,
	discount: RawValue,
	discountPercent: RawValue,
	taxRates: RateList,
	taxable: z.boolean().nullish(),
	hsnSac: RawValue,
	amount: RawValue,
	uncertain: FieldList,
});
export type RawDocLine = z.infer<typeof RawDocLine>;

export const RawBuyer = z.object({
	name: RawValue,
	addressLines: z
		.array(z.string())
		.nullish()
		.transform((v) => v ?? []),
	city: RawValue,
	region: RawValue,
	postalCode: RawValue,
	country: RawValue,
	taxId: RawValue,
	email: RawValue,
});

/** The JSON the prompt asks for. Lenient: gaps become flags, not errors. */
export const RawDocExtraction = z.object({
	title: z.string().nullish(),
	documentType: z.string().nullish(),
	documentNumber: RawValue,
	date: RawValue,
	dueDate: RawValue,
	currency: RawValue,
	buyer: RawBuyer.nullish().transform(
		(v) => v ?? RawBuyer.parse({ addressLines: [] }),
	),
	placeOfSupply: RawValue,
	lines: z
		.array(RawDocLine)
		.nullish()
		.transform((v) => v ?? []),
	taxRates: RateList,
	subtotal: RawValue,
	taxTotal: RawValue,
	total: RawValue,
	notes: z.string().nullish(),
	terms: z.string().nullish(),
	uncertain: FieldList,
	legibility: z.string().nullish(),
});
export type RawDocExtraction = z.infer<typeof RawDocExtraction>;

// ── Result ───────────────────────────────────────────────────────────

export interface DocExtraction {
	form: DocImportForm;
	/** Paths a person should check before creating the draft. */
	uncertain: string[];
	/** Path → why it's flagged, when there's more to say than "check this". */
	reasons: Record<string, string>;
	/** Path → validation message, for fields that can't be saved as they are. */
	issues: Record<string, string>;
	/** Path → printed vs computed, for amounts that don't add up. */
	mismatches: Record<string, string>;
	/** Model's note on legibility. */
	legibility: string | null;
}

// ── Normalisation (formatting only, never arithmetic) ────────────────

interface Normalised {
	value: string;
	/** True when the value had to be guessed or couldn't be parsed. */
	doubtful: boolean;
	reason?: string;
}

const asText = (v: string | number | null | undefined): Normalised => {
	if (v === null || v === undefined) return { value: "", doubtful: false };
	if (typeof v === "number") return { value: String(v), doubtful: true };
	return { value: v.trim(), doubtful: false };
};

/**
 * A printed amount as a plain decimal string. Adds Indian digit grouping
 * ("1,20,000.00") and a trailing "%" to the vendor import's normaliser.
 */
export function normalizeAmount(printed: string): string | null {
	const s = printed.trim().replace(/%$/, "").trim();
	const plain = normalizeDecimal(s);
	if (plain !== null) return plain;
	const indian = s.replace(/^(?:₹|Rs\.?|INR)\s*/i, "");
	return /^\d{1,2}(,\d{2})*,\d{3}(\.\d+)?$/.test(indian)
		? indian.replace(/,/g, "")
		: null;
}

function normAmount(v: string | number | null | undefined): Normalised {
	const text = asText(v);
	if (text.value === "") return text;
	const value = normalizeAmount(text.value);
	return value === null
		? { value: text.value, doubtful: true, reason: "Not a plain number" }
		: { value, doubtful: text.doubtful };
}

const pad = (n: string) => n.padStart(2, "0");
const isIsoDate = (s: string) => z.iso.date().safeParse(s).success;

/**
 * An ISO date. Numeric dates follow the seller's convention (US: month/day,
 * elsewhere day/month) and are flagged when the other reading is possible.
 */
export function normalizeDocDate(
	printed: string,
	order: "MDY" | "DMY",
): Normalised {
	const s = printed.trim();
	if (s === "") return { value: "", doubtful: false };
	if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
		return isIsoDate(s)
			? { value: s, doubtful: false }
			: { value: s, doubtful: true, reason: "Not a real date" };
	}
	const named = namedMonthDate(s);
	if (named) return named;
	const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
	if (!m) return { value: s, doubtful: true, reason: "Unrecognised date" };
	const [, a, b, y] = m;
	const year = y.length === 2 ? `20${y}` : y;
	const read = (o: "MDY" | "DMY") => {
		const [month, day] = o === "MDY" ? [a, b] : [b, a];
		return `${year}-${pad(month)}-${pad(day)}`;
	};
	const iso = read(order);
	if (!isIsoDate(iso)) {
		// "24/10/2026" on a US document can only be day/month.
		const other = read(order === "MDY" ? "DMY" : "MDY");
		return isIsoDate(other)
			? {
					value: other,
					doubtful: true,
					reason: `"${s}" only works as ${order === "MDY" ? "day/month" : "month/day"}`,
				}
			: { value: s, doubtful: true, reason: "Not a real date" };
	}
	const ambiguous =
		Number(a) <= 12 && Number(b) <= 12 && Number(a) !== Number(b);
	return ambiguous
		? {
				value: iso,
				doubtful: true,
				reason: `"${s}" read as ${order === "MDY" ? "month/day" : "day/month"}`,
			}
		: { value: iso, doubtful: y.length === 2 };
}

const MONTHS = [
	"jan",
	"feb",
	"mar",
	"apr",
	"may",
	"jun",
	"jul",
	"aug",
	"sep",
	"oct",
	"nov",
	"dec",
];

/** "October 1, 2026", "Oct 1 2026", "1 October 2026", "1-Oct-26": unambiguous. */
function namedMonthDate(s: string): Normalised | null {
	const monthOf = (name: string) => {
		const i = MONTHS.indexOf(name.slice(0, 3).toLowerCase());
		return i === -1 ? null : String(i + 1);
	};
	const mdy = s.match(
		/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/,
	);
	const dmy = s.match(
		/^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3,9})\.?,?[\s-]+(\d{2}|\d{4})$/,
	);
	const parts = mdy
		? { month: mdy[1], day: mdy[2], year: mdy[3] }
		: dmy
			? { month: dmy[2], day: dmy[1], year: dmy[3] }
			: null;
	if (!parts) return null;
	const month = monthOf(parts.month);
	if (!month) return null;
	const year = parts.year.length === 2 ? `20${parts.year}` : parts.year;
	const iso = `${year}-${pad(month)}-${pad(parts.day)}`;
	return isIsoDate(iso)
		? { value: iso, doubtful: parts.year.length === 2 }
		: { value: s, doubtful: true, reason: "Not a real date" };
}

const COUNTRY_NAMES: Record<string, string> = {
	"united states": "US",
	"united states of america": "US",
	usa: "US",
	"u.s.a.": "US",
	"u.s.": "US",
	india: "IN",
	"united kingdom": "GB",
	uk: "GB",
	"great britain": "GB",
	england: "GB",
	scotland: "GB",
	wales: "GB",
	germany: "DE",
	deutschland: "DE",
	france: "FR",
	australia: "AU",
	canada: "CA",
	"united arab emirates": "AE",
	uae: "AE",
};

function normCountry(
	v: string | number | null | undefined,
	fallback: string,
): Normalised {
	const text = asText(v);
	if (text.value === "") {
		return {
			value: fallback,
			doubtful: true,
			reason: `No country printed; assumed ${fallback}`,
		};
	}
	const named = COUNTRY_NAMES[text.value.toLowerCase()];
	if (named) return { value: named, doubtful: false };
	const upper = text.value.toUpperCase();
	if (/^[A-Z]{2}$/.test(upper)) return { value: upper, doubtful: false };
	return { value: text.value, doubtful: true, reason: "Unrecognised country" };
}

const SYMBOL_CURRENCY: Record<string, string> = {
	"€": "EUR",
	"£": "GBP",
	"₹": "INR",
	Rs: "INR",
	"Rs.": "INR",
	US$: "USD",
	AED: "AED",
};
const DOLLAR_COUNTRY: Record<string, string> = {
	US: "USD",
	CA: "CAD",
	AU: "AUD",
};

function normCurrency(
	v: string | number | null | undefined,
	seller: SellerContext,
): Normalised {
	const text = asText(v);
	const upper = text.value.toUpperCase();
	if (isCurrencyCode(upper)) return { value: upper, doubtful: false };
	const fromSymbol =
		text.value === "$"
			? DOLLAR_COUNTRY[seller.country]
			: SYMBOL_CURRENCY[text.value];
	if (fromSymbol) return { value: fromSymbol, doubtful: false };
	return {
		value: seller.currency,
		doubtful: true,
		reason: text.value
			? `"${text.value}" isn't a currency code; assumed ${seller.currency}`
			: `No currency printed; assumed ${seller.currency}`,
	};
}

/** A printed negative (credit notes print "(50.00)") as the positive the draft stores. */
function unsigned(n: Normalised): Normalised {
	return n.value.startsWith("-")
		? {
				value: n.value.slice(1),
				doubtful: true,
				reason: "Printed as negative; stored as a positive amount",
			}
		: n;
}

// ── Model field names → form paths ───────────────────────────────────

const HEADER_ALIASES: Record<string, string> = {
	title: "type",
	documentType: "type",
	documentNumber: "printed.number",
	number: "printed.number",
	subtotal: "printed.subtotal",
	taxTotal: "printed.tax",
	tax: "printed.tax",
	total: "printed.total",
	date: "date",
	dueDate: "dueDate",
	currency: "currency",
	placeOfSupply: "placeOfSupply",
	notes: "notes",
	terms: "terms",
	"buyer.addressLines": "buyer.address",
	taxRates: "lines",
};
const LINE_ALIASES: Record<string, LineField> = {
	amount: "printedAmount",
	taxRates: "taxCode",
	taxRate: "taxCode",
	taxable: "taxCode",
	discountPercent: "discount",
};

/** "buyer.name", "lines[1].unitPrice", "total" → a form path, or null if unknown. */
function canonicalPath(path: string, lineCount: number): string | null {
	const p = path.trim().replace(/\[(\d+)\]/g, ".$1");
	if (HEADER_ALIASES[p]) return HEADER_ALIASES[p];
	const buyer = p.match(/^buyer\.(\w+)$/);
	if (buyer && (BUYER_FIELDS as readonly string[]).includes(buyer[1])) {
		return p;
	}
	if (p.startsWith("printed.")) {
		const f = p.slice("printed.".length);
		return (PRINTED_FIELDS as readonly string[]).includes(f) ? p : null;
	}
	const line = p.match(/^lines\.(\d+)\.(\w+)$/);
	if (line && Number(line[1]) < lineCount) {
		const field = LINE_ALIASES[line[2]] ?? line[2];
		return (LINE_FIELDS as readonly string[]).includes(field)
			? linePath(Number(line[1]), field as LineField)
			: null;
	}
	return null;
}

// ── Building the form ────────────────────────────────────────────────

function rateStrings(values: (string | number)[]): {
	rates: string[];
	doubtful: boolean;
} {
	let doubtful = false;
	const rates = values.map((v) => {
		if (typeof v === "number") doubtful = true;
		const s = String(v);
		return normalizeAmount(s) ?? s;
	});
	return { rates, doubtful };
}

/** Turn the model's JSON into a form plus everything a person must check. */
export function buildDocExtraction(
	raw: RawDocExtraction,
	seller: SellerContext,
): DocExtraction {
	const uncertain = new Set<string>();
	const reasons: Record<string, string> = {};
	const take = (path: string, n: Normalised) => {
		if (n.doubtful) uncertain.add(path);
		if (n.reason) reasons[path] ??= n.reason;
		return n.value;
	};
	const order = seller.country === "US" ? "MDY" : "DMY";

	const kind = classifyDocumentType(raw);
	if (kind.doubtful) uncertain.add("type");
	if (kind.reason) reasons.type = kind.reason;
	const credit = kind.type === "credit_note";
	const money = (v: string | number | null | undefined) =>
		credit ? unsigned(normAmount(v)) : normAmount(v);

	// Buyer.
	const b = raw.buyer;
	const country = take(
		buyerPath("country"),
		normCountry(b.country, seller.country),
	);
	let region = asText(b.region);
	const taxId = asText(b.taxId);
	// India: a GSTIN starts with the buyer's 2-digit state code.
	if (
		country === "IN" &&
		region.value === "" &&
		/^\d{2}[A-Z0-9]{13}$/.test(taxId.value)
	) {
		region = {
			value: taxId.value.slice(0, 2),
			doubtful: false,
			reason: "State code taken from the GSTIN",
		};
	}
	if (country === "IN" && region.value && !/^\d{2}$/.test(region.value)) {
		region = {
			...region,
			doubtful: true,
			reason: "Use the 2-digit GST state code",
		};
	}
	const buyerName = asText(b.name);
	const buyer: DocImportForm["buyer"] = {
		name: take(
			buyerPath("name"),
			buyerName.value
				? buyerName
				: { value: "", doubtful: true, reason: "No customer name found" },
		),
		address: b.addressLines
			.map((l) => l.trim())
			.filter(Boolean)
			.join("\n"),
		city: take(buyerPath("city"), asText(b.city)),
		region: take(buyerPath("region"), region),
		postalCode: take(buyerPath("postalCode"), asText(b.postalCode)),
		country,
		taxId: take(buyerPath("taxId"), taxId),
		email: take(buyerPath("email"), asText(b.email)),
	};

	// Tax printed anywhere on the document → lines without a rate need a look.
	const taxTotal = money(raw.taxTotal);
	const taxPrinted =
		/^\d+(\.\d+)?$/.test(taxTotal.value) && !dec(taxTotal.value).eq("0");
	const docRates = rateStrings(raw.taxRates);

	const lines: DocImportLine[] = raw.lines.map((line, i) => {
		const path = (f: LineField) => linePath(i, f);
		for (const field of line.uncertain) {
			const p = canonicalPath(`lines.${i}.${field}`, raw.lines.length);
			if (p) uncertain.add(p);
		}

		const quantity = money(line.quantity);
		const unitPrice = money(line.unitPrice);
		const amount = money(line.amount);
		// A lump-sum line ("Delivery ... 45.00"): one of it at the printed amount.
		let qty = quantity;
		let price = unitPrice;
		if (qty.value === "" && price.value === "" && amount.value !== "") {
			qty = {
				value: "1",
				doubtful: true,
				reason: "No quantity printed; assumed 1 at the line amount",
			};
			price = { ...amount, doubtful: true };
		} else if (qty.value === "" && price.value !== "") {
			qty = {
				value: "1",
				doubtful: true,
				reason: "No quantity printed; assumed 1",
			};
		}

		// A printed discount percent becomes an amount: code calculates, exactly.
		let discount = money(line.discount);
		const pct = normAmount(line.discountPercent);
		if (discount.value === "" && pct.value !== "") {
			discount =
				/^\d+(\.\d+)?$/.test(pct.value) &&
				/^\d+(\.\d+)?$/.test(qty.value) &&
				/^\d+(\.\d+)?$/.test(price.value)
					? {
							value: dec(qty.value)
								.times(dec(price.value))
								.times(dec(pct.value))
								.div(dec("100"))
								.toFixed(),
							doubtful: false,
							reason: `${pct.value}% printed, converted to an amount`,
						}
					: {
							value: "",
							doubtful: true,
							reason: `${pct.value}% printed but the line can't be priced yet`,
						};
		}

		const own = rateStrings(line.taxRates);
		const useDoc = own.rates.length === 0 && line.taxable !== false;
		const rates = useDoc ? docRates.rates : own.rates;
		const mapped = mapTaxRate({
			country: seller.country,
			region: buyer.region,
			rates,
			taxable: line.taxable,
			taxPrinted,
		});
		const taxDoubt =
			mapped.doubtful ||
			(useDoc ? docRates.doubtful || docRates.rates.length > 1 : own.doubtful);
		if (taxDoubt) uncertain.add(path("taxCode"));
		if (mapped.reason) reasons[path("taxCode")] = mapped.reason;
		else if (useDoc && rates.length > 0) {
			reasons[path("taxCode")] =
				`${showRates(rates)} printed for the whole document`;
		}

		const hsn = asText(line.hsnSac);
		return {
			description: take(
				path("description"),
				asText(line.description).value
					? asText(line.description)
					: { value: "", doubtful: true },
			),
			quantity: take(path("quantity"), qty),
			unit: take(path("unit"), asText(line.unit)),
			unitPrice: take(path("unitPrice"), price),
			discount: take(path("discount"), discount),
			taxCode: mapped.taxCode,
			rate: mapped.rate ?? "",
			hsnSac: take(path("hsnSac"), hsn),
			printedRate: rates.length ? showRates(rates) : "",
			printedAmount: take(path("printedAmount"), amount),
		};
	});

	const date = normalizeDocDate(asText(raw.date).value, order);
	const form: DocImportForm = {
		type: kind.type,
		date: take(
			"date",
			date.value
				? date
				: { value: "", doubtful: true, reason: "No date found" },
		),
		dueDate: take(
			"dueDate",
			normalizeDocDate(asText(raw.dueDate).value, order),
		),
		currency: take("currency", normCurrency(raw.currency, seller)),
		placeOfSupply: take("placeOfSupply", asText(raw.placeOfSupply)),
		clientId: "",
		buyer,
		notes: raw.notes?.trim() ?? "",
		terms: raw.terms?.trim() ?? "",
		printed: {
			number: take(printedPath("number"), asText(raw.documentNumber)),
			subtotal: take(printedPath("subtotal"), money(raw.subtotal)),
			tax: take(printedPath("tax"), taxTotal),
			total: take(printedPath("total"), money(raw.total)),
		},
		lines,
	};

	for (const p of raw.uncertain) {
		const path = canonicalPath(p, lines.length);
		if (path) uncertain.add(path);
	}

	const issues = validateForm(form, seller);
	for (const path of Object.keys(issues)) uncertain.add(path);

	let mismatches: Record<string, string> = {};
	const totals = formTotals(form, seller);
	if (totals.ok) {
		mismatches = checkTotals(form, totals.result).mismatches;
		for (const path of Object.keys(mismatches)) uncertain.add(path);
	}

	return {
		form,
		uncertain: [...uncertain],
		reasons,
		issues,
		mismatches,
		legibility: raw.legibility?.trim() || null,
	};
}

export type ParsedDocReply =
	| { ok: true; extraction: DocExtraction }
	| { ok: false; error: string };

/** Model reply text → extraction, or a reason it can't be used. */
export function parseDocReply(
	text: string,
	seller: SellerContext,
): ParsedDocReply {
	let json: unknown;
	try {
		json = parseModelJson(text);
	} catch (e) {
		return {
			ok: false,
			error: e instanceof Error ? e.message : "Unreadable model reply",
		};
	}
	const raw = RawDocExtraction.safeParse(json);
	if (!raw.success) {
		return {
			ok: false,
			error: `Model reply did not match the expected shape: ${raw.error.issues
				.slice(0, 3)
				.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`)
				.join("; ")}`,
		};
	}
	if (raw.data.lines.length === 0 && !raw.data.total) {
		return {
			ok: false,
			error: "No lines or totals were found. Is this a business document?",
		};
	}
	return { ok: true, extraction: buildDocExtraction(raw.data, seller) };
}
