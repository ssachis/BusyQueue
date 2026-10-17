import { toMinor } from "#/lib/money/index.ts";
import {
	analysePaymentBehaviour,
	type BehaviourBasis,
	behaviourFor,
	type PaymentBehaviour,
} from "./behaviour.ts";
import type { AmountRange, CashItem, Direction, FlowRange } from "./types.ts";
import {
	addDays,
	daysBetween,
	knownAt,
	singleCurrency,
	sumMinor,
} from "./util.ts";

export const CASH_CALENDAR_METHOD =
	"Open items (issued on or before the as-of date and not yet paid by it) land on their due date " +
	"plus the counterparty's expected days late (median); the range uses its 25th and 75th percentiles. " +
	"Items without a due date are assumed due after the default terms. Dates before the as-of date " +
	"(overdue items) are moved to the as-of date. A period's expected total holds the items whose " +
	"expected date falls in it; the low total holds only items whose whole early–late window falls " +
	"in it, and the high total every item whose window touches it (for credits, the reverse). " +
	"Amounts are exact minor units.";

/** Default cumulative horizons, in days from the as-of date. */
export const DEFAULT_HORIZONS = [30, 60, 90] as const;
/** Default payment terms when an item has no due date. */
export const DEFAULT_TERMS_DAYS = 30;

export interface CalendarItem {
	id: string;
	direction: Direction;
	counterparty: string;
	amountMinor: number;
	/** The due date used: the item's own, or issue date + default terms. */
	dueDate: string;
	dueDateAssumed: boolean;
	/** Due date is before the as-of date. */
	pastDue: boolean;
	/** Due date + expected days late, never before the as-of date. */
	expectedDate: string;
	earliestDate: string;
	latestDate: string;
	basis: BehaviourBasis;
	category?: string;
}

/** Cumulative total from the as-of date: `asOf ≤ date ≤ lastDate`. */
export interface CalendarHorizon extends FlowRange {
	days: number;
	lastDate: string;
}

/** One week, `startDate ≤ date ≤ endDate`; week 0 starts on the as-of date. */
export interface CalendarWeek extends FlowRange {
	index: number;
	startDate: string;
	endDate: string;
}

export interface CashCalendar {
	asOf: string;
	/** Null only when there are no items and no currency was given. */
	currency: string | null;
	horizons: CalendarHorizon[];
	weeks: CalendarWeek[];
	/** Items expected after the longest horizon. */
	beyond: FlowRange & { firstDate: string };
	/** Every open item with its placement, sorted by expected date then id. */
	items: CalendarItem[];
	method: string;
}

export interface CashCalendarOptions {
	asOf: string;
	/** Cumulative horizons in days. Default `DEFAULT_HORIZONS` (30, 60, 90). */
	horizons?: readonly number[];
	/** Terms assumed when `dueDate` is null. Default `DEFAULT_TERMS_DAYS` (30). */
	defaultTermsDays?: number;
	/** Precomputed behaviour; computed from the same items when omitted. */
	behaviour?: PaymentBehaviour;
	/** Passed to `analysePaymentBehaviour` when `behaviour` is omitted. */
	minSamples?: number;
	/** Required currency; items in any other currency throw `MixedCurrencyError`. */
	currency?: string;
}

/** Items open on `asOf`: issued by then and not paid by then. */
export const openAt = (items: readonly CashItem[], asOf: string): CashItem[] =>
	knownAt(items, asOf).filter((i) => i.paidOn === null || i.paidOn > asOf);

/**
 * Expected cash in and out over the coming weeks. Method: `CASH_CALENDAR_METHOD`.
 * Totals per cumulative horizon (default 30/60/90 days) and per week (enough
 * weeks to cover the longest horizon), each with a low/high range.
 * Throws `MixedCurrencyError` if items are in more than one currency.
 */
