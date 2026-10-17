import { describe, expect, it } from "vitest";
import {
	addDays,
	assertConvertible,
	CONVERSIONS,
	ConversionError,
	canConvert,
	conversionLinkKind,
	conversionTargets,
	copyLines,
	daysBetween,
	NOTES_MAX,
	planConversion,
	planDuplicate,
	referenceNote,
	type SourceDocument,
	shiftedDueDate,
} from "./conversions.ts";
import { DOCUMENT_TYPES, type DraftLine } from "./types.ts";

const buyer = {
	name: "Northfield Unified School District",
	addressLines: ["100 School Rd"],
	country: "US",
	region: "CA",
};

const lines: DraftLine[] = [
	{
		lineNo: 2,
		description: "Milk, 1% half pint",
		quantity: "480",
		unit: "each",
		unitPrice: "0.32",
		taxCode: "US-SALES",
		rate: "0",
	},
	{
		lineNo: 1,
		description: "Apples, Gala 40 lb",
		quantity: "12",
		unit: "case",
		unitPrice: "38.50",
		discount: "5.00",
		taxCode: "US-SALES",
		rate: "7.25",
		hsnSac: "0808",
		catalogItemId: "cat-apple",
	},
];

function source(over: Partial<SourceDocument> = {}): SourceDocument {
	return {
		type: "quote",
		status: "issued",
		number: "QUO-0003",
		series: "",
		date: "2026-09-01",
		dueDate: "2026-10-01",
		currency: "USD",
		clientId: "client-1",
		buyer,
		placeOfSupply: null,
		notes: "Deliver to the central kitchen.",
		terms: "Net 30",
		lines,
		...over,
	};
}

const TODAY = "2026-10-17";

function errorCode(fn: () => unknown): string | undefined {
	try {
		fn();
	} catch (err) {
		if (err instanceof ConversionError) return err.code;
		throw err;
	}
	return undefined;
}

describe("allowed conversions", () => {
	it("allows exactly the documented pairs", () => {
		const pairs = DOCUMENT_TYPES.flatMap((from) =>
			CONVERSIONS[from].map((to) => `${from}->${to}`),
		);
		expect(pairs.sort()).toEqual(
			[
				"quote->invoice",
				"quote->proforma",
				"proforma->invoice",
				"invoice->receipt",
				"invoice->credit_note",
				"invoice->delivery_note",
			].sort(),
		);
	});

	it("only offers targets for issued documents", () => {
		expect(conversionTargets("quote", "issued")).toEqual([
			"invoice",
			"proforma",
		]);
		expect(conversionTargets("quote", "draft")).toEqual([]);
		expect(conversionTargets("quote", "void")).toEqual([]);
		expect(conversionTargets("receipt", "issued")).toEqual([]);
		expect(canConvert("invoice", "issued", "credit_note")).toBe(true);
		expect(canConvert("invoice", "void", "credit_note")).toBe(false);
		expect(canConvert("invoice", "issued", "quote")).toBe(false);
	});

	it("rejects drafts, void documents and unlisted targets", () => {
		expect(errorCode(() => assertConvertible(source(), "invoice"))).toBe(
			undefined,
		);
		expect(
			errorCode(() =>
				assertConvertible(source({ status: "draft", number: null }), "invoice"),
			),
		).toBe("not_issued");
		expect(
			errorCode(() => assertConvertible(source({ status: "void" }), "invoice")),
		).toBe("not_issued");
		expect(errorCode(() => assertConvertible(source(), "receipt"))).toBe(
			"not_allowed",
		);
		expect(
			errorCode(() =>
				assertConvertible(source({ type: "credit_note" }), "invoice"),
			),
		).toBe("not_allowed");
	});

	it("checks the target before the status, with a clear message", () => {
		expect(() =>
			assertConvertible(source({ type: "receipt", status: "void" }), "invoice"),
		).toThrow("can't be converted. Duplicate it instead.");
		expect(() =>
			assertConvertible(source({ status: "draft", number: null }), "invoice"),
		).toThrow("Issue the document before converting it");
	});

	it("links a credit note to its invoice with kind 'credits'", () => {
		expect(conversionLinkKind("invoice", "credit_note")).toBe("credits");
		expect(conversionLinkKind("invoice", "receipt")).toBe("converted");
		expect(conversionLinkKind("quote", "invoice")).toBe("converted");
	});
});

