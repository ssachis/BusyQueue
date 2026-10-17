/**
 * Server-only reminder data access (D1) and the daily sweep. Import only from
 * server-function handlers (reminders.ts) or the Worker entry (src/worker.ts),
 * never from components, so the client bundle never pulls in D1.
 *
 * The rules and the sweep plan are pure (`#/lib/reminders`); this file loads
 * their inputs and applies the plan.
 */
import { and, eq, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { type Db, getDb } from "#/db/index.ts";
import { invoices, payments } from "#/db/schema/busyq.ts";
import { contracts } from "#/db/schema/contracts.ts";
import { documentPayments } from "#/db/schema/document-payments.ts";
import { documents } from "#/db/schema/documents.ts";
import { reminders } from "#/db/schema/reminders.ts";
import {
	type ComputedReminder,
	compareReminders,
	computeReminders,
	type OutgoingInvoiceInput,
	planSweep,
	type ReminderInputs,
	type ReminderState,
	reminderState,
	type SnoozeDays,
	snoozeUntil,
	type VendorBillInput,
} from "#/lib/reminders/index.ts";
import { currentBusinessId, loadBusiness } from "./business-store.ts";

export type ReminderRow = typeof reminders.$inferSelect;

/** Today as an ISO date in UTC (the cron runs on UTC too). */
export function todayIso(now: Date = new Date()): string {
	return now.toISOString().slice(0, 10);
}

// ── Inputs ────────────────────────────────────────────────────────────

async function loadInputs(db: Db, businessId: string): Promise<ReminderInputs> {
	const [contractRows, billRows, billPayments, docRows, docPayments] =
		await Promise.all([
			db
				.select({
					id: contracts.id,
					title: contracts.title,
					vendorName: contracts.vendorName,
					endDate: contracts.endDate,
					noticeDays: contracts.noticeDays,
					autoRenew: contracts.autoRenew,
					status: contracts.status,
					createdAt: contracts.createdAt,
				})
				.from(contracts),
			db.select().from(invoices),
			db
				.select({
					invoiceNumber: payments.invoiceNumber,
					amount: payments.amount,
					currency: payments.currency,
					paidOn: payments.paidOn,
				})
				.from(payments)
				.where(isNotNull(payments.invoiceNumber)),
			db
				.select()
				.from(documents)
				.where(
					and(
						eq(documents.businessId, businessId),
						eq(documents.type, "invoice"),
					),
				),
			db
				.select({
					documentId: documentPayments.documentId,
					amountMinor: documentPayments.amountMinor,
					currency: documentPayments.currency,
					receivedOn: documentPayments.receivedOn,
					voidedAt: documentPayments.voidedAt,
				})
				.from(documentPayments)
				.innerJoin(documents, eq(documentPayments.documentId, documents.id))
				.where(eq(documents.businessId, businessId)),
		]);

	// Vendor payments carry the invoice number, not our id (as in the audit).
	const paysByNumber = new Map<string, VendorBillInput["payments"]>();
	for (const p of billPayments) {
		if (!p.invoiceNumber) continue;
		const list = paysByNumber.get(p.invoiceNumber) ?? [];
		list.push({ amount: p.amount, currency: p.currency, paidOn: p.paidOn });
		paysByNumber.set(p.invoiceNumber, list);
	}
	const paysByDoc = new Map<string, OutgoingInvoiceInput["payments"]>();
	for (const { documentId, ...p } of docPayments) {
		const list = paysByDoc.get(documentId) ?? [];
		list.push(p);
		paysByDoc.set(documentId, list);
	}

	return {
		contracts: contractRows,
		vendorBills: billRows.map((b) => ({
			id: b.id,
			invoiceNumber: b.invoiceNumber,
			vendorName: b.vendorName,
			issueDate: b.issueDate,
			dueDate: b.dueDate,
			currency: b.currency,
			statedTotal: b.statedTotal,
			payments: paysByNumber.get(b.invoiceNumber) ?? [],
		})),
		outgoingInvoices: docRows.map((d) => ({
			id: d.id,
			type: d.type,
			status: d.status,
			number: d.number,
			buyerName: d.buyer.name,
			date: d.date,
			dueDate: d.dueDate,
			currency: d.currency,
			totalMinor: d.totalMinor,
			payments: paysByDoc.get(d.id) ?? [],
		})),
	};
}

// ── Email seam ────────────────────────────────────────────────────────

/**
 * Seam for reminder emails. Cloudflare Email Sending needs a verified
 * sending domain, which BusyQ doesn't have yet, so this only logs. When the
 * domain is ready: add a `send_email` binding in wrangler.jsonc, send here,
 * and set `reminders.emailed_at` for the reminders that went out.
 */
export async function sendReminderEmail(
	reminder: Pick<ComputedReminder, "severity" | "title" | "detail">,
): Promise<{ sent: false; reason: string }> {
	const reason = "email sending is not configured (no verified domain)";
	console.log(
		`[reminders] email skipped (${reason}): [${reminder.severity}] ${reminder.title}`,
	);
	return { sent: false, reason };
}

// ── Sweep ─────────────────────────────────────────────────────────────

export interface SweepResult {
	today: string;
	/** Reminders that apply on `today`. */
	computed: number;
	inserted: number;
	refreshed: number;
	reopened: number;
	resolved: number;
}

/**
 * Compute every reminder for `today` and bring the table in line: insert new
 * keys (ON CONFLICT DO NOTHING, so a re-run or a concurrent run never
 * duplicates), refresh wording on open ones, reopen auto-resolved ones that
 * apply again, and auto-resolve open ones that no longer apply (paid,
 * confirmed, void, superseded). Dismissed reminders are left alone.
 */
export async function runReminderSweep(today: string): Promise<SweepResult> {
	const db = getDb();
	await loadBusiness(); // reminders reference the business row
	const businessId = currentBusinessId();
	const [inputs, stored] = await Promise.all([
		loadInputs(db, businessId),
		db.select().from(reminders).where(eq(reminders.businessId, businessId)),
	]);
	const { reminders: computed, outcomes } = computeReminders(inputs, today);
	const plan = planSweep(stored, outcomes);
	const at = new Date().toISOString();

	let inserted: ComputedReminder[] = [];
	if (plan.insert.length > 0) {
		const statements = plan.insert.map((r) =>
			db
				.insert(reminders)
				.values({ id: crypto.randomUUID(), businessId, ...r })
				.onConflictDoNothing({
					target: [
						reminders.subjectType,
						reminders.subjectId,
						reminders.kind,
						reminders.dueDate,
					],
				})
				.returning({ id: reminders.id }),
		);
		const results = await db.batch(
			statements as [(typeof statements)[number], ...typeof statements],
		);
		inserted = plan.insert.filter((_, i) => (results[i]?.length ?? 0) > 0);
	}

	const updates = [
		...plan.refresh.map(({ id, content }) =>
			db
				.update(reminders)
				.set({ ...content, updatedAt: at })
				.where(and(eq(reminders.id, id), isNull(reminders.resolvedAt))),
		),
		...plan.reopen.map(({ id, content }) =>
			db
				.update(reminders)
				.set({
					...content,
					resolvedAt: null,
					resolvedReason: null,
					updatedAt: at,
				})
				.where(eq(reminders.id, id)),
		),
		...plan.resolve.map(({ id, reason }) =>
			db
				.update(reminders)
				.set({ resolvedAt: at, resolvedReason: reason, updatedAt: at })
				.where(and(eq(reminders.id, id), isNull(reminders.resolvedAt))),
		),
	];
	if (updates.length > 0) {
		await db.batch(updates as [(typeof updates)[number], ...typeof updates]);
	}

	for (const r of inserted) await sendReminderEmail(r);

	return {
		today,
		computed: computed.length,
		inserted: inserted.length,
		refreshed: plan.refresh.length,
		reopened: plan.reopen.length,
		resolved: plan.resolve.length,
	};
}

// ── Reads and owner actions ───────────────────────────────────────────

export interface ReminderView {
	id: string;
	subjectType: ReminderRow["subjectType"];
	subjectId: string;
	subjectLabel: string;
	kind: ReminderRow["kind"];
	severity: ReminderRow["severity"];
	title: string;
	detail: string;
	dueDate: string;
	remindOn: string;
	amountMinor: number | null;
	currency: string | null;
	state: ReminderState;
	snoozedUntil: string | null;
	dismissedAt: string | null;
	resolvedAt: string | null;
	resolvedReason: string | null;
}

/** Reminders that are not resolved, plus the most recently resolved ones. */
export async function listReminders(today: string): Promise<ReminderView[]> {
	const rows = await getDb()
		.select()
		.from(reminders)
		.where(eq(reminders.businessId, currentBusinessId()));
	const views = rows.map(
		(r): ReminderView => ({
			id: r.id,
			subjectType: r.subjectType,
			subjectId: r.subjectId,
			subjectLabel: r.subjectLabel,
			kind: r.kind,
			severity: r.severity,
			title: r.title,
			detail: r.detail,
			dueDate: r.dueDate,
			remindOn: r.remindOn,
			amountMinor: r.amountMinor,
			currency: r.currency,
			state: reminderState(r, today),
			snoozedUntil: r.snoozedUntil,
			dismissedAt: r.dismissedAt,
			resolvedAt: r.resolvedAt,
			resolvedReason: r.resolvedReason,
		}),
	);
	const active = views
		.filter((v) => v.state !== "resolved")
		.sort(compareReminders);
	const resolved = views
		.filter((v) => v.state === "resolved")
		.sort((a, b) => (b.resolvedAt ?? "").localeCompare(a.resolvedAt ?? ""))
		.slice(0, 20);
	return [...active, ...resolved];
}

/** Open = not resolved, not dismissed, not snoozed past `today`. */
export async function countOpenReminders(today: string): Promise<number> {
	const [row] = await getDb()
		.select({ n: sql<number>`count(*)` })
		.from(reminders)
		.where(
			and(
				eq(reminders.businessId, currentBusinessId()),
				isNull(reminders.resolvedAt),
				isNull(reminders.dismissedAt),
				or(isNull(reminders.snoozedUntil), lte(reminders.snoozedUntil, today)),
			),
		);
	return row?.n ?? 0;
}

const actionable = (id: string) =>
	and(
		eq(reminders.id, id),
		eq(reminders.businessId, currentBusinessId()),
		isNull(reminders.resolvedAt),
		isNull(reminders.dismissedAt),
	);

export async function snooze(
	id: string,
	days: SnoozeDays,
	today: string,
): Promise<void> {
	await getDb()
		.update(reminders)
		.set({
			snoozedUntil: snoozeUntil(today, days),
			updatedAt: new Date().toISOString(),
		})
		.where(actionable(id));
}

export async function dismiss(id: string, by: string): Promise<void> {
	const at = new Date().toISOString();
	await getDb()
		.update(reminders)
		.set({ dismissedAt: at, dismissedBy: by, updatedAt: at })
		.where(actionable(id));
}

/** Undo a snooze or a dismissal. */
export async function restore(id: string): Promise<void> {
	await getDb()
		.update(reminders)
		.set({
			snoozedUntil: null,
			dismissedAt: null,
			dismissedBy: null,
			updatedAt: new Date().toISOString(),
		})
		.where(
			and(
				eq(reminders.id, id),
				eq(reminders.businessId, currentBusinessId()),
				isNull(reminders.resolvedAt),
			),
		);
}
