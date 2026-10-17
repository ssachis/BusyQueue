import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	parseAnswerKey,
	parseInvoice,
	parsePayments,
	parsePriceList,
} from "../busyq/load.ts";
import { normalizeUnit, sameVendor } from "./aliases.ts";
import { calculateImpact } from "./impact.ts";
import {
	checkInvoice,
	checkInvoicePayments,
	compareLines,
	lookupPrices,
	lookupPricesV2,
	scoreRun,
} from "./index.ts";

const read = (p: string) => readFileSync(`data/${p}`, "utf8");
const prices = parsePriceList(read("price_list.csv"));
const invoices = readdirSync("data/invoices")
	.sort()
	.map((f) => parseInvoice(JSON.parse(read(`invoices/${f}`))));
const payments = parsePayments(read("payments.csv"));
const key = parseAnswerKey(read("answer_key.csv"));

describe("aliases", () => {
	it("matches vendor spelling variants", () => {
		expect(sameVendor("Harbor Foods", "HARBOR FOODS INC")).toBe(true);
		expect(sameVendor("Harbor Foods", "Harbor Foods, Inc.")).toBe(true);
		expect(sameVendor("Valley Fresh Produce", "Valley Fresh")).toBe(true);
		expect(sameVendor("Dairy Pure", "Dairy-Pure")).toBe(true);
		expect(sameVendor("Dairy Pure", "DAIRY PURE CO")).toBe(true);
	});
	it("does not match on a shared first word", () => {
		expect(sameVendor("Harbor Foods", "Harbor Freight")).toBe(false);
		expect(sameVendor("Valley Fresh Produce", "Valley Dairy")).toBe(false);
		expect(sameVendor("Fresh", "Fresh Foods")).toBe(false);
	});
	it("normalises unit aliases", () => {
		expect(["CS", "Case", "cases"].map(normalizeUnit)).toEqual(["case", "case", "case"]);
		expect(["lbs", "LB"].map(normalizeUnit)).toEqual(["lb", "lb"]);
		expect(["BG", "bags"].map(normalizeUnit)).toEqual(["bag", "bag"]);
	});
});

describe("lookupPricesV2", () => {
	it("converts a case price through pack size by multiplying", () => {
		const r = lookupPricesV2(prices, "HARBOR FOODS INC", { item: "Chicken breast", unit: "case" });
		expect(r.ok && r.data.agreedUnitPrice).toBe("84");
		const c = lookupPricesV2(prices, "Valley Fresh", { item: "Carrots", unit: "case" });
		expect(c.ok && c.data.agreedUnitPrice).toBe("39");
	});
	it("still fails on an unknown vendor or item, never guesses", () => {
		expect(lookupPricesV2(prices, "Acme Corp", { item: "Apples", unit: "case" }).ok).toBe(false);
		expect(lookupPricesV2(prices, "Valley Fresh", { item: "Kiwi", unit: "case" }).ok).toBe(false);
	});
	it("reports a unit with no pack conversion as unit_mismatch", () => {
		const r = lookupPricesV2(prices, "Harbor Foods", { item: "Pasta penne", unit: "lb" });
		expect(!r.ok && r.error.code).toBe("unit_mismatch");
	});
});

describe("v1 vs v2 on the generated data", () => {
	const run = (lookup: typeof lookupPrices) => {
		const findings = invoices.flatMap((inv) => [
			...compareLines(inv, prices, lookup).findings,
			...checkInvoice(inv),
			...checkInvoicePayments(inv, payments),
		]);
		const unpriced = invoices.flatMap((inv) => compareLines(inv, prices, lookup).unpriced);
		return { findings, unpriced };
	};
	it("v2 prices every line", () => {
		expect(run(lookupPricesV2).unpriced).toEqual([]);
		expect(run(lookupPrices).unpriced.length).toBeGreaterThan(0);
	});
	it("v2 finds every planted invoice-level problem with no false flags and beats v1", () => {
		const ids = new Set(invoices.map((i) => i.id));
		const v1 = scoreRun(run(lookupPrices).findings, key, ids);
		const v2 = scoreRun(run(lookupPricesV2).findings, key, ids);
		expect(v2.falsePositives).toEqual([]);
		expect(v2.recall).toBeGreaterThan(v1.recall);
		expect(v2.recall).toBe(1);
		expect(calculateImpact(run(lookupPricesV2).findings).total.minor).toBeGreaterThan(
			calculateImpact(run(lookupPrices).findings).total.minor,
		);
	});
});
