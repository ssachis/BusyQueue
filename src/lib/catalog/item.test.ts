import { describe, expect, it } from "vitest";
import { DraftLine } from "#/lib/documents/types.ts";
import { CatalogItemInput, itemToLine } from "./item.ts";

const base = {
	code: " dm-001 ",
	name: "Milk 1% half-pint",
	unitPrice: "9.85",
	unit: "case",
	taxCode: "EXEMPT",
	rate: "",
	hsnSac: "",
};

describe("CatalogItemInput", () => {
	it("uppercases the code and turns blanks into null", () => {
		const i = CatalogItemInput.parse(base);
		expect(i.code).toBe("DM-001");
		expect(i.rate).toBeNull();
		expect(i.hsnSac).toBeNull();
	});

	it("keeps the price as the decimal string entered", () => {
		expect(
			CatalogItemInput.parse({ ...base, unitPrice: "0.335" }).unitPrice,
		).toBe("0.335");
	});

	it("rejects negative, non-numeric and missing values", () => {
		expect(
			CatalogItemInput.safeParse({ ...base, unitPrice: "-1" }).success,
		).toBe(false);
		expect(
			CatalogItemInput.safeParse({ ...base, unitPrice: "abc" }).success,
		).toBe(false);
		expect(CatalogItemInput.safeParse({ ...base, name: "" }).success).toBe(
			false,
		);
		expect(CatalogItemInput.safeParse({ ...base, taxCode: "" }).success).toBe(
			false,
		);
		expect(CatalogItemInput.safeParse({ ...base, rate: "x" }).success).toBe(
			false,
		);
	});
});

describe("itemToLine", () => {
	it("fills a valid draft line and links the catalog item", () => {
		const line = itemToLine(
			{ id: "item-1", ...CatalogItemInput.parse(base) },
			3,
			"12",
		);
		expect(DraftLine.safeParse(line).success).toBe(true);
		expect(line).toMatchObject({
			lineNo: 3,
			description: "Milk 1% half-pint",
			quantity: "12",
			unit: "case",
			unitPrice: "9.85",
			catalogItemId: "item-1",
		});
		expect(line).not.toHaveProperty("rate");
	});
});
