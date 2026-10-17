/**
 * The model writes the dispute email, but it may only quote amounts that code
 * produced. Every dollar figure in the draft must be one of the allowed
 * amounts, and the code-computed total must appear.
 */
import { type Big, dec } from "#/lib/money/index.ts";

const DOLLAR = /\$\s?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)/g;

export function amountsIn(text: string): string[] {
	return [...text.matchAll(DOLLAR)].map((m) =>
		(m[1] as string).replaceAll(",", ""),
	);
}

export type GuardResult =
	| { ok: true }
	| { ok: false; unknown: string[]; missingTotal: boolean };

export function checkDraftAmounts(
	text: string,
	allowed: readonly string[],
	total: string,
): GuardResult {
	const allowedBig: Big[] = allowed.map((a) => dec(a));
	const found = amountsIn(text);
	const unknown = found.filter((a) => !allowedBig.some((b) => b.eq(dec(a))));
	const missingTotal = !found.some((a) => dec(a).eq(dec(total)));
	return unknown.length === 0 && !missingTotal
		? { ok: true }
		: { ok: false, unknown: [...new Set(unknown)], missingTotal };
}
