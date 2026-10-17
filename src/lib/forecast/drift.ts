import { Decimal, dec } from "#/lib/money/index.ts";
import {
	normalizeItem,
	normalizeUnit,
	normalizeVendor,
} from "#/lib/rules/aliases.ts";
import { completeMonths, monthlyTotals } from "./trend.ts";
import type { CashItem, Direction, LineObservation } from "./types.ts";
import { averageMinor, changeRatio, knownAt, singleCurrency } from "./util.ts";

// ── Spend drift ──────────────────────────────────────────────────────

/** Default: alert when a month moves more than 25% away from its baseline. */
export const DEFAULT_SPEND_DRIFT_THRESHOLD = "0.25";
/** Default: baseline is the average of the 3 complete months before the latest. */
export const DEFAULT_DRIFT_BASELINE_MONTHS = 3;
/** Default: no minimum absolute change (minor units). */
export const DEFAULT_SPEND_DRIFT_MIN_CHANGE_MINOR = 0;

export const SPEND_DRIFT_METHOD =
	"For each counterparty and direction, the latest complete month (by issue date) is compared with " +
	"the average of the complete months before it (default 3). An alert fires when the absolute change " +
	"is more than the threshold (default 25%) of that average and at least the minimum change; a " +
	"counterparty with a zero baseline alerts on any non-zero month. Needs the baseline months plus the " +
	"latest month to be complete, otherwise the result is not enough data.";

export interface SpendDriftAlert {
	kind: "spend_drift";
	direction: Direction;
	counterparty: string;
	currency: string;
	month: string;
	actualMinor: number;
	/** Average of the baseline months, rounded once to minor units. */
	baselineMinor: number;
	baselineMonths: string[];
	baselineMonthTotalsMinor: number[];
	/** `actual − baseline`. */
	changeMinor: number;
	/** `change / baseline`, 4 decimals; null when the baseline is 0. */
	changeRatio: string | null;
	thresholdRatio: string;
	minChangeMinor: number;
}

export interface SpendDriftResult {
	status: "ok" | "not_enough_data";
	/** Complete months needed: baseline months + the latest month. */
	requiredMonths: number;
	completeMonths: string[];
	alerts: SpendDriftAlert[];
	method: string;
}

export interface SpendDriftOptions {
	asOf: string;
	/** Ratio as a decimal string, e.g. "0.25". Default `DEFAULT_SPEND_DRIFT_THRESHOLD`. */
	thresholdRatio?: string;
	/** Default `DEFAULT_DRIFT_BASELINE_MONTHS` (3). */
	baselineMonths?: number;
	/** Default `DEFAULT_SPEND_DRIFT_MIN_CHANGE_MINOR` (0). */
	minChangeMinor?: number;
	historyStart?: string;
	currency?: string;
}

/**
 * Counterparties whose latest complete month moved beyond the threshold
 * against their trailing average. Method: `SPEND_DRIFT_METHOD`. The decision
 * uses the exact (unrounded) average; the alert reports it rounded.
 * Throws `MixedCurrencyError` if items are in more than one currency.
 */
export function detectSpendDrift(
	items: readonly CashItem[],
	options: SpendDriftOptions,
): SpendDriftResult {
	const { asOf } = options;
	const threshold = options.thresholdRatio ?? DEFAULT_SPEND_DRIFT_THRESHOLD;
	const n = options.baselineMonths ?? DEFAULT_DRIFT_BASELINE_MONTHS;
	const minChange =
		options.minChangeMinor ?? DEFAULT_SPEND_DRIFT_MIN_CHANGE_MINOR;
	if (!Number.isInteger(n) || n < 1) {
		throw new RangeError("baselineMonths must be a positive whole number");
	}
	const currency = singleCurrency(items, options.currency);
	const months = completeMonths(items, asOf, options.historyStart);
	const base = {
		requiredMonths: n + 1,
		completeMonths: months,
		method: SPEND_DRIFT_METHOD,
	};
	if (months.length < n + 1 || currency === null) {
		return { status: "not_enough_data", alerts: [], ...base };
	}
	const window = months.slice(-(n + 1));
	const t = dec(threshold);

	const groups = new Map<string, CashItem[]>();
	for (const i of knownAt(items, asOf)) {
		const key = `${i.direction}\u0000${i.counterparty}`;
		groups.set(key, [...(groups.get(key) ?? []), i]);
	}

	const alerts: SpendDriftAlert[] = [];
	for (const key of [...groups.keys()].sort()) {
		const group = groups.get(key) ?? [];
		const first = group[0] as CashItem;
		const totals = monthlyTotals(group, window);
		const actual = (totals[n] as (typeof totals)[number]).totalMinor;
		const baselineTotals = totals.slice(0, n).map((m) => m.totalMinor);
		const baselineSum = baselineTotals.reduce((a, b) => a + b, 0);
		// |actual − sum/n| > t·sum/n  ⇔  |actual·n − sum| > t·sum  (exact, no rounding)
		const deviation = new Decimal(String(actual * n - baselineSum)).abs();
		const beyond =
			baselineSum === 0
				? actual !== 0
				: deviation.gt(t.times(new Decimal(String(Math.abs(baselineSum)))));
		const baseline = averageMinor(baselineSum, n, currency);
		const change = actual - baseline;
		if (!beyond || Math.abs(change) < minChange) continue;
		alerts.push({
			kind: "spend_drift",
			direction: first.direction,
			counterparty: first.counterparty,
			currency,
			month: window[n] as string,
			actualMinor: actual,
			baselineMinor: baseline,
			baselineMonths: window.slice(0, n),
			baselineMonthTotalsMinor: baselineTotals,
			changeMinor: change,
			changeRatio: changeRatio(baseline, actual),
			thresholdRatio: threshold,
			minChangeMinor: minChange,
		});
	}
	return { status: "ok", alerts, ...base };
}

