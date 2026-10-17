/**
 * Payments against issued documents (#17). Amounts are integer minor units
 * in the document's currency. Payments are voided, never deleted.
 */
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { documents } from "./documents.ts";

export const documentPayments = sqliteTable(
	"document_payments",
	{
		id: text("id").primaryKey(),
		documentId: text("document_id")
			.notNull()
			.references(() => documents.id),
		amountMinor: integer("amount_minor").notNull(),
		currency: text("currency").notNull(),
		receivedOn: text("received_on").notNull(),
		method: text("method"),
		reference: text("reference"),
		note: text("note"),
		voidedAt: text("voided_at"),
		createdAt: text("created_at")
			.notNull()
			.default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
	},
	(t) => [index("document_payments_document").on(t.documentId)],
);
