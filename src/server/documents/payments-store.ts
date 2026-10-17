/**
 * Server-only payment writes and reads (#17). Import only from server-function
 * handlers (payments.ts), never from components, so D1 stays out of the
 * client bundle.
 *
 * Every number comes from `#/lib/documents/status.ts`. Every change writes
 * its activity row in the same D1 batch, so the log can't miss a change.
 *
 * Concurrency: the checks below read, then write. So a second request can't
 * slip in between, each write also re-checks its precondition inside SQL and,
 * if it no longer holds, writes NULL into a NOT NULL column. That fails the
 * statement and rolls back the whole batch, activity row included.
 * - record / mark paid: the amount must still be <= the balance at write time.
 * - void payment: the payment must still be active.
 * - void document: there must still be no active payments (and the
 *   `documents_issued_locked` trigger rejects anything but issued → void).
 */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { z } from "zod";
import { getDb } from "#/db/index.ts";
import { documentPayments } from "#/db/schema/document-payments.ts";
import { documents } from "#/db/schema/documents.ts";
import {
	assessPayment,
	isFutureDate,
	type MarkPaidInput,
	PaymentError,
	type PaymentSummary,
	paymentSummary,
	type RecordPaymentInput,
	takesPayments,
	type VoidDocumentInput,
	type VoidPaymentInput,
} from "#/lib/documents/status.ts";
import type { DisplayStatus } from "#/lib/documents/types.ts";
import type { Money } from "#/lib/money/index.ts";
import { currentBusinessId } from "#/server/business-store.ts";
import { activityInsert } from "./activity.ts";
import { type DocumentRow, getDocument } from "./store.ts";

type PaymentRow = typeof documentPayments.$inferSelect;

/** Parsed (output) shapes of the boundary schemas. */
type RecordPayment = z.output<typeof RecordPaymentInput>;
type MarkPaid = z.output<typeof MarkPaidInput>;
type VoidPayment = z.output<typeof VoidPaymentInput>;
type VoidDocument = z.output<typeof VoidDocumentInput>;

export interface PaymentsView {
	document: {
		id: string;
		type: DocumentRow["type"];
		status: DocumentRow["status"];
		number: string | null;
		currency: string;
		totalMinor: number | null;
		dueDate: string | null;
		voidedAt: string | null;
		voidReason: string | null;
	};
	takesPayments: boolean;
	summary: PaymentSummary;
	payments: {
		id: string;
		amountMinor: number;
		currency: string;
		receivedOn: string;
		method: string | null;
		reference: string | null;
		note: string | null;
		voidedAt: string | null;
		createdAt: string;
	}[];
}

const todayUtc = () => new Date().toISOString().slice(0, 10);

async function loadDocument(id: string): Promise<DocumentRow> {
	const record = await getDocument(id);
	if (!record) throw new PaymentError("invalid_input", "Document not found");
	return record.document;
}

async function loadPayments(documentId: string): Promise<PaymentRow[]> {
	return getDb()
		.select()
		.from(documentPayments)
		.where(eq(documentPayments.documentId, documentId))
		.orderBy(asc(documentPayments.receivedOn), asc(documentPayments.createdAt));
}

function summarize(
	doc: DocumentRow,
	payments: readonly PaymentRow[],
	today: string,
): PaymentSummary {
	return paymentSummary({
		type: doc.type,
		status: doc.status,
		totalMinor: doc.totalMinor,
		currency: doc.currency,
		dueDate: doc.dueDate,
		payments,
		today,
	});
}

/** The document, its payments (voided included) and the derived summary. */
export async function getPaymentsView(
	documentId: string,
	today: string = todayUtc(),
): Promise<PaymentsView> {
	const doc = await loadDocument(documentId);
	const payments = await loadPayments(doc.id);
	return {
		document: {
			id: doc.id,
			type: doc.type,
			status: doc.status,
			number: doc.number,
			currency: doc.currency,
			totalMinor: doc.totalMinor,
			dueDate: doc.dueDate,
			voidedAt: doc.voidedAt,
			voidReason: doc.voidReason,
		},
		takesPayments: takesPayments(doc.type),
		summary: summarize(doc, payments, today),
		payments: payments.map((p) => ({
			id: p.id,
			amountMinor: p.amountMinor,
			currency: p.currency,
			receivedOn: p.receivedOn,
			method: p.method,
			reference: p.reference,
			note: p.note,
			voidedAt: p.voidedAt,
			createdAt: p.createdAt,
		})),
	};
}