// ── Unit price rises ─────────────────────────────────────────────────

/** Default: alert when a unit price rises by more than 0% (any rise). */
export const DEFAULT_PRICE_RISE_THRESHOLD = "0";

export const PRICE_RISE_METHOD =
	"Billed unit prices are grouped by vendor, item, unit and currency (names compared case- and " +
	"punctuation-insensitively) and ordered by date. Each price is compared with the previous one in " +
	"its group; an alert fires when it rose by more than the threshold (default: any rise).";

export interface PriceRiseAlert {
	kind: "price_rise";
	vendor: string;
	item: string;
	unit: string;
	currency: string | null;
	previousPrice: string;
	previousDate: string;
	previousRef: string | null;
	newPrice: string;
	date: string;
	ref: string | null;
	/** `new − previous`, exact decimal string. */
	changeAmount: string;
	/** `(new − previous) / previous`, 4 decimals. */
	changeRatio: string;
	thresholdRatio: string;
}

export interface PriceRiseOptions {
	/** Ratio as a decimal string. Default `DEFAULT_PRICE_RISE_THRESHOLD` ("0"). */
	thresholdRatio?: string;
	/** Ignore observations after this date (replay what was known then). */
	asOf?: string;
}

/**
 * Unit prices that rose between consecutive observations of the same
 * vendor + item + unit. Method: `PRICE_RISE_METHOD`. Ties on date keep
 * `ref` order, then input order, so the output is deterministic.
 */
export function detectPriceRises(
	lines: readonly LineObservation[],
	options: PriceRiseOptions = {},
): PriceRiseAlert[] {
	const threshold = options.thresholdRatio ?? DEFAULT_PRICE_RISE_THRESHOLD;
	const t = dec(threshold);
	const groups = new Map<string, { obs: LineObservation; idx: number }[]>();
	lines.forEach((obs, idx) => {
		if (options.asOf && obs.date > options.asOf) return;
		const key = [
			normalizeVendor(obs.vendor),
			normalizeItem(obs.item),
			normalizeUnit(obs.unit),
			obs.currency ?? "",
		].join("\u0000");
		groups.set(key, [...(groups.get(key) ?? []), { obs, idx }]);
	});

	const alerts: PriceRiseAlert[] = [];
	for (const key of [...groups.keys()].sort()) {
		const sorted = (groups.get(key) ?? []).sort(
			(a, b) =>
				a.obs.date.localeCompare(b.obs.date) ||
				(a.obs.ref ?? "").localeCompare(b.obs.ref ?? "") ||
				a.idx - b.idx,
		);
		for (let k = 1; k < sorted.length; k++) {
			const prev = (sorted[k - 1] as (typeof sorted)[number]).obs;
			const cur = (sorted[k] as (typeof sorted)[number]).obs;
			const before = dec(prev.unitPrice);
			const after = dec(cur.unitPrice);
			if (before.lte(new Decimal("0"))) continue;
			const rise = after.minus(before);
			if (!rise.gt(t.times(before))) continue;
			alerts.push({
				kind: "price_rise",
				vendor: cur.vendor,
				item: cur.item,
				unit: cur.unit,
				currency: cur.currency ?? null,
				previousPrice: prev.unitPrice,
				previousDate: prev.date,
				previousRef: prev.ref ?? null,
				newPrice: cur.unitPrice,
				date: cur.date,
				ref: cur.ref ?? null,
				changeAmount: rise.toFixed(),
				changeRatio: rise.div(before).toFixed(4),
				thresholdRatio: threshold,
			});
		}
	}
	return alerts.sort(
		(a, b) =>
			a.date.localeCompare(b.date) ||
			a.vendor.localeCompare(b.vendor) ||
			a.item.localeCompare(b.item),
	);
}
