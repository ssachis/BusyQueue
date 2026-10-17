/**
 * Server-only catalog data access (D1). Kept apart from the server functions
 * in catalog.ts so the client bundle never imports the D1 client.
 */
import {
	and,
	asc,
	eq,
	isNotNull,
	isNull,
	ne,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { getDb } from "#/db/index.ts";
import { catalogItems } from "#/db/schema/catalog.ts";
import {
	type ArchiveFilter,
	type CatalogItemInput,
	type CatalogItemRecord,
	catalogTaxCodes,
	containsPattern,
	type FieldErrors,
	parseCatalogItem,
	SAMPLE_CATALOG_ITEMS,
	TYPEAHEAD_LIMIT,
} from "#/lib/clients/index.ts";
import type { TaxCodeOption } from "#/lib/tax/index.ts";
import { currentBusinessId, loadBusiness } from "./business-store.ts";

type ItemRow = typeof catalogItems.$inferSelect;

export interface CatalogListRow extends CatalogItemRecord {
	/** Document lines that came from this item; > 0 means archive-only. */
	useCount: number;
}

function toRecord(row: ItemRow): CatalogItemRecord {
	const { businessId: _b, ...rest } = row;
	return rest;
}

// Written out in full: drizzle drops table qualifiers inside the subquery.
const useCount = sql<number>`(SELECT count(*) FROM "document_lines" WHERE "document_lines"."catalog_item_id" = "catalog_items"."id")`;

/** The delete-guard trigger's message (D1 wraps it in the error's cause). */
const isArchiveOnly = (err: unknown) =>
	`${err} ${(err as { cause?: unknown } | null)?.cause}`.includes(
		"can only be archived",
	);

const likeLower = (col: SQL | typeof catalogItems.name, pattern: string) =>
	sql`lower(${col}) LIKE ${pattern} ESCAPE '\\'`;

function matches(pattern: string) {
	return or(
		likeLower(catalogItems.name, pattern),
		likeLower(sql`coalesce(${catalogItems.code}, '')`, pattern),
	);
}

function archivedWhere(filter: ArchiveFilter) {
	if (filter === "active") return isNull(catalogItems.archivedAt);
	if (filter === "archived") return isNotNull(catalogItems.archivedAt);
	return undefined;
}

const scoped = (id: string) =>
	and(
		eq(catalogItems.id, id),
		eq(catalogItems.businessId, currentBusinessId()),
	);

export async function listCatalogItems(opts: {
	query: string;
	archived: ArchiveFilter;
}): Promise<CatalogListRow[]> {
	const pattern = containsPattern(opts.query);
	const rows = await getDb()
		.select({ i: catalogItems, useCount })
		.from(catalogItems)
		.where(
			and(
				eq(catalogItems.businessId, currentBusinessId()),
				archivedWhere(opts.archived),
				pattern ? matches(pattern) : undefined,
			),
		)
		.orderBy(asc(sql`lower(${catalogItems.name})`));
	return rows.map(({ i, useCount }) => ({
		...toRecord(i),
		useCount: Number(useCount),
	}));
}

/**
 * Type-ahead: active items by name or code, exact code and name-prefix hits
 * first. With `currency`, only items priced in that currency.
 */
export async function searchCatalogItems(
	query: string,
	currency?: string,
): Promise<CatalogItemRecord[]> {
	const pattern = containsPattern(query);
	const prefix = pattern ? pattern.slice(1) : null;
	const exact = prefix ? prefix.slice(0, -1) : null;
	const rows = await getDb()
		.select()
		.from(catalogItems)
		.where(
			and(
				eq(catalogItems.businessId, currentBusinessId()),
				isNull(catalogItems.archivedAt),
				currency ? eq(catalogItems.currency, currency) : undefined,
				pattern ? matches(pattern) : undefined,
			),
		)
		.orderBy(
			...(prefix && exact
				? [
						sql`CASE
							WHEN ${likeLower(sql`coalesce(${catalogItems.code}, '')`, exact)} THEN 0
							WHEN ${likeLower(catalogItems.name, prefix)} THEN 1
							ELSE 2 END`,
					]
				: []),
			asc(sql`lower(${catalogItems.name})`),
		)
		.limit(TYPEAHEAD_LIMIT);
	return rows.map(toRecord);
}

export async function loadCatalogItem(
	id: string,
): Promise<CatalogListRow | null> {
	const [row] = await getDb()
		.select({ i: catalogItems, useCount })
		.from(catalogItems)
		.where(scoped(id));
	return row ? { ...toRecord(row.i), useCount: Number(row.useCount) } : null;
}

export interface CatalogFormContext {
	item: CatalogListRow | null;
	businessCountry: string;
	businessCurrency: string;
	taxCodes: TaxCodeOption[];
}

/** An item (or null for a new one) plus what its form needs. */
export async function loadCatalogForm(
	id: string | null,
): Promise<CatalogFormContext> {
	const business = await loadBusiness();
	const item = id ? await loadCatalogItem(id) : null;
	if (id && !item) throw new Error("Item not found");
	return {
		item,
		businessCountry: business.country,
		businessCurrency: business.currency,
		taxCodes: catalogTaxCodes(business.country),
	};
}

export type SaveItemResult =
	| { ok: true; item: CatalogItemRecord }
	| { ok: false; errors: FieldErrors };

async function codeTaken(code: string, exceptId: string | null) {
	const [row] = await getDb()
		.select({ id: catalogItems.id, name: catalogItems.name })
		.from(catalogItems)
		.where(
			and(
				eq(catalogItems.businessId, currentBusinessId()),
				eq(catalogItems.code, code),
				exceptId ? ne(catalogItems.id, exceptId) : undefined,
			),
		);
	return row ?? null;
}

/** Validate against the business's tax country, then create or update. */
export async function saveCatalogItem(
	id: string | null,
	input: unknown,
): Promise<SaveItemResult> {
	const business = await loadBusiness();
	const parsed = parseCatalogItem(input, business.country);
	if (!parsed.ok) return parsed;
	const item: CatalogItemInput = parsed.item;
	if (item.code) {
		const other = await codeTaken(item.code, id);
		if (other) {
			return {
				ok: false,
				errors: { code: `"${other.name}" already uses this code` },
			};
		}
	}
	const db = getDb();
	const [row] = id
		? await db
				.update(catalogItems)
				.set({ ...item, updatedAt: new Date().toISOString() })
				.where(scoped(id))
				.returning()
		: await db
				.insert(catalogItems)
				.values({
					id: `itm-${crypto.randomUUID()}`,
					businessId: business.id,
					...item,
				})
				.returning();
	if (!row) throw new Error(id ? "Item not found" : "Could not save the item");
	return { ok: true, item: toRecord(row) };
}

export async function setCatalogItemArchived(
	id: string,
	archived: boolean,
): Promise<CatalogItemRecord> {
	const now = new Date().toISOString();
	const [row] = await getDb()
		.update(catalogItems)
		.set({ archivedAt: archived ? now : null, updatedAt: now })
		.where(scoped(id))
		.returning();
	if (!row) throw new Error("Item not found");
	return toRecord(row);
}

export type DeleteItemResult =
	| { deleted: true }
	| { deleted: false; reason: string };

/** Delete an item no document line uses; otherwise it must be archived. */
export async function deleteCatalogItem(id: string): Promise<DeleteItemResult> {
	const item = await loadCatalogItem(id);
	if (!item) throw new Error("Item not found");
	const refused: DeleteItemResult = {
		deleted: false,
		reason: `${item.name} is used on documents, so it can only be archived.`,
	};
	if (item.useCount > 0) return refused;
	try {
		await getDb().delete(catalogItems).where(scoped(id));
	} catch (err) {
		if (isArchiveOnly(err)) return refused;
		throw err;
	}
	return { deleted: true };
}

/**
 * Insert the Northfield sample items that aren't there yet. Samples whose
 * tax code doesn't fit the business country (they are US items) are skipped.
 */
export async function ensureSampleCatalog(): Promise<number> {
	const business = await loadBusiness();
	const valid = SAMPLE_CATALOG_ITEMS.filter(
		(i) => parseCatalogItem(i, business.country).ok,
	);
	if (valid.length === 0) return 0;
	const rows = await getDb()
		.insert(catalogItems)
		.values(valid.map((i) => ({ ...i, businessId: business.id })))
		.onConflictDoNothing()
		.returning({ id: catalogItems.id });
	return rows.length;
}
