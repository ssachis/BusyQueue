/**
 * D1 rows → forecast engine inputs. Pure: no I/O, no rounding of money (minor
 * units are converted back to exact decimal strings), so the same rows always
 * give the same `CashItem`s.
 *
 * - Vendor bills (BusyQ `invoices`) are cash **out**. A bill counts as paid on
 *   the date of its first payment with the same invoice number (accounts
 *   payable pays a bill in one go; duplicate payments don't reopen it).
 * - Issued outgoing invoices (`documents` of type "invoice") are cash **in**.
 *   Drafts and voided documents are skipped, and so are voided payments. An
 *   invoice is paid on the day its payments first add up to its total; a
 *   partly paid invoice becomes two items: the part received (paid on its
 *   last payment) and the open balance.
 */
import type { CashItem, LineObservation } from "#/lib/forecast/index.ts";
import { toMajor } from "#/lib/money/index.ts";
import { resolveVendor } from "#/lib/rules/aliases.ts";

/** `invoices` columns the forecast needs. */
export interface BillRow {
	id: string;
	vendorName: string;
	invoiceNumber: string;
	issueDate: string;
	dueDate: string | null;
	currency: string;
	statedTotal: string;
}

/** `payments` columns the forecast needs. */
export interface BillPaymentRow {
	invoiceNumber: string | null;
	paidOn: string;
}

/** `invoice_lines` columns the forecast needs. */
export interface BillLineRow {
	invoiceId: string;
	lineNo: number;
	item: string;
	unit: string;
	unitPrice: string;
}

/** `documents` columns the forecast needs (buyer name from the JSON snapshot). */
export interface DocumentRow {
	id: string;
	type: string;
	status: string;
	number: string | null;
	date: string;
	dueDate: string | null;
	currency: string;
	totalMinor: number | null;
	buyerName: string;
}

/** `document_payments` columns the forecast needs. */
export interface DocumentPaymentRow {
	documentId: string;
	amountMinor: number;
	receivedOn: string;
	voidedAt: string | null;
}

/** What the page shows for an item id, and where it links. */
export interface ItemLabel {
	label: string;
	/** Vendor bill to open on the review page (`/?v=v2&invoice=<id>`); null otherwise. */
	reviewInvoiceId: string | null;
}

/** Printed vendor name → canonical price-list name (the v2 alias rules). */
export function canonicalVendor(
	printed: string,
	canonical: readonly string[],
): string {
	const r = resolveVendor(printed, canonical);
	return r.ok ? r.vendor : printed.trim();
}

/** "inv-1023#1" → "inv-1023" (line observation refs are `<invoiceId>#<lineNo>`). */
export function invoiceIdFromRef(ref: string | null): string | null {
	if (!ref) return null;
	const id = ref.split("#")[0];
	return id ? id : null;
}

const decimal = (minor: number, currency: string) =>
	toMajor({ minor, currency }).toFixed();

/** Vendor bills as cash-out items. */
export function billsToCashItems(
	bills: readonly BillRow[],
	payments: readonly BillPaymentRow[],
	canonicalVendors: readonly string[],
): CashItem[] {
	const firstPaid = new Map<string, string>();
	for (const p of payments) {
		if (!p.invoiceNumber) continue;
		const prev = firstPaid.get(p.invoiceNumber);
		if (!prev || p.paidOn < prev) firstPaid.set(p.invoiceNumber, p.paidOn);
	}
	return bills.map((b) => ({
		id: b.id,
		direction: "out",
		counterparty: canonicalVendor(b.vendorName, canonicalVendors),
		currency: b.currency,
		amount: b.statedTotal,
		issueDate: b.issueDate,
		dueDate: b.dueDate,
		paidOn: firstPaid.get(b.invoiceNumber) ?? null,
	}));
}

/** Billed unit prices from vendor bill lines, for price-rise alerts. */
export function billLinesToObservations(
	bills: readonly BillRow[],
	lines: readonly BillLineRow[],
	canonicalVendors: readonly string[],
): LineObservation[] {
	const byId = new Map(bills.map((b) => [b.id, b]));
	return lines.flatMap((l) => {
		const bill = byId.get(l.invoiceId);
		if (!bill) return [];
		return [
			{
				vendor: canonicalVendor(bill.vendorName, canonicalVendors),
				item: l.item,
				unit: l.unit,
				unitPrice: l.unitPrice,
				date: bill.issueDate,
				currency: bill.currency,
				ref: `${bill.id}#${l.lineNo}`,
			},
		];
	});
}

