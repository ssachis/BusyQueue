/** Server-only catalog data access. Kept apart from catalog.ts so the client bundle never imports D1. */
import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "#/db/index.ts";
import { catalogItems } from "#/db/schema/catalog.ts";
import type { CatalogItemInput } from "#/lib/catalog/item.ts";
import { rankMatches } from "#/lib/typeahead.ts";
import { currentBusinessId } from "./business-store.ts";

export type CatalogRow = typeof catalogItems.$inferSelect;

export async function listItems(opts: {
	includeArchived?: boolean;
}): Promise<CatalogRow[]> {
	const businessId = currentBusinessId();
	return getDb()
		.select()
		.from(catalogItems)
		.where(
			opts.includeArchived
				? eq(catalogItems.businessId, businessId)
				: and(
						eq(catalogItems.businessId, businessId),
						isNull(catalogItems.archivedAt),
					),
		)
		.orderBy(asc(catalogItems.name));
}

export async function getItem(id: string): Promise<CatalogRow | null> {
	const [row] = await getDb()
		.select()
		.from(catalogItems)
		.where(
			and(
				eq(catalogItems.id, id),
				eq(catalogItems.businessId, currentBusinessId()),
			),
		);
	return row ?? null;
}

/** Active items matching the name or code, best match first. For line type-ahead. */
export async function searchItems(query: string, limit = 8) {
	const rows = await listItems({});
	return rankMatches(query, rows, [(i) => i.name, (i) => i.code], limit);
}

async function assertCodeFree(code: string | null, exceptId?: string) {
	if (!code) return;
	const rows = await listItems({ includeArchived: true });
	if (rows.some((r) => r.code === code && r.id !== exceptId)) {
		throw new Error(`Code ${code} is already used by another item`);
	}
}

export async function createItem(input: CatalogItemInput) {
	await assertCodeFree(input.code);
	const id = crypto.randomUUID();
	await getDb()
		.insert(catalogItems)
		.values({ id, businessId: currentBusinessId(), ...input });
	return id;
}

export async function updateItem(id: string, input: CatalogItemInput) {
	await assertCodeFree(input.code, id);
	await getDb()
		.update(catalogItems)
		.set({ ...input, updatedAt: new Date().toISOString() })
		.where(
			and(
				eq(catalogItems.id, id),
				eq(catalogItems.businessId, currentBusinessId()),
			),
		);
}

/**
 * Items are only archived: issued documents keep the catalog id on their
 * lines, so a catalog row is never deleted.
 */
export async function setItemArchived(id: string, archived: boolean) {
	const at = new Date().toISOString();
	await getDb()
		.update(catalogItems)
		.set({ archivedAt: archived ? at : null, updatedAt: at })
		.where(
			and(
				eq(catalogItems.id, id),
				eq(catalogItems.businessId, currentBusinessId()),
			),
		);
}
