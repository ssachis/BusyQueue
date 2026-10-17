/**
 * Shared contract for the invoicing suite (Phase 2): the editor, issuing,
 * payments, conversions and print all build against these. Change them in a
 * small PR of their own.
 *
 * Money follows the project rule: quantities, unit prices and discounts are
 * decimal strings as entered; totals are integer minor units from the tax
 * engine; nothing is ever a JS float.
 */
import { z } from "zod";
import { DECIMAL_PATTERN, isCurrencyCode } from "#/lib/money/index.ts";
import { DOCUMENT_TYPES, type DocumentType } from "#/lib/tax/index.ts";

export { DOCUMENT_TYPES, type DocumentType };

/** Stored lifecycle. Payment state is derived from payments, never stored. */
export const DOCUMENT_STATUSES = ["draft", "issued", "void"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/** What the UI shows: stored lifecycle plus payment state (derived by payments). */
export type DisplayStatus =
	| "draft"
	| "issued"
	| "partially_paid"
	| "paid"
	| "overdue"
	| "void";

const Decimal = z.string().regex(DECIMAL_PATTERN, "Use a number like 12.50");
const NonNegativeDecimal = Decimal.refine(
	(v) => !v.startsWith("-"),
	"Can't be negative",
);
const IsoDate = z.iso.date();
const text = (max: number) => z.string().trim().max(max);

/** A party (buyer or seller) as printed on a document. Snapshotted on issue. */
export const PartySnapshot = z.object({
	name: text(200).min(1, "Name is required"),
	addressLines: z.array(text(200)).max(4).default([]),
	city: text(100).optional(),
	/** State / province / emirate code; drives IN place of supply and CA rates. */
	region: text(20).optional(),
	postalCode: text(20).optional(),
	/** ISO 3166-1 alpha-2. */
	country: z.string().regex(/^[A-Z]{2}$/, "Use a 2-letter country code"),
	taxId: text(40).optional(),
	email: z.email().optional(),
});
export type PartySnapshot = z.infer<typeof PartySnapshot>;

export const DraftLine = z.object({
	lineNo: z.number().int().positive(),
	description: text(500).min(1, "Description is required"),
	quantity: NonNegativeDecimal,
	unit: text(20).optional(),
	unitPrice: NonNegativeDecimal,
	/** Amount off the line (not a percent). */
	discount: NonNegativeDecimal.optional(),
	/** A code from `taxCodes(sellerCountry, region)`. */
	taxCode: text(40).min(1),
	/** US sales-tax percent, only with taxCode "US-SALES". */
	rate: NonNegativeDecimal.optional(),
	hsnSac: text(20).optional(),
	/** Catalog item it came from (#14), if any. */
	catalogItemId: z.string().optional(),
});
export type DraftLine = z.infer<typeof DraftLine>;

/** Everything the editor saves for a draft. */
export const DocumentDraft = z.object({
	type: z.enum(DOCUMENT_TYPES),
	/** Document date. Issuing keeps it; the number is assigned on issue. */
	date: IsoDate,
	dueDate: IsoDate.optional(),
	currency: z.string().refine(isCurrencyCode, "Use an ISO 4217 code like USD"),
	/** Saved client (#14), if picked; the buyer snapshot is what prints. */
	clientId: z.string().optional(),
	buyer: PartySnapshot,
	/** IN only: GST state code; defaults to the buyer's region. */
	placeOfSupply: text(20).optional(),
	notes: text(2000).optional(),
	terms: text(2000).optional(),
	lines: z.array(DraftLine).max(200),
});
export type DocumentDraft = z.infer<typeof DocumentDraft>;

/** Kinds written to the per-document activity log. */
export const ACTIVITY_KINDS = [
	"created",
	"edited",
	"issued",
	"payment_recorded",
	"payment_voided",
	"marked_paid",
	"voided",
	"converted",
	"duplicated",
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
