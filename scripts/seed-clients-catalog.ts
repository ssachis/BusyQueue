/**
 * Load the Northfield sample clients and catalog items into D1.
 *
 *   bun scripts/seed-clients-catalog.ts --local
 *   bun scripts/seed-clients-catalog.ts --remote
 *
 * Idempotent: fixed ids with INSERT ... ON CONFLICT DO NOTHING, so rows the
 * user edited are left alone. The same samples can be loaded from the empty
 * Clients and Catalog pages.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
	DEMO_BUSINESS,
	DEMO_BUSINESS_ID,
} from "../src/lib/business/profile.ts";
import {
	SAMPLE_CATALOG_ITEMS,
	SAMPLE_CLIENTS,
} from "../src/lib/clients/samples.ts";
import { sqlValue } from "./seed.ts";

type Value = string | number | null | undefined;

function insertIgnore(table: string, row: Record<string, Value>): string {
	const cols = Object.keys(row);
	return `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols
		.map((c) => sqlValue(row[c]))
		.join(", ")}) ON CONFLICT DO NOTHING;`;
}

export function samplesSql(): string[] {
	const b = DEMO_BUSINESS;
	const statements = [
		insertIgnore("businesses", {
			id: DEMO_BUSINESS_ID,
			legal_name: b.legalName,
			address_line1: b.addressLine1,
			address_line2: b.addressLine2,
			city: b.city,
			region: b.region,
			postal_code: b.postalCode,
			country: b.country,
			currency: b.currency,
			tax_ids: JSON.stringify(b.taxIds),
			logo_url: b.logoUrl,
			accent_color: b.accentColor,
		}),
	];
	for (const c of SAMPLE_CLIENTS) {
		statements.push(
			insertIgnore("clients", {
				id: c.id,
				business_id: DEMO_BUSINESS_ID,
				name: c.name,
				address_lines: JSON.stringify(c.addressLines),
				city: c.city,
				region: c.region,
				postal_code: c.postalCode,
				country: c.country,
				tax_id: c.taxId,
				email: c.email,
				place_of_supply: c.placeOfSupply,
				currency: c.currency,
				notes: c.notes,
			}),
		);
	}
	for (const i of SAMPLE_CATALOG_ITEMS) {
		statements.push(
			insertIgnore("catalog_items", {
				id: i.id,
				business_id: DEMO_BUSINESS_ID,
				name: i.name,
				description: i.description,
				unit: i.unit,
				unit_price: i.unitPrice,
				currency: i.currency,
				tax_code: i.taxCode,
				rate: i.rate,
				hsn_sac: i.hsnSac,
				code: i.code,
			}),
		);
	}
	return statements;
}

if (import.meta.main) {
	const remote = process.argv.includes("--remote");
	const file = resolve(import.meta.dirname, "../.wrangler/seed-clients.sql");
	mkdirSync(resolve(file, ".."), { recursive: true });
	writeFileSync(file, `${samplesSql().join("\n")}\n`);
	console.log(
		`Seeding ${remote ? "REMOTE" : "local"} busyq: ${SAMPLE_CLIENTS.length} clients, ${SAMPLE_CATALOG_ITEMS.length} catalog items`,
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
