/**
 * Server-only document reads shared by the editor (#15), issuing (#16),
 * payments (#17) and later features. Import only from server-function
 * handlers or other server-only modules (never from components), so the
 * client bundle never pulls in D1.
 */
import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "#/db/index.ts";
import { documentLines, documents } from "#/db/schema/documents.ts";
import type { DraftLine } from "#/lib/documents/types.ts";
import { currentBusinessId } from "#/server/business-store.ts";

export type DocumentRow = typeof documents.$inferSelect;

export interface DocumentRecord {
	document: DocumentRow;
	lines: DraftLine[];
}

const toLine = (l: typeof documentLines.$inferSelect): DraftLine => ({
	lineNo: l.lineNo,
	description: l.description,
	quantity: l.quantity,
	unit: l.unit ?? undefined,
	unitPrice: l.unitPrice,
	discount: l.discount ?? undefined,
	taxCode: l.taxCode,
	rate: l.rate ?? undefined,
	hsnSac: l.hsnSac ?? undefined,
	catalogItemId: l.catalogItemId ?? undefined,
});

/** One document of the current business, with its lines in order. */
export async function getDocument(id: string): Promise<DocumentRecord | null> {
	const db = getDb();
	const [document] = await db
		.select()
		.from(documents)
		.where(
			and(eq(documents.id, id), eq(documents.businessId, currentBusinessId())),
		);
	if (!document) return null;
	const lines = await db
		.select()
		.from(documentLines)
		.where(eq(documentLines.documentId, id))
		.orderBy(asc(documentLines.lineNo));
	return { document, lines: lines.map(toLine) };
}

/** Documents of the current business, newest first. */
export async function listDocuments(
	filter: { type?: DocumentRow["type"]; status?: DocumentRow["status"] } = {},
): Promise<DocumentRow[]> {
	const conditions = [eq(documents.businessId, currentBusinessId())];
	if (filter.type) conditions.push(eq(documents.type, filter.type));
	if (filter.status) conditions.push(eq(documents.status, filter.status));
	return getDb()
		.select()
		.from(documents)
		.where(and(...conditions))
		.orderBy(desc(documents.updatedAt));
}
