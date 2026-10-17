import { describe, expect, it } from "vitest";
import {
	analysePaymentBehaviour,
	behaviourFor,
	buildCashCalendar,
	buildDigestInput,
	buildForecast,
	buildTrend,
	type CashItem,
	completeMonths,
	detectPriceRises,
	detectSpendDrift,
	groupByCurrency,
	type LineObservation,
	MixedCurrencyError,
	percentileDays,
} from "./index.ts";

let seq = 0;
function item(p: Partial<CashItem> & Pick<CashItem, "counterparty">): CashItem {
	seq += 1;
	return {
		id: `i-${String(seq).padStart(3, "0")}`,
		direction: "out",
		currency: "USD",
		amount: "100.00",
		issueDate: "2026-01-01",
		dueDate: "2026-01-10",
		paidOn: null,
		...p,
	};
}

describe("percentileDays", () => {
	it("interpolates between ranks and rounds half up to a whole day", () => {
		expect(percentileDays([1, 2, 3, 4], 50)).toBe(3); // 2.5 → 3
		expect(percentileDays([1, 2, 3, 4], 25)).toBe(2); // 1.75 → 2
		expect(percentileDays([1, 2, 3, 4], 75)).toBe(3); // 3.25 → 3
		expect(percentileDays([5, 1, 3], 50)).toBe(3);
		expect(percentileDays([-4, -1], 50)).toBe(-2); // -2.5 → the later day
		expect(percentileDays([7], 25)).toBe(7);
	});
});

// Vendor A: days late [-1, 2, 5, 10]; vendor B: [20]; pooled: [-1, 2, 5, 10, 20].
const historyItems = (): CashItem[] => [
	item({ counterparty: "A", paidOn: "2026-01-12" }), // +2
	item({ counterparty: "A", paidOn: "2026-01-15" }), // +5
	item({ counterparty: "A", paidOn: "2026-01-09" }), // −1
	item({ counterparty: "A", paidOn: "2026-01-20" }), // +10
	item({ counterparty: "B", paidOn: "2026-01-30" }), // +20
	// Paid after the as-of date: not history yet.
	item({ counterparty: "B", paidOn: "2026-02-20" }),
];

describe("analysePaymentBehaviour", () => {
	const b = analysePaymentBehaviour(historyItems(), { asOf: "2026-02-01" });

	it("uses a counterparty's own median and p25–p75 when it has enough history", () => {
		const a = behaviourFor(b, "out", "A");
		expect(a.basis).toBe("own");
		expect(a.own?.sampleSize).toBe(4);
		// sorted [-1, 2, 5, 10]: median 3.5 → 4, p25 1.25 → 1, p75 6.25 → 6
		expect(a.expected).toEqual({ medianDays: 4, p25Days: 1, p75Days: 6 });
	});

	it("falls back to the overall median, flagged, for thin history", () => {
		const bb = behaviourFor(b, "out", "B");
		expect(bb.basis).toBe("overall");
		expect(bb.own).toEqual({
			sampleSize: 1,
			medianDays: 20,
			p25Days: 20,
			p75Days: 20,
		});
		// pooled [-1, 2, 5, 10, 20]
		expect(bb.expected).toEqual({ medianDays: 5, p25Days: 2, p75Days: 10 });
		expect(b.overall.out?.sampleSize).toBe(5);
		expect(behaviourFor(b, "out", "Never seen").basis).toBe("overall");
	});

	it("assumes payment on the due date when even the pool is too small", () => {
		const none = behaviourFor(b, "in", "Client");
		expect(none.basis).toBe("none");
		expect(none.expected).toEqual({ medianDays: 0, p25Days: 0, p75Days: 0 });
	});
});

