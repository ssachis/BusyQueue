/**
 * Invoicing-suite documents (Phase 2). One table for all six types.
 * Drafts are editable and unnumbered; issuing assigns the number, snapshots
 * seller/buyer/totals and locks the document (DB triggers enforce it).
 */
import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import {
	DOCUMENT_STATUSES,
	DOCUMENT_TYPES,
	type PartySnapshot,
} from "#/lib/documents/types.ts";
import type { TaxResult } from "#/lib/tax/index.ts";
import { businesses } from "./business.ts";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const inList = (values: readonly string[]) =>
	sql.raw(values.map((v) => `'${v}'`).join(", "));

export const documents = sqliteTable(
	"documents",
	{
		id: text("id").primaryKey(),
		businessId: text("business_id")
			.notNull()
			.references(() => businesses.id),
		type: text("type", { enum: DOCUMENT_TYPES }).notNull(),
		status: text("status", { enum: DOCUMENT_STATUSES })
			.notNull()
			.default("draft"),
		/** Null while a draft; assigned on issue (#16). */
		number: text("number"),
		series: text("series").notNull().default(""),
		fiscalYear: text("fiscal_year"),
		date: text("date").notNull(),
		dueDate: text("due_date"),
		currency: text("currency").notNull(),
		/** Saved client (#14), if any. No FK until the clients table exists. */
		clientId: text("client_id"),
		buyer: text("buyer", { mode: "json" }).$type<PartySnapshot>().notNull(),
		/** Seller as it printed, snapshotted on issue. */
		seller: text("seller", { mode: "json" }).$type<
			PartySnapshot & { taxIds?: { type: string; value: string }[] }
		>(),
		placeOfSupply: text("place_of_supply"),
		notes: text("notes"),
		terms: text("terms"),
		/** Frozen on issue from the tax engine; null for drafts. */
		subtotalMinor: integer("subtotal_minor"),
		taxMinor: integer("tax_minor"),
		totalMinor: integer("total_minor"),
		taxResult: text("tax_result", { mode: "json" }).$type<TaxResult>(),
		issuedAt: text("issued_at"),
		voidedAt: text("voided_at"),
		voidReason: text("void_reason"),
		createdAt: text("created_at").notNull().default(now),
		updatedAt: text("updated_at").notNull().default(now),
	},
	(t) => [
		index("documents_business_type").on(t.businessId, t.type, t.status),
		uniqueIndex("documents_number_unique").on(
			t.businessId,
			t.type,
			t.series,
			t.number,
		),
		check("documents_type", sql`${t.type} IN (${inList(DOCUMENT_TYPES)})`),
		check(
			"documents_status",
			sql`${t.status} IN (${inList(DOCUMENT_STATUSES)})`,
		),
		check(
			"documents_number_when_issued",
			sql`(${t.status} = 'draft') = (${t.number} IS NULL)`,
		),
	],
);

export const documentLines = sqliteTable(
	"document_lines",
	{
		documentId: text("document_id")
			.notNull()
			.references(() => documents.id, { onDelete: "cascade" }),
		lineNo: integer("line_no").notNull(),
		description: text("description").notNull(),
		quantity: text("quantity").notNull(),
		unit: text("unit"),
		unitPrice: text("unit_price").notNull(),
		discount: text("discount"),
		taxCode: text("tax_code").notNull(),
		rate: text("rate"),
		hsnSac: text("hsn_sac"),
		catalogItemId: text("catalog_item_id"),
	},
	(t) => [primaryKey({ columns: [t.documentId, t.lineNo] })],
);
