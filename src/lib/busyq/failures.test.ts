import { describe, expect, it } from "vitest";
import { summarizeFailures } from "./failures.ts";
import { priceList } from "./fixtures/index.ts";

const lookupFail = (
	vendor: string,
	unmatched: { line: number; item: string; unit: string }[],
) => ({
	name: "lookup_vendor_prices",
	status: "error" as const,
	errorCode: "price_not_found",
	errorMessage: `No agreed price for ${unmatched.length} lines from vendor "${vendor}"`,
	details: { vendor, unmatched, matched: [] },
});
const ok = (name: string) => ({ name, status: "ok" as const });

describe("summarizeFailures", () => {
	it("names vendor and unit variants as the cause", () => {
		const summary = summarizeFailures(
			[
				{
					runId: "r1",
					invoiceId: "inv-a",
					vendor: "SYSCO Foods",
					toolLog: [
						ok("get_invoice"),
						lookupFail("SYSCO Foods", [
							{ line: 1, item: "Chicken breast", unit: "case" },
						]),
					],
				},
				{
					runId: "r2",
					invoiceId: "inv-b",
					vendor: "Sysco",
					toolLog: [
						ok("get_invoice"),
						lookupFail("Sysco", [
							{ line: 2, item: "Yellow onions", unit: "lbs" },
						]),
					],
				},
				{
					runId: "r3",
					invoiceId: "inv-c",
					vendor: "Sysco",
					toolLog: [ok("get_invoice"), ok("lookup_vendor_prices")],
				},
			],
			priceList,
		);

		expect(summary).toMatchObject({ runs: 3, failedRuns: 2 });
		expect(summary.groups).toEqual([
			expect.objectContaining({
				tool: "lookup_vendor_prices",
				code: "price_not_found",
				runs: 2,
				invoiceIds: ["inv-a", "inv-b"],
			}),
		]);
		expect(summary.vendorVariants).toEqual([
			{ printed: "SYSCO Foods", canonical: "Sysco", invoiceIds: ["inv-a"] },
		]);
		// "case" is Chicken breast's pack unit (still a mismatch for exact v1), "lbs" a synonym.
		expect(
			summary.unitVariants.map((u) => [u.item, u.billedUnit, u.contractUnits]),
		).toEqual([
			["Chicken breast", "case", ["lb", "case of 40"]],
			["Yellow onions", "lbs", ["lb", "bag of 50"]],
		]);
		expect(summary.cause).toContain('"SYSCO Foods" for "Sysco"');
		expect(summary.cause).toContain('"lbs" for lb / bag of 50');
	});

	it("counts a run once per error group even with repeated calls", () => {
		const summary = summarizeFailures(
			[
				{
					runId: "r1",
					invoiceId: "inv-a",
					vendor: "Sysco",
					toolLog: [
						{
							name: "save_dispute_draft",
							status: "error",
							errorCode: "invalid_input",
						},
						{
							name: "save_dispute_draft",
							status: "error",
							errorCode: "invalid_input",
						},
					],
				},
			],
			priceList,
		);
		expect(summary.groups[0]?.runs).toBe(1);
		expect(summary.cause).toContain("1 run had failed tool calls");
	});

	it("returns no cause when nothing failed", () => {
		expect(
			summarizeFailures(
				[
					{
						runId: "r",
						invoiceId: "i",
						vendor: "Sysco",
						toolLog: [ok("get_invoice")],
					},
				],
				priceList,
			).cause,
		).toBeNull();
	});
});
