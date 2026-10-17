import { describe, expect, it } from "vitest";
import { DEMO_BUSINESS } from "#/lib/business/profile.ts";
import { sellerSnapshot } from "#/lib/documents/totals.ts";
import type { DocumentDraft } from "#/lib/documents/types.ts";
import {
	blankLine,
	type DraftForm,
	defaultTaxCode,
	draftCandidate,
	formFromDraft,
	localIsoDate,
	moveLine,
	nextLineKey,
	parseDraft,
	previewTotals,
	removeLine,
	taxCodeOptions,
} from "./form.ts";

const US = { country: "US" };
const IN = { country: "IN", region: "27" };

const draft: DocumentDraft = {
	type: "invoice",
	date: "2026-10-17",
	dueDate: "2026-11-16",
	currency: "USD",
	buyer: {
		name: "Lincoln PTA",
		addressLines: ["10 Main St", "Suite 2"],
		city: "Northfield",
		region: "CA",
		postalCode: "95001",
		country: "US",
		email: "pta@example.org",
	},
	notes: "Thanks!",
	lines: [
		{
			lineNo: 1,
			description: "Catering",
			quantity: "3",
			unitPrice: "100.00",
			taxCode: "US-SALES",
			rate: "7.25",
		},
		{
			lineNo: 2,
			description: "Delivery",
			quantity: "1",
			unit: "trip",
			unitPrice: "20.00",
			discount: "5.00",
			taxCode: "EXEMPT",
		},
	],
};

const form = (): DraftForm => formFromDraft(draft);

function nth<T>(items: readonly T[], i: number): T {
	const item = items[i];
	if (item === undefined) throw new Error(`no item ${i}`);
	return item;
}

describe("form <-> DocumentDraft", () => {
	it("round-trips a draft", () => {
		const parsed = parseDraft(form(), US);
		expect(parsed).toEqual({ ok: true, draft });
	});

	it("turns blanks into undefined and splits address lines", () => {
		const f = form();
		f.dueDate = "  ";
		f.buyer.email = "";
		f.buyer.addressLines = " 10 Main St \n\n Suite 2 ";
		f.buyer.country = "us";
		const c = draftCandidate(f, US);
		expect(c.dueDate).toBeUndefined();
		expect(c.buyer.email).toBeUndefined();
		expect(c.buyer.addressLines).toEqual(["10 Main St", "Suite 2"]);
		expect(c.buyer.country).toBe("US");
	});

	it("numbers lines in display order", () => {
		const f = form();
		f.lines = moveLine(f.lines, 1, 0);
		const c = draftCandidate(f, US);
		expect(c.lines.map((l) => [l.lineNo, l.description])).toEqual([
			[1, "Delivery"],
			[2, "Catering"],
		]);
	});

	it("drops fields that do not apply to the seller or tax code", () => {
		const f = form();
		f.placeOfSupply = "27";
		f.lines[0] = { ...nth(f.lines, 0), hsnSac: "9963" };
		f.lines[1] = { ...nth(f.lines, 1), rate: "5" };
		const us = draftCandidate(f, US);
		expect(us.placeOfSupply).toBeUndefined();
		expect(us.lines[0]?.hsnSac).toBeUndefined();
		expect(us.lines[1]?.rate).toBeUndefined();
		const india = draftCandidate(f, IN);
		expect(india.placeOfSupply).toBe("27");
		expect(india.lines[0]?.hsnSac).toBe("9963");
	});

	it("reports errors by path", () => {
		const f = form();
		f.buyer.name = " ";
		f.lines[0] = { ...nth(f.lines, 0), unitPrice: "1,000", rate: "" };
		f.dueDate = "2026-10-01";
		const parsed = parseDraft(f, US);
		expect(parsed.ok).toBe(false);
		if (parsed.ok) return;
		expect(Object.keys(parsed.errors).sort()).toEqual([
			"buyer.name",
			"dueDate",
			"lines.0.rate",
			"lines.0.unitPrice",
		]);
	});

	it("rejects float-like and negative amounts", () => {
		const f = form();
		f.lines[1] = { ...nth(f.lines, 1), quantity: "-1", discount: "1e3" };
		const parsed = parseDraft(f, US);
		expect(parsed.ok).toBe(false);
		if (parsed.ok) return;
		expect(parsed.errors["lines.1.quantity"]).toBeDefined();
		expect(parsed.errors["lines.1.discount"]).toBeDefined();
	});
});

