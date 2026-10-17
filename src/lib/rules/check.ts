import type { Finding, Invoice } from "#/lib/busyq/types.ts";
import { dec, lineAmount, sum, toMajor, toMinor } from "#/lib/money/index.ts";
import { distinctLines, lineSignature } from "./util.ts";

const money = (minor: number, currency: string) =>
	toMajor({ minor, currency }).toFixed(2);

/**
 * Checks that need no price list:
 * - duplicate_line: the same line billed again (impact = that line's amount)
 * - wrong_total, line level: printed line amount above quantity x unit price
 * - wrong_total, invoice level: stated total above the sum of printed lines
 * Each repeated copy is reported once and not re-checked for price or total.
 */
export function checkInvoice(invoice: Invoice): Finding[] {
	const findings: Finding[] = [];
	const { currency } = invoice;

	const seen = new Set<string>();
	for (const line of invoice.lines) {
		const key = lineSignature(line);
		if (!seen.has(key)) {
			seen.add(key);
			continue;
		}
		const impactMinor = toMinor(line.amount, currency).minor;
		findings.push({
			kind: "duplicate_line",
			invoiceId: invoice.id,
			lineNo: line.lineNo,
			paymentId: null,
			expected: null,
			actual: dec(line.amount).toFixed(2),
			impactMinor,
			currency,
			detail: `${line.item} (${line.quantity} ${line.unit}) is billed more than once; line ${line.lineNo} repeats an earlier line.`,
		});
	}

	for (const line of distinctLines(invoice)) {
		const expectedMinor = toMinor(
			lineAmount(line.quantity, line.unitPrice),
			currency,
		).minor;
		const printedMinor = toMinor(line.amount, currency).minor;
		if (printedMinor > expectedMinor) {
			findings.push({
				kind: "wrong_total",
				invoiceId: invoice.id,
				lineNo: line.lineNo,
				paymentId: null,
				expected: money(expectedMinor, currency),
				actual: money(printedMinor, currency),
				impactMinor: printedMinor - expectedMinor,
				currency,
				detail: `${line.item}: ${line.quantity} x ${line.unitPrice} is ${money(expectedMinor, currency)}, but the line shows ${money(printedMinor, currency)}.`,
			});
		}
	}

	const linesMinor = toMinor(
		sum(invoice.lines.map((l) => l.amount)),
		currency,
	).minor;
	const statedMinor = toMinor(invoice.statedTotal, currency).minor;
	if (statedMinor > linesMinor) {
		findings.push({
			kind: "wrong_total",
			invoiceId: invoice.id,
			lineNo: null,
			paymentId: null,
			expected: money(linesMinor, currency),
			actual: money(statedMinor, currency),
			impactMinor: statedMinor - linesMinor,
			currency,
			detail: `The lines add up to ${money(linesMinor, currency)}, but the stated total is ${money(statedMinor, currency)}.`,
		});
	}
	return findings;
}
