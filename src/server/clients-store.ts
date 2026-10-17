/** Server-only clients data access. Kept apart from clients.ts so the client bundle never imports D1. */
import { and, asc, count, eq, isNull } from "drizzle-orm";
import { getDb } from "#/db/index.ts";
import { clients } from "#/db/schema/clients.ts";
import { documents } from "#/db/schema/documents.ts";
import { type ClientInput, removalOutcome } from "#/lib/clients/client.ts";
import { rankMatches } from "#/lib/typeahead.ts";
import { currentBusinessId } from "./business-store.ts";

export type ClientRow = typeof clients.$inferSelect & {
	documentCount: number;
};

async function documentCounts(): Promise<Map<string, number>> {
	const rows = await getDb()
		.select({ clientId: documents.clientId, n: count() })
		.from(documents)
		.where(eq(documents.businessId, currentBusinessId()))
		.groupBy(documents.clientId);
	return new Map(rows.flatMap((r) => (r.clientId ? [[r.clientId, r.n]] : [])));
}

export async function listClients(opts: {
	includeArchived?: boolean;
}): Promise<ClientRow[]> {
	const businessId = currentBusinessId();
	const rows = await getDb()
		.select()
		.from(clients)
		.where(
			opts.includeArchived
				? eq(clients.businessId, businessId)
				: and(eq(clients.businessId, businessId), isNull(clients.archivedAt)),
		)
		.orderBy(asc(clients.name));
	const counts = await documentCounts();
	return rows.map((r) => ({ ...r, documentCount: counts.get(r.id) ?? 0 }));
}

export async function getClient(id: string): Promise<ClientRow | null> {
	const [row] = await getDb()
		.select()
		.from(clients)
		.where(and(eq(clients.id, id), eq(clients.businessId, currentBusinessId())));
	if (!row) return null;
	const counts = await documentCounts();
	return { ...row, documentCount: counts.get(id) ?? 0 };
}

/** Active clients matching the text, best match first. For the editor's picker. */
export async function searchClients(query: string, limit = 8) {
	const rows = await listClients({});
	return rankMatches(
		query,
		rows,
		[(c) => c.name, (c) => c.taxId, (c) => c.email, (c) => c.city],
		limit,
	);
}

export async function createClient(input: ClientInput) {
	const id = crypto.randomUUID();
	await getDb()
		.insert(clients)
		.values({ id, businessId: currentBusinessId(), ...input });
	return id;
}

export async function updateClient(id: string, input: ClientInput) {
	await getDb()
		.update(clients)
		.set({ ...input, updatedAt: new Date().toISOString() })
		.where(and(eq(clients.id, id), eq(clients.businessId, currentBusinessId())));
}

export async function setClientArchived(id: string, archived: boolean) {
	const at = new Date().toISOString();
	await getDb()
		.update(clients)
		.set({ archivedAt: archived ? at : null, updatedAt: at })
		.where(and(eq(clients.id, id), eq(clients.businessId, currentBusinessId())));
}

/** Delete a client with no documents; archive one that has history. */
export async function removeClient(id: string): Promise<"deleted" | "archived"> {
	const client = await getClient(id);
	if (!client) throw new Error("Client not found");
	if (removalOutcome(client.documentCount) === "archive") {
		await setClientArchived(id, true);
		return "archived";
	}
	await getDb()
		.delete(clients)
		.where(and(eq(clients.id, id), eq(clients.businessId, currentBusinessId())));
	return "deleted";
}
