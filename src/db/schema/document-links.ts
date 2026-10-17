/**
 * Links between related documents (#18), stored both ways: converting quote Q
 * into invoice I writes (Q, I, converted_to) and (I, Q, converted_from), so
 * each document can list its relatives with one indexed lookup.
 */
import { sql } from "drizzle-orm";
import { index, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { LINK_RELATIONS } from "#/lib/documents/conversion.ts";
import { documents } from "./documents.ts";

export const documentLinks = sqliteTable(
	"document_links",
	{
		documentId: text("document_id")
			.notNull()
			.references(() => documents.id),
		relatedId: text("related_id")
			.notNull()
			.references(() => documents.id),
		relation: text("relation", { enum: LINK_RELATIONS }).notNull(),
		createdAt: text("created_at")
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
	},
	(t) => [
		primaryKey({ columns: [t.documentId, t.relatedId, t.relation] }),
		index("document_links_related").on(t.relatedId),
	],
);
