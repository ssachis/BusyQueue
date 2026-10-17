/**
 * Server-only conversions, duplicates and history (#18). Import only from the
 * server functions in convert.ts and duplicate.ts so D1 stays out of the
 * client bundle.
 *
 * A conversion or duplicate always creates an unnumbered draft in one D1
 * batch: the document, its lines, the links (both ways, for conversions) and
 * the activity entries on both documents. The new draft is priced by the tax
 * engine only when it is issued.
 */
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "#/db/index.ts";
import { documentActivity } from "#/db/schema/activity.ts";
import { documentLinks } from "#/db/schema/document-links.ts";
import { documentLines, documents } from "#/db/schema/documents.ts";
import {
	canConvert,
	convertedDraft,
	duplicatedDraft,
	type LinkRelation,
	type SourceDocument,
} from "#/lib/documents/conversion.ts";
import type {
	DocumentDraft,
	DocumentType,
	DraftLine,
} from "#/lib/documents/types.ts";
import { currentBusinessId } from "#/server/business-store.ts";
import { activityInsert } from "./activity.ts";
import { getDocument } from "./store.ts";

const toLineRow = (documentId: string, l: DraftLine) => ({
	documentId,
	lineNo: l.lineNo,
	description: l.description,
	quantity: l.quantity,
	unit: l.unit ?? null,
	unitPrice: l.unitPrice,
	discount: l.discount ?? null,
	taxCode: l.taxCode,
	rate: l.rate ?? null,
	hsnSac: l.hsnSac ?? null,
	catalogItemId: l.catalogItemId ?? null,
});

async function loadSource(id: string) {
	const record = await getDocument(id);
	if (!record) throw new Error("Document not found");
	const { document: d, lines } = record;
	const source: SourceDocument = {
		type: d.type,
		currency: d.currency,
		clientId: d.clientId,
		buyer: d.buyer,
		placeOfSupply: d.placeOfSupply,
		notes: d.notes,
		terms: d.terms,
		lines,
	};
	return { document: d, source };
}

function insertDraft(newId: string, draft: DocumentDraft) {
	const db = getDb();
	return [
		db.insert(documents).values({
			id: newId,
			businessId: currentBusinessId(),
			type: draft.type,
			status: "draft",
			date: draft.date,
			currency: draft.currency,
			clientId: draft.clientId ?? null,
			buyer: draft.buyer,
			placeOfSupply: draft.placeOfSupply ?? null,
			notes: draft.notes ?? null,
			terms: draft.terms ?? null,
		}),
		...draft.lines.map((l) =>
			db.insert(documentLines).values(toLineRow(newId, l)),
		),
	] as const;
}

/** Create a draft of another type from an issued document and link both ways. */
export async function convertDocument(input: {
	documentId: string;
	to: DocumentType;
	date: string;
}): Promise<{ id: string }> {
	const { document, source } = await loadSource(input.documentId);
	if (!canConvert(document, input.to)) {
		throw new Error(
			document.status === "issued"
				? `A ${document.type.replace("_", " ")} can't be converted to a ${input.to.replace("_", " ")}`
				: "Only issued documents can be converted",
		);
	}
	const draft = convertedDraft(source, input.to, input.date);
	const newId = crypto.randomUUID();
	const db = getDb();
	await db.batch([
		...insertDraft(newId, draft),
		db.insert(documentLinks).values([
			{ documentId: document.id, relatedId: newId, relation: "converted_to" },
			{ documentId: newId, relatedId: document.id, relation: "converted_from" },
		]),
		activityInsert(db, {
			documentId: newId,
			kind: "created",
			detail: {
				type: input.to,
				convertedFrom: document.id,
				number: document.number,
			},
		}),
		activityInsert(db, {
			documentId: document.id,
			kind: "converted",
			detail: { to: input.to, id: newId },
		}),
	]);
	return { id: newId };
}

/** Copy any document into a new, unnumbered draft of the same type. */
export async function duplicateDocument(input: {
	documentId: string;
	date: string;
}): Promise<{ id: string }> {
	const { document, source } = await loadSource(input.documentId);
	const draft = duplicatedDraft(source, input.date);
	const newId = crypto.randomUUID();
	const db = getDb();
	await db.batch([
		...insertDraft(newId, draft),
		activityInsert(db, {
			documentId: newId,
			kind: "created",
			detail: {
				type: draft.type,
				duplicatedFrom: document.id,
				number: document.number,
			},
		}),
		activityInsert(db, {
			documentId: document.id,
			kind: "duplicated",
			detail: { id: newId },
		}),
	]);
	return { id: newId };
}

export interface RelatedDocument {
	relation: LinkRelation;
	id: string;
	type: DocumentType;
	status: "draft" | "issued" | "void";
	number: string | null;
}

export interface DocumentHistory {
	related: RelatedDocument[];
	activity: {
		id: number;
		kind: string;
		actor: string;
		/** JSON-safe so it can cross the server-function boundary. */
		detail: ActivityDetail | null;
		at: string;
	}[];
}

type ActivityDetail = Record<string, string | number | boolean | null>;

/** Linked documents and the activity log of one document, oldest first. */
export async function loadHistory(
	documentId: string,
): Promise<DocumentHistory> {
	const db = getDb();
	const businessId = currentBusinessId();
	const [own] = await db
		.select({ id: documents.id })
		.from(documents)
		.where(
			and(eq(documents.id, documentId), eq(documents.businessId, businessId)),
		);
	if (!own) throw new Error("Document not found");
	const [related, activity] = await Promise.all([
		db
			.select({
				relation: documentLinks.relation,
				id: documents.id,
				type: documents.type,
				status: documents.status,
				number: documents.number,
			})
			.from(documentLinks)
			.innerJoin(documents, eq(documents.id, documentLinks.relatedId))
			.where(eq(documentLinks.documentId, documentId))
			.orderBy(asc(documentLinks.createdAt)),
		db
			.select()
			.from(documentActivity)
			.where(eq(documentActivity.documentId, documentId))
			.orderBy(asc(documentActivity.at), asc(documentActivity.id)),
	]);
	return {
		related,
		activity: activity.map((a) => ({
			id: a.id,
			kind: a.kind,
			actor: a.actor,
			detail: (a.detail as ActivityDetail | null) ?? null,
			at: a.at,
		})),
	};
}
