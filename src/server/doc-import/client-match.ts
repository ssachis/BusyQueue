/**
 * Match the document's buyer to a saved client (#14). The clients table may
 * not exist yet, and this feature must not depend on #14's code, so the
 * lookup checks for the table first and returns null on any mismatch with
 * the expected columns (`id`, `business_id`, `name`). Only an unambiguous,
 * case-insensitive name match counts. Server-only.
 */
import { sql } from "drizzle-orm";
import type { Db } from "#/db/index.ts";
import type { ClientMatch } from "#/lib/doc-import/api.ts";

export async function matchClient(
	db: Db,
	businessId: string,
	buyerName: string,
): Promise<ClientMatch | null> {
	const name = buyerName.trim();
	if (!name) return null;
	try {
		const tables = await db.all<{ name: string }>(
			sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'clients'`,
		);
		if (tables.length === 0) return null;
		const rows = await db.all<{ id: string; name: string }>(
			sql`SELECT id, name FROM clients WHERE business_id = ${businessId} AND lower(trim(name)) = lower(${name}) LIMIT 2`,
		);
		return rows.length === 1 ? { id: rows[0].id, name: rows[0].name } : null;
	} catch {
		return null;
	}
}
