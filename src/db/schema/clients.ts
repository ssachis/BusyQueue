/** Saved clients. Archived, never deleted, once any document points at them. */
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
		addressLine1: text("address_line1"),
		addressLine2: text("address_line2"),
		city: text("city"),
		region: text("region"),
		postalCode: text("postal_code"),
		/** ISO 3166-1 alpha-2. */
		country: text("country").notNull(),
		taxId: text("tax_id"),
		email: text("email"),
		/** IN only: GST state code. */
		placeOfSupply: text("place_of_supply"),
		/** Set when archived; null while active. */
		archivedAt: text("archived_at"),
		createdAt: text("created_at").notNull().default(now),
		updatedAt: text("updated_at").notNull().default(now),
	},
	(t) => [index("clients_business_name").on(t.businessId, t.name)],
);
