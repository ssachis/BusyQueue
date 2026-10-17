/**
 * Pure review model for the owner's page: runs the rules (v1 or v2 lookup) over every invoice
 * and builds a vendor dispute draft from the findings. No I/O, no AI; every
 * amount comes from the rules engine.
 */

import type {
	Finding,
	FindingKind,
	Invoice,
	Payment,
	PriceRow,
} from "#/lib/busyq/types.ts";
import { formatMoney, type Money, toMinor } from "#/lib/money/index.ts";
import {
	calculateImpact,
	checkInvoice,
	checkInvoicePayments,
	compareLines,
	findOrphanPayments,
	lookupPrices,
	type PriceLookup,
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
		/** Recoverable money split by cause, largest first. */
		byKind: { kind: FindingKind; count: number; impact: Money }[];
	};
};

export function buildReview(
	invoices: readonly Invoice[],
	prices: readonly PriceRow[],
	payments: readonly Payment[],
	currency = "USD",
	lookup: PriceLookup = lookupPrices,
): ReviewModel {
	const rows: InvoiceReview[] = invoices.map((invoice) => {
		const compared = compareLines(invoice, prices, lookup);
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
	const summary = calculateImpact(all, currency);
	return {
		rows,
		orphans,
		totals: {
			invoices: rows.length,
			flagged: rows.filter((r) => r.status === "flagged").length,
			recoverable: summary.total,
			unpricedLines: rows.reduce((n, r) => n + r.unpriced.length, 0),
			orphanTotal: calculateImpact(orphans, currency).total,
			byKind: Object.entries(summary.byKind)
				.map(([kind, v]) => ({
					kind: kind as FindingKind,
					count: v.count,
					impact: v.impact,
				}))
				.sort((a, b) => b.impact.minor - a.impact.minor),
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

export type CashflowMonth = {
	/** "2026-08" */
	month: string;
	/** Short month name for the axis, e.g. "Aug". */
	label: string;
	/** Bills received that month (stated invoice totals, by issue date), minor units. */
	billedMinor: number;
	/** Money paid out that month, by payment date, minor units. */
	paidMinor: number;
};

const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

/** Bills in versus payments out, per calendar month, oldest first. Integer minor units. */
export function cashflowByMonth(
	invoices: readonly Invoice[],
	payments: readonly Payment[],
): CashflowMonth[] {
	const byMonth = new Map<string, { billed: number; paid: number }>();
	const slot = (date: string) => {
		const key = date.slice(0, 7);
		const existing = byMonth.get(key) ?? { billed: 0, paid: 0 };
		byMonth.set(key, existing);
		return existing;
	};
	for (const inv of invoices) {
		slot(inv.issueDate).billed += toMinor(inv.statedTotal, inv.currency).minor;
	}
	for (const p of payments) {
		slot(p.paidOn).paid += toMinor(p.amount, p.currency).minor;
	}
	return [...byMonth.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([month, v]) => ({
			month,
			label: MONTHS[Number(month.slice(5, 7)) - 1] ?? month,
			billedMinor: v.billed,
			paidMinor: v.paid,
		}));
}
