/** The business that issues documents (single row for now; see DEMO_BUSINESS_ID). */
import { sql } from "drizzle-orm";
import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { TaxId } from "#/lib/business/profile.ts";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const businesses = sqliteTable("businesses", {
	id: text("id").primaryKey(),
	legalName: text("legal_name").notNull(),
	addressLine1: text("address_line1"),
	addressLine2: text("address_line2"),
	city: text("city"),
	region: text("region"),
	postalCode: text("postal_code"),
	/** ISO 3166-1 alpha-2; drives the tax engine. */
	country: text("country").notNull(),
	currency: text("currency").notNull(),
	taxIds: text("tax_ids", { mode: "json" })
		.$type<TaxId[]>()
		.notNull()
		.default(sql`'[]'`),
	logoUrl: text("logo_url"),
	accentColor: text("accent_color"),
	createdAt: text("created_at").notNull().default(now),
	updatedAt: text("updated_at").notNull().default(now),
});
