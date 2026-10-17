/**
 * Saved clients (Phase 2, #14): who documents are issued to. Scoped by
 * business. A client that any document references is archived, never deleted
 * (a DB trigger in the migration enforces it; `documents.client_id` has no FK).
 */
import { sql } from "drizzle-orm";
import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { businesses } from "./business.ts";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const clients = sqliteTable(
	"clients",
	{
		id: text("id").primaryKey(),
		businessId: text("business_id")
			.notNull()
			.references(() => businesses.id),
		name: text("name").notNull(),
		/** Up to 4 printed address lines. */
		addressLines: text("address_lines", { mode: "json" })
			.$type<string[]>()
			.notNull()
			.default(sql`'[]'`),
		city: text("city"),
		/** State / province / emirate code. */
		region: text("region"),
		postalCode: text("postal_code"),
		/** ISO 3166-1 alpha-2. */
		country: text("country").notNull(),
		taxId: text("tax_id"),
		email: text("email"),
		/** IN only: default GST place of supply (2-digit state code). */
		placeOfSupply: text("place_of_supply"),
		/** Default document currency (ISO 4217) for this client. */
		currency: text("currency"),
		notes: text("notes"),
		/** Set when archived: hidden from pickers, kept for history. */
		archivedAt: text("archived_at"),
		createdAt: text("created_at").notNull().default(now),
		updatedAt: text("updated_at").notNull().default(now),
	},
	(t) => [index("clients_business_name").on(t.businessId, t.name)],
);
