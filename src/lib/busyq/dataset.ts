/**
 * Parsers for the generated dataset in `data/` (see scripts/generate-data.ts).
 * Pure: text in, validated shared types out. File reading lives in
 * scripts/lib/dataset.ts so this stays usable anywhere.
 *
 * CSV columns are snake_case; the shared types are camelCase.
 */
import { AnswerKeyRow, Invoice, Payment, PriceRow } from "./types.ts";

/** RFC 4180 CSV: quoted fields, "" escapes, commas and newlines inside quotes. */
export function parseCsv(text: string): Record<string, string>[] {
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (quoted) {
			if (ch === '"' && text[i + 1] === '"') {
				cell += '"';
				i++;
			} else if (ch === '"') quoted = false;
			else cell += ch;
		} else if (ch === '"') quoted = true;
		else if (ch === ",") {
			row.push(cell);
			cell = "";
		} else if (ch === "\n" || ch === "\r") {
			if (ch === "\r" && text[i + 1] === "\n") i++;
			row.push(cell);
			rows.push(row);
			row = [];
			cell = "";
		} else cell += ch;
	}
	if (cell !== "" || row.length > 0) {
		row.push(cell);
		rows.push(row);
	}
	const [header, ...body] = rows.filter((r) => r.some((c) => c !== ""));
	if (!header) return [];
	return body.map((cells, n) => {
		if (cells.length !== header.length) {
			throw new Error(
				`CSV row ${n + 2} has ${cells.length} cells, expected ${header.length}`,
			);
		}
		return Object.fromEntries(header.map((h, i) => [h, cells[i] as string]));
	});
}

const optional = (s: string | undefined) => (s ? s : undefined);
const nullable = (s: string | undefined) => (s ? s : null);
const intOrNull = (s: string | undefined) => (s ? Number(s) : null);

export function parsePriceListCsv(text: string): PriceRow[] {
	return parseCsv(text).map((r) =>
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
}

export function parsePaymentsCsv(text: string): Payment[] {
	return parseCsv(text).map((r) =>
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
}

export function parseAnswerKeyCsv(text: string): AnswerKeyRow[] {
	return parseCsv(text).map((r) =>
		AnswerKeyRow.parse({
			kind: r.kind,
			invoiceId: nullable(r.invoice_id),
			lineNo: intOrNull(r.line_no),
			paymentId: nullable(r.payment_id),
			expectedImpactMinor: Number(r.expected_impact_minor),
			currency: r.currency,
		}),
	);
}

export function parseInvoiceJson(text: string): Invoice {
	return Invoice.parse(JSON.parse(text));
}

export interface Dataset {
	priceList: PriceRow[];
	invoices: Invoice[];
	payments: Payment[];
	answerKey: AnswerKeyRow[];
}
