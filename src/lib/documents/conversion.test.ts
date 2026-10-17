import { describe, expect, it } from "vitest";
import {
	canConvert,
	conversionTargets,
	convertedDraft,
	duplicatedDraft,
	type SourceDocument,
} from "./conversion.ts";
import { DocumentDraft } from "./types.ts";

const source: SourceDocument = {
	type: "quote",
	currency: "USD",
	clientId: "client-1",
	buyer: { name: "Lincoln PTA", addressLines: [], country: "US", region: "CA" },
	placeOfSupply: null,
	notes: "Thanks",
	terms: null,
	lines: [
		{
			lineNo: 5,
			description: "Catering",
			quantity: "3",
			unitPrice: "100.00",
			taxCode: "US-SALES",
			rate: "7.25",
			catalogItemId: "item-1",
		},
		{
			lineNo: 9,
			description: "Delivery",
			quantity: "1",
			unitPrice: "20.00",
			discount: "5.00",
			taxCode: "EXEMPT",
		},
	],
};

describe("conversionTargets", () => {
	it("lets an issued quote become an invoice", () => {
		expect(conversionTargets("quote", "issued")).toEqual(["invoice"]);
		expect(canConvert({ type: "quote", status: "issued" }, "invoice")).toBe(true);
	});

	it("lets an issued invoice become a receipt, credit note or delivery note", () => {
		expect(conversionTargets("invoice", "issued")).toEqual([
			"receipt",
			"credit_note",
			"delivery_note",
		]);
	});

	it("offers nothing for drafts and voided documents", () => {
		expect(conversionTargets("quote", "draft")).toEqual([]);
		expect(conversionTargets("invoice", "void")).toEqual([]);
	});

	it("rejects conversions that are not listed", () => {
		expect(canConvert({ type: "quote", status: "issued" }, "receipt")).toBe(false);
		expect(canConvert({ type: "receipt", status: "issued" }, "invoice")).toBe(
			false,
		);
	});
});

describe("convertedDraft", () => {
	const draft = convertedDraft(source, "invoice", "2026-10-17");

	it("carries over client, buyer and lines, renumbering the lines", () => {
		expect(draft.type).toBe("invoice");
		expect(draft.clientId).toBe("client-1");
		expect(draft.buyer).toEqual(source.buyer);
		expect(draft.lines.map((l) => l.lineNo)).toEqual([1, 2]);
		expect(draft.lines[0]).toMatchObject({
			unitPrice: "100.00",
			rate: "7.25",
			catalogItemId: "item-1",
		});
		expect(draft.lines[1]).toMatchObject({ discount: "5.00" });
	});

	it("uses the new date and no due date, and is a valid draft", () => {
		expect(draft.date).toBe("2026-10-17");
		expect(draft.dueDate).toBeUndefined();
		expect(DocumentDraft.safeParse(draft).success).toBe(true);
	});

	it("does not change the source", () => {
		expect(source.lines[0]?.lineNo).toBe(5);
	});
});

describe("duplicatedDraft", () => {
	it("keeps the type and is a valid draft", () => {
		const draft = duplicatedDraft(source, "2026-10-18");
		expect(draft.type).toBe("quote");
		expect(draft.date).toBe("2026-10-18");
		expect(draft.notes).toBe("Thanks");
		expect(DocumentDraft.safeParse(draft).success).toBe(true);
	});
});
