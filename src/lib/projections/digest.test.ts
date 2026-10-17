import { describe, expect, it } from "vitest";
import {
	buildDigestInput,
	buildForecast,
	type CashItem,
	type LineObservation,
} from "#/lib/forecast/index.ts";
import {
	allowedFigures,
	checkDigestText,
	digestFacts,
	digestRetryPrompt,
	percentsIn,
} from "./digest.ts";
import { formatPercent, formatPrice } from "./format.ts";

const items: CashItem[] = [
	{
		id: "b1",
		direction: "out",
		counterparty: "Dairy Pure",
		currency: "USD",
		amount: "3110.40",
		issueDate: "2026-09-02",
		dueDate: "2026-10-02",
		paidOn: null,
	},
	{
		id: "b2",
		direction: "out",
		counterparty: "Harbor Foods",
		currency: "USD",
		amount: "25092.00",
		issueDate: "2026-10-05",
		dueDate: "2026-11-04",
		paidOn: null,
	},
];
const lines: LineObservation[] = [
	{
		vendor: "Dairy Pure",
		item: "Milk",
		unit: "case",
		unitPrice: "9.85",
		date: "2026-09-02",
		currency: "USD",
		ref: "b0#1",
	},
	{
		vendor: "Dairy Pure",
		item: "Milk",
		unit: "case",
		unitPrice: "11.05",
		date: "2026-09-17",
		currency: "USD",
		ref: "b1#1",
	},
];
const input = buildDigestInput(
	buildForecast(items, { asOf: "2026-10-21", lines }),
);
const facts = digestFacts(input);

describe("digestFacts", () => {
	it("formats minor units as money and ratios as percentages, in code", () => {
		const json = JSON.stringify(facts);
		expect(json).not.toMatch(/Minor"/);
		expect(json).not.toMatch(/"amountUnit"/);
		expect(json).toContain('"$28,202.40"'); // 30-day cash out, from 2820240 minor
		expect(json).toContain('"$3,110.40"'); // past due
		const cash = facts.cash as { pastDue: { out: Record<string, unknown> } };
		expect(cash.pastDue.out).toEqual({ count: 1, total: "$3,110.40" });
		const rises = (
			facts.alerts as { priceRises: { items: Record<string, unknown>[] } }
		).priceRises.items;
		expect(rises[0]).toMatchObject({
			previousPrice: "$9.85",
			newPrice: "$11.05",
			changeAmount: "$1.20",
			changePercent: "12.18%",
			thresholdPercent: "0%",
		});
	});

	it("is deterministic", () => {
		expect(JSON.stringify(digestFacts(input))).toBe(JSON.stringify(facts));
	});
});

describe("formatting", () => {
	it("keeps price precision and turns ratios into exact percentages", () => {
		expect(formatPrice("0.625", "USD")).toBe("$0.625");
		expect(formatPrice("9.8", "USD")).toBe("$9.80");
		expect(formatPercent("0.1218")).toBe("12.18%");
		expect(formatPercent("-0.5")).toBe("-50%");
		expect(percentsIn("up 12.18% and 3 %")).toEqual(["12.18", "3"]);
	});
});

describe("checkDigestText (the dispute-draft amount guard, reused)", () => {
	it("collects every amount and percentage written in the facts", () => {
		const allowed = allowedFigures(facts);
		expect(allowed.amounts).toContain("28202.40");
		expect(allowed.amounts).toContain("9.85");
		expect(allowed.percents).toContain("12.18");
	});

	it("accepts a summary that copies figures from the facts", () => {
		const text =
			"About $28,202.40 is expected to go out in the next 30 days. One bill of $3,110.40 is past due. Dairy Pure raised Milk from $9.85 to $11.05 per case (12.18%).";
		expect(checkDigestText(text, facts)).toEqual({
			ok: true,
			amounts: 4,
			percents: 1,
		});
	});

	it("treats a negative net as the same figure and ignores comma grouping", () => {
		expect(checkDigestText("Net is -$28202.40.", facts).ok).toBe(true);
	});

	it("rejects invented, rounded or summed figures", () => {
		const text =
			"Roughly $28k goes out, $31,312.80 in total, a 12% rise, plus $3,110.40 past due.";
		const check = checkDigestText(text, facts);
		expect(check).toEqual({
			ok: false,
			amounts: 3,
			percents: 1,
			unknownAmounts: ["28", "31312.80"],
			unknownPercents: ["12"],
		});
		if (!check.ok) {
			expect(digestRetryPrompt(check)).toContain("$28, $31312.80, 12%");
		}
	});
});