describe("buildCashCalendar", () => {
	const asOf = "2026-02-01";
	const items = [
		...historyItems(),
		// A: due 02-10 → expected 02-14 (day 13), window 02-11..02-16 (days 10–15)
		item({ counterparty: "A", amount: "1000.00", dueDate: "2026-02-10" }),
		// B (pooled 5 / 2 / 10): due 03-20 → expected 03-25 (day 52), window days 49–57
		item({ counterparty: "B", amount: "250.55", dueDate: "2026-03-20" }),
		// C (pooled), overdue: 01-15 + 5 = 01-20, moved to the as-of date
		item({ counterparty: "C", amount: "75.00", dueDate: "2026-01-15" }),
		// Money in, no history: paid on the due date, day 4
		item({
			counterparty: "Client",
			direction: "in",
			amount: "500.00",
			dueDate: "2026-02-05",
		}),
		// Issued after the as-of date: not known yet
		item({ counterparty: "A", issueDate: "2026-02-02", dueDate: "2026-02-12" }),
	];
	const cal = buildCashCalendar(items, { asOf });
	const placed = (amountMinor: number) =>
		cal.items.find((i) => i.amountMinor === amountMinor);

	it("lists open items only, including ones paid after the as-of date", () => {
		expect(cal.items.map((i) => i.amountMinor).sort((a, b) => a - b)).toEqual([
			7500, 10000, 25055, 50000, 100000,
		]);
		expect(cal.currency).toBe("USD");
	});

	it("places each item at due date + expected days late", () => {
		expect(placed(100000)).toMatchObject({
			expectedDate: "2026-02-14",
			earliestDate: "2026-02-11",
			latestDate: "2026-02-16",
			basis: "own",
			pastDue: false,
		});
		expect(placed(25055)).toMatchObject({
			expectedDate: "2026-03-25",
			earliestDate: "2026-03-22",
			latestDate: "2026-03-30",
			basis: "overall",
		});
		expect(placed(7500)).toMatchObject({
			dueDate: "2026-01-15",
			expectedDate: asOf,
			latestDate: asOf,
			pastDue: true,
		});
		expect(placed(50000)).toMatchObject({
			expectedDate: "2026-02-05",
			basis: "none",
		});
	});

	it("totals cumulative horizons in exact minor units", () => {
		const [h30, h60, h90] = cal.horizons;
		expect(h30?.lastDate).toBe("2026-03-02");
		// out: 1000.00 + 75.00 + the B bill paid early 02-20 (still open on 02-01)
		expect(h30?.out).toEqual({
			expectedMinor: 117500,
			lowMinor: 117500,
			highMinor: 117500,
		});
		expect(h30?.in.expectedMinor).toBe(50000);
		expect(h30?.net).toEqual({
			expectedMinor: -67500,
			lowMinor: -67500,
			highMinor: -67500,
		});
		expect(h60?.out.expectedMinor).toBe(142555);
		expect(h90?.out.expectedMinor).toBe(142555);
		expect(cal.beyond.out.highMinor).toBe(0);
	});

	it("gives each week a range from the early–late window", () => {
		const w1 = cal.weeks[1]; // days 7–13: 02-08..02-14
		expect(w1?.startDate).toBe("2026-02-08");
		// A's 1000.00 is expected here but its window (days 10–15) spills into week 2
		expect(w1?.out).toEqual({
			expectedMinor: 100000,
			lowMinor: 0,
			highMinor: 100000,
		});
		const w2 = cal.weeks[2];
		expect(w2?.out.expectedMinor).toBe(0);
		expect(w2?.out.highMinor).toBe(100000);
		expect(cal.weeks).toHaveLength(13);
		for (const w of cal.weeks) {
			expect(w.out.lowMinor).toBeLessThanOrEqual(w.out.expectedMinor);
			expect(w.out.expectedMinor).toBeLessThanOrEqual(w.out.highMinor);
		}
	});

	it("assumes default terms when there is no due date", () => {
		const c = buildCashCalendar(
			[
				item({
					counterparty: "X",
					issueDate: "2026-01-20",
					dueDate: null,
					direction: "in",
				}),
			],
			{ asOf, defaultTermsDays: 30 },
		);
		expect(c.items[0]).toMatchObject({
			dueDate: "2026-02-19",
			dueDateAssumed: true,
			expectedDate: "2026-02-19",
		});
	});
});

