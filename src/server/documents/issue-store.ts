/**
 * Issuing (#16), server-only: assigns the next number, snapshots the seller
 * and totals, logs the activity and locks the draft, all in ONE D1 batch.
 *
 * Why it can't collide or skip:
 * - A D1 batch is one SQLite transaction and batches run one at a time, so
 *   no other issue can run between the counter bump and the document update.
 * - The number is read from the counter in SQL inside that batch, never from
 *   a value read earlier in JS.
 * - Every statement is guarded by the same "still the draft we priced"
 *   predicate, so if the document was issued or edited meanwhile, all three
 *   are no-ops (no number consumed) and the update returns no row.
 * - If any statement fails (e.g. a number too long for India, which the
 *   documents CHECK rejects), the whole batch rolls back, counter included.
 *
 * Import only from server-function handlers (src/server/documents/issue.ts).
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "#/db/index.ts";
import { documentActivity } from "#/db/schema/activity.ts";
import { documents } from "#/db/schema/documents.ts";
import { documentCounters } from "#/db/schema/numbering.ts";
import { BusinessProfile } from "#/lib/business/profile.ts";
import {
	NumberingError,
	planNumbering,
	SEQUENCE_PRINTF,
} from "#/lib/documents/numbering.ts";
import { documentTotals, sellerSnapshot } from "#/lib/documents/totals.ts";
import { TaxError } from "#/lib/tax/index.ts";
import { currentBusinessId, loadBusiness } from "#/server/business-store.ts";
import { DEFAULT_ACTOR } from "./activity.ts";
import { getDocument } from "./store.ts";

export type IssueErrorCode =
	| "not_found"
	| "not_draft"
	| "no_lines"
	| "tax"
	| "numbering"
	| "profile"
	| "changed"
	| "locked";

export class IssueError extends Error {
	readonly code: IssueErrorCode;
	constructor(code: IssueErrorCode, message: string) {
		super(message);
		this.name = "IssueError";
		this.code = code;
	}
}

export interface IssueResult {
	documentId: string;
	number: string;
	issuedAt: string;
	totalMinor: number;
	currency: string;
}

/** Message text of an error and its causes (drizzle wraps D1 errors). */
function errorText(err: unknown): string {
	const parts: string[] = [];
	let e: unknown = err;
	for (let i = 0; e && i < 5; i++) {
		parts.push(e instanceof Error ? e.message : String(e));
		e = e instanceof Error ? e.cause : undefined;
	}
	return parts.join(" | ");
}

/**
 * A friendly message when a write hit the lock triggers from
 * 0005_documents_guards.sql, else null. For any feature that writes documents.
 */
export function lockedDocumentMessage(err: unknown): string | null {
	const text = errorText(err);
	if (
		/issued documents are immutable|lines of an issued document are immutable/.test(
			text,
		)
	) {
		return "This document has been issued and is locked. Void it or issue a credit note instead of editing it.";
	}
	if (/void documents are immutable/.test(text)) {
		return "This document is void and can't be changed.";
	}
	if (/only drafts can be deleted/.test(text)) {
		return "Only drafts can be deleted. Void an issued document instead.";
	}
	return null;
}

