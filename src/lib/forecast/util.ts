/**
 * Calendar, statistics and minor-unit helpers for the forecast engine.
 * Day counts and percentiles are whole days (plain integers, not money).
 * Money stays in integer minor units; the only rounding goes through `toMinor`.
 */
import { Decimal, toMajor, toMinor } from "#/lib/money/index.ts";
import { type CashItem, MixedCurrencyError } from "./types.ts";

const MS_PER_DAY = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whole days since 1970-01-01 (UTC) for an ISO date. Rejects impossible dates. */
export function toDay(iso: string): number {
	const m = ISO_DATE.exec(iso);
	if (!m) throw new TypeError(`Not an ISO date: "${iso}"`);
	const day =
		Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / MS_PER_DAY;
	if (fromDay(day) !== iso) throw new RangeError(`Invalid date: "${iso}"`);
	return day;
}

export function fromDay(day: number): string {
	return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

export const addDays = (iso: string, days: number): string =>
	fromDay(toDay(iso) + days);

/** `to − from` in whole days (negative when `to` is earlier). */
export const daysBetween = (from: string, to: string): number =>
	toDay(to) - toDay(from);

/** "2026-08-04" → "2026-08". */
export const monthOf = (iso: string): string => iso.slice(0, 7);

export function nextMonth(month: string): string {
	const [y, m] = month.split("-").map(Number) as [number, number];
	return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

export function previousMonth(month: string): string {
	const [y, m] = month.split("-").map(Number) as [number, number];
	return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** Last calendar day of a month, e.g. "2026-02" → "2026-02-28". */
export const lastDayOfMonth = (month: string): string =>
	addDays(`${nextMonth(month)}-01`, -1);

/** Every month from `from` to `to`, inclusive. Empty when `from > to`. */
export function monthsBetween(from: string, to: string): string[] {
	const out: string[] = [];
	for (let m = from; m <= to; m = nextMonth(m)) out.push(m);
	return out;
}

/**
 * Percentile of whole-day values: linear interpolation between closest ranks
 * (the "inclusive" method, as in Excel PERCENTILE.INC), then rounded half up
 * to a whole day (a .5 tie lands on the later day). `pct` is 0–100.
 */
export function percentileDays(values: readonly number[], pct: number): number {
	if (values.length === 0) throw new RangeError("No values");
	const sorted = [...values].sort((a, b) => a - b);
	// (n − 1) × pct / 100 is exact for the quartiles used here (multiples of 0.25).
	const h = ((sorted.length - 1) * pct) / 100;
	const lo = Math.floor(h);
	const a = sorted[lo] as number;
	const b = sorted[Math.min(lo + 1, sorted.length - 1)] as number;
	return Math.floor(a + (h - lo) * (b - a) + 0.5);
}

export function assertSafeMinor(minor: number): number {
	if (!Number.isSafeInteger(minor)) {
		throw new RangeError(`Minor units must be a safe integer, got ${minor}`);
	}
	return minor;
}

/** Exact sum of integer minor units. */
export const sumMinor = (values: readonly number[]): number =>
	values.reduce((acc, v) => assertSafeMinor(acc + v), 0);

/** `totalMinor / n`, rounded once (half up) to minor units via `toMinor`. */
export function averageMinor(
	totalMinor: number,
	n: number,
	currency: string,
): number {
	const major = toMajor({ minor: totalMinor, currency }).div(
		new Decimal(String(n)),
	);
	return toMinor(major, currency).minor;
}

/** `(to − from) / from` as a decimal string with 4 places; null when `from` is 0. */
export function changeRatio(
	fromMinor: number,
	toMinor_: number,
): string | null {
	if (fromMinor === 0) return null;
	return new Decimal(String(toMinor_ - fromMinor))
		.div(new Decimal(String(fromMinor)).abs())
		.toFixed(4);
}

/**
 * The one currency shared by every item. Throws `MixedCurrencyError` when
 * items disagree (or disagree with `expected`). Null for no items and no `expected`.
 */
export function singleCurrency(
	items: readonly Pick<CashItem, "currency">[],
	expected?: string,
): string | null {
	const set = new Set(items.map((i) => i.currency));
	if (expected) set.add(expected);
	if (set.size > 1) throw new MixedCurrencyError([...set].sort());
	return set.values().next().value ?? null;
}

/** Split items by currency so each group can be forecast on its own. */
export function groupByCurrency<T extends Pick<CashItem, "currency">>(
	items: readonly T[],
): Map<string, T[]> {
	const out = new Map<string, T[]>();
	for (const i of items) {
		const list = out.get(i.currency) ?? [];
		list.push(i);
		out.set(i.currency, list);
	}
	return new Map([...out].sort(([a], [b]) => a.localeCompare(b)));
}

/** Items the engine may know about on `asOf`: issued on or before it. */
export const knownAt = <T extends Pick<CashItem, "issueDate">>(
	items: readonly T[],
	asOf: string,
): T[] => items.filter((i) => i.issueDate <= asOf);

/** Stable sort key for counterparty maps. */
export const cpKey = (direction: string, counterparty: string) =>
	`${direction}\u0000${counterparty}`;
