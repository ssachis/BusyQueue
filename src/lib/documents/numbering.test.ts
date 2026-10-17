import { describe, expect, it } from "vitest";
import {
	fiscalYearFor,
	formatDocumentNumber,
	NUMBER_PREFIXES,
	NumberingError,
	numberPrefix,
	planNumbering,
} from "./numbering.ts";
import { DOCUMENT_TYPES } from "./types.ts";

describe("fiscalYearFor", () => {
	it("splits India's financial year at 31 March / 1 April", () => {
		expect(fiscalYearFor("IN", "2026-03-31")).toBe("2025-26");
		expect(fiscalYearFor("IN", "2026-04-01")).toBe("2026-27");
		expect(fiscalYearFor("IN", "2026-12-31")).toBe("2026-27");
		expect(fiscalYearFor("IN", "2027-01-01")).toBe("2026-27");
	});

	it("handles the century turn", () => {
		expect(fiscalYearFor("IN", "2099-04-01")).toBe("2099-00");
		expect(fiscalYearFor("IN", "2000-03-31")).toBe("1999-00");
	});

	it("has no fiscal-year reset elsewhere", () => {
		for (const c of ["US", "GB", "DE", "FR", "AU", "CA", "AE"]) {
			expect(fiscalYearFor(c, "2026-03-31")).toBe("");
			expect(fiscalYearFor(c, "2026-04-01")).toBe("");
		}
	});

	it("rejects a non-date", () => {
		expect(() => fiscalYearFor("IN", "31/03/2026")).toThrow(NumberingError);
	});
});

describe("formatting", () => {
	it("has a distinct prefix per type", () => {
		const prefixes = DOCUMENT_TYPES.map((t) => NUMBER_PREFIXES[t]);
		expect(new Set(prefixes).size).toBe(DOCUMENT_TYPES.length);
	});

	it("zero-pads to four digits and grows past 9999", () => {
		expect(formatDocumentNumber("INV-", 1)).toBe("INV-0001");
		expect(formatDocumentNumber("INV-", 42)).toBe("INV-0042");
		expect(formatDocumentNumber("INV-", 12345)).toBe("INV-12345");
		expect(() => formatDocumentNumber("INV-", 0)).toThrow(NumberingError);
	});

	it("builds prefixes with series and fiscal year", () => {
		const p = (series: string, fiscalYear: string) =>
			numberPrefix({ type: "invoice", series, fiscalYear });
		expect(p("", "")).toBe("INV-");
		expect(p("A", "")).toBe("INV-A-");
		expect(p("", "2026-27")).toBe("INV/26-27/");
		expect(p("A", "2026-27")).toBe("INV-A/26-27/");
		expect(
			numberPrefix({ type: "credit_note", series: "", fiscalYear: "" }),
		).toBe("CN-");
	});
});

describe("planNumbering", () => {
	it("plans a US invoice with no fiscal year or length limit", () => {
		expect(
			planNumbering({
				country: "US",
				type: "invoice",
				series: "",
				date: "2026-10-17",
			}),
		).toEqual({ fiscalYear: "", prefix: "INV-", maxLength: null });
	});

	it("plans Indian numbers per financial year within 16 characters", () => {
		const march = planNumbering({
			country: "IN",
			type: "invoice",
			series: "",
			date: "2026-03-31",
		});
		const april = planNumbering({
			country: "IN",
			type: "invoice",
			series: "",
			date: "2026-04-01",
		});
		expect(march.fiscalYear).toBe("2025-26");
		expect(april.fiscalYear).toBe("2026-27");
		expect(formatDocumentNumber(march.prefix, 1)).toBe("INV/25-26/0001");
		expect(formatDocumentNumber(april.prefix, 1)).toBe("INV/26-27/0001");
		expect(april.maxLength).toBe(16);

		const longest = planNumbering({
			country: "IN",
			type: "delivery_note",
			series: "AB",
			date: "2026-04-01",
		});
		expect(formatDocumentNumber(longest.prefix, 9999)).toBe("DN-AB/26-27/9999");
		expect(
			formatDocumentNumber(longest.prefix, 9999).length,
		).toBeLessThanOrEqual(16);
		// Only rule 46(b) characters: letters, digits, hyphen, slash.
		expect(formatDocumentNumber(longest.prefix, 1)).toMatch(/^[A-Z0-9/-]+$/);
	});

	it("rejects a series that would push an Indian number past 16", () => {
		expect(() =>
			planNumbering({
				country: "IN",
				type: "receipt",
				series: "ABC",
				date: "2026-04-01",
			}),
		).toThrow(/at most 16/);
		// The same series is fine where there is no limit.
		expect(
			planNumbering({
				country: "GB",
				type: "receipt",
				series: "ABC",
				date: "2026-04-01",
			}).prefix,
		).toBe("RCT-ABC-");
	});

	it("rejects malformed series", () => {
		for (const series of ["a", "A-1", "A/B", "TOOLONG7", " "]) {
			expect(() =>
				planNumbering({
					country: "US",
					type: "invoice",
					series,
					date: "2026-01-01",
				}),
			).toThrow(NumberingError);
		}
	});
});
