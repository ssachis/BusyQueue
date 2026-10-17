import type { Finding, Invoice, Payment } from "#/lib/busyq/types.ts";
import { toMinor } from "#/lib/money/index.ts";

const byDateThenId = (a: Payment, b: Payment) =>
	a.paidOn.localeCompare(b.paidOn) || a.id.localeCompare(b.id);

/** Payments for one invoice: every payment after the first is a duplicate. */
export function checkInvoicePayments(
	invoice: Invoice,
	payments: readonly Payment[],
): Finding[] {
	return payments
		.filter((p) => p.invoiceNumber === invoice.invoiceNumber)
		.sort(byDateThenId)
		.slice(1)
		.map((p) => ({
			kind: "duplicate_payment" as const,
			invoiceId: invoice.id,
			lineNo: null,
			paymentId: p.id,
			expected: null,
			actual: p.amount,
			impactMinor: toMinor(p.amount, p.currency).minor,
			currency: p.currency,
			detail: `Invoice ${invoice.invoiceNumber} was already paid; ${p.reference} paid ${p.amount} again on ${p.paidOn}.`,
		}));
}

/** Payments that cannot be tied to any known invoice. */
export function findOrphanPayments(
	invoices: readonly Invoice[],
	payments: readonly Payment[],
): Finding[] {
	const known = new Set(invoices.map((i) => i.invoiceNumber));
	return payments
		.filter((p) => p.invoiceNumber === null || !known.has(p.invoiceNumber))
		.map((p) => ({
			kind: "orphan_payment" as const,
			invoiceId: null,
			lineNo: null,
			paymentId: p.id,
			expected: null,
			actual: p.amount,
			impactMinor: toMinor(p.amount, p.currency).minor,
			currency: p.currency,
			detail: `${p.reference} paid ${p.amount} to ${p.vendor}${p.invoiceNumber ? ` against ${p.invoiceNumber}, which matches no invoice on file` : " with no invoice number"}.`,
		}));
}

/** Duplicate payments across all invoices plus orphan payments. */
export function checkPayments(
	invoices: readonly Invoice[],
	payments: readonly Payment[],
): Finding[] {
	return [
		...invoices.flatMap((i) => checkInvoicePayments(i, payments)),
		...findOrphanPayments(invoices, payments),
	];
}
