import type { Invoice, InvoiceLine } from "#/lib/busyq/types.ts";
import { dec } from "#/lib/money/index.ts";

/** Two lines with the same signature are the same line billed twice. */
export const lineSignature = (l: InvoiceLine): string =>
	[
		l.item,
		dec(l.quantity).toString(),
		l.unit,
		dec(l.unitPrice).toString(),
		dec(l.amount).toString(),
	].join("|");

/** The lines worth checking: the first copy of each distinct line, in order. */
export function distinctLines(invoice: Invoice): InvoiceLine[] {
	const seen = new Set<string>();
	return invoice.lines.filter((l) => {
		const key = lineSignature(l);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/** Decimal string with at least two places ("2.1" -> "2.10") for display. */
export function fixed(value: string): string {
	const d = dec(value);
	const places = (d.toString().split(".")[1] ?? "").length;
	return d.toFixed(Math.max(2, places));
}
