import { PAYMENT_BEHAVIOUR_METHOD } from "./behaviour.ts";
import { CASH_CALENDAR_METHOD, type CalendarItem } from "./calendar.ts";
import {
	PRICE_RISE_METHOD,
	type PriceRiseAlert,
	SPEND_DRIFT_METHOD,
	type SpendDriftAlert,
} from "./drift.ts";
import type { Forecast } from "./forecast.ts";
import { TREND_METHOD, type TrendSummary } from "./trend.ts";
import type { Direction, FlowRange } from "./types.ts";
import { sumMinor } from "./util.ts";

/**
 * Compact, JSON-serialisable facts for a model to narrate. Every number in
 * here was computed by the engine; the model may only put it into words.
 */
export interface DigestInput {
	asOf: string;
	currency: string | null;
	/** Amounts are integer minor units of `currency`. */
	amountUnit: "minor";
	cash: {
		horizons: (FlowRange & { days: number; lastDate: string })[];
		beyondLongestHorizon: FlowRange;
		pastDue: Record<Direction, { count: number; totalMinor: number }>;
		largestUpcoming: Pick<
			CalendarItem,
			| "id"
			| "direction"
			| "counterparty"
			| "amountMinor"
			| "dueDate"
			| "expectedDate"
			| "earliestDate"
			| "latestDate"
			| "basis"
		>[];
	};
	paymentBehaviour: {
		direction: Direction;
		counterparty: string;
		basis: string;
		ownSampleSize: number;
		medianDaysLate: number;
		p25DaysLate: number;
		p75DaysLate: number;
	}[];
	trend:
		| {
				status: "not_enough_data";
				completeMonths: string[];
				requiredMonths: number;
		  }
		| {
				status: "ok";
				completeMonths: string[];
				spend: TrendSummary | null;
				revenue: TrendSummary | null;
				spendByCounterparty: { key: string; summary: TrendSummary | null }[];
				revenueByCounterparty: {
					key: string;
					summary: TrendSummary | null;
				}[];
		  };
	alerts: {
		spendDrift:
			| { status: "not_enough_data"; requiredMonths: number }
			| { status: "ok"; count: number; items: SpendDriftAlert[] };
		priceRises: { count: number; items: PriceRiseAlert[] };
	};
	methods: {
		paymentBehaviour: string;
		cashCalendar: string;
		trend: string;
		spendDrift: string;
		priceRise: string;
	};
}

export interface DigestOptions {
	/** Largest upcoming items to include. Default 5. */
	maxItems?: number;
	/** Alerts of each kind to include (the count is always the full count). Default 10. */
	maxAlerts?: number;
}

/**
 * Reduce a `Forecast` to the facts a narrated digest needs. Pure and
 * deterministic: the same forecast gives byte-identical JSON. No model call.
 */
export function buildDigestInput(
	forecast: Forecast,
	options: DigestOptions = {},
): DigestInput {
	const maxItems = options.maxItems ?? 5;
	const maxAlerts = options.maxAlerts ?? 10;
	const { calendar, trend, spendDrift, priceRises, behaviour } = forecast;
	const longest = calendar.horizons[calendar.horizons.length - 1];

	const pastDue = (direction: Direction) => {
		const due = calendar.items.filter(
			(i) => i.direction === direction && i.pastDue,
		);
		return {
			count: due.length,
			totalMinor: sumMinor(due.map((i) => i.amountMinor)),
		};
	};

	const largestUpcoming = calendar.items
		.filter((i) => !longest || i.expectedDate <= longest.lastDate)
		.sort((a, b) => b.amountMinor - a.amountMinor || a.id.localeCompare(b.id))
		.slice(0, maxItems)
		.map(
			({
				id,
				direction,
				counterparty,
				amountMinor,
				dueDate,
				expectedDate,
				earliestDate,
				latestDate,
				basis,
			}) => ({
				id,
				direction,
				counterparty,
				amountMinor,
				dueDate,
				expectedDate,
				earliestDate,
				latestDate,
				basis,
			}),
		);

	const nonZero = (s: { months: { totalMinor: number }[] }) =>
		s.months.some((m) => m.totalMinor !== 0);

	return {
		asOf: forecast.asOf,
		currency: forecast.currency,
		amountUnit: "minor",
		cash: {
			horizons: calendar.horizons.map(
				({ days, lastDate, in: i, out, net }) => ({
					days,
					lastDate,
					in: i,
					out,
					net,
				}),
			),
			beyondLongestHorizon: {
				in: calendar.beyond.in,
				out: calendar.beyond.out,
				net: calendar.beyond.net,
			},
			pastDue: { in: pastDue("in"), out: pastDue("out") },
			largestUpcoming,
		},
		paymentBehaviour: behaviour.counterparties.map((c) => ({
			direction: c.direction,
			counterparty: c.counterparty,
			basis: c.basis,
			ownSampleSize: c.own?.sampleSize ?? 0,
			medianDaysLate: c.expected.medianDays,
			p25DaysLate: c.expected.p25Days,
			p75DaysLate: c.expected.p75Days,
		})),
		trend:
			trend.status === "ok"
				? {
						status: "ok",
						completeMonths: trend.completeMonths,
						spend: nonZero(trend.spend.overall)
							? trend.spend.overall.summary
							: null,
						revenue: nonZero(trend.revenue.overall)
							? trend.revenue.overall.summary
							: null,
						spendByCounterparty: trend.spend.byCounterparty.map(
							({ key, summary }) => ({ key, summary }),
						),
						revenueByCounterparty: trend.revenue.byCounterparty.map(
							({ key, summary }) => ({ key, summary }),
						),
					}
				: {
						status: "not_enough_data",
						completeMonths: trend.completeMonths,
						requiredMonths: trend.requiredMonths,
					},
		alerts: {
			spendDrift:
				spendDrift.status === "ok"
					? {
							status: "ok",
							count: spendDrift.alerts.length,
							items: spendDrift.alerts.slice(0, maxAlerts),
						}
					: {
							status: "not_enough_data",
							requiredMonths: spendDrift.requiredMonths,
						},
			priceRises: {
				count: priceRises.length,
				items: priceRises.slice(0, maxAlerts),
			},
		},
		methods: {
			paymentBehaviour: PAYMENT_BEHAVIOUR_METHOD,
			cashCalendar: CASH_CALENDAR_METHOD,
			trend: TREND_METHOD,
			spendDrift: SPEND_DRIFT_METHOD,
			priceRise: PRICE_RISE_METHOD,
		},
	};
}
