/**
 * Contracts and tenders whose agreed prices feed the BusyQ price list.
 *
 * A contract starts as a `draft` holding the model's checked extraction.
 * Confirming it writes its prices to `price_list` and a snapshot of exactly
 * what was applied to `contract_prices`, in one batch. Prices are decimal
 * strings as printed, like the rest of the schema.
 */
import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";
import type { ContractPrice, ExtractionFlag } from "#/lib/contracts/types.ts";
import { vendors } from "./busyq.ts";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const CONTRACT_STATUSES = ["draft", "confirmed"] as const;
export const CONTRACT_CHANGES = ["new", "changed", "unchanged"] as const;

const inList = (values: readonly string[]) =>
	sql.raw(values.map((v) => `'${v}'`).join(", "));

export const contracts = sqliteTable(
	"contracts",
	{
		id: text("id").primaryKey(),
		/** Set on confirm (the matched or newly created vendor). */
		vendorId: text("vendor_id").references(() => vendors.id),
		/** Counterparty as printed on the contract. */
		vendorName: text("vendor_name"),
		title: text("title"),
		startDate: text("start_date"),
		endDate: text("end_date"),
		noticeDays: integer("notice_days"),
		autoRenew: integer("auto_renew", { mode: "boolean" }),
		currency: text("currency").notNull(),
		/** Uploaded file name, if any. */
		sourceName: text("source_name"),
		/** The contract text the model read (prices are checked against it). */
		sourceText: text("source_text").notNull(),
		/** The model's reply exactly as returned, for audit. */
		rawExtraction: text("raw_extraction"),
		/** Checked price rows from the extraction (before confirm). */
		prices: text("prices", { mode: "json" }).$type<ContractPrice[]>().notNull(),
		flags: text("flags", { mode: "json" })
			.$type<ExtractionFlag[]>()
			.notNull()
			.default(sql`'[]'`),
		status: text("status", { enum: CONTRACT_STATUSES })
			.notNull()
			.default("draft"),
		model: text("model"),
		prismTraceId: text("prism_trace_id"),
		confirmedBy: text("confirmed_by"),
		confirmedAt: text("confirmed_at"),
		createdAt: text("created_at").notNull().default(now),
		updatedAt: text("updated_at").notNull().default(now),
	},
	(t) => [
		index("contracts_vendor").on(t.vendorId),
		check(
			"contracts_status",
			sql`${t.status} IN (${inList(CONTRACT_STATUSES)})`,
		),
	],
);

/**
 * What a confirmed contract wrote to the price list, line by line, with the
 * price it replaced. The primary key also stops a contract being applied twice.
 */
export const contractPrices = sqliteTable(
	"contract_prices",
	{
		contractId: text("contract_id")
			.notNull()
			.references(() => contracts.id),
		lineNo: integer("line_no").notNull(),
		vendorId: text("vendor_id")
			.notNull()
			.references(() => vendors.id),
		item: text("item").notNull(),
		unit: text("unit").notNull(),
		unitPrice: text("unit_price").notNull(),
		previousUnitPrice: text("previous_unit_price"),
		currency: text("currency").notNull(),
		packUnit: text("pack_unit"),
		packSize: text("pack_size"),
		change: text("change", { enum: CONTRACT_CHANGES }).notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.contractId, t.lineNo] }),
		check(
			"contract_prices_change",
			sql`${t.change} IN (${inList(CONTRACT_CHANGES)})`,
		),
	],
);
