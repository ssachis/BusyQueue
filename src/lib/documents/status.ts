/**
 * Payment state of a document (#17). Pure: no I/O, no clock.
 *
 * Only the lifecycle (draft / issued / void) is stored. Everything else the
 * UI shows (partially paid, paid, overdue, the balance) is derived here from
 * the frozen total and the document's payments, so it can never drift from
 * the payments themselves.
 *
 * Rules:
 * - Invoices and proformas take payments. Quotes and delivery notes are not
 *   bills; a receipt already records a payment; a credit note is money owed
 *   back to the client and is settled against an invoice, not paid (refunds
 *   are out of scope). Those types show their lifecycle status only.
 * - `void` wins over everything. A draft is always `draft`.
 * - Issued: paid >= total → `paid` (so a zero-total invoice is `paid` at
 *   once: there is nothing to collect); some paid → `partially_paid`;
 *   otherwise `issued`. If the balance is still positive and the due date is
 *   before `today` (strictly), the display status is `overdue` and
 *   `overdue` is true.
 * - Voided payments are ignored. A payment in another currency is an error,
 *   never converted.
 */
import { z } from "zod";
import {
	DECIMAL_PATTERN,
	isCurrencyCode,
	type Money,
	toMinor,
} from "#/lib/money/index.ts";
import type { DisplayStatus, DocumentStatus, DocumentType } from "./types.ts";

/** Document types that can receive payments. */
export const PAYABLE_TYPES = [
	"invoice",
	"proforma",
] as const satisfies readonly DocumentType[];

export function takesPayments(type: DocumentType): boolean {
	return (PAYABLE_TYPES as readonly string[]).includes(type);
}

export interface PaymentLike {
	amountMinor: number;
	currency: string;
	/** Voided payments are kept for the record but don't count. */
	voidedAt?: string | null;
}

export interface StatusInput {
	type: DocumentType;
	status: DocumentStatus;
	/** Frozen on issue; null for drafts. */
	totalMinor: number | null;
	currency: string;
	/** ISO date (YYYY-MM-DD) or null when there are no payment terms. */
	dueDate: string | null;
	payments: readonly PaymentLike[];
	/** ISO date (YYYY-MM-DD) to judge "overdue" against. */
	today: string;
}

export interface PaymentSummary {
	displayStatus: DisplayStatus;
	/** Sum of non-voided payments, in minor units. */
	paidMinor: number;
	/** What is still owed. 0 for drafts, void and non-payable documents. */
	balanceMinor: number;
	overdue: boolean;
}

