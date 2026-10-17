/** Per-document activity log, written by every feature that changes a document. */
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { ActivityKind } from "#/lib/documents/types.ts";
import { documents } from "./documents.ts";

export const documentActivity = sqliteTable(
	"document_activity",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		documentId: text("document_id")
			.notNull()
			.references(() => documents.id, { onDelete: "cascade" }),
		kind: text("kind").$type<ActivityKind>().notNull(),
		actor: text("actor").notNull(),
		/** Small JSON payload, e.g. { number: "INV-0001" } or { amountMinor }. */
		detail: text("detail", { mode: "json" }).$type<Record<string, unknown>>(),
		at: text("at")
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
	},
	(t) => [index("document_activity_document").on(t.documentId, t.at)],
);
