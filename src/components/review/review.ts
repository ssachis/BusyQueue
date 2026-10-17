/**
 * Pure review model for the owner's page: runs the v1 rules over every invoice
 * and builds a vendor dispute draft from the findings. No I/O, no AI; every
 * amount comes from the rules engine.
 */

import type { Finding, Invoice, Payment, PriceRow } from "#/lib/busyq/types.ts";
import { formatMoney, type Money } from "#/lib/money/index.ts";
import {
	calculateImpact,
	checkInvoice,
	checkInvoicePayments,
	compareLines,
	findOrphanPayments,
	type UnpricedLine,
} from "#/lib/rules/index.ts";

export type ReviewStatus = "flagged" | "unpriced" | "clean";

export type InvoiceReview = {
	invoice: Invoice;
	findings: Finding[];
	/** Lines the v1 lookup could not price (vendor or unit spelled differently). */
	unpriced: UnpricedLine[];
	impact: Money;
	status: ReviewStatus;
};

export type ReviewModel = {
	rows: InvoiceReview[];
	orphans: Finding[];
	totals: {
		invoices: number;
		flagged: number;
		recoverable: Money;
		unpricedLines: number;
		orphanTotal: Money;
	};
};

export function buildReview(
	invoices: readonly Invoice[],
	prices: readonly PriceRow[],
	payments: readonly Payment[],
	currency = "USD",
): ReviewModel {
	const rows: InvoiceReview[] = invoices.map((invoice) => {
		const compared = compareLines(invoice, prices);
		const findings = [
			...compared.findings,
			...checkInvoice(invoice),
			...checkInvoicePayments(invoice, payments),
		];
		const status: ReviewStatus =
			findings.length > 0
				? "flagged"
				: compared.unpriced.length > 0
					? "unpriced"
					: "clean";
		return {
			invoice,
			findings,
			unpriced: compared.unpriced,
			impact: calculateImpact(findings, currency).total,
			status,
		};
	});
	const orphans = findOrphanPayments(invoices, payments);
	const all = [...rows.flatMap((r) => r.findings), ...orphans];
	return {
		rows,
		orphans,
		totals: {
			invoices: rows.length,
			flagged: rows.filter((r) => r.status === "flagged").length,
			recoverable: calculateImpact(all, currency).total,
			unpricedLines: rows.reduce((n, r) => n + r.unpriced.length, 0),
			orphanTotal: calculateImpact(orphans, currency).total,
		},
	};
}

const money = (minor: number, currency: string) =>
	formatMoney({ minor, currency });

/**
 * A plain-text dispute email built from the findings. A template until the
 * agent (which writes the prose) is connected; amounts are code-computed.
 */
export function disputeDraft(
	review: InvoiceReview,
	sender = "Food Services Office, Northfield Unified School District",
): string {
	const { invoice, findings, impact } = review;
	if (findings.length === 0) return "";
	const lines = findings.map(
		(f) => `- ${f.detail} (${money(f.impactMinor, f.currency)})`,
	);
	return [
		`Subject: Invoice ${invoice.invoiceNumber}: billing discrepancies`,
		"",
		`Hello ${invoice.vendor},`,
		"",
		`While reconciling invoice ${invoice.invoiceNumber} (${invoice.issueDate}), we found the following:`,
		"",
		...lines,
		"",
		`Total to credit or refund: ${money(impact.minor, impact.currency)}.`,
		"",
		"Please send a corrected invoice or a credit memo. Thank you,",
		sender,
	].join("\n");
}
