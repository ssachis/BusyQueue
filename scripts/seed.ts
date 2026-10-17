/**
 * Load data/ into D1.
 *
 *   bun run db:seed:local     # local D1 (wrangler dev state)
 *   bun run db:seed:remote    # the deployed busyq database
 *
 * Idempotent upserts of reference data only (vendors, price list, invoices,
 * lines, payments). Agent runs, findings, drafts and approvals are never
 * touched, so re-seeding can't break the append-only audit trail.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Dataset } from "../src/lib/busyq/dataset.ts";
import { loadDataset } from "./lib/dataset.ts";

type Value = string | number | null | undefined;

/** SQLite literal. Strings are single-quoted with '' escaping; numbers must be integers. */
export function sqlValue(v: Value): string {
	if (v === null || v === undefined) return "NULL";
	if (typeof v === "number") {
		if (!Number.isSafeInteger(v)) throw new TypeError(`Not an integer: ${v}`);
		return String(v);
	}
	return `'${v.replaceAll("'", "''")}'`;
}

function upsert(
	table: string,
	row: Record<string, Value>,
	conflict: string[],
): string {
	const cols = Object.keys(row);
	const updates = cols
		.filter((c) => !conflict.includes(c))
		.map((c) => `${c} = excluded.${c}`);
	return `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols
		.map((c) => sqlValue(row[c]))
		.join(", ")}) ON CONFLICT (${conflict.join(", ")}) DO ${
		updates.length ? `UPDATE SET ${updates.join(", ")}` : "NOTHING"
	};`;
}

export const vendorId = (name: string) =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");

export function seedSql(data: Dataset): string[] {
	const vendorNames = [...new Set(data.priceList.map((p) => p.vendor))].sort();
	const statements: string[] = [];

	for (const name of vendorNames) {
		statements.push(upsert("vendors", { id: vendorId(name), name }, ["id"]));
	}
	for (const p of data.priceList) {
		statements.push(
			upsert(
				"price_list",
				{
					vendor_id: vendorId(p.vendor),
					item: p.item,
					unit: p.unit,
					unit_price: p.unitPrice,
					currency: p.currency,
					pack_unit: p.packUnit,
					pack_size: p.packSize,
				},
				["vendor_id", "item", "unit"],
			),
		);
	}
	for (const inv of data.invoices) {
		statements.push(
			upsert(
				"invoices",
				{
					id: inv.id,
					vendor_name: inv.vendor,
					invoice_number: inv.invoiceNumber,
					issue_date: inv.issueDate,
					due_date: inv.dueDate,
					currency: inv.currency,
					stated_total: inv.statedTotal,
				},
				["id"],
			),
		);
		// Lines have nothing pointing at them, so replace them wholesale.
		statements.push(
			`DELETE FROM invoice_lines WHERE invoice_id = ${sqlValue(inv.id)};`,
		);
		for (const l of inv.lines) {
			statements.push(
				`INSERT INTO invoice_lines (invoice_id, line_no, item, quantity, unit, unit_price, amount) VALUES (${[
					inv.id,
					l.lineNo,
					l.item,
					l.quantity,
					l.unit,
					l.unitPrice,
					l.amount,
				]
					.map(sqlValue)
					.join(", ")});`,
			);
		}
	}
	for (const p of data.payments) {
		statements.push(
			upsert(
				"payments",
				{
					id: p.id,
					vendor_name: p.vendor,
					invoice_number: p.invoiceNumber,
					amount: p.amount,
					currency: p.currency,
					paid_on: p.paidOn,
					reference: p.reference,
				},
				["id"],
			),
		);
	}
	return statements;
}

if (import.meta.main) {
	const remote = process.argv.includes("--remote");
	const data = loadDataset();
	const file = resolve(import.meta.dirname, "../.wrangler/seed.sql");
	mkdirSync(resolve(file, ".."), { recursive: true });
	writeFileSync(file, `${seedSql(data).join("\n")}\n`);
	console.log(
		`Seeding ${remote ? "REMOTE" : "local"} busyq: ${data.priceList.length} prices, ${data.invoices.length} invoices, ${data.payments.length} payments`,
	);
	const result = spawnSync(
		"bunx",
		[
			"wrangler",
			"d1",
			"execute",
			"busyq",
			remote ? "--remote" : "--local",
			`--file=${file}`,
			"--yes",
		],
		{ stdio: "inherit" },
	);
	process.exit(result.status ?? 1);
}