/** Id of the "received so far" part of a partly paid outgoing invoice. */
export const receivedPartId = (documentId: string) => `${documentId}~received`;

/** Issued outgoing invoices as cash-in items (see the module comment). */
export function documentsToCashItems(
	documents: readonly DocumentRow[],
	payments: readonly DocumentPaymentRow[],
): CashItem[] {
	const live = new Map<string, DocumentPaymentRow[]>();
	for (const p of payments) {
		if (p.voidedAt) continue;
		live.set(p.documentId, [...(live.get(p.documentId) ?? []), p]);
	}
	return documents.flatMap((d): CashItem[] => {
		if (d.type !== "invoice" || d.status !== "issued") return [];
		if (d.totalMinor === null || d.totalMinor <= 0) return [];
		const base = {
			direction: "in" as const,
			counterparty: d.buyerName.trim() || "Unknown client",
			currency: d.currency,
			issueDate: d.date,
			dueDate: d.dueDate,
		};
		const paid = (live.get(d.id) ?? []).sort((a, b) =>
			a.receivedOn.localeCompare(b.receivedOn),
		);
		let received = 0;
		for (const p of paid) {
			received += p.amountMinor;
			if (received >= d.totalMinor) {
				return [
					{
						...base,
						id: d.id,
						amount: decimal(d.totalMinor, d.currency),
						paidOn: p.receivedOn,
					},
				];
			}
		}
		const open: CashItem = {
			...base,
			id: d.id,
			amount: decimal(d.totalMinor - received, d.currency),
			paidOn: null,
		};
		const last = paid[paid.length - 1];
		if (received <= 0 || !last) return [open];
		return [
			{
				...base,
				id: receivedPartId(d.id),
				amount: decimal(received, d.currency),
				paidOn: last.receivedOn,
			},
			open,
		];
	});
}

/** Labels and links for every item id the page can show. */
export function itemLabels(
	bills: readonly BillRow[],
	documents: readonly DocumentRow[],
): Record<string, ItemLabel> {
	const labels: Record<string, ItemLabel> = {};
	for (const b of bills) {
		labels[b.id] = { label: b.invoiceNumber, reviewInvoiceId: b.id };
	}
	for (const d of documents) {
		const label = d.number ?? d.id;
		labels[d.id] = { label, reviewInvoiceId: null };
		labels[receivedPartId(d.id)] = {
			label: `${label} (received part)`,
			reviewInvoiceId: null,
		};
	}
	return labels;
}

export interface CurrencyPick {
	/** The currency forecast; null when there are no items at all. */
	currency: string | null;
	/** Items in other currencies, left out (amounts are never summed across currencies). */
	excluded: { currency: string; count: number }[];
}

/**
 * The engine forecasts one currency at a time. Prefer the business currency
 * when it has items; otherwise the currency with the most items (ties by code).
 */
export function pickCurrency(
	items: readonly Pick<CashItem, "currency">[],
	preferred: string | null,
): CurrencyPick {
	const counts = new Map<string, number>();
	for (const i of items)
		counts.set(i.currency, (counts.get(i.currency) ?? 0) + 1);
	const ranked = [...counts.entries()].sort(
		([a, x], [b, y]) => y - x || a.localeCompare(b),
	);
	const currency =
		preferred && counts.has(preferred)
			? preferred
			: (ranked[0]?.[0] ?? preferred);
	return {
		currency,
		excluded: ranked
			.filter(([c]) => c !== currency)
			.map(([c, count]) => ({ currency: c, count })),
	};
}

const nextDay = (iso: string) => {
	const d = new Date(`${iso}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + 1);
	return d.toISOString().slice(0, 10);
};

export interface AsOfDefault {
	asOf: string;
	/** "today", or "after_latest" when documents are dated today or later. */
	reason: "today" | "after_latest";
	latestIssueDate: string | null;
}

/**
 * Default "as of" date: today, unless documents are dated today or later
 * (sample data runs ahead of the calendar), then the day after the latest one
 * so every document is known and the forecast starts where the data ends.
 */
export function defaultAsOf(
	today: string,
	issueDates: readonly string[],
): AsOfDefault {
	const latest = issueDates.reduce<string | null>(
		(max, d) => (max === null || d > max ? d : max),
		null,
	);
	if (latest !== null && latest >= today) {
		return {
			asOf: nextDay(latest),
			reason: "after_latest",
			latestIssueDate: latest,
		};
	}
	return { asOf: today, reason: "today", latestIssueDate: latest };
}