/** Display status per document id (unknown ids are left out). */
export async function getDisplayStatuses(
	ids: readonly string[],
	today: string = todayUtc(),
): Promise<Record<string, PaymentSummary>> {
	if (ids.length === 0) return {};
	const db = getDb();
	const docs = await db
		.select()
		.from(documents)
		.where(
			and(
				eq(documents.businessId, currentBusinessId()),
				inArray(documents.id, [...ids]),
			),
		);
	if (docs.length === 0) return {};
	const payments = await db
		.select()
		.from(documentPayments)
		.where(
			and(
				inArray(
					documentPayments.documentId,
					docs.map((d) => d.id),
				),
				isNull(documentPayments.voidedAt),
			),
		);
	const byDoc = new Map<string, PaymentRow[]>();
	for (const p of payments) {
		const list = byDoc.get(p.documentId);
		if (list) list.push(p);
		else byDoc.set(p.documentId, [p]);
	}
	const out: Record<string, PaymentSummary> = {};
	for (const doc of docs) {
		out[doc.id] = summarize(doc, byDoc.get(doc.id) ?? [], today);
	}
	return out;
}

/** Turn a failed guarded batch into a message the user can act on. */
async function runGuarded(work: () => Promise<unknown>): Promise<void> {
	try {
		await work();
	} catch (err) {
		if (err instanceof PaymentError) throw err;
		const message = err instanceof Error ? err.message : String(err);
		console.error("[payments] write rejected by the database:", message);
		throw new PaymentError(
			"invalid_input",
			"The document changed while saving. Reload and try again.",
		);
	}
}

/** Insert a payment and its activity row, re-checking the balance in SQL. */
async function insertPayment(
	doc: DocumentRow,
	money: Money,
	input: MarkPaid,
	kind: "payment_recorded" | "marked_paid",
	now: Date,
): Promise<string> {
	if (isFutureDate(input.receivedOn, now)) {
		throw new PaymentError(
			"invalid_input",
			"The payment date can't be in the future",
		);
	}
	const db = getDb();
	const id = crypto.randomUUID();
	// NULL (→ NOT NULL failure → batch rollback) unless the amount still fits.
	const guardedAmount = sql`CASE WHEN (
		SELECT d.total_minor - COALESCE((
			SELECT SUM(p.amount_minor) FROM document_payments p
			WHERE p.document_id = d.id AND p.voided_at IS NULL
		), 0)
		FROM documents d
		WHERE d.id = ${doc.id} AND d.status = 'issued'
	) >= ${money.minor} THEN ${money.minor} ELSE NULL END`;
	await runGuarded(() =>
		db.batch([
			db.insert(documentPayments).values({
				id,
				documentId: doc.id,
				amountMinor: guardedAmount,
				currency: money.currency,
				receivedOn: input.receivedOn,
				method: input.method ?? null,
				reference: input.reference ?? null,
				note: input.note ?? null,
			}),
			activityInsert(db, {
				documentId: doc.id,
				kind,
				detail: {
					paymentId: id,
					amountMinor: money.minor,
					currency: money.currency,
					receivedOn: input.receivedOn,
					...(input.method ? { method: input.method } : {}),
					...(input.reference ? { reference: input.reference } : {}),
				},
			}),
		]),
	);
	return id;
}

async function currentBalance(doc: DocumentRow, now: Date) {
	const payments = await loadPayments(doc.id);
	return summarize(doc, payments, now.toISOString().slice(0, 10));
}

export async function recordPayment(
	input: RecordPayment,
	now: Date = new Date(),
): Promise<{ paymentId: string; displayStatus: DisplayStatus }> {
	const doc = await loadDocument(input.documentId);
	const { balanceMinor } = await currentBalance(doc, now);
	const money = assessPayment(
		{
			type: doc.type,
			status: doc.status,
			currency: doc.currency,
			balanceMinor,
		},
		input.amount,
		input.currency,
	);
	const paymentId = await insertPayment(
		doc,
		money,
		input,
		"payment_recorded",
		now,
	);
	const after = await currentBalance(doc, now);
	return { paymentId, displayStatus: after.displayStatus };
}

