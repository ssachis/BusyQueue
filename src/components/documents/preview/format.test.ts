import { describe, expect, it } from "vitest";
import {
	formatDate,
	formatDecimalMoney,
	formatQuantity,
	taxLabel,
} from "./format.ts";

describe("document formatting", () => {
	it("formats ISO dates without time zones", () => {
		expect(formatDate("2026-10-17")).toBe("17 Oct 2026");
		expect(formatDate("2026-01-01")).toBe("1 Jan 2026");
		expect(formatDate("2026-13-01")).toBe("2026-13-01");
		expect(formatDate(undefined)).toBe("");
	});

	it("keeps the digits a unit price was typed with", () => {
		expect(formatDecimalMoney("1200", "USD")).toBe("$1,200.00");
		expect(formatDecimalMoney("0.125", "USD")).toBe("$0.125");
		expect(formatDecimalMoney("12.5", "JPY")).toBe("¥12.5");
		expect(formatDecimalMoney("abc", "USD")).toBe("abc");
		expect(formatDecimalMoney("5", "??")).toBe("5 ??");
	});

	it("formats quantities exactly", () => {
		expect(formatQuantity("1200.5")).toBe("1,200.5");
		expect(formatQuantity("0.333333333333333333")).toBe("0.333333333333333333");
	});

	it("labels tax components", () => {
		expect(taxLabel("SALES_TAX", "7.25")).toBe("Sales tax 7.25%");
		expect(taxLabel("CGST", "9")).toBe("CGST 9%");
	});
});
