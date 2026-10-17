/**
 * Server-only draft editing (#15): create, save and delete drafts, and the
 * data the list and document pages render. Import only from the server
 * functions in drafts.ts (never from components) so D1 stays out of the
 * client bundle.
 *
 * Drafts have no number. Every change writes to the activity log in the same
 * D1 batch; DB triggers keep issued and void documents locked regardless.
 */
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "#/db/index.ts";
import { documentActivity } from "#/db/schema/activity.ts";
import { documentLines, documents } from "#/db/schema/documents.ts";
import type {
	BusinessCountry,
	BusinessProfile,
} from "#/lib/business/profile.ts";
import { documentTotals, sellerSnapshot } from "#/lib/documents/totals.ts";
import type {
	DocumentDraft,
	DocumentStatus,
	DocumentType,
	DraftLine,
	PartySnapshot,
} from "#/lib/documents/types.ts";
import { type Business, loadBusiness } from "#/server/business-store.ts";
import { activityInsert } from "./activity.ts";
import { type DocumentRow, getDocument, listDocuments } from "./store.ts";

export type Seller = PartySnapshot & {
	taxIds?: { type: string; value: string }[];
};

/** The live business as it would print today (drafts use this). */
function liveSeller(business: Business): Seller {
	const profile: BusinessProfile = {
		...business,
		country: business.country as BusinessCountry,
	};
	return sellerSnapshot(profile);
}

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

const draftColumns = (d: DocumentDraft) => ({
	type: d.type,
	date: d.date,
	dueDate: d.dueDate ?? null,
	currency: d.currency,
	clientId: d.clientId ?? null,
	buyer: d.buyer,
	placeOfSupply: d.placeOfSupply ?? null,
	notes: d.notes ?? null,
	terms: d.terms ?? null,
});

/** Totals of a draft, or null while the tax rules reject it. */
function draftTotal(
	seller: Seller,
	doc: Pick<DocumentRow, "buyer" | "currency" | "placeOfSupply">,
	lines: DraftLine[],
): number | null {
	try {
		return documentTotals(seller, {
			buyer: doc.buyer,
			currency: doc.currency,
			placeOfSupply: doc.placeOfSupply ?? undefined,
			lines,
		}).totalMinor;
	} catch {
		return null;
	}
}

// --- list -------------------------------------------------------------------

export interface DocumentListRow {
	id: string;
	type: DocumentType;
	status: DocumentStatus;
	number: string | null;
	buyerName: string;
	date: string;
	dueDate: string | null;
	currency: string;
	/** Frozen total for issued/void; computed from the lines for drafts. */
	totalMinor: number | null;
	updatedAt: string;
}

export async function loadDocumentList(filter: {
	type?: DocumentType;
	status?: DocumentStatus;
}): Promise<DocumentListRow[]> {
	const [rows, business] = await Promise.all([
		listDocuments(filter),
		loadBusiness(),
	]);
	const draftIds = new Set(
		rows.filter((r) => r.status === "draft").map((r) => r.id),
	);
	const linesByDoc = new Map<string, DraftLine[]>();
	if (draftIds.size > 0) {
		// One query for every draft's lines (no IN list, so no bind-limit worries).
		const draftLines = await getDb()
			.select({ line: documentLines })
			.from(documentLines)
			.innerJoin(documents, eq(documents.id, documentLines.documentId))
			.where(
				and(
					eq(documents.businessId, business.id),
					eq(documents.status, "draft"),
				),
			)
			.orderBy(asc(documentLines.documentId), asc(documentLines.lineNo));
		for (const { line } of draftLines) {
			const list = linesByDoc.get(line.documentId) ?? [];
			list.push({
				lineNo: line.lineNo,
				description: line.description,
				quantity: line.quantity,
				unit: line.unit ?? undefined,
				unitPrice: line.unitPrice,
				discount: line.discount ?? undefined,
				taxCode: line.taxCode,
				rate: line.rate ?? undefined,
				hsnSac: line.hsnSac ?? undefined,
			});
			linesByDoc.set(line.documentId, list);
		}
	}
	const seller = liveSeller(business);
	return rows.map((r) => ({
		id: r.id,
		type: r.type,
		status: r.status,
		number: r.number,
		buyerName: r.buyer.name,
		date: r.date,
		dueDate: r.dueDate,
		currency: r.currency,
		totalMinor:
			r.status === "draft"
				? draftTotal(seller, r, linesByDoc.get(r.id) ?? [])
				: r.totalMinor,
		updatedAt: r.updatedAt,
	}));
}