/** Record a payment for exactly the remaining balance. */
export async function markPaid(
	input: MarkPaid,
	now: Date = new Date(),
): Promise<{ paymentId: string; amountMinor: number }> {
	const doc = await loadDocument(input.documentId);
	if (doc.status !== "issued") {
		throw new PaymentError(
			"not_issued",
			"Only issued documents can be marked as paid",
		);
	}
	if (!takesPayments(doc.type)) {
		throw new PaymentError(
			"not_payable",
			"Only invoices and proformas take payments",
		);
	}
	const { balanceMinor } = await currentBalance(doc, now);
	if (balanceMinor <= 0) {
		throw new PaymentError("nothing_owed", "This document is already paid");
	}
	const money: Money = { minor: balanceMinor, currency: doc.currency };
	const paymentId = await insertPayment(doc, money, input, "marked_paid", now);
	return { paymentId, amountMinor: balanceMinor };
}

/** Void a payment: it stays on record with voided_at set and stops counting. */
export async function voidPayment(
	input: VoidPayment,
	now: Date = new Date(),
): Promise<void> {
	const doc = await loadDocument(input.documentId);
	const db = getDb();
	const [payment] = await db
		.select()
		.from(documentPayments)
		.where(
			and(
				eq(documentPayments.id, input.paymentId),
				eq(documentPayments.documentId, doc.id),
			),
		);
	if (!payment) throw new PaymentError("invalid_input", "Payment not found");
	if (payment.voidedAt) {
		throw new PaymentError("invalid_input", "This payment is already void");
	}
	if (doc.status !== "issued") {
		throw new PaymentError(
			"not_issued",
			"Payments can only be voided on issued documents",
		);
	}
	await runGuarded(() =>
		db.batch([
			db
				.update(documentPayments)
				.set({
					voidedAt: now.toISOString(),
					// NULL (→ rollback) if someone voided it first.
					amountMinor: sql`CASE WHEN voided_at IS NULL THEN amount_minor ELSE NULL END`,
				})
				.where(eq(documentPayments.id, payment.id)),
			activityInsert(db, {
				documentId: doc.id,
				kind: "payment_voided",
				detail: {
					paymentId: payment.id,
					amountMinor: payment.amountMinor,
					currency: payment.currency,
					...(input.reason ? { reason: input.reason } : {}),
				},
			}),
		]),
	);
}

/**
 * Void an issued document. It keeps its number (numbers are never reused).
 * Active payments block voiding: void (or refund and void) each payment
 * first, so the money trail is explicit rather than silently orphaned.
 */
export async function voidDocument(
	input: VoidDocument,
	now: Date = new Date(),
): Promise<void> {
	const doc = await loadDocument(input.documentId);
	if (doc.status !== "issued") {
		throw new PaymentError(
			"not_issued",
			doc.status === "void"
				? "This document is already void"
				: "Drafts can be deleted; only issued documents are voided",
		);
	}
	const { paidMinor } = await currentBalance(doc, now);
	if (paidMinor > 0) {
		throw new PaymentError(
			"invalid_input",
			"Void the payments on this document first",
		);
	}
	const db = getDb();
	const at = now.toISOString();
	await runGuarded(() =>
		db.batch([
			db
				.update(documents)
				.set({
					// NULL (→ trigger/constraint rollback) if a payment landed meanwhile.
					status: sql`CASE WHEN EXISTS (
						SELECT 1 FROM document_payments
						WHERE document_id = ${doc.id} AND voided_at IS NULL
					) THEN NULL ELSE 'void' END`,
					voidedAt: at,
					voidReason: input.reason,
					updatedAt: at,
				})
				.where(
					and(
						eq(documents.id, doc.id),
						eq(documents.businessId, currentBusinessId()),
					),
				),
			activityInsert(db, {
				documentId: doc.id,
				kind: "voided",
				detail: { reason: input.reason, number: doc.number },
			}),
		]),
	);
}
