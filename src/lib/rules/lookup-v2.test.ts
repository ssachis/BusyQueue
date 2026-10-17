import { describe, expect, it } from "vitest";
import { invoices, priceList } from "#/lib/busyq/fixtures/index.ts";
import type { PriceRow } from "#/lib/busyq/types.ts";
import { normalizeUnit, normalizeVendor, resolveVendor } from "./aliases.ts";
import { compareLines } from "./compare.ts";
import { lookupPrices } from "./lookup.ts";
import { lookupPricesV2 } from "./lookup-v2.ts";

describe("normalizeVendor", () => {
	it("drops case, punctuation and legal suffixes", () => {
		for (const v of [
			"HARBOR FOODS INC",
			"Harbor Foods, Inc.",
			"Harbor Foods Co.",
			"harbor   foods",
		]) {
			expect(normalizeVendor(v)).toBe("harbor foods");
		}
		expect(normalizeVendor("Dairy-Pure")).toBe("dairy pure");
		expect(normalizeVendor("VALLEY FRESH PRODUCE LLC")).toBe(
			"valley fresh produce",
		);
	});
});

describe("resolveVendor", () => {
	const vendors = [
		"Harbor Foods",
		"Valley Fresh Produce",
		"Dairy Pure",
		"Sysco",
	];

	it("resolves exact, suffix and word-prefix variants", () => {
		expect(resolveVendor("HARBOR FOODS INC", vendors)).toEqual({
			ok: true,
			vendor: "Harbor Foods",
		});
		expect(resolveVendor("Valley Fresh", vendors)).toEqual({
			ok: true,
			vendor: "Valley Fresh Produce",
		});
		expect(resolveVendor("SYSCO Foods", vendors)).toEqual({
			ok: true,
			vendor: "Sysco",
		});
	});

	it("refuses to guess between vendors or for strangers", () => {
		expect(
			resolveVendor("Valley", ["Valley Fresh Produce", "Valley Dairy"]),
		).toMatchObject({
			ok: false,
			reason: "ambiguous",
		});
		expect(resolveVendor("Acme Supply", vendors)).toMatchObject({
			ok: false,
			reason: "unknown",
		});
		// "Harbor" alone must not match "Harborview Foods": whole words only.
		expect(resolveVendor("Harbor", ["Harborview Foods"])).toMatchObject({
			ok: false,
		});
	});
});

describe("normalizeUnit", () => {
	it("collapses synonyms and leaves unknown units alone", () => {
		expect(["LB", "lbs", "Pounds"].map(normalizeUnit)).toEqual([
			"lb",
			"lb",
			"lb",
		]);
		expect(["CS", "Case", "cases"].map(normalizeUnit)).toEqual([
			"case",
			"case",
			"case",
		]);
		expect(normalizeUnit("Tray")).toBe("tray");
	});
});

describe("lookupPricesV2", () => {
	const line = (item: string, unit: string) => ({ item, unit });

	it("prices a pack unit as unitPrice × packSize, exactly", () => {
		const r = lookupPricesV2(
			priceList,
			"SYSCO Foods",
			line("Chicken breast", "case"),
		);
		expect(r).toMatchObject({ ok: true, data: { agreedUnitPrice: "84" } });
	});

	it("matches unit synonyms and item case", () => {
		const r = lookupPricesV2(priceList, "Sysco", line("chicken BREAST", "lbs"));
		expect(r).toMatchObject({ ok: true, data: { agreedUnitPrice: "2.10" } });
	});

	it("reports unit_mismatch when no unit or pack fits", () => {
		const r = lookupPricesV2(
			priceList,
			"Sysco",
			line("Chicken breast", "pallet"),
		);
		expect(r).toMatchObject({ ok: false, error: { code: "unit_mismatch" } });
	});

	it("reports price_not_found for an unknown vendor or item", () => {
		expect(
			lookupPricesV2(priceList, "Acme", line("Chicken breast", "lb")),
		).toMatchObject({
			ok: false,
			error: { code: "price_not_found" },
		});
		expect(
			lookupPricesV2(priceList, "Sysco", line("Salmon", "lb")),
		).toMatchObject({
			ok: false,
			error: { code: "price_not_found" },
		});
	});

	it("turns the v1 failure on the variant fixture into the $72 finding", () => {
		const variant = invoices.find((i) => i.id === "inv-variant");
		if (!variant) throw new Error("fixture missing");
		const v1 = compareLines(variant, priceList, lookupPrices);
		const v2 = compareLines(variant, priceList, lookupPricesV2);
		expect(v1.unpriced).toHaveLength(1);
		expect(v2.unpriced).toEqual([]);
		expect(v2.findings[0]).toMatchObject({
			impactMinor: 7200,
			expected: "84.00",
		});
	});

	it("never matches across vendors", () => {
		const prices: PriceRow[] = [
			{
				vendor: "Harbor Foods",
				item: "Rice",
				unit: "bag",
				unitPrice: "14.20",
				currency: "USD",
			},
		];
		expect(lookupPricesV2(prices, "Valley Fresh", line("Rice", "bag")).ok).toBe(
			false,
		);
	});
});
