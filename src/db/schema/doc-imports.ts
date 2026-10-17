/**
 * AI import of the business's own paper documents (#20): one row per upload.
 *
 * The file lives in R2 (`r2Key`). `extracted` is the form exactly as read
 * (after formatting clean-up and tax-code mapping), so the draft that was
 * created can be compared with the scan. `documentId` is the draft created
 * from it; creating twice returns the same draft.
 */
import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";
import type { DocImportForm } from "#/lib/doc-import/form.ts";
import { businesses } from "./business.ts";
import { documents } from "./documents.ts";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const DOC_IMPORT_STATUSES = [
	"uploaded",
	"extracted",
	"failed",
	"created",
] as const;

export const documentImports = sqliteTable(
	"document_imports",
	{
		id: text("id").primaryKey(),
		businessId: text("business_id")
			.notNull()
			.references(() => businesses.id),
		r2Key: text("r2_key").notNull(),
		filename: text("filename").notNull(),
		contentType: text("content_type").notNull(),
		sizeBytes: integer("size_bytes").notNull(),
		status: text("status", { enum: DOC_IMPORT_STATUSES })
			.notNull()
			.default("uploaded"),
		/** Model asked for first, and the one Nicrron says answered (differs on fallback). */
		requestedModel: text("requested_model"),
		model: text("model"),
		extracted: text("extracted", { mode: "json" }).$type<DocImportForm>(),
		uncertain: text("uncertain", { mode: "json" })
			.$type<string[]>()
			.notNull()
			.default(sql`'[]'`),
		error: text("error"),
		documentId: text("document_id").references(() => documents.id, {
			onDelete: "set null",
		}),
		prismTraceId: text("prism_trace_id"),
		createdAt: text("created_at").notNull().default(now),
		updatedAt: text("updated_at").notNull().default(now),
	},
	(t) => [
		index("document_imports_business_created").on(t.businessId, t.createdAt),
		check(
			"document_imports_status",
			sql`${t.status} IN (${sql.raw(DOC_IMPORT_STATUSES.map((s) => `'${s}'`).join(", "))})`,
		),
	],
);