export class PaymentError extends Error {
	constructor(
		readonly code:
			| "currency_mismatch"
			| "invalid_amount"
			| "not_issued"
			| "not_payable"
			| "overpayment"
			| "nothing_owed"
			| "invalid_input",
		message: string,
	) {
		super(message);
		this.name = "PaymentError";
	}
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function assertSafeMinor(value: number, what: string): void {
	if (!Number.isSafeInteger(value)) {
		throw new PaymentError(
			"invalid_amount",
			`${what} must be whole minor units, got ${value}`,
		);
	}
}

/** Sum of the active payments, rejecting any in another currency. */
export function paidMinor(
	payments: readonly PaymentLike[],
	currency: string,
): number {
	let total = 0;
	for (const p of payments) {
		if (p.voidedAt) continue;
		if (p.currency !== currency) {
			throw new PaymentError(
				"currency_mismatch",
				`Payment in ${p.currency} on a ${currency} document`,
			);
		}
		assertSafeMinor(p.amountMinor, "Payment amount");
		total += p.amountMinor;
		assertSafeMinor(total, "Paid total");
	}
	return total;
}

export function paymentSummary(input: StatusInput): PaymentSummary {
	if (!ISO_DATE.test(input.today)) {
		throw new PaymentError(
			"invalid_input",
			`Not an ISO date: "${input.today}"`,
		);
	}
	if (input.dueDate !== null && !ISO_DATE.test(input.dueDate)) {
		throw new PaymentError(
			"invalid_input",
			`Not an ISO date: "${input.dueDate}"`,
		);
	}
	const paid = paidMinor(input.payments, input.currency);

	if (input.status === "draft") {
		return {
			displayStatus: "draft",
			paidMinor: 0,
			balanceMinor: 0,
			overdue: false,
		};
	}
	if (input.status === "void") {
		return {
			displayStatus: "void",
			paidMinor: paid,
			balanceMinor: 0,
			overdue: false,
		};
	}
	if (input.totalMinor === null) {
		throw new PaymentError("invalid_input", "An issued document needs a total");
	}
	assertSafeMinor(input.totalMinor, "Total");
	if (!takesPayments(input.type)) {
		return {
			displayStatus: "issued",
			paidMinor: 0,
			balanceMinor: 0,
			overdue: false,
		};
	}

	const balance = input.totalMinor - paid;
	if (balance <= 0) {
		return {
			displayStatus: "paid",
			paidMinor: paid,
			balanceMinor: balance,
			overdue: false,
		};
	}
	// ISO dates compare correctly as strings.
	const overdue = input.dueDate !== null && input.dueDate < input.today;
	return {
		displayStatus: overdue ? "overdue" : paid > 0 ? "partially_paid" : "issued",
		paidMinor: paid,
		balanceMinor: balance,
		overdue,
	};
}

/** Context needed to accept a new payment against a document. */
export interface PaymentTarget {
	type: DocumentType;
	status: DocumentStatus;
	currency: string;
	balanceMinor: number;
}

/**
 * Check a payment the user typed (a decimal string in major units) and
 * convert it to minor units in the document's currency. Throws PaymentError.
 */
export function assessPayment(
	target: PaymentTarget,
	amount: string,
	currency: string,
): Money {
	if (target.status !== "issued") {
		throw new PaymentError(
			"not_issued",
			target.status === "void"
				? "This document is void; it can't take payments"
				: "Issue the document before recording payments",
		);
	}
	if (!takesPayments(target.type)) {
		throw new PaymentError(
			"not_payable",
			"Only invoices and proformas take payments",
		);
	}
	if (currency !== target.currency) {
		throw new PaymentError(
			"currency_mismatch",
			`This document is in ${target.currency}; the payment is in ${currency}`,
		);
	}
	const trimmed = amount.trim();
	if (!DECIMAL_PATTERN.test(trimmed)) {
		throw new PaymentError("invalid_amount", "Use an amount like 125.50");
	}
	let money: Money;
	let up: Money;
	try {
		money = toMinor(trimmed, target.currency, "down");
		up = toMinor(trimmed, target.currency, "up");
	} catch {
		throw new PaymentError("invalid_amount", "That amount is too large");
	}
	// Payments are exact: no rounding of what the user typed.
	if (money.minor !== up.minor) {
		throw new PaymentError(
			"invalid_amount",
			`Too many decimal places for ${target.currency}`,
		);
	}
	if (money.minor <= 0) {
		throw new PaymentError("invalid_amount", "The amount must be more than 0");
	}
	if (target.balanceMinor <= 0) {
		throw new PaymentError("nothing_owed", "This document is already paid");
	}
	if (money.minor > target.balanceMinor) {
		throw new PaymentError(
			"overpayment",
			"The amount is more than the balance due",
		);
	}
	return money;
}

// ── Boundary schemas (shared by the panel and the server functions) ──────────

export const PAYMENT_METHODS = [
	"bank_transfer",
	"check",
	"card",
	"cash",
	"upi",
	"other",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
	bank_transfer: "Bank transfer / ACH",
	check: "Check",
	card: "Card",
	cash: "Cash",
	upi: "UPI",
	other: "Other",
};

const IsoDate = z.iso.date();
const optionalText = (max: number) =>
	z
		.string()
		.trim()
		.max(max)
		.optional()
		.transform((v) => (v ? v : undefined));

const PaymentDetails = z.object({
	documentId: z.string().min(1),
	receivedOn: IsoDate,
	method: z.enum(PAYMENT_METHODS).optional(),
	reference: optionalText(100),
	note: optionalText(500),
});

export const RecordPaymentInput = PaymentDetails.extend({
	/** Major units as typed, e.g. "125.50". Converted with `toMinor`. */
	amount: z
		.string()
		.trim()
		.regex(/^\d+(\.\d+)?$/, "Use a positive amount like 125.50"),
	currency: z.string().refine(isCurrencyCode, "Use an ISO 4217 code like USD"),
});
export type RecordPaymentInput = z.input<typeof RecordPaymentInput>;

/** Mark as paid: a payment for exactly the remaining balance. */
export const MarkPaidInput = PaymentDetails;
export type MarkPaidInput = z.input<typeof MarkPaidInput>;

export const VoidPaymentInput = z.object({
	documentId: z.string().min(1),
	paymentId: z.string().min(1),
	reason: optionalText(500),
});
export type VoidPaymentInput = z.input<typeof VoidPaymentInput>;

export const VoidDocumentInput = z.object({
	documentId: z.string().min(1),
	reason: z.string().trim().min(1, "Give a reason").max(500),
});
export type VoidDocumentInput = z.input<typeof VoidDocumentInput>;

export const DisplayStatusesInput = z.object({
	ids: z.array(z.string().min(1)).max(500),
	/** The viewer's local date; defaults to the server's UTC date. */
	today: IsoDate.optional(),
});
export type DisplayStatusesInput = z.input<typeof DisplayStatusesInput>;

/** UTC calendar date of an instant, as YYYY-MM-DD. */
export function isoDay(at: Date): string {
	return at.toISOString().slice(0, 10);
}

/**
 * Payment dates may be at most one day ahead of the server's UTC date, so a
 * user east of UTC can record a payment for their own "today".
 */
export function isFutureDate(day: string, now: Date): boolean {
	const limit = new Date(now.getTime() + 24 * 60 * 60 * 1000);
	return day > isoDay(limit);
}
