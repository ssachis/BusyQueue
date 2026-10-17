/**
 * Number counters for issuing (#16): one row per business, type, series and
 * fiscal year. Issuing increments with UPDATE … RETURNING inside the same D1
 * batch that writes the number, so concurrent issues can't collide.
 */
import {
	integer,
	primaryKey,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";
import { businesses } from "./business.ts";

export const documentCounters = sqliteTable(
	"document_counters",
	{
		businessId: text("business_id")
			.notNull()
			.references(() => businesses.id),
		type: text("type").notNull(),
		series: text("series").notNull().default(""),
		/** "" when the country doesn't number by fiscal year. */
		fiscalYear: text("fiscal_year").notNull().default(""),
		nextNumber: integer("next_number").notNull().default(1),
	},
	(t) => [
		primaryKey({
			columns: [t.businessId, t.type, t.series, t.fiscalYear],
		}),
	],
);
