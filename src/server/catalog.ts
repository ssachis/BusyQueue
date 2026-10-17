/** Catalog server functions (callable from the client). */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { CatalogItemInput } from "#/lib/catalog/item.ts";
import {
	createItem,
	getItem,
	listItems,
	searchItems,
	setItemArchived,
	updateItem,
} from "./catalog-store.ts";

const Id = z.string().min(1).max(100);

export const getCatalogItems = createServerFn({ method: "GET" })
	.validator((input: unknown) =>
		z.object({ includeArchived: z.boolean().optional() }).parse(input ?? {}),
	)
	.handler(({ data }) => listItems(data));

export const getCatalogItem = createServerFn({ method: "GET" })
	.validator((input: unknown) => z.object({ id: Id }).parse(input))
	.handler(({ data }) => getItem(data.id));

/** Type-ahead by name or code for document lines. */
export const findCatalogItems = createServerFn({ method: "GET" })
	.validator((input: unknown) =>
		z.object({ query: z.string().max(100) }).parse(input),
	)
	.handler(({ data }) => searchItems(data.query));

export const createCatalogItem = createServerFn({ method: "POST" })
	.validator((input: unknown) => CatalogItemInput.parse(input))
	.handler(({ data }) => createItem(data));

export const updateCatalogItem = createServerFn({ method: "POST" })
	.validator((input: unknown) =>
		z.object({ id: Id, item: CatalogItemInput }).parse(input),
	)
	.handler(({ data }) => updateItem(data.id, data.item));

export const archiveCatalogItem = createServerFn({ method: "POST" })
	.validator((input: unknown) =>
		z.object({ id: Id, archived: z.boolean() }).parse(input),
	)
	.handler(({ data }) => setItemArchived(data.id, data.archived));
