/** Client server functions (callable from the client). */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { ClientInput, ListQuery, SearchQuery } from "#/lib/clients/index.ts";
import { loadBusiness } from "./business-store.ts";
import {
	createClient,
	deleteClient,
	ensureSampleClients,
	listClients,
	loadClient,
	searchClients,
	setClientArchived,
	updateClient,
} from "./clients-store.ts";

const Id = z.object({ id: z.string().min(1).max(100) });

export const getClients = createServerFn({ method: "GET" })
	.validator((input: unknown) => ListQuery.parse(input ?? {}))
	.handler(({ data }) => listClients(data));

/** Type-ahead for the editor's client picker: active clients only, max 10. */
export const findClients = createServerFn({ method: "GET" })
	.validator((input: unknown) => SearchQuery.parse(input ?? {}))
	.handler(({ data }) => searchClients(data.query));

/** One client by id (archived ones too, so a draft can still show its client). */
export const getClient = createServerFn({ method: "GET" })
	.validator((input: unknown) => Id.parse(input))
	.handler(({ data }) => loadClient(data.id));

/** A client (or null for "new") plus the business defaults its form needs. */
export const getClientForm = createServerFn({ method: "GET" })
	.validator((input: unknown) =>
		z.object({ id: z.string().min(1).max(100).nullable() }).parse(input),
	)
	.handler(async ({ data }) => {
		const business = await loadBusiness();
		const client = data.id ? await loadClient(data.id) : null;
		if (data.id && !client) throw new Error("Client not found");
		return {
			client,
			businessCountry: business.country,
			businessCurrency: business.currency,
		};
	});

export const saveClient = createServerFn({ method: "POST" })
	.validator((input: unknown) =>
		z
			.object({
				id: z.string().min(1).max(100).nullable(),
				client: ClientInput,
			})
			.parse(input),
	)
	.handler(({ data }) =>
		data.id ? updateClient(data.id, data.client) : createClient(data.client),
	);

export const archiveClient = createServerFn({ method: "POST" })
	.validator((input: unknown) =>
		Id.extend({ archived: z.boolean() }).parse(input),
	)
	.handler(({ data }) => setClientArchived(data.id, data.archived));

/** Refused (not thrown) when the client has documents; archive it instead. */
export const removeClient = createServerFn({ method: "POST" })
	.validator((input: unknown) => Id.parse(input))
	.handler(({ data }) => deleteClient(data.id));

export const addSampleClients = createServerFn({ method: "POST" }).handler(
	async () => ({ added: await ensureSampleClients() }),
);
