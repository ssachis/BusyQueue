/** Catalog server functions (callable from the client). */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ListQuery, SearchQuery } from "#/lib/clients/index.ts";
import { isCurrencyCode } from "#/lib/money/index.ts";
import {
	deleteCatalogItem,
	ensureSampleCatalog,
	listCatalogItems,
	loadCatalogForm,
	saveCatalogItem,
	searchCatalogItems,
	setCatalogItemArchived,
} from "./catalog-store.ts";

const Id = z.object({ id: z.string().min(1).max(100) });

export const getCatalogItems = createServerFn({ method: "GET" })
	.validator((input: unknown) => ListQuery.parse(input ?? {}))
	.handler(({ data }) => listCatalogItems(data));

/**
 * Type-ahead for the editor's line items: active items by name or code,
 * max 10. Pass `currency` to only get items priced in the document currency.
 */
export const findCatalogItems = createServerFn({ method: "GET" })
	.validator((input: unknown) =>
		SearchQuery.extend({
			currency: z.string().refine(isCurrencyCode).optional(),
		}).parse(input ?? {}),
	)
	.handler(({ data }) => searchCatalogItems(data.query, data.currency));

/** An item (or null for "new") with the tax codes for the business country. */
export const getCatalogForm = createServerFn({ method: "GET" })
	.validator((input: unknown) =>
		z.object({ id: z.string().min(1).max(100).nullable() }).parse(input),
	)
	.handler(({ data }) => loadCatalogForm(data.id));

/** Returns field errors (tax code, rate, HSN/SAC, duplicate code) instead of throwing. */
export const saveItem = createServerFn({ method: "POST" })
	.validator((input: unknown) =>
		z
			.object({
				id: z.string().min(1).max(100).nullable(),
				item: z.record(z.string(), z.unknown()),
			})
			.parse(input),
	)
	.handler(({ data }) => saveCatalogItem(data.id, data.item));

export const archiveItem = createServerFn({ method: "POST" })
	.validator((input: unknown) =>
		Id.extend({ archived: z.boolean() }).parse(input),
	)
	.handler(({ data }) => setCatalogItemArchived(data.id, data.archived));

export const removeItem = createServerFn({ method: "POST" })
	.validator((input: unknown) => Id.parse(input))
	.handler(({ data }) => deleteCatalogItem(data.id));

export const addSampleCatalog = createServerFn({ method: "POST" }).handler(
	async () => ({ added: await ensureSampleCatalog() }),
);
