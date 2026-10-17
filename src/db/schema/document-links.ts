/**
 * Links between documents (#18): a quote converted to an invoice, an invoice
 * duplicated as a new draft, a credit note crediting an invoice. One row per
 * pair, read from both ends ("Converted from QUO-0003" / "Converted to
 * INV-0012"). Written in the same D1 batch as the new draft.
 */
import { sql } from "drizzle-orm";
import {
	check,
	index,
	primaryKey,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";
import { LINK_KINDS } from "#/lib/documents/conversions.ts";
import { documents } from "./documents.ts";

export const documentLinks = sqliteTable(
	"document_links",
	{
		/** The source: the quote, the invoice credited, the document duplicated. */
		fromDocumentId: text("from_document_id")
			.notNull()
			.references(() => documents.id, { onDelete: "cascade" }),
		/** The new document made from it. */
		toDocumentId: text("to_document_id")
			.notNull()
			.references(() => documents.id, { onDelete: "cascade" }),
		kind: text("kind", { enum: LINK_KINDS }).notNull(),
		createdAt: text("created_at")
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
	},
	(t) => [
		primaryKey({ columns: [t.fromDocumentId, t.toDocumentId] }),
		index("document_links_to").on(t.toDocumentId),
		check(
			"document_links_kind",
			sql.raw(`kind IN (${LINK_KINDS.map((k) => `'${k}'`).join(", ")})`),
		),
		check(
			"document_links_not_self",
			sql`${t.fromDocumentId} <> ${t.toDocumentId}`,
		),
	],
);
