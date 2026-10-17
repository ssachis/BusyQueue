/**
 * AI import of vendor invoices from a photo or PDF.
 *
 * One row per upload. The file itself lives in R2 (`r2Key`); the row tracks
 * what the model read, which fields need a person's check, and the invoice
 * that was saved from it. `extracted` holds the draft exactly as read (after
 * formatting clean-up only), so a later edit can be compared with the scan.
 */
import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";
import type { ImportDraft } from "#/lib/import/extraction.ts";
import { invoices } from "./busyq.ts";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const IMPORT_STATUSES = [
	"uploaded",
	"extracted",
	"failed",
	"saved",
] as const;

export const invoiceImports = sqliteTable(
	"invoice_imports",
	{
		id: text("id").primaryKey(),
		r2Key: text("r2_key").notNull(),
		filename: text("filename").notNull(),
		contentType: text("content_type").notNull(),
		sizeBytes: integer("size_bytes").notNull(),
		status: text("status", { enum: IMPORT_STATUSES })
			.notNull()
			.default("uploaded"),
		/** Model asked for first, and the one Nicrron says answered (differs on fallback). */
		requestedModel: text("requested_model"),
		model: text("model"),
		extracted: text("extracted", { mode: "json" }).$type<ImportDraft>(),
		uncertain: text("uncertain", { mode: "json" })
			.$type<string[]>()
			.notNull()
			.default(sql`'[]'`),
		error: text("error"),
		invoiceId: text("invoice_id").references(() => invoices.id),
		prismTraceId: text("prism_trace_id"),
		createdAt: text("created_at").notNull().default(now),
		updatedAt: text("updated_at").notNull().default(now),
	},
	(t) => [
		index("invoice_imports_created").on(t.createdAt),
		check(
			"invoice_imports_status",
			sql`${t.status} IN (${sql.raw(IMPORT_STATUSES.map((s) => `'${s}'`).join(", "))})`,
		),
	],
);