describe("buildTrend", () => {
	const items = [
		item({ counterparty: "A", amount: "100.00", issueDate: "2026-08-03" }),
		item({ counterparty: "B", amount: "50.00", issueDate: "2026-08-20" }),
		item({ counterparty: "A", amount: "200.00", issueDate: "2026-09-10" }),
		item({ counterparty: "A", amount: "400.02", issueDate: "2026-10-05" }),
	];

	it("says not enough data with fewer than 3 complete months", () => {
		const t = buildTrend(items, { asOf: "2026-10-21" });
		expect(t.status).toBe("not_enough_data");
		expect(t.completeMonths).toEqual(["2026-08", "2026-09"]);
		expect(t.spend.overall.summary).toBeNull();
		expect(t.spend.byCounterparty.every((s) => s.summary === null)).toBe(true);
		// The observed totals are still listed.
		expect(t.spend.overall.months.map((m) => m.totalMinor)).toEqual([
			15000, 20000,
		]);
	});

	it("counts a month as complete once its last day is on or before the as-of date", () => {
		expect(completeMonths(items, "2026-10-30")).toEqual(["2026-08", "2026-09"]);
		expect(completeMonths(items, "2026-10-31")).toEqual([
			"2026-08",
			"2026-09",
			"2026-10",
		]);
	});

	it("computes MoM change and the trailing 3-month band", () => {
		const t = buildTrend(items, { asOf: "2026-10-31" });
		expect(t.status).toBe("ok");
		expect(t.spend.overall.summary).toEqual({
			latestMonth: "2026-10",
			latestMinor: 40002,
			previousMonth: "2026-09",
			previousMinor: 20000,
			momChangeMinor: 20002,
			momChangeRatio: "1.0001",
			trailing: {
				months: ["2026-08", "2026-09", "2026-10"],
				averageMinor: 25001, // 75002 / 3 = 25000.67, rounded once
				lowMinor: 15000,
				highMinor: 40002,
			},
		});
		const b = t.spend.byCounterparty.find((s) => s.key === "B");
		expect(b?.months.map((m) => m.totalMinor)).toEqual([5000, 0, 0]);
		expect(b?.summary?.momChangeRatio).toBeNull(); // previous month was 0
		expect(t.revenue.overall.months.every((m) => m.totalMinor === 0)).toBe(
			true,
		);
	});
});

describe("detectSpendDrift", () => {
	const monthly = (cp: string, amounts: string[]) =>
		amounts.map((amount, k) =>
			item({ counterparty: cp, amount, issueDate: `2026-0${6 + k}-15` }),
		);

	it("fires when the latest month moves beyond the threshold", () => {
		const r = detectSpendDrift(
			[
				...monthly("A", ["100.00", "100.00", "100.00", "130.00"]),
				...monthly("B", ["80.00", "90.00", "100.00", "95.00"]),
			],
			{ asOf: "2026-09-30" },
		);
		expect(r.status).toBe("ok");
		expect(r.alerts).toEqual([
			{
				kind: "spend_drift",
				direction: "out",
				counterparty: "A",
				currency: "USD",
				month: "2026-09",
				actualMinor: 13000,
				baselineMinor: 10000,
				baselineMonths: ["2026-06", "2026-07", "2026-08"],
				baselineMonthTotalsMinor: [10000, 10000, 10000],
				changeMinor: 3000,
				changeRatio: "0.3000",
				thresholdRatio: "0.25",
				minChangeMinor: 0,
			},
		]);
	});

	it("does not fire at exactly the threshold, or below a minimum change", () => {
		const items = monthly("A", ["100.00", "100.00", "100.00", "125.00"]);
		expect(detectSpendDrift(items, { asOf: "2026-09-30" }).alerts).toEqual([]);
		const big = monthly("A", ["100.00", "100.00", "100.00", "200.00"]);
		expect(
			detectSpendDrift(big, { asOf: "2026-09-30", minChangeMinor: 20000 })
				.alerts,
		).toEqual([]);
		expect(
			detectSpendDrift(big, { asOf: "2026-09-30", thresholdRatio: "1" }).alerts,
		).toEqual([]);
	});

	it("needs baseline months plus the latest month", () => {
		const r = detectSpendDrift(monthly("A", ["100.00", "100.00", "130.00"]), {
			asOf: "2026-08-31",
		});
		expect(r).toMatchObject({
			status: "not_enough_data",
			requiredMonths: 4,
			alerts: [],
		});
	});
});