describe("line operations", () => {
	it("moves, clamps and removes lines", () => {
		const lines = form().lines;
		expect(moveLine(lines, 0, 5).map((l) => l.key)).toEqual(["l2", "l1"]);
		expect(moveLine(lines, 0, -1).map((l) => l.key)).toEqual(["l1", "l2"]);
		expect(moveLine(lines, 9, 0)).toEqual(lines);
		expect(removeLine(lines, 0).map((l) => l.key)).toEqual(["l2"]);
	});

	it("gives new lines a key nothing else uses", () => {
		const lines = form().lines;
		expect(nextLineKey([])).toBe("l1");
		expect(nextLineKey(lines)).toBe("l3");
		expect(nextLineKey(removeLine(lines, 0))).toBe("l3");
		const added = blankLine(lines, "EXEMPT");
		expect(added).toMatchObject({
			key: "l3",
			quantity: "1",
			taxCode: "EXEMPT",
		});
	});
});

describe("tax codes", () => {
	it("starts new lines on the standard rate", () => {
		const india = taxCodeOptions(IN, { country: "IN", region: "27" });
		expect(defaultTaxCode("IN", india)).toBe("IN-GST-18");
		const us = taxCodeOptions(US, { country: "US", region: "CA" });
		expect(defaultTaxCode("US", us)).toBe("US-SALES");
		expect(defaultTaxCode("XX", [])).toBe("");
	});

	it("labels Canada with the buyer's province and ignores unknown ones", () => {
		const on = taxCodeOptions(
			{ country: "CA" },
			{ country: "ca", region: "on" },
		);
		expect(on[0]?.label).toContain("HST 13%");
		const unknown = taxCodeOptions(
			{ country: "CA" },
			{ country: "CA", region: "ZZ" },
		);
		expect(unknown[0]?.rate).toBe("");
	});

	it("has no options for a country without tax rules", () => {
		expect(
			taxCodeOptions({ country: "XX" }, { country: "", region: "" }),
		).toEqual([]);
	});
});

describe("previewTotals", () => {
	const seller = sellerSnapshot(DEMO_BUSINESS);

	it("prices the draft through the tax engine", () => {
		const t = previewTotals(seller, draftCandidate(form(), US));
		expect(t.ok).toBe(true);
		if (!t.ok) return;
		expect(t.result.subtotalMinor).toBe(31500);
		expect(t.result.taxMinor).toBe(2175);
		expect(t.result.totalMinor).toBe(33675);
		expect(t.skipped).toEqual([]);
	});

	it("leaves incomplete lines out instead of failing", () => {
		const f = form();
		f.lines = [...f.lines, blankLine(f.lines, "US-SALES")];
		f.lines[0] = { ...nth(f.lines, 0), rate: "" };
		const t = previewTotals(seller, draftCandidate(f, US));
		expect(t.ok).toBe(true);
		if (!t.ok) return;
		expect(t.skipped).toEqual([1, 3]);
		expect(t.result.totalMinor).toBe(1500);
	});

	it("returns tax-rule errors as a message", () => {
		const f = form();
		f.lines[1] = { ...nth(f.lines, 1), discount: "50" };
		const t = previewTotals(seller, draftCandidate(f, US));
		expect(t).toMatchObject({ ok: false });
		if (t.ok) return;
		expect(t.message).toMatch(/discount exceeds/);
	});

	it("asks for a buyer country before computing", () => {
		const f = form();
		f.buyer.country = "";
		const t = previewTotals(seller, draftCandidate(f, US));
		expect(t).toMatchObject({ ok: false });
	});

	it("splits Indian GST by place of supply", () => {
		const inSeller = { country: "IN", region: "27", taxId: "27ABCDE1234F1Z5" };
		const f = form();
		f.currency = "INR";
		f.buyer.country = "IN";
		f.buyer.region = "27";
		f.lines = f.lines.map((l) => ({ ...l, taxCode: "IN-GST-18", rate: "" }));
		const same = previewTotals(inSeller, draftCandidate(f, IN));
		expect(same.ok && same.result.taxTotals.map((t) => t.code)).toEqual([
			"CGST",
			"SGST",
		]);
		f.placeOfSupply = "29";
		const other = previewTotals(inSeller, draftCandidate(f, IN));
		expect(other.ok && other.result.taxTotals.map((t) => t.code)).toEqual([
			"IGST",
		]);
	});
});

describe("localIsoDate", () => {
	it("formats the local calendar date", () => {
		expect(localIsoDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
	});
});
