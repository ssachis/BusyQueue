import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cashflowByMonth } from "./cashflow.ts";
import { parseInvoice, parsePayments } from "./load.ts";

const dir = new URL("../../../data/", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, dir), "utf8");
const invoices = readdirSync(new URL("invoices/", dir))
	.sort()
	.map((f) => parseInvoice(JSON.parse(read(`invoices/${f}`))));
const flow = cashflowByMonth(invoices, parsePayments(read("payments.csv")));

describe("cashflowByMonth", () => {
	it("is ordered by month with short labels", () => {
		expect(flow.map((m) => m.month)).toEqual(
			[...flow.map((m) => m.month)].sort(),
		);
		expect(flow[0]?.label).toBe("Aug");
	});
	it("adds up to the invoice and payment totals", () => {
		const billed = invoices.reduce(
			(n, i) => n + Math.round(Number(i.statedTotal) * 100),
			0,
		);
		expect(flow.reduce((n, m) => n + m.billedMinor, 0)).toBe(billed);
		expect(flow.reduce((n, m) => n + m.paidMinor, 0)).toBeGreaterThan(0);
	});
});
