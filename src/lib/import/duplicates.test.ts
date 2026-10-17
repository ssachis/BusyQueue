import { describe, expect, it } from "vitest";
import { findDuplicateInvoices, normalizeInvoiceNumber } from "./duplicates.ts";

const stored = [
	{ id: "inv-1", vendor: "Harbor Freight Lines", invoiceNumber: "HF-1042" },
	{ id: "inv-2", vendor: "Valley Haulage", invoiceNumber: "HF-1042" },
	{ id: "inv-3", vendor: "Harbor Freight Lines", invoiceNumber: "HF-1043" },
];

describe("normalizeInvoiceNumber", () => {
	it("ignores case, spaces and #", () => {
		expect(normalizeInvoiceNumber(" hf # 1042 ")).toBe("HF1042");
		expect(normalizeInvoiceNumber("#HF-1042")).toBe("HF-1042");
	});
});

describe("findDuplicateInvoices", () => {
	it("matches the same vendor and number despite spelling", () => {
		expect(
			findDuplicateInvoices(
				{ vendor: "HARBOR FREIGHT LINES INC", invoiceNumber: "hf-1042" },
				stored,
			).map((s) => s.id),
		).toEqual(["inv-1"]);
	});

	it("treats the same number from another vendor as a different bill", () => {
		expect(
			findDuplicateInvoices(
				{ vendor: "Northside Courier", invoiceNumber: "HF-1042" },
				stored,
			),
		).toEqual([]);
	});

	it("keeps dashes and digits significant", () => {
		expect(
			findDuplicateInvoices(
				{ vendor: "Harbor Freight Lines", invoiceNumber: "HF1042" },
				stored,
			),
		).toEqual([]);
		expect(
			findDuplicateInvoices(
				{ vendor: "Harbor Freight Lines", invoiceNumber: "HF-1044" },
				stored,
			),
		).toEqual([]);
	});

	it("never matches a blank vendor or number", () => {
		expect(
			findDuplicateInvoices({ vendor: "", invoiceNumber: "HF-1042" }, stored),
		).toEqual([]);
		expect(
			findDuplicateInvoices(
				{ vendor: "Harbor Freight Lines", invoiceNumber: " " },
				stored,
			),
		).toEqual([]);
	});
});
