import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	type ContractPrice,
	type CurrentPrice,
	diffPriceList,
	formatPriceDelta,
	formatUnitPrice,
	matchContractVendor,
	normalizePackSize,
	normalizePrintedDecimal,
	numbersInText,
	parseExtraction,
	parseModelJson,
	vendorSlug,
} from "./index.ts";

const sample = readFileSync(
	new URL("../../../data/contracts/harbor-foods-2026.txt", import.meta.url),
	"utf8",
);

/** What a faithful transcription of the sample contract looks like. */
const faithful = {
	vendor: "Harbor Foods, Inc.",
	title: "Bid No. NUSD-NS-2026-03",
	startDate: "2026-07-01",
	endDate: "2027-06-30",
	noticeDays: 60,
	autoRenew: true,
	currency: "USD",
	prices: [
		{
			item: "Chicken breast",
			unit: "lb",
			unitPrice: "1.95",
			packUnit: "case",
			packSize: "40",
		},
		{
			item: "Ground beef 85/15",
			unit: "lb",
			unitPrice: "3.45",
			packUnit: "case",
			packSize: "40",
		},
		{ item: "Brown rice", unit: "bag", unitPrice: "14.20" },
		{ item: "Pasta penne", unit: "case", unitPrice: "21.75" },
		{ item: "Canned tomatoes", unit: "case", unitPrice: "18.90" },
		{ item: "Whole grain bread", unit: "case", unitPrice: "16.80" },
		{
			item: "Turkey deli slices",
			unit: "lb",
			unitPrice: "4.25",
			packUnit: "case",
			packSize: "12",
		},
	],
	uncertainFields: [],
};

const opts = { sourceText: sample, defaultCurrency: "USD" };

/** Harbor Foods rows of data/price_list.csv. */
function harborPriceList(): CurrentPrice[] {
	const [, ...lines] = readFileSync(
		new URL("../../../data/price_list.csv", import.meta.url),
		"utf8",
	)
		.trim()
		.split("\n");
	return lines
		.map((l) => l.split(","))
		.filter(([vendor]) => vendor === "Harbor Foods")
		.map(([, item, unit, unitPrice, currency, packUnit, packSize]) => ({
			item: item as string,
			unit: unit as string,
			unitPrice: unitPrice as string,
			currency: currency as string,
			packUnit: packUnit || null,
			packSize: packSize || null,
		}));
}

const price = (p: Partial<ContractPrice>): ContractPrice => ({
	lineNo: 1,
	item: "Chicken breast",
	unit: "lb",
	unitPrice: "1.95",
	packUnit: null,
	packSize: null,
	blocked: false,
	...p,
});

describe("normalizePrintedDecimal", () => {
	it("strips currency markers and thousands separators, nothing else", () => {
		expect(normalizePrintedDecimal("$1.95")).toBe("1.95");
		expect(normalizePrintedDecimal(" USD 16.80 ")).toBe("16.80");
		expect(normalizePrintedDecimal("$1,234.50")).toBe("1234.50");
		expect(normalizePrintedDecimal("40")).toBe("40");
		expect(normalizePrintedDecimal(1.95)).toBe("1.95");
	});

	it("rejects anything that isn't a positive decimal", () => {
		for (const bad of ["", "abc", "1.2.3", "-1.95", "0.00", "1,95", "~2"]) {
			expect(normalizePrintedDecimal(bad), bad).toBeNull();
		}
		expect(normalizePrintedDecimal(null)).toBeNull();
	});
});

describe("normalizePackSize", () => {
	it("allows the row's own unit after the number", () => {
		expect(normalizePackSize("40 lb", "lb")).toBe("40");
		expect(normalizePackSize("40 LBS", "lb")).toBe("40");
		expect(normalizePackSize("40", "lb")).toBe("40");
		expect(normalizePackSize(12, "lb")).toBe("12");
	});

	it("rejects a size in some other unit", () => {
		expect(normalizePackSize("6 oz", "lb")).toBeNull();
		expect(normalizePackSize("case of 40", "lb")).toBeNull();
	});
});

describe("numbersInText", () => {
	it("collects printed numbers in canonical form", () => {
		const n = numbersInText("Bread $16.80 per case; 1,200 cases; 12 per cs");
		expect(n.has("16.8")).toBe(true);
		expect(n.has("1200")).toBe(true);
		expect(n.has("12")).toBe(true);
		expect(n.has("16.4")).toBe(false);
	});
});

