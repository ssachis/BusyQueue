/**
 * Server-only client data access (D1). Kept apart from the server functions
 * in clients.ts so the client bundle never imports the D1 client.
 */
import {
	and,
	asc,
	eq,
	isNotNull,
	isNull,
	or,
	type SQL,
	sql,
} from "drizzle-orm";
import { getDb } from "#/db/index.ts";
import { clients } from "#/db/schema/clients.ts";
import {
	type ArchiveFilter,
	type ClientInput,
	type ClientRecord,
	containsPattern,
	SAMPLE_CLIENTS,
	TYPEAHEAD_LIMIT,
} from "#/lib/clients/index.ts";
import { currentBusinessId, loadBusiness } from "./business-store.ts";

type ClientRow = typeof clients.$inferSelect;

export interface ClientListRow extends ClientRecord {
	/** Documents that reference this client; > 0 means archive-only. */
	documentCount: number;
}

function toRecord(row: ClientRow): ClientRecord {
	const { businessId: _b, ...rest } = row;
	return rest;
}

// Written out in full: drizzle drops table qualifiers inside the subquery,
// which would compare documents.client_id with documents.id.
const documentCount = sql<number>`(SELECT count(*) FROM "documents" WHERE "documents"."client_id" = "clients"."id")`;

/** The delete-guard trigger's message (D1 wraps it in the error's cause). */
const isArchiveOnly = (err: unknown) =>
	`${err} ${(err as { cause?: unknown } | null)?.cause}`.includes(
		"can only be archived",
	);

/** `lower(col) LIKE pattern ESCAPE '\'` (pattern already lowercased). */
const likeLower = (col: SQL | typeof clients.name, pattern: string) =>
	sql`lower(${col}) LIKE ${pattern} ESCAPE '\\'`;

function matches(pattern: string) {
	return or(
		likeLower(clients.name, pattern),
		likeLower(sql`coalesce(${clients.email}, '')`, pattern),
		likeLower(sql`coalesce(${clients.taxId}, '')`, pattern),
	);
}

function archivedWhere(filter: ArchiveFilter) {
	if (filter === "active") return isNull(clients.archivedAt);
	if (filter === "archived") return isNotNull(clients.archivedAt);
	return undefined;
}

export async function listClients(opts: {
	query: string;
	archived: ArchiveFilter;
}): Promise<ClientListRow[]> {
	const pattern = containsPattern(opts.query);
	const rows = await getDb()
		.select({ c: clients, documentCount })
		.from(clients)
		.where(
			and(
				eq(clients.businessId, currentBusinessId()),
				archivedWhere(opts.archived),
				pattern ? matches(pattern) : undefined,
			),
		)
		.orderBy(asc(sql`lower(${clients.name})`));
	return rows.map(({ c, documentCount }) => ({
		...toRecord(c),
		documentCount: Number(documentCount),
	}));
}

/** Type-ahead: active clients by name, email or tax ID; name-prefix hits first. */
export async function searchClients(query: string): Promise<ClientRecord[]> {
	const pattern = containsPattern(query);
	const prefix = pattern ? pattern.slice(1) : null;
	const rows = await getDb()
		.select()
		.from(clients)
		.where(
			and(
				eq(clients.businessId, currentBusinessId()),
				isNull(clients.archivedAt),
				pattern ? matches(pattern) : undefined,
			),
		)
		.orderBy(
			...(prefix
				? [sql`CASE WHEN ${likeLower(clients.name, prefix)} THEN 0 ELSE 1 END`]
				: []),
			asc(sql`lower(${clients.name})`),
		)
		.limit(TYPEAHEAD_LIMIT);
	return rows.map(toRecord);
}

export async function loadClient(id: string): Promise<ClientListRow | null> {
	const [row] = await getDb()
		.select({ c: clients, documentCount })
		.from(clients)
		.where(
			and(eq(clients.id, id), eq(clients.businessId, currentBusinessId())),
		);
	return row
		? { ...toRecord(row.c), documentCount: Number(row.documentCount) }
		: null;
}

export async function createClient(input: ClientInput): Promise<ClientRecord> {
	const id = `cli-${crypto.randomUUID()}`;
	const [row] = await getDb()
		.insert(clients)
		.values({ id, businessId: currentBusinessId(), ...input })
		.returning();
	if (!row) throw new Error("Could not save the client");
	return toRecord(row);
}

export async function updateClient(
	id: string,
	input: ClientInput,
): Promise<ClientRecord> {
	const [row] = await getDb()
		.update(clients)
		.set({ ...input, updatedAt: new Date().toISOString() })
		.where(and(eq(clients.id, id), eq(clients.businessId, currentBusinessId())))
		.returning();
	if (!row) throw new Error("Client not found");
	return toRecord(row);
}

export async function setClientArchived(
	id: string,
	archived: boolean,
): Promise<ClientRecord> {
	const now = new Date().toISOString();
	const [row] = await getDb()
		.update(clients)
		.set({ archivedAt: archived ? now : null, updatedAt: now })
		.where(and(eq(clients.id, id), eq(clients.businessId, currentBusinessId())))
		.returning();
	if (!row) throw new Error("Client not found");
	return toRecord(row);
}

export type DeleteResult =
	| { deleted: true }
	| { deleted: false; reason: string; documentCount: number };

/**
 * Delete a client with no documents. One that has history is refused (the
 * `clients_no_delete_with_documents` trigger backs this up) and must be
 * archived instead.
 */
export async function deleteClient(id: string): Promise<DeleteResult> {
	const client = await loadClient(id);
	if (!client) throw new Error("Client not found");
	const refused = (documentCount: number): DeleteResult => ({
		deleted: false,
		documentCount,
		reason: `${client.name} has ${documentCount} document${documentCount === 1 ? "" : "s"}, so it can only be archived.`,
	});
	if (client.documentCount > 0) return refused(client.documentCount);
	try {
		await getDb()
			.delete(clients)
			.where(
				and(eq(clients.id, id), eq(clients.businessId, currentBusinessId())),
			);
	} catch (err) {
		// A document was attached between the check and the delete.
		if (isArchiveOnly(err)) {
			return refused((await loadClient(id))?.documentCount ?? 1);
		}
		throw err;
	}
	return { deleted: true };
}

/** Insert the Northfield sample clients that aren't there yet. */
export async function ensureSampleClients(): Promise<number> {
	const { id: businessId } = await loadBusiness();
	const rows = await getDb()
		.insert(clients)
		.values(SAMPLE_CLIENTS.map((c) => ({ ...c, businessId })))
		.onConflictDoNothing()
		.returning({ id: clients.id });
	return rows.length;
}
