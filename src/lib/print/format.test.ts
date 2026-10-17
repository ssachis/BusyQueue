import { describe, expect, it } from "vitest";
import {
	buyerTaxIdLabel,
	formatDate,
	formatQuantity,
	formatRate,
	formatUnitAmount,
	inkOn,
	inStateLabel,
	localeFor,
	taxRowLabel,
} from "./format.ts";
import { cssString, pageCss } from "./page-css.ts";

describe("formatDate", () => {
	it("prints an unambiguous day month year", () => {
		expect(formatDate("2026-10-07")).toBe("7 Oct 2026");
		expect(formatDate("2026-01-31")).toBe("31 Jan 2026");
	});
	it("leaves anything else as given", () => {
		expect(formatDate("soon")).toBe("soon");
		expect(formatDate("2026-13-01")).toBe("2026-13-01");
	});
});

describe("formatQuantity", () => {
	it("trims trailing zeros and groups thousands", () => {
		expect(formatQuantity("2.500", "en-US")).toBe("2.5");
		expect(formatQuantity("1000", "en-US")).toBe("1,000");
		expect(formatQuantity("100000", "en-IN")).toBe("1,00,000");
	});
	it("keeps every digit the user typed", () => {
		expect(formatQuantity("0.0001", "en-US")).toBe("0.0001");
	});
});

describe("formatUnitAmount", () => {
	it("shows at least the currency's minor digits", () => {
		expect(formatUnitAmount("12", "USD", "en-US")).toBe("$12.00");
		expect(formatUnitAmount("12.5", "USD", "en-US")).toBe("$12.50");
	});
	it("never rounds a price with extra precision", () => {
		expect(formatUnitAmount("0.125", "USD", "en-US")).toBe("$0.125");
		expect(formatUnitAmount("1234567.891", "INR", "en-IN")).toBe(
			"₹12,34,567.891",
		);
	});
	it("handles zero-decimal currencies", () => {
		expect(formatUnitAmount("1500", "JPY", "en-US")).toBe("¥1,500");
	});
});

describe("tax labels", () => {
	it("labels components with their rate", () => {
		expect(taxRowLabel("CGST", "9")).toBe("CGST 9%");
		expect(taxRowLabel("QST", "9.975")).toBe("QST 9.975%");
		expect(taxRowLabel("SALES_TAX", "8.8750")).toBe("Sales tax 8.875%");
		expect(formatRate("18.0")).toBe("18%");
	});
	it("names the buyer's tax ID by country", () => {
		expect(buyerTaxIdLabel("IN")).toBe("GSTIN");
		expect(buyerTaxIdLabel("DE")).toBe("VAT ID");
		expect(buyerTaxIdLabel("AE")).toBe("TRN");
		expect(buyerTaxIdLabel("US")).toBe("Tax ID");
	});
	it("names Indian states by GST code", () => {
		expect(inStateLabel("27")).toBe("Maharashtra (27)");
		expect(inStateLabel("XX")).toBe("XX");
	});
	it("picks a number locale per seller country", () => {
		expect(localeFor("IN")).toBe("en-IN");
		expect(localeFor("ZZ")).toBe("en-US");
	});
});

describe("inkOn", () => {
	it("uses white text on dark accents and dark text on light ones", () => {
		expect(inkOn("#2563eb")).toBe("light");
		expect(inkOn("#111111")).toBe("light");
		expect(inkOn("#fde047")).toBe("dark");
		expect(inkOn("#ffffff")).toBe("dark");
	});
});

describe("pageCss", () => {
	it("sets the paper size and a page counter footer", () => {
		const a4 = pageCss({ paper: "a4", footer: "Invoice INV-1" });
		expect(a4).toContain("size: A4;");
		expect(a4).toContain('content: "Invoice INV-1"');
		expect(a4).toContain("counter(pages)");
		expect(pageCss({ paper: "letter", footer: "x" })).toContain(
			"size: letter;",
		);
	});
	it("escapes text so it can't break out of the rule or the style tag", () => {
		expect(cssString('a"b\\c')).toBe('"a\\"b\\\\c"');
		expect(cssString("</style><script>")).not.toContain("<");
		expect(cssString("line\nbreak")).toBe('"linebreak"');
	});
});
