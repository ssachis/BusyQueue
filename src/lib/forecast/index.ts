/**
 * Forecast engine: projections are arithmetic, not AI. Every function here is
 * pure and deterministic, works in integer minor units, and exports a
 * `*_METHOD` string the UI can show as "how this was calculated".
 *
 * - `analysePaymentBehaviour`: days late per counterparty (median, p25–p75)
 * - `buildCashCalendar`: expected cash in/out over 30/60/90 days and per week
 * - `buildTrend`: month-over-month totals with a trailing 3-month band
 * - `detectSpendDrift` / `detectPriceRises`: drift alerts with their numbers
 * - `buildForecast`: all of the above for one currency
 * - `buildDigestInput`: compact JSON facts for a model to narrate
 */
export {
	analysePaymentBehaviour,
	type BehaviourBasis,
	behaviourFor,
	type CounterpartyBehaviour,
	type DaysLateStats,
	DEFAULT_MIN_SAMPLES,
	PAYMENT_BEHAVIOUR_METHOD,
	type PaymentBehaviour,
	type PaymentBehaviourOptions,
} from "./behaviour.ts";
export {
	buildCashCalendar,
	CASH_CALENDAR_METHOD,
	type CalendarHorizon,
	type CalendarItem,
	type CalendarWeek,
	type CashCalendar,
	type CashCalendarOptions,
	DEFAULT_HORIZONS,
	DEFAULT_TERMS_DAYS,
	openAt,
} from "./calendar.ts";
export {
	buildDigestInput,
	type DigestInput,
	type DigestOptions,
} from "./digest.ts";
export {
	DEFAULT_DRIFT_BASELINE_MONTHS,
	DEFAULT_PRICE_RISE_THRESHOLD,
	DEFAULT_SPEND_DRIFT_MIN_CHANGE_MINOR,
	DEFAULT_SPEND_DRIFT_THRESHOLD,
	detectPriceRises,
	detectSpendDrift,
	PRICE_RISE_METHOD,
	type PriceRiseAlert,
	type PriceRiseOptions,
	SPEND_DRIFT_METHOD,
	type SpendDriftAlert,
	type SpendDriftOptions,
	type SpendDriftResult,
} from "./drift.ts";
export {
	buildForecast,
	type Forecast,
	type ForecastOptions,
} from "./forecast.ts";
export {
	buildTrend,
	completeMonths,
	type DirectionTrend,
	MIN_TREND_MONTHS,
	type MonthTotal,
	monthlyTotals,
	TREND_METHOD,
	type Trend,
	type TrendOptions,
	type TrendSeries,
	type TrendSummary,
} from "./trend.ts";
export {
	type AmountRange,
	CashItem,
	Direction,
	type FlowRange,
	LineObservation,
	MixedCurrencyError,
} from "./types.ts";
export { groupByCurrency, percentileDays } from "./util.ts";