describe("parseModelJson", () => {
	it("reads plain, fenced and wrapped JSON", () => {
		expect(parseModelJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
		expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({
			ok: true,
			value: { a: 1 },
		});
		expect(parseModelJson('Here you go: {"a":1} done')).toEqual({
			ok: true,
			value: { a: 1 },
		});
	});

	it("reports empty, missing and broken JSON", () => {
		expect(parseModelJson("").ok).toBe(false);
		expect(parseModelJson("no json here").ok).toBe(false);
		expect(parseModelJson('{"a":').ok).toBe(false);
	});
});

describe("parseExtraction", () => {
	it("accepts a faithful transcription of the sample contract", () => {
		const parsed = parseExtraction(faithful, opts);
		expect(parsed.flags).toEqual([]);
		expect(parsed.terms).toEqual({
			vendorName: "Harbor Foods, Inc.",
			title: "Bid No. NUSD-NS-2026-03",
			startDate: "2026-07-01",
			endDate: "2027-06-30",
			noticeDays: 60,
			autoRenew: true,
			currency: "USD",
		});
		expect(parsed.prices).toHaveLength(7);
		expect(parsed.prices.every((p) => !p.blocked)).toBe(true);
		expect(parsed.prices[0]).toEqual({
			lineNo: 1,
			item: "Chicken breast",
			unit: "lb",
			unitPrice: "1.95",
			packUnit: "case",
			packSize: "40",
			blocked: false,
		});
	});

	it("blocks a price that is not printed in the contract", () => {
		const parsed = parseExtraction(
			{
				...faithful,
				prices: [{ item: "Chicken breast", unit: "lb", unitPrice: "1.85" }],
			},
			opts,
		);
		expect(parsed.prices[0]?.blocked).toBe(true);
		expect(parsed.prices[0]?.unitPrice).toBeNull();
		expect(parsed.flags).toContainEqual(
			expect.objectContaining({
				path: "prices.1.unitPrice",
				severity: "error",
				source: "validation",
			}),
		);
		expect(parsed.flags.some((f) => f.path === "prices")).toBe(true);
	});

	it("accepts a price written with a symbol or as a number when it is printed", () => {
		const parsed = parseExtraction(
			{
				...faithful,
				prices: [
					{ item: "Chicken breast", unit: "lb", unitPrice: "$1.95" },
					{ item: "Brown rice", unit: "bag", unitPrice: 14.2 },
				],
			},
			opts,
		);
		expect(parsed.prices.map((p) => p.unitPrice)).toEqual(["1.95", "14.2"]);
		expect(parsed.prices.every((p) => !p.blocked)).toBe(true);
	});

	it("blocks rows missing an item, unit or price, and duplicates", () => {
		const parsed = parseExtraction(
			{
				...faithful,
				prices: [
					{ item: "", unit: "lb", unitPrice: "1.95" },
					{ item: "Brown rice", unitPrice: "14.20" },
					{ item: "Pasta penne", unit: "case", unitPrice: null },
					{ item: "Chicken breast", unit: "lb", unitPrice: "1.95" },
					{ item: "chicken  BREAST", unit: "LBS", unitPrice: "1.95" },
					"not a row",
				],
			},
			opts,
		);
		expect(parsed.prices.map((p) => p.blocked)).toEqual([
			true,
			true,
			true,
			false,
			true,
			true,
		]);
		expect(parsed.flags.find((f) => f.path === "prices.5.item")?.message).toBe(
			"Same item and unit as line 4.",
		);
	});

	it("ignores a half-specified pack with a warning", () => {
		const parsed = parseExtraction(
			{
				...faithful,
				prices: [
					{
						item: "Chicken breast",
						unit: "lb",
						unitPrice: "1.95",
						packUnit: "case",
					},
					{
						item: "Brown rice",
						unit: "bag",
						unitPrice: "14.20",
						packUnit: "pallet",
						packSize: "77",
					},
				],
			},
			opts,
		);
		expect(
			parsed.prices.map((p) => [p.packUnit, p.packSize, p.blocked]),
		).toEqual([
			[null, null, false],
			[null, null, false],
		]);
		expect(
			parsed.flags.filter((f) => f.severity === "warning").map((f) => f.path),
		).toEqual(["prices.1.packSize", "prices.2.packSize"]);
	});

	it("reads a pack size written with the row's unit", () => {
		const parsed = parseExtraction(
			{
				...faithful,
				prices: [
					{
						item: "Chicken breast",
						unit: "lb",
						unitPrice: "1.95",
						packUnit: "case",
						packSize: "40 lb",
					},
					{
						item: "Brown rice",
						unit: "bag",
						unitPrice: "14.20",
						packUnit: "case",
						packSize: "6 oz",
					},
				],
			},
			opts,
		);
		expect(parsed.prices.map((p) => [p.packUnit, p.packSize])).toEqual([
			["case", "40"],
			[null, null],
		]);
		expect(parsed.flags.map((f) => [f.path, f.message])).toEqual([
			["prices.2.packSize", '"6 oz" is not a pack size; pack ignored.'],
		]);
	});

	it("flags what the model was unsure of, and odd items", () => {
		const parsed = parseExtraction(
			{
				...faithful,
				uncertainFields: ["endDate", "bogus"],
				prices: [
					{
						item: "Chicken breast",
						unit: "lb",
						unitPrice: "1.95",
						uncertain: true,
						note: "smudged",
					},
					{ item: "Chicken thighs", unit: "lb", unitPrice: "3.45" },
				],
			},
			opts,
		);
		expect(parsed.flags).toEqual([
			{
				path: "endDate",
				severity: "warning",
				source: "model",
				message: "The model was not sure about this.",
			},
			{
				path: "prices.1",
				severity: "warning",
				source: "model",
				message: "The model was not sure: smudged",
			},
			expect.objectContaining({ path: "prices.2.item", severity: "warning" }),
		]);
		expect(parsed.prices.every((p) => !p.blocked)).toBe(true);
	});

	it("flags bad terms without failing the contract", () => {
		const parsed = parseExtraction(
			{
				...faithful,
				vendor: "  ",
				startDate: "July 1, 2026",
				endDate: "2025-06-30",
				noticeDays: "two months",
				currency: "dollars",
			},
			{ ...opts, defaultCurrency: "USD" },
		);
		expect(parsed.terms).toMatchObject({
			vendorName: null,
			startDate: null,
			endDate: "2025-06-30",
			noticeDays: null,
			currency: "USD",
		});
		expect(parsed.flags.map((f) => f.path)).toEqual([
			"vendor",
			"startDate",
			"noticeDays",
			"currency",
		]);
		expect(parsed.prices.every((p) => !p.blocked)).toBe(true);
	});

	it("flags an end date before the start", () => {
		const parsed = parseExtraction(
			{ ...faithful, startDate: "2027-07-01", endDate: "2026-06-30" },
			opts,
		);
		expect(parsed.flags.map((f) => f.path)).toEqual(["endDate"]);
	});

	it("returns an error flag for the wrong shape", () => {
		const parsed = parseExtraction({ prices: "lots" }, opts);
		expect(parsed.prices).toEqual([]);
		expect(parsed.flags[0]).toMatchObject({ path: "", severity: "error" });
	});
});

describe("diffPriceList", () => {
	it("shows the sample contract's changes against the Harbor Foods list", () => {
		const parsed = parseExtraction(faithful, opts);
		const diff = diffPriceList(harborPriceList(), parsed.prices, "USD");
		expect(diff.counts).toEqual({ new: 1, changed: 2, unchanged: 4 });
		expect(diff.notInContract).toEqual([]);
		expect(diff.skipped).toEqual([]);

		const changed = diff.rows.filter((r) => r.status === "changed");
		expect(
			changed.map((r) => [r.item, r.oldUnitPrice, r.newUnitPrice, r.delta]),
		).toEqual([
			["Chicken breast", "2.10", "1.95", "-0.15"],
			["Whole grain bread", "16.40", "16.80", "0.4"],
		]);
		expect(changed.every((r) => r.changes.join() === "price")).toBe(true);

		const added = diff.rows.find((r) => r.status === "new");
		expect(added?.apply).toEqual({
			item: "Turkey deli slices",
			unit: "lb",
			unitPrice: "4.25",
			currency: "USD",
			packUnit: "case",
			packSize: "12",
		});
	});

	it("keeps the current spelling so lookups still match", () => {
		const current: CurrentPrice[] = [
			{
				item: "Chicken breast",
				unit: "lb",
				unitPrice: "2.10",
				currency: "USD",
				packUnit: "case",
				packSize: "40",
			},
		];
		const diff = diffPriceList(
			current,
			[
				price({
					item: "CHICKEN  Breast",
					unit: "LBS",
					unitPrice: "2.1",
					packUnit: "CS",
					packSize: "40.0",
				}),
			],
			"USD",
		);
		expect(diff.rows[0]).toMatchObject({
			status: "unchanged",
			item: "Chicken breast",
			unit: "lb",
			delta: "0",
			changes: [],
		});
		expect(diff.rows[0]?.apply).toMatchObject({
			item: "Chicken breast",
			unit: "lb",
			unitPrice: "2.1",
			packUnit: "case",
			packSize: "40.0",
		});
	});

	it("detects pack and currency changes", () => {
		const current: CurrentPrice[] = [
			{
				item: "Chicken breast",
				unit: "lb",
				unitPrice: "1.95",
				currency: "USD",
				packUnit: "case",
				packSize: "40",
			},
		];
		const diff = diffPriceList(
			current,
			[price({ packUnit: "case", packSize: "30" })],
			"CAD",
		);
		expect(diff.rows[0]).toMatchObject({
			status: "changed",
			changes: ["pack", "currency"],
			oldPack: "case of 40",
			newPack: "case of 30",
		});

		const dropped = diffPriceList(current, [price({})], "USD");
		expect(dropped.rows[0]?.changes).toEqual(["pack"]);
	});

	it("skips blocked and excluded lines and lists rows the contract omits", () => {
		const current: CurrentPrice[] = [
			{
				item: "Chicken breast",
				unit: "lb",
				unitPrice: "2.10",
				currency: "USD",
				packUnit: null,
				packSize: null,
			},
			{
				item: "Brown rice",
				unit: "bag",
				unitPrice: "14.20",
				currency: "USD",
				packUnit: null,
				packSize: null,
			},
		];
		const diff = diffPriceList(
			current,
			[
				price({ lineNo: 1 }),
				price({
					lineNo: 2,
					item: "Pasta penne",
					unit: "case",
					unitPrice: null,
					blocked: true,
				}),
				price({ lineNo: 3, item: "Bananas", unitPrice: "0.62" }),
			],
			"USD",
			new Set([3]),
		);
		expect(diff.rows.map((r) => r.lineNo)).toEqual([1]);
		expect(diff.skipped).toEqual([2, 3]);
		expect(diff.notInContract.map((c) => c.item)).toEqual(["Brown rice"]);
	});
});

describe("matchContractVendor", () => {
	const vendors = [
		{ id: "harbor-foods", name: "Harbor Foods" },
		{ id: "valley-fresh-produce", name: "Valley Fresh Produce" },
		{ id: "valley-fresh-dairy", name: "Valley Fresh Dairy" },
	];

	it("matches exact and word-prefix spellings", () => {
		expect(matchContractVendor("HARBOR FOODS, INC.", vendors)).toEqual({
			status: "matched",
			vendor: vendors[0],
		});
		expect(matchContractVendor("Valley Fresh Produce Co", vendors)).toEqual({
			status: "matched",
			vendor: vendors[1],
		});
	});

	it("leaves ambiguous, unknown and missing names to the director", () => {
		expect(matchContractVendor("Valley Fresh", vendors)).toEqual({
			status: "ambiguous",
			candidates: [vendors[1], vendors[2]],
		});
		expect(matchContractVendor("Coastal Bakery", vendors)).toEqual({
			status: "unknown",
		});
		expect(matchContractVendor(null, vendors)).toEqual({ status: "missing" });
	});

	it("slugs vendor ids like the seed script", () => {
		expect(vendorSlug("Harbor Foods")).toBe("harbor-foods");
		expect(vendorSlug(" Coastal Bakery, Inc. ")).toBe("coastal-bakery-inc");
	});
});

describe("formatting", () => {
	it("keeps every printed decimal of a unit price", () => {
		expect(formatUnitPrice("1.95", "USD")).toBe("$1.95");
		expect(formatUnitPrice("16.8", "USD")).toBe("$16.80");
		expect(formatUnitPrice("0.785", "USD")).toBe("$0.785");
		expect(formatUnitPrice("1234.5", "USD")).toBe("$1,234.50");
	});

	it("signs price changes", () => {
		expect(formatPriceDelta("0.4", "USD")).toBe("+$0.40");
		expect(formatPriceDelta("-0.15", "USD")).toBe("−$0.15");
		expect(formatPriceDelta("0", "USD")).toBe("no change");
	});
});
