/**
 * Conversions and duplicates (#18). Pure: no I/O, no clock (the caller passes
 * `today`). Decides which conversions are allowed and exactly what a new
 * draft copies from its source; the server only writes the result.
 *
 * Allowed conversions (the source must be issued: not a draft, not void):
 * - quote    → invoice, proforma
 * - proforma → invoice
 * - invoice  → receipt, credit_note, delivery_note
 * Duplicate works from any status (draft, issued or void) and keeps the type.
 *
 * What the new draft gets:
 * - Always a draft: no number, no seller snapshot, no frozen totals (issuing
 *   recomputes them from the copied lines).
 * - Copied as-is: buyer snapshot, client id, currency, place of supply, every
 *   line field (renumbered 1..n in the source's order).
 * - date = today.
 * - Series: a conversion starts in the target type's default series ("");
 *   a duplicate keeps the source's series.
 * - Notes: kept. A conversion prepends one reference line naming the source,
 *   e.g. "Credit note against invoice INV-0012 dated 2026-10-01." so the
 *   printed document cites what it credits / settles / delivers.
 * - Terms: kept when the target is billed (invoice, proforma) and on a
 *   duplicate; dropped for receipts, credit notes and delivery notes, where
 *   payment terms don't apply.
 * - Due date: the source's payment-term length (due date − date, in days) is
 *   kept and applied to today for a duplicate and for proforma → invoice. A
 *   quote's due date is a validity date, not payment terms, so quote →
 *   invoice/proforma leaves it blank, as do receipts, credit notes and
 *   delivery notes (they aren't bills).
 */
import type { DocumentStatus, DocumentType, DraftLine } from "./types.ts";

