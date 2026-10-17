import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	parseAnswerKeyCsv,
	parseCsv,
	parseInvoiceJson,
	parsePaymentsCsv,
	parsePriceListCsv,
} from "./dataset.ts";

describe("parseCsv", () => {
	it("handles quotes, escaped quotes, embedded commas/newlines and CRLF", () => {
		const text = 'a,b,c\r\n1,"x, y","say ""hi"""\r\n2,"line\nbreak",\r\n';
		expect(parseCsv(text)).toEqual([
			{ a: "1", b: "x, y", c: 'say "hi"' },
			{ a: "2", b: "line\nbreak", c: "" },
		]);
	});

	it("ignores blank lines and rejects ragged rows", () => {
		expect(parseCsv("a,b\n\n1,2\n\n")).toEqual([{ a: "1", b: "2" }]);
		expect(() => parseCsv("a,b\n1,2,3\n")).toThrow(/row 2 has 3 cells/);
	});
});

describe("typed parsers", () => {
	it("map snake_case columns and empty cells", () => {
		expect(
			parsePriceListCsv(
				"vendor,item,unit,unit_price,currency,pack_unit,pack_size\nHarbor Foods,Rice,lb,0.80,USD,,\n",
			),
		).toEqual([
			{
				vendor: "Harbor Foods",
				item: "Rice",
				unit: "lb",
				unitPrice: "0.80",
				currency: "USD",
			},
		]);
		expect(
			parsePaymentsCsv(
				"id,vendor,invoice_number,amount,currency,paid_on,reference\np1,Harbor Foods,,10.00,USD,2026-09-01,CHK-1\n",
			)[0]?.invoiceNumber,
		).toBeNull();
		expect(
			parseAnswerKeyCsv(
				"kind,invoice_id,line_no,payment_id,expected_impact_minor,currency\nwrong_total,inv-1,,,250,USD\n",
			)[0],
		).toMatchObject({
			lineNo: null,
			paymentId: null,
			expectedImpactMinor: 250,
		});
	});

	it("reject values that break the shared types", () => {
		expect(() =>
			parsePriceListCsv(
				"vendor,item,unit,unit_price,currency,pack_unit,pack_size\nHarbor Foods,Rice,lb,0.80,USD,case,\n",
			),
		).toThrow();
	});
});

describe("generated data/ files", () => {
	const dir = new URL("../../../data/", import.meta.url);
	const read = (p: string) => readFileSync(new URL(p, dir), "utf8");

	it("all parse against the shared types", () => {
		const prices = parsePriceListCsv(read("price_list.csv"));
		const invoices = readdirSync(new URL("invoices/", dir))
			.filter((f) => f.endsWith(".json"))
			.map((f) => parseInvoiceJson(read(`invoices/${f}`)));
		const payments = parsePaymentsCsv(read("payments.csv"));
		const key = parseAnswerKeyCsv(read("answer_key.csv"));

		expect(prices.length).toBeGreaterThan(0);
		expect(invoices.length).toBeGreaterThanOrEqual(30);
		expect(payments.length).toBeGreaterThan(0);
		expect(key.length).toBeGreaterThan(0);
		const ids = new Set(invoices.map((i) => i.id));
		for (const row of key) {
			if (row.invoiceId) expect(ids.has(row.invoiceId)).toBe(true);
		}
	});
});
