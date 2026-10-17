/**
 * Per-document activity log. Every feature that changes a document writes an
 * entry. `activityInsert` returns a query so it can join the same D1 batch as
 * the change it records.
 */
import { asc, eq } from "drizzle-orm";
import { type Db, getDb } from "#/db/index.ts";
import { documentActivity } from "#/db/schema/activity.ts";
import type { ActivityKind } from "#/lib/documents/types.ts";

/** No sign-in for the hackathon; replace with the session user later. */
export const DEFAULT_ACTOR = "Food Services Office";

export function activityInsert(
	db: Db,
	entry: {
		documentId: string;
		kind: ActivityKind;
		actor?: string;
		detail?: Record<string, unknown>;
	},
) {
	return db.insert(documentActivity).values({
		documentId: entry.documentId,
		kind: entry.kind,
		actor: entry.actor ?? DEFAULT_ACTOR,
		detail: entry.detail ?? null,
	});
}

export async function logActivity(entry: Parameters<typeof activityInsert>[1]) {
	await activityInsert(getDb(), entry);
}

export async function listActivity(documentId: string) {
	return getDb()
		.select()
		.from(documentActivity)
		.where(eq(documentActivity.documentId, documentId))
		.orderBy(asc(documentActivity.at), asc(documentActivity.id));
}
