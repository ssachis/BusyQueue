/**
 * Bills in versus money paid out, per calendar month. Pure and integer-only:
 * amounts are minor units.
 */
import { toMinor } from "#/lib/money/index.ts";
import type { Invoice, Payment } from "./types.ts";

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
