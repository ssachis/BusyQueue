/** Clients server functions (callable from the client). */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ClientInput } from "#/lib/clients/client.ts";
import {
	createClient,
	getClient,
	listClients,
	removeClient,
	searchClients,
	setClientArchived,
	updateClient,
} from "./clients-store.ts";

const Id = z.string().min(1).max(100);

export const getClients = createServerFn({ method: "GET" })
	.validator((input: unknown) =>
		z.object({ includeArchived: z.boolean().optional() }).parse(input ?? {}),
	)
	.handler(({ data }) => listClients(data));

export const getClientById = createServerFn({ method: "GET" })
	.validator((input: unknown) => z.object({ id: Id }).parse(input))
	.handler(({ data }) => getClient(data.id));

/** Type-ahead for the document editor. */
export const findClients = createServerFn({ method: "GET" })
	.validator((input: unknown) =>
		z.object({ query: z.string().max(100) }).parse(input),
	)
	.handler(({ data }) => searchClients(data.query));

export const createClientRecord = createServerFn({ method: "POST" })
	.validator((input: unknown) => ClientInput.parse(input))
	.handler(({ data }) => createClient(data));

export const updateClientRecord = createServerFn({ method: "POST" })
	.validator((input: unknown) =>
		z.object({ id: Id, client: ClientInput }).parse(input),
	)
	.handler(({ data }) => updateClient(data.id, data.client));

export const archiveClient = createServerFn({ method: "POST" })
	.validator((input: unknown) =>
		z.object({ id: Id, archived: z.boolean() }).parse(input),
	)
	.handler(({ data }) => setClientArchived(data.id, data.archived));

/** Deletes a client with no documents; archives one with history. */
export const removeClientRecord = createServerFn({ method: "POST" })
	.validator((input: unknown) => z.object({ id: Id }).parse(input))
	.handler(({ data }) => removeClient(data.id));
