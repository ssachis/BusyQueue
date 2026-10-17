import { analysePaymentBehaviour, type PaymentBehaviour } from "./behaviour.ts";
import { buildCashCalendar, type CashCalendar } from "./calendar.ts";
import {
	detectPriceRises,
	detectSpendDrift,
	type PriceRiseAlert,
	type SpendDriftResult,
} from "./drift.ts";
import { buildTrend, type Trend } from "./trend.ts";
import { CashItem, LineObservation } from "./types.ts";
import { singleCurrency } from "./util.ts";

export interface ForecastOptions {
	/** "Today": everything is computed from what was known on this date. */
	asOf: string;
	/** Optional billed unit prices for price-rise alerts. */
	lines?: readonly LineObservation[];
	/** Required currency (also used when there are no items). */
	currency?: string;
	historyStart?: string;
	minSamples?: number;
	horizons?: readonly number[];
	defaultTermsDays?: number;
	spendDriftThreshold?: string;
	spendDriftBaselineMonths?: number;
	spendDriftMinChangeMinor?: number;
	priceRiseThreshold?: string;
}

export interface Forecast {
	asOf: string;
	currency: string | null;
	behaviour: PaymentBehaviour;
	calendar: CashCalendar;
	trend: Trend;
	spendDrift: SpendDriftResult;
	priceRises: PriceRiseAlert[];
}

/**
 * Run the whole engine on one currency: payment behaviour, cash calendar,
 * trend, spend drift and price rises. Inputs are validated with zod first.
 * Throws `MixedCurrencyError` when items (or price lines) mix currencies;
 * use `groupByCurrency` and forecast each group separately.
 */
export function buildForecast(
	rawItems: readonly CashItem[],
	options: ForecastOptions,
): Forecast {
	const items = CashItem.array().parse(rawItems);
	const lines = LineObservation.array().parse(options.lines ?? []);
	const { asOf } = options;
	const currency = singleCurrency(
		[
			...items,
			...lines.flatMap((l) => (l.currency ? [{ currency: l.currency }] : [])),
		],
		options.currency,
	);
	const pinned = currency ?? undefined;
	const behaviour = analysePaymentBehaviour(items, {
		asOf,
		minSamples: options.minSamples,
	});
	return {
		asOf,
		currency,
		behaviour,
		calendar: buildCashCalendar(items, {
			asOf,
			behaviour,
			currency: pinned,
			horizons: options.horizons,
			defaultTermsDays: options.defaultTermsDays,
		}),
		trend: buildTrend(items, {
			asOf,
			currency: pinned,
			historyStart: options.historyStart,
		}),
		spendDrift: detectSpendDrift(items, {
			asOf,
			currency: pinned,
			historyStart: options.historyStart,
			thresholdRatio: options.spendDriftThreshold,
			baselineMonths: options.spendDriftBaselineMonths,
			minChangeMinor: options.spendDriftMinChangeMinor,
		}),
		priceRises: detectPriceRises(lines, {
			asOf,
			thresholdRatio: options.priceRiseThreshold,
		}),
	};
}