/** Issue a draft of the current business. Throws IssueError with a clear message. */
export async function issueDraft(
	documentId: string,
	actor: string = DEFAULT_ACTOR,
): Promise<IssueResult> {
	const record = await getDocument(documentId);
	if (!record) throw new IssueError("not_found", "Document not found");
	const { document: doc, lines } = record;
	if (doc.status !== "draft") {
		throw new IssueError(
			"not_draft",
			doc.number
				? `Already ${doc.status} as ${doc.number}`
				: `Already ${doc.status}`,
		);
	}
	if (lines.length === 0) {
		throw new IssueError("no_lines", "Add at least one line before issuing");
	}

	const profile = BusinessProfile.safeParse(await loadBusiness());
	if (!profile.success) {
		throw new IssueError(
			"profile",
			"Complete the business profile (Settings) before issuing",
		);
	}
	const business = profile.data;
	const seller = sellerSnapshot(business);

	let totals: ReturnType<typeof documentTotals>;
	try {
		totals = documentTotals(seller, {
			buyer: doc.buyer,
			currency: doc.currency,
			placeOfSupply: doc.placeOfSupply ?? undefined,
			lines,
		});
	} catch (err) {
		if (err instanceof TaxError) {
			throw new IssueError("tax", `Can't issue: ${err.message}`);
		}
		throw err;
	}

	let plan: ReturnType<typeof planNumbering>;
	try {
		plan = planNumbering({
			country: business.country,
			type: doc.type,
			series: doc.series,
			date: doc.date,
		});
	} catch (err) {
		if (err instanceof NumberingError) {
			throw new IssueError("numbering", err.message);
		}
		throw err;
	}

	const db = getDb();
	const businessId = currentBusinessId();
	const issuedAt = new Date().toISOString();

	// "Still the draft we just priced": same predicate on all three statements.
	const stillDraft = sql`EXISTS (SELECT 1 FROM documents WHERE id = ${doc.id} AND business_id = ${businessId} AND status = 'draft' AND updated_at = ${doc.updatedAt})`;
	const counterKey = sql`business_id = ${businessId} AND type = ${doc.type} AND series = ${doc.series} AND fiscal_year = ${plan.fiscalYear}`;
	const assigned = sql`(${plan.prefix} || printf(${SEQUENCE_PRINTF}, (SELECT next_number - 1 FROM document_counters WHERE ${counterKey})))`;
	// Over India's 16 characters → NULL → the documents CHECK aborts the batch.
	const number =
		plan.maxLength === null
			? assigned
			: sql`(CASE WHEN length(${assigned}) <= ${plan.maxLength} THEN ${assigned} END)`;

	// Drizzle builders, not db.run(sql): drizzle's D1 batch can't bind params
	// of raw queries. `.select(sql)` inserts into every column in table order.
	const bumpCounter = db
		.insert(documentCounters)
		.select(
			sql`SELECT ${businessId}, ${doc.type}, ${doc.series}, ${plan.fiscalYear}, 2 WHERE ${stillDraft}`,
		)
		.onConflictDoUpdate({
			target: [
				documentCounters.businessId,
				documentCounters.type,
				documentCounters.series,
				documentCounters.fiscalYear,
			],
			set: { nextNumber: sql`${documentCounters.nextNumber} + 1` },
		});

	// Conditional, so it can't use activityInsert (which always inserts).
	// Columns: id (NULL = next rowid), document_id, kind, actor, detail, at.
	const logIssued = db.insert(documentActivity).select(
		sql`SELECT NULL, ${doc.id}, 'issued', ${actor},
			json_object('number', ${number}, 'totalMinor', ${totals.totalMinor}, 'currency', ${doc.currency}),
			${issuedAt}
		WHERE ${stillDraft}`,
	);

	const lock = db
		.update(documents)
		.set({
			status: "issued",
			number,
			fiscalYear: plan.fiscalYear || null,
			seller,
			subtotalMinor: totals.subtotalMinor,
			taxMinor: totals.taxMinor,
			totalMinor: totals.totalMinor,
			taxResult: totals,
			issuedAt,
			updatedAt: issuedAt,
		})
		.where(
			and(
				eq(documents.id, doc.id),
				eq(documents.businessId, businessId),
				eq(documents.status, "draft"),
				eq(documents.updatedAt, doc.updatedAt),
			),
		)
		.returning({ number: documents.number });

	let updated: { number: string | null }[];
	try {
		[, , updated] = await db.batch([bumpCounter, logIssued, lock]);
	} catch (err) {
		const text = errorText(err);
		if (text.includes("documents_number_when_issued")) {
			throw new IssueError(
				"numbering",
				`The next number would exceed ${plan.maxLength} characters; start a new series`,
			);
		}
		const locked = lockedDocumentMessage(err);
		if (locked) throw new IssueError("locked", locked);
		throw err;
	}

	const issuedNumber = updated[0]?.number;
	if (!issuedNumber) {
		// Nothing was written. Say why.
		const now = await getDocument(documentId);
		if (now && now.document.status !== "draft") {
			throw new IssueError(
				"not_draft",
				`Already ${now.document.status} as ${now.document.number}`,
			);
		}
		throw new IssueError(
			"changed",
			"The draft changed while issuing. Reload and try again.",
		);
	}

	return {
		documentId: doc.id,
		number: issuedNumber,
		issuedAt,
		totalMinor: totals.totalMinor,
		currency: doc.currency,
	};
}

/** What the Issue button shows for an issued or void document. */
export async function loadIssueState(documentId: string) {
	const record = await getDocument(documentId);
	if (!record) throw new IssueError("not_found", "Document not found");
	const { status, number, issuedAt, voidedAt } = record.document;
	return { status, number, issuedAt, voidedAt };
}