export function buildCashCalendar(
	items: readonly CashItem[],
	options: CashCalendarOptions,
): CashCalendar {
	const { asOf } = options;
	daysBetween(asOf, asOf); // validates asOf
	const currency = singleCurrency(items, options.currency);
	const horizons = [...(options.horizons ?? DEFAULT_HORIZONS)].sort(
		(a, b) => a - b,
	);
	if (horizons.some((h) => !Number.isInteger(h) || h <= 0)) {
		throw new RangeError("Horizons must be positive whole days");
	}
	const terms = options.defaultTermsDays ?? DEFAULT_TERMS_DAYS;
	const behaviour =
		options.behaviour ??
		analysePaymentBehaviour(items, { asOf, minSamples: options.minSamples });

	const placed = openAt(items, asOf)
		.map((item) => place(item, asOf, terms, behaviour))
		.sort(
			(a, b) =>
				a.expectedDate.localeCompare(b.expectedDate) ||
				a.id.localeCompare(b.id),
		);

	const offsets = placed.map((p) => ({
		item: p,
		exp: daysBetween(asOf, p.expectedDate),
		early: daysBetween(asOf, p.earliestDate),
		late: daysBetween(asOf, p.latestDate),
	}));
	const period = (start: number, end: number): FlowRange =>
		flowRange(offsets, start, end);

	const maxHorizon = horizons[horizons.length - 1] ?? 0;
	const weekCount = Math.ceil(maxHorizon / 7);

	return {
		asOf,
		currency,
		horizons: horizons.map((days) => ({
			days,
			lastDate: addDays(asOf, days - 1),
			...period(0, days),
		})),
		weeks: Array.from({ length: weekCount }, (_, index) => ({
			index,
			startDate: addDays(asOf, index * 7),
			endDate: addDays(asOf, index * 7 + 6),
			...period(index * 7, index * 7 + 7),
		})),
		beyond: {
			firstDate: addDays(asOf, maxHorizon),
			...period(maxHorizon, Number.POSITIVE_INFINITY),
		},
		items: placed,
		method: CASH_CALENDAR_METHOD,
	};
}

function place(
	item: CashItem,
	asOf: string,
	terms: number,
	behaviour: PaymentBehaviour,
): CalendarItem {
	const b = behaviourFor(behaviour, item.direction, item.counterparty);
	const dueDate = item.dueDate ?? addDays(item.issueDate, terms);
	const notBefore = (iso: string) => (iso < asOf ? asOf : iso);
	return {
		id: item.id,
		direction: item.direction,
		counterparty: item.counterparty,
		amountMinor: toMinor(item.amount, item.currency).minor,
		dueDate,
		dueDateAssumed: item.dueDate === null,
		pastDue: dueDate < asOf,
		expectedDate: notBefore(addDays(dueDate, b.expected.medianDays)),
		earliestDate: notBefore(addDays(dueDate, b.expected.p25Days)),
		latestDate: notBefore(addDays(dueDate, b.expected.p75Days)),
		basis: b.basis,
		...(item.category ? { category: item.category } : {}),
	};
}

interface Offsets {
	item: CalendarItem;
	exp: number;
	early: number;
	late: number;
}

/** Totals for `start ≤ day < end` (days from asOf), with the window-based range. */
function flowRange(
	offsets: readonly Offsets[],
	start: number,
	end: number,
): FlowRange {
	const range = (direction: Direction): AmountRange => {
		const expected: number[] = [];
		const low: number[] = [];
		const high: number[] = [];
		for (const o of offsets) {
			if (o.item.direction !== direction) continue;
			const amount = o.item.amountMinor;
			if (o.exp >= start && o.exp < end) expected.push(amount);
			const inside = o.early >= start && o.late < end;
			const touches = o.late >= start && o.early < end;
			// An item that may or may not land here contributes 0 or its amount;
			// low takes the smaller, high the larger (so credits stay bounded too).
			if (inside) {
				low.push(amount);
				high.push(amount);
			} else if (touches) {
				low.push(Math.min(0, amount));
				high.push(Math.max(0, amount));
			}
		}
		return {
			expectedMinor: sumMinor(expected),
			lowMinor: sumMinor(low),
			highMinor: sumMinor(high),
		};
	};
	const cashIn = range("in");
	const cashOut = range("out");
	return {
		in: cashIn,
		out: cashOut,
		net: {
			expectedMinor: cashIn.expectedMinor - cashOut.expectedMinor,
			lowMinor: cashIn.lowMinor - cashOut.highMinor,
			highMinor: cashIn.highMinor - cashOut.lowMinor,
		},
	};
}
