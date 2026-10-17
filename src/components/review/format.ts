/** Small display helpers shared by the review and dashboard pages. */
import { formatMoney } from "#/lib/money/index.ts";

export const money = (minor: number, currency = "USD") =>
	formatMoney({ minor, currency });

export const plural = (n: number, word: string, many = `${word}s`) =>
	`${n} ${n === 1 ? word : many}`;

/** Same text on server and client (no time-zone-dependent rendering). */
export const utc = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;

export const KIND_LABEL: Record<string, string> = {
	overcharge: "Overcharge",
	duplicate_line: "Duplicate line",
	wrong_total: "Wrong total",
	duplicate_payment: "Duplicate payment",
	orphan_payment: "Payment with no bill",
};
