/**
 * Items catalog (Phase 2, #14): things the business sells, with a default
 * price, unit and tax code. Picking one fills a document line; the line keeps
 * its own copy, so later catalog edits never change existing documents.
 * Unit prices are decimal strings as entered, like the rest of the schema.
 */
import { sql } from "drizzle-orm";
import { index, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { businesses } from "./business.ts";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const catalogItems = sqliteTable(
	"catalog_items",
	{
		id: text("id").primaryKey(),
		businessId: text("business_id")
			.notNull()
			.references(() => businesses.id),
		name: text("name").notNull(),
		description: text("description"),
		unit: text("unit"),
		/** Decimal string, tax-exclusive, >= 0. */
		unitPrice: text("unit_price").notNull(),
		currency: text("currency").notNull(),
		/** A code from `taxCodes(businessCountry)`. */
		taxCode: text("tax_code").notNull(),
		/** US sales-tax percent, only with tax code "US-SALES". */
		rate: text("rate"),
		/** IN: HSN (goods) / SAC (services) code. */
		hsnSac: text("hsn_sac"),
		/** Code / SKU, unique per business when set. */
		code: text("code"),
		archivedAt: text("archived_at"),
		createdAt: text("created_at").notNull().default(now),
		updatedAt: text("updated_at").notNull().default(now),
	},
	(t) => [
		index("catalog_items_business_name").on(t.businessId, t.name),
		uniqueIndex("catalog_items_business_code").on(t.businessId, t.code),
	],
);
