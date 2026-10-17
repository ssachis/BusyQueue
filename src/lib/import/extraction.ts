/**
 * AI import of vendor invoices: everything after the model has answered.
 *
 * The model only transcribes. This module turns its JSON into an editable
 * draft, normalises printed values (currency symbols, thousands separators,
 * dates) without ever computing an amount, and flags fields a person must
 * check: ones the model said it was unsure of, ones it couldn't find, ones
 * that needed a guess to normalise, and ones that fail validation.
 *
 * Pure: no I/O, safe to import from the client (the review form re-runs
 * `validateDraft` on every edit).
 */
import { z } from "zod";
import { Invoice } from "#/lib/busyq/types.ts";
import { isCurrencyCode } from "#/lib/money/index.ts";

// ── Uploads ──────────────────────────────────────────────────────────

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const UPLOAD_TYPES = [...IMAGE_TYPES, "application/pdf"] as const;
export type UploadType = (typeof UPLOAD_TYPES)[number];

/** File-picker `accept` value. */
export const UPLOAD_ACCEPT = UPLOAD_TYPES.join(",");

/**
 * Content type from the file's first bytes. The browser-supplied type is
 * not trusted: a renamed file must not reach the model as something else.
 */
export function sniffContentType(bytes: Uint8Array): UploadType | null {
	const starts = (sig: number[], at = 0) =>
		bytes.length >= at + sig.length && sig.every((b, i) => bytes[at + i] === b);
	if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
		return "image/png";
	if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
	if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8))
		return "image/webp";
	if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf";
	return null;
}

// ── What the model returns ───────────────────────────────────────────

/** Strings are expected; numbers are tolerated but flagged (they went through a float). */
const RawValue = z.union([z.string(), z.number()]).nullish();
const FieldList = z
	.array(z.string())
	.nullish()
	.transform((v) => v ?? []);

export const RawLine = z.object({
	item: RawValue,
	quantity: RawValue,
	unit: RawValue,
	unitPrice: RawValue,
	amount: RawValue,
	uncertain: FieldList,
});

/** The JSON the extraction prompt asks for. Lenient: gaps become flags, not errors. */
export const RawExtraction = z.object({
	documentType: z.string().nullish(),
	vendor: RawValue,
	invoiceNumber: RawValue,
	issueDate: RawValue,
	dueDate: RawValue,
	currency: RawValue,
	statedTotal: RawValue,
	lines: z
		.array(RawLine)
		.nullish()
		.transform((v) => v ?? []),
	uncertain: FieldList,
	notes: z.string().nullish(),
});
export type RawExtraction = z.infer<typeof RawExtraction>;

// ── The editable draft ───────────────────────────────────────────────

export const DraftLine = z.object({
	item: z.string(),
	quantity: z.string(),
	unit: z.string(),
	unitPrice: z.string(),
	amount: z.string(),
});
export type DraftLine = z.infer<typeof DraftLine>;

/** Every field is a string so the form can hold anything the user types. Empty dueDate = none. */
export const ImportDraft = z.object({
	vendor: z.string(),
	invoiceNumber: z.string(),
	issueDate: z.string(),
	dueDate: z.string(),
	currency: z.string(),
	statedTotal: z.string(),
	lines: z.array(DraftLine).max(200),
});
export type ImportDraft = z.infer<typeof ImportDraft>;

export const HEADER_FIELDS = [
	"vendor",
	"invoiceNumber",
	"issueDate",
	"dueDate",
	"currency",
	"statedTotal",
] as const;
export type HeaderField = (typeof HEADER_FIELDS)[number];
export const LINE_FIELDS = [
	"item",
	"quantity",
	"unit",
	"unitPrice",
	"amount",
] as const;
export type LineField = (typeof LINE_FIELDS)[number];

/** Field paths match zod issue paths joined with ".", e.g. "lines.2.unitPrice". */
export const linePath = (index: number, field: LineField) =>
	`lines.${index}.${field}`;

export interface Extraction {
	draft: ImportDraft;
	/** Paths a person should check before saving. */
	uncertain: string[];
	/** Path → validation message, for fields that can't be saved as they are. */
	issues: Record<string, string>;
	notes: string | null;
}

// ── Normalisation (formatting only, never arithmetic) ────────────────

interface Normalised {
	value: string;
	/** True when the value had to be guessed or couldn't be parsed. */
	doubtful: boolean;
}

const asText = (v: string | number | null | undefined): Normalised => {
	if (v === null || v === undefined) return { value: "", doubtful: true };
	if (typeof v === "number") return { value: String(v), doubtful: true };
	return { value: v.trim(), doubtful: v.trim() === "" };
};

/**
 * A printed number as a plain decimal string: drops currency symbols and
 * codes, spaces and thousands separators; "(12.50)" and "12.50-" become
 * "-12.50"; "1.234,56" becomes "1234.56". Digits are never changed. Returns
 * null when the text isn't a number.
 */
