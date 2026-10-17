/**
 * Conversions (#18), server-only: build a new draft from a document and write
 * it, its lines, the link row and the activity on both documents in ONE D1
 * batch (one SQLite transaction). The source is only read, never written:
 * issued documents are immutable (0005_documents_guards.sql).
 *
 * Also the reads behind "Converted from / to" (links) and the activity
 * timeline, which resolve the documents an entry points at.
 *
 * Import only from server-function handlers (convert.ts, duplicate.ts), never
 * from components, so the client bundle never pulls in D1.
 */
import { and, eq, inArray, or, type SQL, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { getDb } from "#/db/index.ts";
import { documentLinks } from "#/db/schema/document-links.ts";
import { documentLines, documents } from "#/db/schema/documents.ts";
import {
	ConversionError,
	conversionLinkKind,
	type LinkKind,
	type NewDraft,
	planConversion,
} from "#/lib/documents/conversions.ts";
import type {
	ActivityKind,
	DocumentStatus,
	DocumentType,
	DraftLine,
} from "#/lib/documents/types.ts";
import { currentBusinessId } from "#/server/business-store.ts";
import { activityInsert, DEFAULT_ACTOR, listActivity } from "./activity.ts";
import { type DocumentRecord, type DocumentRow, getDocument } from "./store.ts";

export type ConvertErrorCode =
	| ConversionError["code"]
	| "not_found"
	| "changed";

export class ConvertError extends Error {
	readonly code: ConvertErrorCode;
	constructor(code: ConvertErrorCode, message: string) {
		super(message);
		this.name = "ConvertError";
		this.code = code;
	}
}

export interface NewDraftResult {
	/** The new draft's id; the page to open is /documents/<documentId>. */
	documentId: string;
	type: DocumentType;
	linkKind: LinkKind;
}

/** A document as other documents show it: type, number, status. */
export interface DocumentRef {
	id: string;
	type: DocumentType;
	number: string | null;
	status: DocumentStatus;
	date: string;
}

export interface DocumentLinkView extends DocumentRef {
	kind: LinkKind;
	createdAt: string;
}

export interface DocumentLinksView {
	/** Documents this one was made from (e.g. the quote it was converted from). */
	from: DocumentLinkView[];
	/** Documents made from this one (e.g. the invoice it was converted to). */
	to: DocumentLinkView[];
}

export interface HistoryEntry {
	id: number;
	kind: ActivityKind;
	actor: string;
	at: string;
	detail: Record<string, string | number | boolean | null> | null;
	/** The other document a converted / duplicated entry points at, if it still exists. */
	related: DocumentRef | null;
}

/** UTC calendar date; the client may pass its own local date instead. */
export const todayUtc = () => new Date().toISOString().slice(0, 10);

/** D1 binds at most 100 parameters per statement; a line row binds 11. */
const LINES_PER_INSERT = 9;

function lineRows(documentId: string, lines: readonly DraftLine[]) {
	return lines.map((l) => ({
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
	}));
}

export async function loadSource(documentId: string): Promise<DocumentRecord> {
	const record = await getDocument(documentId);
	if (!record) throw new ConvertError("not_found", "Document not found");
	return record;
}

/**
 * Write `draft` as a new document made from `source`, in one batch: the
 * document, its lines, the link and an activity row on each side.
 *
 * `guardSource`, when given, must hold for the source at write time (e.g.
 * "still issued"); if it doesn't, the new row gets a NULL status, the NOT
 * NULL constraint fails and the whole batch rolls back.
 */
export async function writeDraftFrom(opts: {
	source: DocumentRow;
	draft: NewDraft<DocumentRow["buyer"]>;
	linkKind: LinkKind;
	activity: Extract<ActivityKind, "converted" | "duplicated">;
	guardSource?: SQL;
	actor?: string;
}): Promise<NewDraftResult> {
	const { source, draft, linkKind } = opts;
	const db = getDb();
	const businessId = currentBusinessId();
	const id = crypto.randomUUID();
	const actor = opts.actor ?? DEFAULT_ACTOR;

	const status = opts.guardSource
		? sql`CASE WHEN EXISTS (SELECT 1 FROM documents WHERE id = ${source.id} AND business_id = ${businessId} AND ${opts.guardSource}) THEN 'draft' END`
		: "draft";

	const statements: BatchItem<"sqlite">[] = [
		db.insert(documents).values({
			id,
			businessId,
			type: draft.type,
			status,
			number: null,
			series: draft.series,
			date: draft.date,
			dueDate: draft.dueDate,
			currency: draft.currency,
			clientId: draft.clientId,
			buyer: draft.buyer,
			placeOfSupply: draft.placeOfSupply,
			notes: draft.notes,
			terms: draft.terms,
		}),
	];
	const rows = lineRows(id, draft.lines);
	for (let i = 0; i < rows.length; i += LINES_PER_INSERT) {
		statements.push(
			db.insert(documentLines).values(rows.slice(i, i + LINES_PER_INSERT)),
		);
	}
	statements.push(
		db
			.insert(documentLinks)
			.values({ fromDocumentId: source.id, toDocumentId: id, kind: linkKind }),
		activityInsert(db, {
			documentId: source.id,
			kind: opts.activity,
			actor,
			detail: {
				direction: "to",
				documentId: id,
				type: draft.type,
				linkKind,
			},
		}),
		activityInsert(db, {
			documentId: id,
			kind: opts.activity,
			actor,
			detail: {
				direction: "from",
				documentId: source.id,
				type: source.type,
				number: source.number,
				linkKind,
				lineCount: draft.lines.length,
			},
		}),
	);

	try {
		await db.batch(
			statements as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error("[convert] write rejected by the database:", message);
		throw new ConvertError(
			"changed",
			"The document changed while copying it (it may have been voided). Reload and try again.",
		);
	}
	return { documentId: id, type: draft.type, linkKind };
}

/** Convert an issued document to a new draft of type `to`. Throws ConvertError. */
export async function convertToDraft(
	documentId: string,
	to: DocumentType,
	today: string = todayUtc(),
): Promise<NewDraftResult> {
	const { document: source, lines } = await loadSource(documentId);
	let draft: NewDraft<DocumentRow["buyer"]>;
	try {
		draft = planConversion({ ...source, lines }, to, today);
	} catch (err) {
		if (err instanceof ConversionError) {
			throw new ConvertError(err.code, err.message);
		}
		throw err;
	}
	return writeDraftFrom({
		source,
		draft,
		linkKind: conversionLinkKind(source.type, to),
		activity: "converted",
		guardSource: sql`status = 'issued'`,
	});
}

/** Documents of the current business by id. */
async function loadRefs(
	ids: readonly string[],
): Promise<Map<string, DocumentRef>> {
	if (ids.length === 0) return new Map();
	const rows = await getDb()
		.select({
			id: documents.id,
			type: documents.type,
			number: documents.number,
			status: documents.status,
			date: documents.date,
		})
		.from(documents)
		.where(
			and(
				eq(documents.businessId, currentBusinessId()),
				inArray(documents.id, [...new Set(ids)]),
			),
		);
	return new Map(rows.map((r) => [r.id, r]));
}

/** Related documents in both directions, oldest link first. */
export async function loadDocumentLinks(
	documentId: string,
): Promise<DocumentLinksView> {
	await loadSource(documentId);
	const links = await getDb()
		.select()
		.from(documentLinks)
		.where(
			or(
				eq(documentLinks.fromDocumentId, documentId),
				eq(documentLinks.toDocumentId, documentId),
			),
		)
		.orderBy(documentLinks.createdAt);
	const refs = await loadRefs(
		links.map((l) =>
			l.fromDocumentId === documentId ? l.toDocumentId : l.fromDocumentId,
		),
	);
	const view: DocumentLinksView = { from: [], to: [] };
	for (const l of links) {
		const outgoing = l.fromDocumentId === documentId;
		const ref = refs.get(outgoing ? l.toDocumentId : l.fromDocumentId);
		if (!ref) continue;
		(outgoing ? view.to : view.from).push({
			...ref,
			kind: l.kind,
			createdAt: l.createdAt,
		});
	}
	return view;
}

type DetailValue = string | number | boolean | null;

/** Keep only plain values from an activity payload (serializable, display-safe). */
function plainDetail(
	detail: Record<string, unknown> | null,
): Record<string, DetailValue> | null {
	if (!detail || typeof detail !== "object") return null;
	const out: Record<string, DetailValue> = {};
	for (const [key, value] of Object.entries(detail)) {
		if (
			value === null ||
			typeof value === "string" ||
			typeof value === "number" ||
			typeof value === "boolean"
		) {
			out[key] = value;
		}
	}
	return out;
}

/** The activity log of a document, oldest first, with linked documents resolved. */
export async function loadHistory(documentId: string): Promise<HistoryEntry[]> {
	await loadSource(documentId);
	const entries = await listActivity(documentId);
	const details = entries.map((e) => plainDetail(e.detail));
	const refs = await loadRefs(
		details.flatMap((d) =>
			d && typeof d.documentId === "string" ? [d.documentId] : [],
		),
	);
	return entries.map((e, i) => {
		const detail = details[i];
		const relatedId =
			detail && typeof detail.documentId === "string"
				? detail.documentId
				: null;
		return {
			id: e.id,
			kind: e.kind,
			actor: e.actor,
			at: e.at,
			detail,
			related: relatedId ? (refs.get(relatedId) ?? null) : null,
		};
	});
}