// --- one document -----------------------------------------------------------

export interface DocumentPageData {
	document: DocumentRow;
	lines: DraftLine[];
	/** Frozen seller for issued/void; the live business for drafts. */
	seller: Seller;
	accentColor: string | null;
}

export async function loadDocumentPage(
	id: string,
): Promise<DocumentPageData | null> {
	const [record, business] = await Promise.all([
		getDocument(id),
		loadBusiness(),
	]);
	if (!record) return null;
	const frozen = record.document.status !== "draft" && record.document.seller;
	return {
		document: record.document,
		lines: record.lines,
		seller: frozen ? (record.document.seller as Seller) : liveSeller(business),
		accentColor: business.accentColor,
	};
}

// --- writes -----------------------------------------------------------------

/** A new, empty draft with the business defaults. Logs `created`. */
export async function createDraft(input: {
	type: DocumentType;
	date: string;
}): Promise<{ id: string }> {
	const business = await loadBusiness();
	const db = getDb();
	const id = crypto.randomUUID();
	await db.batch([
		db.insert(documents).values({
			id,
			businessId: business.id,
			type: input.type,
			status: "draft",
			date: input.date,
			currency: business.currency,
			buyer: { name: "", addressLines: [], country: business.country },
		}),
		activityInsert(db, {
			documentId: id,
			kind: "created",
			detail: { type: input.type },
		}),
	]);
	return { id };
}

async function requireDraft(id: string) {
	const business = await loadBusiness();
	const [row] = await getDb()
		.select({ status: documents.status })
		.from(documents)
		.where(and(eq(documents.id, id), eq(documents.businessId, business.id)));
	if (!row) throw new Error("Document not found");
	if (row.status !== "draft") {
		throw new Error("Only drafts can be changed; this document is issued");
	}
	return business;
}

/**
 * Save a validated draft: update the document and replace its lines in one
 * batch, with an `edited` activity entry.
 */
export async function saveDraft(input: {
	id: string;
	draft: DocumentDraft;
}): Promise<{ updatedAt: string }> {
	const business = await requireDraft(input.id);
	const db = getDb();
	const updatedAt = new Date().toISOString();
	const where = and(
		eq(documents.id, input.id),
		eq(documents.businessId, business.id),
		eq(documents.status, "draft"),
	);
	await db.batch([
		db
			.update(documents)
			.set({ ...draftColumns(input.draft), updatedAt })
			.where(where),
		db.delete(documentLines).where(eq(documentLines.documentId, input.id)),
		...input.draft.lines.map((l) =>
			db.insert(documentLines).values(toLineRow(input.id, l)),
		),
		activityInsert(db, {
			documentId: input.id,
			kind: "edited",
			detail: { lines: input.draft.lines.length },
		}),
	]);
	return { updatedAt };
}

/** Delete a draft and its lines and log. Issued documents are voided instead. */
export async function deleteDraft(id: string): Promise<{ id: string }> {
	const business = await requireDraft(id);
	const db = getDb();
	await db.batch([
		db.delete(documentLines).where(eq(documentLines.documentId, id)),
		db.delete(documentActivity).where(eq(documentActivity.documentId, id)),
		db
			.delete(documents)
			.where(
				and(
					eq(documents.id, id),
					eq(documents.businessId, business.id),
					eq(documents.status, "draft"),
				),
			),
	]);
	return { id };
}
