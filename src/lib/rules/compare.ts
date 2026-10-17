import type {
	Finding,
	Invoice,
	PriceRow,
	ToolError,
} from "#/lib/busyq/types.ts";
import { dec, toMinor } from "#/lib/money/index.ts";
import { lookupPrices, type PriceLookup } from "./lookup.ts";
import { distinctLines, fixed } from "./util.ts";

export type UnpricedLine = {
	lineNo: number;
	item: string;
	unit: string;
	error: ToolError;
};

/**
 * Compare each distinct line's billed unit price with the agreed price.
 * Lines with no agreed price are reported in `unpriced`, never guessed.
 * Only overcharges are findings; undercharges are not.
 */
export function compareLines(
	invoice: Invoice,
	prices: readonly PriceRow[],
	lookup: PriceLookup = lookupPrices,
): { findings: Finding[]; unpriced: UnpricedLine[] } {
	const findings: Finding[] = [];
	const unpriced: UnpricedLine[] = [];
	for (const line of distinctLines(invoice)) {
		const match = lookup(prices, invoice.vendor, line);
		if (!match.ok) {
			unpriced.push({
				lineNo: line.lineNo,
				item: line.item,
				unit: line.unit,
				error: match.error,
			});
			continue;
		}
		const billed = dec(line.unitPrice);
		const agreed = dec(match.data.agreedUnitPrice);
		if (!billed.gt(agreed)) continue;
		const impactMinor = toMinor(
			billed.minus(agreed).times(dec(line.quantity)),
			invoice.currency,
		).minor;
		if (impactMinor <= 0) continue;
		findings.push({
			kind: "overcharge",
			invoiceId: invoice.id,
			lineNo: line.lineNo,
			paymentId: null,
			expected: fixed(match.data.agreedUnitPrice),
			actual: fixed(line.unitPrice),
			impactMinor,
			currency: invoice.currency,
			detail: `${line.item}: billed ${fixed(line.unitPrice)} per ${line.unit}, agreed ${fixed(match.data.agreedUnitPrice)} per ${line.unit}, ${line.quantity} ${line.unit} billed.`,
		});
	}
	return { findings, unpriced };
}
