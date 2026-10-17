import type { CashItem, Direction } from "./types.ts";
import { cpKey, daysBetween, knownAt, percentileDays } from "./util.ts";

export const PAYMENT_BEHAVIOUR_METHOD =
	"Days late = paid date − due date, for items paid on or before the as-of date. " +
	"Per counterparty: the median is the expected delay and the 25th–75th percentiles are the range " +
	"(linear interpolation, rounded half up to whole days). A counterparty with fewer than the minimum " +
	"number of paid items uses the median and range of all counterparties in the same direction; " +
	"if that pool is also too small, items are assumed to be paid on the due date (0 days).";

/** Default minimum paid items before a counterparty's own history is trusted. */
export const DEFAULT_MIN_SAMPLES = 3;

export interface DaysLateStats {
	sampleSize: number;
	/** Expected delay in days; negative means paid early. */
	medianDays: number;
	p25Days: number;
	p75Days: number;
}

/**
 * Where a counterparty's expected delay comes from:
 * - `own`: its own paid history (≥ `minSamples` items)
 * - `overall`: too little history; the pooled history of its direction is used
 * - `none`: the pool is too small as well; 0 days (paid on the due date)
 */
export type BehaviourBasis = "own" | "overall" | "none";

export interface CounterpartyBehaviour {
	direction: Direction;
	counterparty: string;
	basis: BehaviourBasis;
	/** Its own statistics, or null when it has no paid history. */
	own: DaysLateStats | null;
	/** The delay the calendar applies (own, pooled or zero, per `basis`). */
	expected: Omit<DaysLateStats, "sampleSize">;
}

export interface PaymentBehaviour {
	asOf: string;
	minSamples: number;
	overall: Record<Direction, DaysLateStats | null>;
	counterparties: CounterpartyBehaviour[];
	method: string;
}

export interface PaymentBehaviourOptions {
	asOf: string;
	/** Default `DEFAULT_MIN_SAMPLES` (3). */
	minSamples?: number;
}

function stats(days: readonly number[]): DaysLateStats | null {
	if (days.length === 0) return null;
	return {
		sampleSize: days.length,
		medianDays: percentileDays(days, 50),
		p25Days: percentileDays(days, 25),
		p75Days: percentileDays(days, 75),
	};
}

const ZERO = { medianDays: 0, p25Days: 0, p75Days: 0 };

const strip = ({ medianDays, p25Days, p75Days }: DaysLateStats) => ({
	medianDays,
	p25Days,
	p75Days,
});

/**
 * Payment behaviour per counterparty: how many days after the due date items
 * are actually paid. Method: `PAYMENT_BEHAVIOUR_METHOD`. Only items issued
 * and paid on or before `asOf` count, so a past `asOf` replays what was known
 * then. Items without a due date carry no lateness information and are skipped.
 */
export function analysePaymentBehaviour(
	items: readonly CashItem[],
	options: PaymentBehaviourOptions,
): PaymentBehaviour {
	const { asOf } = options;
	const minSamples = options.minSamples ?? DEFAULT_MIN_SAMPLES;
	const known = knownAt(items, asOf);

	const perCp = new Map<
		string,
		{ direction: Direction; counterparty: string; days: number[] }
	>();
	const pooled: Record<Direction, number[]> = { in: [], out: [] };
	for (const item of known) {
		const key = cpKey(item.direction, item.counterparty);
		const entry = perCp.get(key) ?? {
			direction: item.direction,
			counterparty: item.counterparty,
			days: [],
		};
		perCp.set(key, entry);
		if (item.dueDate && item.paidOn && item.paidOn <= asOf) {
			const late = daysBetween(item.dueDate, item.paidOn);
			entry.days.push(late);
			pooled[item.direction].push(late);
		}
	}

	const overall = { in: stats(pooled.in), out: stats(pooled.out) };
	const counterparties = [...perCp.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, e]) =>
			resolveBehaviour(
				e.direction,
				e.counterparty,
				stats(e.days),
				overall,
				minSamples,
			),
		);

	return {
		asOf,
		minSamples,
		overall,
		counterparties,
		method: PAYMENT_BEHAVIOUR_METHOD,
	};
}

function resolveBehaviour(
	direction: Direction,
	counterparty: string,
	own: DaysLateStats | null,
	overall: Record<Direction, DaysLateStats | null>,
	minSamples: number,
): CounterpartyBehaviour {
	if (own && own.sampleSize >= minSamples) {
		return { direction, counterparty, basis: "own", own, expected: strip(own) };
	}
	const pool = overall[direction];
	if (pool && pool.sampleSize >= minSamples) {
		return {
			direction,
			counterparty,
			basis: "overall",
			own,
			expected: strip(pool),
		};
	}
	return { direction, counterparty, basis: "none", own, expected: ZERO };
}

/** The behaviour to apply to a counterparty, falling back for ones not in the analysis. */
export function behaviourFor(
	behaviour: PaymentBehaviour,
	direction: Direction,
	counterparty: string,
): CounterpartyBehaviour {
	return (
		behaviour.counterparties.find(
			(c) => c.direction === direction && c.counterparty === counterparty,
		) ??
		resolveBehaviour(
			direction,
			counterparty,
			null,
			behaviour.overall,
			behaviour.minSamples,
		)
	);
}
