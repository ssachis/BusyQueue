/** Catalog items: reusable document lines (price, unit, tax rate, code). */
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
		/** Optional SKU, unique per business. */
		code: text("code"),
		name: text("name").notNull(),
		/** Decimal string as entered; never a float. */
		unitPrice: text("unit_price").notNull(),
		unit: text("unit"),
		taxCode: text("tax_code").notNull(),
		/** US sales-tax percent, only with taxCode "US-SALES". */
		rate: text("rate"),
		hsnSac: text("hsn_sac"),
		archivedAt: text("archived_at"),
		createdAt: text("created_at").notNull().default(now),
		updatedAt: text("updated_at").notNull().default(now),
	},
	(t) => [
		index("catalog_items_business_name").on(t.businessId, t.name),
		uniqueIndex("catalog_items_code_unique").on(t.businessId, t.code),
	],
);
