/**
 * Parse the generated data files (`data/*.csv`) into the shared types. Pure:
 * pass in the file text. Used by the review page and, later, the D1 seed.
 */
import {
	AnswerKeyRow,
	Invoice,
	Payment,
	PriceRow,
} from "./types.ts";

export function parseCsv(text: string): Record<string, string>[] {
	const lines = text.trim().split("\n");
	const head = (lines.shift() ?? "").split(",");
	return lines.map((line) => {
		const cells: string[] = [];
		let cur = "";
		let quoted = false;
		for (const ch of line) {
			if (ch === '"') quoted = !quoted;
			else if (ch === "," && !quoted) {
				cells.push(cur);
				cur = "";
			} else cur += ch;
		}
		cells.push(cur);
		return Object.fromEntries(head.map((h, i) => [h, cells[i] ?? ""]));
	});
}

const optional = (s: string | undefined) =>
	s === undefined || s === "" ? undefined : s;
const nullable = (s: string | undefined) =>
	s === undefined || s === "" ? null : s;

export const parsePriceList = (csv: string): PriceRow[] =>
	parseCsv(csv).map((r) =>
		PriceRow.parse({
			vendor: r.vendor,
			item: r.item,
			unit: r.unit,
			unitPrice: r.unit_price,
			currency: r.currency,
			packUnit: optional(r.pack_unit),
			packSize: optional(r.pack_size),
		}),
	);

export const parsePayments = (csv: string): Payment[] =>
	parseCsv(csv).map((r) =>
		Payment.parse({
			id: r.id,
			vendor: r.vendor,
			invoiceNumber: nullable(r.invoice_number),
			amount: r.amount,
			currency: r.currency,
			paidOn: r.paid_on,
			reference: r.reference,
		}),
	);

export const parseAnswerKey = (csv: string): AnswerKeyRow[] =>
	parseCsv(csv).map((r) =>
		AnswerKeyRow.parse({
			kind: r.kind,
			invoiceId: nullable(r.invoice_id),
			lineNo: r.line_no === "" ? null : Number(r.line_no),
			paymentId: nullable(r.payment_id),
			expectedImpactMinor: Number(r.expected_impact_minor),
			currency: r.currency,
		}),
	);

export const parseInvoice = (json: unknown): Invoice => Invoice.parse(json);