export function normalizeDecimal(printed: string): string | null {
	// Only currency marks are dropped: any other letter means "not a number".
	let s = printed
		.trim()
		.replace(/^[A-Z]{3}(?=[\s\d$€£₹¥(.-])|(?<=[\d)\s])[A-Z]{3}$/g, "")
		.replace(/US\$|[$€£₹¥\s ]/g, "");
	let negative = false;
	if (/^\(.*\)$/.test(s)) {
		negative = true;
		s = s.slice(1, -1);
	}
	if (s.endsWith("-")) {
		negative = true;
		s = s.slice(0, -1);
	}
	if (s.startsWith("-")) {
		negative = !negative;
		s = s.slice(1);
	}
	if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s) || /^\d+,\d{1,2}$/.test(s)) {
		s = s.replace(/\./g, "").replace(",", ".");
	} else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
		s = s.replace(/,/g, "");
	}
	if (s.startsWith(".")) s = `0${s}`;
	if (!/^\d+(\.\d+)?$/.test(s)) return null;
	return negative && /[1-9]/.test(s) ? `-${s}` : s;
}

function normDecimal(v: string | number | null | undefined): Normalised {
	const text = asText(v);
	if (text.value === "") return text;
	const value = normalizeDecimal(text.value);
	return value === null
		? { value: text.value, doubtful: true }
		: { value, doubtful: text.doubtful };
}

const pad = (n: string) => n.padStart(2, "0");

/**
 * An ISO date. "08/07/2026" is read as US month/day (the first customers are
 * US school districts) and flagged, because it could be day/month.
 */
export function normalizeDate(printed: string): Normalised {
	const s = printed.trim();
	if (s === "") return { value: "", doubtful: true };
	if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
		return { value: s, doubtful: !z.iso.date().safeParse(s).success };
	}
	const us = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
	if (us) {
		const [, a, b, year] = us;
		const iso = `${year}-${pad(a)}-${pad(b)}`;
		const valid = z.iso.date().safeParse(iso).success;
		// Unambiguous only when the day can't be a month.
		const ambiguous = Number(a) <= 12 && Number(b) <= 12 && a !== b;
		return valid
			? { value: iso, doubtful: ambiguous }
			: { value: s, doubtful: true };
	}
	return { value: s, doubtful: true };
}

function normDate(v: string | number | null | undefined): Normalised {
	const text = asText(v);
	if (text.value === "") return text;
	const date = normalizeDate(text.value);
	return { value: date.value, doubtful: date.doubtful || text.doubtful };
}

const SYMBOL_CURRENCY: Record<string, string> = {
	$: "USD",
	US$: "USD",
	"€": "EUR",
	"£": "GBP",
	"₹": "INR",
};

function normCurrency(v: string | number | null | undefined): Normalised {
	const text = asText(v);
	const upper = text.value.toUpperCase();
	if (isCurrencyCode(upper)) return { value: upper, doubtful: text.doubtful };
	const fromSymbol = SYMBOL_CURRENCY[text.value];
	if (fromSymbol) return { value: fromSymbol, doubtful: true };
	// Nothing printed: assume the district's own currency, and say so.
	return { value: text.value || "USD", doubtful: true };
}

// ── Building and validating the draft ────────────────────────────────

/** Accepts "dueDate", "lines.1.unitPrice", "lines[1].unitPrice". */
function canonicalPath(path: string): string {
	return path.trim().replace(/\[(\d+)\]/g, ".$1");
}

const isKnownPath = (path: string, lineCount: number) => {
	if ((HEADER_FIELDS as readonly string[]).includes(path)) return true;
	const m = path.match(/^lines\.(\d+)\.(\w+)$/);
	return (
		!!m &&
		Number(m[1]) < lineCount &&
		(LINE_FIELDS as readonly string[]).includes(m[2])
	);
};

/** Turn the model's JSON into a draft plus the fields a person must check. */
export function buildExtraction(raw: RawExtraction): Extraction {
	const uncertain = new Set<string>();
	const take = (path: string, n: Normalised) => {
		if (n.doubtful) uncertain.add(path);
		return n.value;
	};

	const dueDate = asText(raw.dueDate);
	const draft: ImportDraft = {
		vendor: take("vendor", asText(raw.vendor)),
		invoiceNumber: take("invoiceNumber", asText(raw.invoiceNumber)),
		issueDate: take("issueDate", normDate(raw.issueDate)),
		// No due date printed is normal, so an empty one is not a doubt.
		dueDate: dueDate.value === "" ? "" : take("dueDate", normDate(raw.dueDate)),
		currency: take("currency", normCurrency(raw.currency)),
		statedTotal: take("statedTotal", normDecimal(raw.statedTotal)),
		lines: raw.lines.map((line, i) => {
			for (const field of line.uncertain) {
				const path = linePath(i, field as LineField);
				if (isKnownPath(path, raw.lines.length)) uncertain.add(path);
			}
			return {
				item: take(linePath(i, "item"), asText(line.item)),
				quantity: take(linePath(i, "quantity"), normDecimal(line.quantity)),
				unit: take(linePath(i, "unit"), asText(line.unit)),
				unitPrice: take(linePath(i, "unitPrice"), normDecimal(line.unitPrice)),
				amount: take(linePath(i, "amount"), normDecimal(line.amount)),
			};
		}),
	};
	for (const path of raw.uncertain.map(canonicalPath)) {
		if (isKnownPath(path, draft.lines.length)) uncertain.add(path);
	}

	const issues = validateDraft(draft);
	for (const path of Object.keys(issues)) uncertain.add(path);
	return {
		draft,
		uncertain: [...uncertain],
		issues,
		notes: raw.notes?.trim() || null,
	};
}

