/**
 * Reminder rules: contract notice windows, vendor bills coming due (money
 * out) and our issued invoices coming due (money in). Pure data shapes; the
 * sweep in `src/server/reminders-store.ts` stores what `computeReminders`
 * returns.
 *
 * Every reminder is identified by its idempotency key
 * `(subjectType, subjectId, kind, dueDate)`, so the daily sweep can run any
 * number of times without creating duplicates.
 */
import { z } from "zod";

export const SUBJECT_TYPES = ["contract", "vendor_bill", "document"] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

export const REMINDER_KINDS = [
	/** Inside `end − max(notice, 30 days)`, before the notice deadline / end. */
	"contract_expiring",
	/** Auto-renewing contract past its notice deadline but not yet renewed. */
	"contract_notice_missed",
	/** Non-renewing contract past its end date. */
	"contract_expired",
	/** Draft contract whose extracted prices nobody has confirmed yet. */
	"contract_unconfirmed",
	"bill_due_soon",
	"bill_overdue",
	"invoice_due_soon",
	"invoice_overdue",
] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

/** `critical` = act now, `warning` = coming up, `info` = for your information. */
export const SEVERITIES = ["critical", "warning", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** How many days ahead a bill or invoice counts as "due soon". */
export const DUE_SOON_DAYS = 7;
/** Contract reminders start at least this many days before the end date. */
export const MIN_CONTRACT_LEAD_DAYS = 30;
/** Inside this many days of the deadline a contract reminder turns `warning`. */
export const CONTRACT_WARNING_DAYS = 14;

export const SNOOZE_DAYS = [1, 3, 7] as const;
export type SnoozeDays = (typeof SNOOZE_DAYS)[number];

const IsoDate = z.iso.date();

// ── Inputs (one shape per subject; the store maps DB rows into these) ──

export interface ContractInput {
	id: string;
	title: string | null;
	vendorName: string | null;
	endDate: string | null;
	noticeDays: number | null;
	autoRenew: boolean | null;
	status: "draft" | "confirmed";
	/** ISO timestamp; its date anchors the "unconfirmed" reminder. */
	createdAt: string;
}

/** A vendor bill (money out). Payments are matched by invoice number. */
export interface VendorBillInput {
	id: string;
	invoiceNumber: string;
	vendorName: string;
	issueDate: string;
	dueDate: string | null;
	currency: string;
	/** Decimal string as printed. */
	statedTotal: string;
	payments: { amount: string; currency: string; paidOn: string }[];
}

/** One of our documents (money in). Only issued invoices are chased. */
export interface OutgoingInvoiceInput {
	id: string;
	type: string;
	status: "draft" | "issued" | "void";
	number: string | null;
	buyerName: string;
	date: string;
	dueDate: string | null;
	currency: string;
	totalMinor: number | null;
	payments: {
		amountMinor: number;
		currency: string;
		receivedOn: string;
		voidedAt: string | null;
	}[];
}

export interface ReminderInputs {
	contracts: ContractInput[];
	vendorBills: VendorBillInput[];
	outgoingInvoices: OutgoingInvoiceInput[];
}

// ── Output ────────────────────────────────────────────────────────────

/** A reminder as the rules compute it on a given day. */
export interface ComputedReminder {
	subjectType: SubjectType;
	subjectId: string;
	kind: ReminderKind;
	/** The date the reminder is about (deadline, due date, end date). Part of the key. */
	dueDate: string;
	/** The first day this reminder applies. */
	remindOn: string;
	severity: Severity;
	/** Short label for the subject, e.g. "HF-1024 · Harbor Foods". */
	subjectLabel: string;
	title: string;
	detail: string;
	/** Outstanding amount from code (integer minor units), when money is involved. */
	amountMinor: number | null;
	currency: string | null;
}

export const ReminderKey = z.object({
	subjectType: z.enum(SUBJECT_TYPES),
	subjectId: z.string().min(1),
	kind: z.enum(REMINDER_KINDS),
	dueDate: IsoDate,
});
export type ReminderKey = z.infer<typeof ReminderKey>;

/** What the rules concluded for one subject, reminders or not. */
export interface SubjectOutcome {
	subjectType: SubjectType;
	subjectId: string;
	reminders: ComputedReminder[];
	/** Why nothing (more) is due, e.g. "paid", "confirmed". Used when auto-resolving. */
	status: string;
}

/** The stored fields the sweep plan needs. */
export interface StoredReminder extends ReminderKey {
	id: string;
	severity: Severity;
	title: string;
	detail: string;
	subjectLabel: string;
	amountMinor: number | null;
	currency: string | null;
	snoozedUntil: string | null;
	dismissedAt: string | null;
	resolvedAt: string | null;
}

/** Where a stored reminder stands on a given day. */
export type ReminderState = "open" | "snoozed" | "dismissed" | "resolved";