/** How two documents are related (document_links.kind). */
export const LINK_KINDS = ["converted", "duplicated", "credits"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/** Allowed conversion targets per source type. */
export const CONVERSIONS: Readonly<
	Record<DocumentType, readonly DocumentType[]>
> = {
	quote: ["invoice", "proforma"],
	proforma: ["invoice"],
	invoice: ["receipt", "credit_note", "delivery_note"],
	credit_note: [],
	receipt: [],
	delivery_note: [],
};

/** Lower-case names for prose ("Converted from quote QUO-0003"). */
export const DOCUMENT_TYPE_NAMES: Readonly<Record<DocumentType, string>> = {
	invoice: "invoice",
	quote: "quote",
	proforma: "pro forma invoice",
	credit_note: "credit note",
	receipt: "receipt",
	delivery_note: "delivery note",
};

/** Notes column limit, same as the editor's `DocumentDraft.notes`. */
export const NOTES_MAX = 2000;

export class ConversionError extends Error {
	readonly code: "not_allowed" | "not_issued" | "invalid_input";
	constructor(code: ConversionError["code"], message: string) {
		super(message);
		this.name = "ConversionError";
		this.code = code;
	}
}

/** Targets a document can be converted to right now (none unless issued). */
export function conversionTargets(
	type: DocumentType,
	status: DocumentStatus,
): readonly DocumentType[] {
	return status === "issued" ? CONVERSIONS[type] : [];
}

export function canConvert(
	type: DocumentType,
	status: DocumentStatus,
	to: DocumentType,
): boolean {
	return conversionTargets(type, status).includes(to);
}

/** The link written for a conversion: a credit note `credits` its invoice. */
export function conversionLinkKind(
	from: DocumentType,
	to: DocumentType,
): LinkKind {
	return from === "invoice" && to === "credit_note" ? "credits" : "converted";
}

/** What a new draft is built from. Mirrors a documents row plus its lines. */
export interface SourceDocument {
	type: DocumentType;
	status: DocumentStatus;
	number: string | null;
	series: string;
	date: string;
	dueDate: string | null;
	currency: string;
	clientId: string | null;
	buyer: unknown;
	placeOfSupply: string | null;
	notes: string | null;
	terms: string | null;
	lines: readonly DraftLine[];
}

/** The new draft's columns (status is always draft, number null). */
export interface NewDraft<Buyer = unknown> {
	type: DocumentType;
	series: string;
	date: string;
	dueDate: string | null;
	currency: string;
	clientId: string | null;
	buyer: Buyer;
	placeOfSupply: string | null;
	notes: string | null;
	terms: string | null;
	lines: DraftLine[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseDay(iso: string): number {
	const ms = ISO_DATE.test(iso) ? Date.parse(`${iso}T00:00:00Z`) : Number.NaN;
	if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== iso) {
		throw new ConversionError("invalid_input", `Not an ISO date: "${iso}"`);
	}
	return ms;
}

/** Whole days from `from` to `to` (ISO dates, calendar arithmetic in UTC). */
export function daysBetween(from: string, to: string): number {
	return Math.round((parseDay(to) - parseDay(from)) / DAY_MS);
}

export function addDays(iso: string, days: number): string {
	return new Date(parseDay(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The source's payment-term length applied to `today`, or null when the
 * source has no due date. A due date before the document date counts as 0.
 */
export function shiftedDueDate(
	source: Pick<SourceDocument, "date" | "dueDate">,
	today: string,
): string | null {
	parseDay(today);
	if (!source.dueDate) return null;
	const term = Math.max(0, daysBetween(source.date, source.dueDate));
	return addDays(today, term);
}

/** Copy lines in order, numbered 1..n, every field kept. */
export function copyLines(lines: readonly DraftLine[]): DraftLine[] {
	return [...lines]
		.sort((a, b) => a.lineNo - b.lineNo)
		.map((line, i) => ({ ...line, lineNo: i + 1 }));
}

/** The line a converted document's notes start with, naming its source. */
export function referenceNote(
	source: Pick<SourceDocument, "type" | "number" | "date">,
	to: DocumentType,
): string {
	const from =
		`${DOCUMENT_TYPE_NAMES[source.type]} ${source.number ?? ""}`.trim();
	switch (to) {
		case "credit_note":
			return `Credit note against ${from} dated ${source.date}.`;
		case "receipt":
			return `Receipt for ${from} dated ${source.date}.`;
		case "delivery_note":
			return `Delivery note for ${from}.`;
		case "invoice":
			return source.type === "proforma"
				? `Final invoice for ${from}.`
				: `As per ${from}.`;
		case "proforma":
			return `As per ${from}.`;
		default:
			return `Converted from ${from}.`;
	}
}

/** Prepend a line to notes, keeping the result within NOTES_MAX. */
function withReference(reference: string, notes: string | null): string {
	const rest = notes?.trim();
	return (rest ? `${reference}\n\n${rest}` : reference).slice(0, NOTES_MAX);
}

const BILLED: readonly DocumentType[] = ["invoice", "proforma"];

/** Throw a ConversionError unless `source` may be converted to `to`. */
export function assertConvertible(
	source: Pick<SourceDocument, "type" | "status" | "number">,
	to: DocumentType,
): void {
	if (!CONVERSIONS[source.type].includes(to)) {
		const allowed = CONVERSIONS[source.type].map((t) => DOCUMENT_TYPE_NAMES[t]);
		throw new ConversionError(
			"not_allowed",
			allowed.length
				? `A ${DOCUMENT_TYPE_NAMES[source.type]} can only be converted to: ${allowed.join(", ")}`
				: `A ${DOCUMENT_TYPE_NAMES[source.type]} can't be converted. Duplicate it instead.`,
		);
	}
	if (source.status !== "issued" || !source.number) {
		throw new ConversionError(
			"not_issued",
			source.status === "void"
				? "This document is void and can't be converted. Duplicate it instead."
				: "Issue the document before converting it",
		);
	}
}

/** The new draft for converting `source` to `to`. Throws ConversionError. */
export function planConversion<S extends SourceDocument>(
	source: S,
	to: DocumentType,
	today: string,
): NewDraft<S["buyer"]> {
	assertConvertible(source, to);
	parseDay(today);
	const keepsTerm = source.type === "proforma" && to === "invoice";
	return {
		type: to,
		series: "",
		date: today,
		dueDate: keepsTerm ? shiftedDueDate(source, today) : null,
		currency: source.currency,
		clientId: source.clientId,
		buyer: source.buyer,
		placeOfSupply: source.placeOfSupply,
		notes: withReference(referenceNote(source, to), source.notes),
		terms: BILLED.includes(to) ? source.terms : null,
		lines: copyLines(source.lines),
	};
}

/** The new draft for duplicating `source` (any status). Same type and series. */
export function planDuplicate<S extends SourceDocument>(
	source: S,
	today: string,
): NewDraft<S["buyer"]> {
	parseDay(today);
	return {
		type: source.type,
		series: source.series,
		date: today,
		dueDate: shiftedDueDate(source, today),
		currency: source.currency,
		clientId: source.clientId,
		buyer: source.buyer,
		placeOfSupply: source.placeOfSupply,
		notes: source.notes,
		terms: source.terms,
		lines: copyLines(source.lines),
	};
}