describe("planConversion", () => {
	it("quote → invoice: copies buyer, client, currency, lines; dates today; no due date", () => {
		const src = source({ placeOfSupply: "27" });
		const draft = planConversion(src, "invoice", TODAY);
		expect(draft).toEqual({
			type: "invoice",
			series: "",
			date: TODAY,
			dueDate: null,
			currency: "USD",
			clientId: "client-1",
			buyer,
			placeOfSupply: "27",
			notes: "As per quote QUO-0003.\n\nDeliver to the central kitchen.",
			terms: "Net 30",
			lines: [
				{ ...lines[1], lineNo: 1 },
				{ ...lines[0], lineNo: 2 },
			],
		});
		// The buyer snapshot is the same object (copied by value when stored).
		expect(draft.buyer).toBe(buyer);
	});

	it("keeps every line field, including discount, rate, HSN and catalog id", () => {
		const [first] = planConversion(source(), "proforma", TODAY).lines;
		expect(first).toEqual({
			lineNo: 1,
			description: "Apples, Gala 40 lb",
			quantity: "12",
			unit: "case",
			unitPrice: "38.50",
			discount: "5.00",
			taxCode: "US-SALES",
			rate: "7.25",
			hsnSac: "0808",
			catalogItemId: "cat-apple",
		});
	});

	it("proforma → invoice keeps the payment-term length", () => {
		const draft = planConversion(
			source({
				type: "proforma",
				number: "PRO-0001",
				date: "2026-09-01",
				dueDate: "2026-09-15",
			}),
			"invoice",
			TODAY,
		);
		expect(draft.dueDate).toBe("2026-10-31");
		expect(
			draft.notes?.startsWith("Final invoice for pro forma invoice PRO-0001."),
		).toBe(true);
		expect(draft.terms).toBe("Net 30");
	});

	it("invoice → credit note references the invoice and drops terms and due date", () => {
		const draft = planConversion(
			source({ type: "invoice", number: "INV-0012", date: "2026-10-01" }),
			"credit_note",
			TODAY,
		);
		expect(draft.type).toBe("credit_note");
		expect(draft.notes).toBe(
			"Credit note against invoice INV-0012 dated 2026-10-01.\n\nDeliver to the central kitchen.",
		);
		expect(draft.terms).toBeNull();
		expect(draft.dueDate).toBeNull();
	});

	it("invoice → receipt and delivery note reference the invoice", () => {
		const inv = source({ type: "invoice", number: "INV-0012", notes: null });
		expect(planConversion(inv, "receipt", TODAY).notes).toBe(
			"Receipt for invoice INV-0012 dated 2026-09-01.",
		);
		expect(planConversion(inv, "delivery_note", TODAY).notes).toBe(
			"Delivery note for invoice INV-0012.",
		);
	});

	it("starts the target in the default series", () => {
		expect(
			planConversion(source({ series: "B" }), "invoice", TODAY).series,
		).toBe("");
	});

	it("keeps notes within the column limit", () => {
		const draft = planConversion(
			source({ notes: "x".repeat(NOTES_MAX) }),
			"invoice",
			TODAY,
		);
		expect(draft.notes?.length).toBe(NOTES_MAX);
		expect(draft.notes?.startsWith("As per quote QUO-0003.")).toBe(true);
	});

	it("does not modify the source", () => {
		const src = source();
		const before = structuredClone(src);
		const draft = planConversion(src, "invoice", TODAY);
		draft.lines[0].description = "changed";
		expect(src).toEqual(before);
	});

	it("rejects a bad today", () => {
		expect(
			errorCode(() => planConversion(source(), "invoice", "2026-02-30")),
		).toBe("invalid_input");
	});
});

describe("planDuplicate", () => {
	it("copies any status, keeps type, series, notes and terms, shifts the due date", () => {
		for (const status of ["draft", "issued", "void"] as const) {
			const draft = planDuplicate(
				source({
					type: "invoice",
					status,
					number: status === "draft" ? null : "INV-0007",
					series: "B",
				}),
				TODAY,
			);
			expect(draft).toMatchObject({
				type: "invoice",
				series: "B",
				date: TODAY,
				dueDate: "2026-11-16",
				notes: "Deliver to the central kitchen.",
				terms: "Net 30",
				clientId: "client-1",
				currency: "USD",
			});
			expect(draft.lines.map((l) => l.lineNo)).toEqual([1, 2]);
		}
	});

	it("leaves the due date blank when the source has none", () => {
		expect(planDuplicate(source({ dueDate: null }), TODAY).dueDate).toBeNull();
	});
});

describe("date helpers", () => {
	it("counts calendar days across month and leap-year boundaries", () => {
		expect(daysBetween("2026-09-01", "2026-10-01")).toBe(30);
		expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
		expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
		expect(addDays("2026-03-08", 30)).toBe("2026-04-07");
	});

	it("treats a due date before the document date as due today", () => {
		expect(
			shiftedDueDate({ date: "2026-09-10", dueDate: "2026-09-01" }, TODAY),
		).toBe(TODAY);
	});

	it("renumbers lines contiguously in their original order", () => {
		expect(
			copyLines([
				{ ...lines[0], lineNo: 7 },
				{ ...lines[1], lineNo: 3 },
			]).map((l) => [l.lineNo, l.description]),
		).toEqual([
			[1, "Apples, Gala 40 lb"],
			[2, "Milk, 1% half pint"],
		]);
	});

	it("words the reference per target", () => {
		const q = {
			type: "quote" as const,
			number: "QUO-0003",
			date: "2026-09-01",
		};
		expect(referenceNote(q, "proforma")).toBe("As per quote QUO-0003.");
	});
});