/** The draft as an `Invoice`, with line numbers assigned in order. */
export function draftToInvoice(draft: ImportDraft, id: string) {
	return Invoice.safeParse({
		id,
		vendor: draft.vendor.trim(),
		invoiceNumber: draft.invoiceNumber.trim(),
		issueDate: draft.issueDate.trim(),
		dueDate: draft.dueDate.trim() || undefined,
		currency: draft.currency.trim().toUpperCase(),
		statedTotal: draft.statedTotal.trim(),
		lines: draft.lines.map((l, i) => ({
			lineNo: i + 1,
			item: l.item.trim(),
			quantity: l.quantity.trim(),
			unit: l.unit.trim(),
			unitPrice: l.unitPrice.trim(),
			amount: l.amount.trim(),
		})),
	});
}

const FRIENDLY: Record<string, string> = {
	vendor: "Vendor is required",
	invoiceNumber: "Invoice number is required",
	issueDate: "Use a date like 2026-08-07",
	dueDate: "Use a date like 2026-09-06, or leave empty",
	currency: "Use a currency code like USD",
	statedTotal: "Use a plain number like 1982.00",
	lines: "Add at least one line",
	item: "Item is required",
	unit: "Unit is required",
	quantity: "Use a positive number like 20",
	unitPrice: "Use a plain number like 24.00",
	amount: "Use a plain number like 480.00",
};

/** Path → message for every field that can't be saved as it is. Empty when valid. */
export function validateDraft(draft: ImportDraft): Record<string, string> {
	const result = draftToInvoice(draft, "draft");
	if (result.success) return {};
	const issues: Record<string, string> = {};
	for (const issue of result.error.issues) {
		const path = issue.path.join(".");
		const last = String(issue.path.at(-1) ?? "");
		issues[path] ??= FRIENDLY[last] ?? issue.message;
	}
	return issues;
}

/**
 * Fields a person changed between what the model read and what was saved
 * ("lines" when lines were added or removed). Traced, so PRISM shows how
 * often each field needed correcting.
 */
export function correctedPaths(
	read: ImportDraft,
	saved: ImportDraft,
): string[] {
	const changed: string[] = HEADER_FIELDS.filter(
		(f) => read[f].trim() !== saved[f].trim(),
	);
	if (read.lines.length !== saved.lines.length) changed.push("lines");
	const n = Math.min(read.lines.length, saved.lines.length);
	for (let i = 0; i < n; i++) {
		for (const f of LINE_FIELDS) {
			if (read.lines[i][f].trim() !== saved.lines[i][f].trim()) {
				changed.push(linePath(i, f));
			}
		}
	}
	return changed;
}

/** Field paths after line `index` is removed: its own drop, later lines shift up. */
export function pathsWithoutLine(paths: Iterable<string>, index: number) {
	const out: string[] = [];
	for (const path of paths) {
		const m = path.match(/^lines\.(\d+)\.(\w+)$/);
		if (!m) out.push(path);
		else if (Number(m[1]) < index) out.push(path);
		else if (Number(m[1]) > index)
			out.push(`lines.${Number(m[1]) - 1}.${m[2]}`);
	}
	return out;
}

/** Strip code fences or prose around the model's JSON object. */
export function parseModelJson(text: string): unknown {
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	if (start === -1 || end <= start) {
		throw new Error("The model did not return a JSON object");
	}
	return JSON.parse(text.slice(start, end + 1));
}

export type ParsedReply =
	| { ok: true; extraction: Extraction }
	| { ok: false; error: string };

/** Model reply text → extraction, or a reason it can't be used. */
export function parseExtractionReply(text: string): ParsedReply {
	let json: unknown;
	try {
		json = parseModelJson(text);
	} catch (e) {
		return {
			ok: false,
			error: e instanceof Error ? e.message : "Unreadable model reply",
		};
	}
	const raw = RawExtraction.safeParse(json);
	if (!raw.success) {
		return {
			ok: false,
			error: `Model reply did not match the expected shape: ${raw.error.issues
				.slice(0, 3)
				.map((i) => `${i.path.join(".") || "(root)"} ${i.message}`)
				.join("; ")}`,
		};
	}
	if (raw.data.documentType && raw.data.documentType !== "invoice") {
		return {
			ok: false,
			error: `This doesn't look like an invoice (read as: ${raw.data.documentType}).`,
		};
	}
	return { ok: true, extraction: buildExtraction(raw.data) };
}
