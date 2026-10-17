/**
 * AI import of the business's own paper documents (#20): the editable form
 * the review screen holds between "the model read it" and "Create draft".
 *
 * Every field is a string so the form can hold anything a person types;
 * `formToDraft` turns it into a `DocumentDraft` (the editor's contract) and
 * `validateForm` says which fields can't be saved yet. Printed amounts
 * (`printed.*`, `lines.N.printedAmount`, `lines.N.printedRate`) are kept only
 * to compare with what the tax engine computes; they are never saved as
 * amounts.
 *
 * Pure: safe to import from the client.
 */
import { z } from "zod";
import { pathsWithoutLine } from "#/lib/import/extraction.ts";
import type { TaxCountry } from "#/lib/tax/index.ts";

export const DocImportLine = z.object({
	description: z.string().max(500),
	quantity: z.string().max(40),
	unit: z.string().max(40),
	unitPrice: z.string().max(40),
	/** Amount off the line (not a percent; a printed percent is converted by code). */
	discount: z.string().max(40),
	/** A code from `taxCodes(seller.country, region)`; "" until one fits. */
	taxCode: z.string().max(40),
	/** US-SALES only: the sales-tax percent. */
	rate: z.string().max(20),
	hsnSac: z.string().max(20),
	/** Tax percent(s) as printed, e.g. "8.25" or "9 + 9". Reference only. */
	printedRate: z.string().max(40),
	/** Line amount as printed. Reference only. */
	printedAmount: z.string().max(40),
});
export type DocImportLine = z.infer<typeof DocImportLine>;

export const DocImportBuyer = z.object({
	name: z.string().max(200),
	/** One address line per text line. */
	address: z.string().max(1000),
	city: z.string().max(100),
	region: z.string().max(40),
	postalCode: z.string().max(20),
	country: z.string().max(60),
	taxId: z.string().max(40),
	email: z.string().max(200),
});
export type DocImportBuyer = z.infer<typeof DocImportBuyer>;

export const DocImportForm = z.object({
	type: z.string().max(40),
	date: z.string().max(40),
	dueDate: z.string().max(40),
	currency: z.string().max(10),
	/** IN only: GST state code of the place of supply. Empty = buyer's region. */
	placeOfSupply: z.string().max(20),
	/** Saved client the buyer matched, if any. */
	clientId: z.string().max(100),
	buyer: DocImportBuyer,
	notes: z.string().max(2000),
	terms: z.string().max(2000),
	/** As printed, for comparison. The draft gets its own number on issue. */
	printed: z.object({
		number: z.string().max(60),
		subtotal: z.string().max(40),
		tax: z.string().max(40),
		total: z.string().max(40),
	}),
	lines: z.array(DocImportLine).max(200),
});
export type DocImportForm = z.infer<typeof DocImportForm>;

/** The business that issued the document: decides tax codes, date order and defaults. */
export interface SellerContext {
	name: string;
	country: TaxCountry;
	region?: string;
	taxId?: string;
	/** Default when the document prints no currency. */
	currency: string;
}

export const BUYER_FIELDS = [
	"name",
	"address",
	"city",
	"region",
	"postalCode",
	"country",
	"taxId",
	"email",
] as const satisfies readonly (keyof DocImportBuyer)[];
export type BuyerField = (typeof BUYER_FIELDS)[number];

export const LINE_FIELDS = [
	"description",
	"quantity",
	"unit",
	"unitPrice",
	"discount",
	"taxCode",
	"rate",
	"hsnSac",
	"printedRate",
	"printedAmount",
] as const satisfies readonly (keyof DocImportLine)[];
export type LineField = (typeof LINE_FIELDS)[number];

export const PRINTED_FIELDS = ["number", "subtotal", "tax", "total"] as const;
export type PrintedField = (typeof PRINTED_FIELDS)[number];

/** Form paths, matching zod issue paths joined with ".". */
export const linePath = (index: number, field: LineField) =>
	`lines.${index}.${field}`;
export const buyerPath = (field: BuyerField) => `buyer.${field}`;
export const printedPath = (field: PrintedField) => `printed.${field}`;

export const EMPTY_LINE: DocImportLine = {
	description: "",
	quantity: "",
	unit: "",
	unitPrice: "",
	discount: "",
	taxCode: "",
	rate: "",
	hsnSac: "",
	printedRate: "",
	printedAmount: "",
};

/** Field paths after line `index` is removed (same rule as the vendor import). */
export { pathsWithoutLine };

/** Every editable path of a form, in display order (for diffs and counts). */
export function formPaths(form: DocImportForm): string[] {
	return [
		"type",
		"date",
		"dueDate",
		"currency",
		"placeOfSupply",
		...BUYER_FIELDS.map(buyerPath),
		"notes",
		"terms",
		...PRINTED_FIELDS.map(printedPath),
		...form.lines.flatMap((_, i) => LINE_FIELDS.map((f) => linePath(i, f))),
	];
}

/** The value at a form path ("buyer.name", "lines.2.unitPrice"). */
export function valueAt(form: DocImportForm, path: string): string | undefined {
	const parts = path.split(".");
	let node: unknown = form;
	for (const part of parts) {
		if (node === null || typeof node !== "object") return undefined;
		node = (node as Record<string, unknown>)[part];
	}
	return typeof node === "string" ? node : undefined;
}

/**
 * Fields a person changed between what the model read and what was saved
 * ("lines" when lines were added or removed). Traced, so PRISM shows how
 * often each field needed correcting.
 */
export function correctedPaths(
	read: DocImportForm,
	saved: DocImportForm,
): string[] {
	const changed: string[] = [];
	if (read.lines.length !== saved.lines.length) changed.push("lines");
	const n = Math.min(read.lines.length, saved.lines.length);
	const shared: DocImportForm = { ...saved, lines: saved.lines.slice(0, n) };
	for (const path of formPaths(shared)) {
		if (
			(valueAt(read, path) ?? "").trim() !== (valueAt(saved, path) ?? "").trim()
		) {
			changed.push(path);
		}
	}
	return changed;
}