describe("detectPriceRises", () => {
	const obs = (
		vendor: string,
		unitPrice: string,
		date: string,
		extra: Partial<LineObservation> = {},
	): LineObservation => ({
		vendor,
		item: "Chicken breast",
		unit: "lb",
		unitPrice,
		date,
		currency: "USD",
		ref: date,
		...extra,
	});
	const lines = [
		obs("Harbor Foods", "2.10", "2026-08-01"),
		obs("HARBOR FOODS INC", "2.20", "2026-08-20", { unit: "LBS" }),
		obs("Harbor Foods", "2.10", "2026-08-10"),
		obs("Harbor Foods", "2.15", "2026-09-01"),
		obs("Harbor Foods", "9.99", "2026-09-02", { currency: "EUR" }),
	];

	it("fires on a rise between consecutive invoices, matching name and unit variants", () => {
		expect(detectPriceRises(lines)).toEqual([
			{
				kind: "price_rise",
				vendor: "HARBOR FOODS INC",
				item: "Chicken breast",
				unit: "LBS",
				currency: "USD",
				previousPrice: "2.10",
				previousDate: "2026-08-10",
				previousRef: "2026-08-10",
				newPrice: "2.20",
				date: "2026-08-20",
				ref: "2026-08-20",
				changeAmount: "0.1",
				changeRatio: "0.0476",
				thresholdRatio: "0",
			},
		]);
	});

	it("does not fire below the threshold, on drops, or across currencies", () => {
		expect(detectPriceRises(lines, { thresholdRatio: "0.05" })).toEqual([]);
		expect(detectPriceRises(lines, { asOf: "2026-08-19" })).toEqual([]);
	});
});

describe("currency guard", () => {
	const mixed = [
		item({ counterparty: "A", currency: "USD" }),
		item({ counterparty: "B", currency: "EUR" }),
	];

	it("refuses to sum different currencies", () => {
		expect(() => buildCashCalendar(mixed, { asOf: "2026-02-01" })).toThrow(
			MixedCurrencyError,
		);
		expect(() => buildTrend(mixed, { asOf: "2026-02-01" })).toThrow(
			MixedCurrencyError,
		);
		expect(() => buildForecast(mixed, { asOf: "2026-02-01" })).toThrow(
			/EUR, USD/,
		);
		expect(() =>
			buildCashCalendar([mixed[0] as CashItem], {
				asOf: "2026-02-01",
				currency: "EUR",
			}),
		).toThrow(MixedCurrencyError);
	});

	it("groups by currency so each can be forecast alone", () => {
		const groups = groupByCurrency(mixed);
		expect([...groups.keys()]).toEqual(["EUR", "USD"]);
		for (const [currency, list] of groups) {
			expect(buildForecast(list, { asOf: "2026-02-01" }).currency).toBe(
				currency,
			);
		}
	});
});

describe("buildForecast and buildDigestInput", () => {
	const items = [
		...historyItems(),
		item({ counterparty: "A", amount: "1000.00", dueDate: "2026-02-10" }),
		item({ counterparty: "C", amount: "75.00", dueDate: "2026-01-15" }),
	];

	it("validates input at the boundary", () => {
		const bad = { ...items[0], amount: 12.5 } as unknown as CashItem;
		expect(() => buildForecast([bad], { asOf: "2026-02-01" })).toThrow();
		expect(() => buildCashCalendar(items, { asOf: "2026-02-30" })).toThrow(
			/Invalid date/,
		);
	});

	it("is deterministic regardless of input order", () => {
		const a = buildDigestInput(buildForecast(items, { asOf: "2026-02-01" }));
		const b = buildDigestInput(
			buildForecast([...items].reverse(), { asOf: "2026-02-01" }),
		);
		expect(JSON.stringify(b)).toBe(JSON.stringify(a));
	});

	it("produces a JSON-safe digest with not-enough-data trend", () => {
		const d = buildDigestInput(buildForecast(items, { asOf: "2026-02-01" }));
		expect(JSON.parse(JSON.stringify(d))).toEqual(d);
		expect(d.trend).toEqual({
			status: "not_enough_data",
			completeMonths: ["2026-01"],
			requiredMonths: 3,
		});
		expect(d.alerts.spendDrift).toEqual({
			status: "not_enough_data",
			requiredMonths: 4,
		});
		expect(d.cash.pastDue.out).toEqual({ count: 2, totalMinor: 17500 });
		expect(d.cash.largestUpcoming[0]?.amountMinor).toBe(100000);
		expect(d.methods.cashCalendar).toMatch(/median/);
	});
});
