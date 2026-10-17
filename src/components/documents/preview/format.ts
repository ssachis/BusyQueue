/** Display helpers for documents. Pure; no floats, no time-zone dependence. */
import type {
	DisplayStatus,
	DocumentStatus,
	DocumentType,
} from "#/lib/documents/types.ts";
import { isDecimalString, minorUnitDigits } from "#/lib/money/index.ts";
import type { TaxComponentCode } from "#/lib/tax/index.ts";

export const TYPE_LABEL: Record<DocumentType, string> = {
	invoice: "Invoice",
	quote: "Quote",
	proforma: "Proforma",
	credit_note: "Credit note",
	receipt: "Receipt",
	delivery_note: "Delivery note",
};

export const TYPE_DESCRIPTION: Record<DocumentType, string> = {
	invoice: "Bill a client for goods or services delivered.",
	quote: "Offer prices before the work is agreed.",
	proforma: "A preliminary invoice, e.g. to request an advance.",
	credit_note: "Reduce or cancel an amount already invoiced.",
	receipt: "Acknowledge a payment you received.",
	delivery_note: "List what was delivered, without prices owed.",
};

export const STATUS_LABEL: Record<DocumentStatus, string> = {
	draft: "Draft",
	issued: "Issued",
	void: "Void",
};

export const STATUS_VARIANT: Record<
	DocumentStatus,
	"outline" | "info" | "destructive"
> = {
	draft: "outline",
	issued: "info",
	void: "destructive",
};

/** Derived status (lifecycle + payments) as the list and header show it. */
export const DISPLAY_STATUS_LABEL: Record<DisplayStatus, string> = {
	draft: "Draft",
	issued: "Issued",
	partially_paid: "Partially paid",
	paid: "Paid",
	overdue: "Overdue",
	void: "Void",
};

export const DISPLAY_STATUS_VARIANT: Record<
	DisplayStatus,
	"outline" | "info" | "warning" | "success" | "destructive" | "secondary"
> = {
	draft: "outline",
	issued: "info",
	partially_paid: "warning",
	paid: "success",
	overdue: "destructive",
	void: "secondary",
};

const COMPONENT_LABEL: Record<TaxComponentCode, string> = {
	CGST: "CGST",
	SGST: "SGST",
	UTGST: "UTGST",
	IGST: "IGST",
	VAT: "VAT",
	GST: "GST",
	HST: "HST",
	PST: "PST",
	QST: "QST",
	SALES_TAX: "Sales tax",
};

/** e.g. "CGST 9%", "Sales tax 7.25%". */
export function taxLabel(code: TaxComponentCode, rate: string): string {
	return `${COMPONENT_LABEL[code]} ${rate}%`;
}

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

/** "2026-10-17" → "17 Oct 2026"; anything else is returned as is. */
export function formatDate(iso: string | null | undefined): string {
	if (!iso) return "";
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
	const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
	if (!m || !month) return iso;
	return `${Number(m[3])} ${month} ${m[1]}`;
}

/**
 * A decimal string (unit price, discount) as currency, keeping every digit
 * the user typed beyond the currency's minor units (e.g. $0.125). Intl
 * formats numeric strings exactly, so no float is involved.
 */
export function formatDecimalMoney(value: string, currency: string): string {
	if (!isDecimalString(value)) return value;
	try {
		const digits = minorUnitDigits(currency);
		const typed = value.split(".")[1]?.length ?? 0;
		return new Intl.NumberFormat("en-US", {
			style: "currency",
			currency,
			minimumFractionDigits: digits,
			maximumFractionDigits: Math.min(20, Math.max(digits, typed)),
		}).format(value as unknown as number);
	} catch {
		return `${value} ${currency}`;
	}
}

/** A quantity as typed, grouped for reading (e.g. "1,200.5"). */
export function formatQuantity(value: string): string {
	if (!isDecimalString(value)) return value;
	const typed = value.split(".")[1]?.length ?? 0;
	return new Intl.NumberFormat("en-US", {
		maximumFractionDigits: Math.min(20, typed),
	}).format(value as unknown as number);
}
