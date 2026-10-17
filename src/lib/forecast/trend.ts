import { toMinor } from "#/lib/money/index.ts";
import type { CashItem, Direction } from "./types.ts";
import {
	averageMinor,
	changeRatio,
	knownAt,
	lastDayOfMonth,
	monthOf,
	monthsBetween,
	previousMonth,
	singleCurrency,
	sumMinor,
} from "./util.ts";

/** Fewer complete months than this and the trend reports "not_enough_data". */
export const MIN_TREND_MONTHS = 3;

export const TREND_METHOD =
	"Items are counted in the month of their issue date (billed, not paid). Only complete months count: " +
	"from the month of the earliest item (or the given history start) up to the last month that ended " +
	"on or before the as-of date. Month-over-month change compares the latest complete month with the " +
	"one before it. The trailing band is the average, lowest and highest of the last 3 complete months; " +
	`the average is rounded once to minor units. With fewer than ${MIN_TREND_MONTHS} complete months ` +
	"no trend numbers are produced (not enough data).";

export interface MonthTotal {
	month: string;
	totalMinor: number;
	count: number;
}

export interface TrendSummary {
	latestMonth: string;
	latestMinor: number;
	previousMonth: string;
	previousMinor: number;
	momChangeMinor: number;
	/** `(latest − previous) / previous`, 4 decimals; null when previous is 0. */
	momChangeRatio: string | null;
	trailing: {
		months: string[];
		averageMinor: number;
		lowMinor: number;
		highMinor: number;
	};
}

export interface TrendSeries {
	/** "all", a counterparty name, or a category. */
	key: string;
	/** Actual totals per complete month (observed history, not a projection). */
	months: MonthTotal[];
	/** Null when the trend has `not_enough_data`. */
	summary: TrendSummary | null;
}

export interface DirectionTrend {
	overall: TrendSeries;
	byCounterparty: TrendSeries[];
	/** Only items that carry a `category`. */
	byCategory: TrendSeries[];
}

export interface Trend {
	status: "ok" | "not_enough_data";
	asOf: string;
	currency: string | null;
	completeMonths: string[];
	requiredMonths: number;
	/** Direction "out". */
	spend: DirectionTrend;
	/** Direction "in". */
	revenue: DirectionTrend;
	method: string;
}

export interface TrendOptions {
	asOf: string;
	/** First day of known history; defaults to the earliest issue date. */
	historyStart?: string;
	/** Required currency; items in any other currency throw `MixedCurrencyError`. */
	currency?: string;
}

/**
 * Months of history that are complete on `asOf`: from the month of
 * `historyStart` (default: earliest issue date among known items) to the last
 * month whose final day is on or before `asOf`.
 */
export function completeMonths(
	items: readonly CashItem[],
	asOf: string,
	historyStart?: string,
): string[] {
	const known = knownAt(items, asOf);
	const start =
		historyStart ??
		known.reduce<string | null>(
			(min, i) => (min === null || i.issueDate < min ? i.issueDate : min),
			null,
		);
	if (start === null) return [];
	const current = monthOf(asOf);
	const last =
		lastDayOfMonth(current) > asOf ? previousMonth(current) : current;
	return monthsBetween(monthOf(start), last);
}

/** Totals per month (zero-filled) for the given items, in minor units. */
export function monthlyTotals(
	items: readonly CashItem[],
	months: readonly string[],
): MonthTotal[] {
	const byMonth = new Map<string, { amounts: number[] }>(
		months.map((m) => [m, { amounts: [] }]),
	);
	for (const item of items) {
		byMonth
			.get(monthOf(item.issueDate))
			?.amounts.push(toMinor(item.amount, item.currency).minor);
	}
	return months.map((month) => {
		const amounts = byMonth.get(month)?.amounts ?? [];
		return { month, totalMinor: sumMinor(amounts), count: amounts.length };
	});
}

function summarise(
	months: readonly MonthTotal[],
	currency: string,
): TrendSummary {
	const latest = months[months.length - 1] as MonthTotal;
	const previous = months[months.length - 2] as MonthTotal;
	const trailing = months.slice(-MIN_TREND_MONTHS);
	const totals = trailing.map((m) => m.totalMinor);
	return {
		latestMonth: latest.month,
		latestMinor: latest.totalMinor,
		previousMonth: previous.month,
		previousMinor: previous.totalMinor,
		momChangeMinor: latest.totalMinor - previous.totalMinor,
		momChangeRatio: changeRatio(previous.totalMinor, latest.totalMinor),
		trailing: {
			months: trailing.map((m) => m.month),
			averageMinor: averageMinor(sumMinor(totals), totals.length, currency),
			lowMinor: Math.min(...totals),
			highMinor: Math.max(...totals),
		},
	};
}

/**
 * Month-over-month totals for spend (out) and revenue (in), overall, per
 * counterparty and per category. Method: `TREND_METHOD`. When fewer than
 * `MIN_TREND_MONTHS` complete months exist, `status` is "not_enough_data" and
 * every `summary` is null; the observed monthly totals are still listed.
 * Throws `MixedCurrencyError` if items are in more than one currency.
 */
export function buildTrend(
	items: readonly CashItem[],
	options: TrendOptions,
): Trend {
	const { asOf } = options;
	const currency = singleCurrency(items, options.currency);
	const months = completeMonths(items, asOf, options.historyStart);
	const ok = months.length >= MIN_TREND_MONTHS && currency !== null;
	const known = knownAt(items, asOf);

	const series = (key: string, subset: readonly CashItem[]): TrendSeries => {
		const totals = monthlyTotals(subset, months);
		return {
			key,
			months: totals,
			summary: ok ? summarise(totals, currency) : null,
		};
	};
	const groupBy = (
		subset: readonly CashItem[],
		pick: (i: CashItem) => string | undefined,
	): TrendSeries[] => {
		const groups = new Map<string, CashItem[]>();
		for (const i of subset) {
			const k = pick(i);
			if (k === undefined) continue;
			groups.set(k, [...(groups.get(k) ?? []), i]);
		}
		return [...groups.keys()].sort().map((k) => series(k, groups.get(k) ?? []));
	};
	const forDirection = (direction: Direction): DirectionTrend => {
		const subset = known.filter((i) => i.direction === direction);
		return {
			overall: series("all", subset),
			byCounterparty: groupBy(subset, (i) => i.counterparty),
			byCategory: groupBy(subset, (i) => i.category),
		};
	};

	return {
		status: ok ? "ok" : "not_enough_data",
		asOf,
		currency,
		completeMonths: months,
		requiredMonths: MIN_TREND_MONTHS,
		spend: forDirection("out"),
		revenue: forDirection("in"),
		method: TREND_METHOD,
	};
}
