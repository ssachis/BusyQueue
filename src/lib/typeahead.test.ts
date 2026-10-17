import { describe, expect, it } from "vitest";
import { matchScore, rankMatches } from "./typeahead.ts";

describe("matchScore", () => {
	it("ranks exact over prefix over word-prefix over substring", () => {
		expect(matchScore("milk", "Milk")).toBe(4);
		expect(matchScore("mil", "Milk 1%")).toBe(3);
		expect(matchScore("half", "Milk half-pint")).toBe(2);
		expect(matchScore("ilk", "Milk")).toBe(1);
		expect(matchScore("zzz", "Milk")).toBe(0);
	});

	it("ignores case and surrounding spaces", () => {
		expect(matchScore("  MILK ", "milk")).toBe(4);
	});
});

describe("rankMatches", () => {
	const items = [
		{ name: "Whole milk", code: "DM-2" },
		{ name: "Milk", code: "DM-1" },
		{ name: "Chocolate milk", code: "DM-3" },
		{ name: "Eggs", code: "EG-1" },
	];
	const keys = [
		(i: (typeof items)[number]) => i.name,
		(i: (typeof items)[number]) => i.code,
	];

	it("puts the best match first and drops non-matches", () => {
		expect(rankMatches("milk", items, keys).map((i) => i.name)).toEqual([
			"Milk",
			"Whole milk",
			"Chocolate milk",
		]);
	});

	it("matches on any key, such as the item code", () => {
		expect(rankMatches("eg-", items, keys).map((i) => i.name)).toEqual(["Eggs"]);
	});

	it("returns the first items for an empty query and honours the limit", () => {
		expect(rankMatches("", items, keys, 2)).toHaveLength(2);
		expect(rankMatches("milk", items, keys, 1)).toHaveLength(1);
	});
});
