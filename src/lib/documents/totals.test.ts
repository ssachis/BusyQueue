import { describe, expect, it } from "vitest";
import { DEMO_BUSINESS } from "#/lib/business/profile.ts";
import { TaxError } from "#/lib/tax/index.ts";
import { documentTotals, sellerSnapshot } from "./totals.ts";
import { DocumentDraft } from "./types.ts";

const draft = DocumentDraft.parse({
	type: "invoice",
	date: "2026-10-17",
	currency: "USD",
	buyer: { name: "Lincoln PTA", country: "US", region: "CA" },
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
			unitPrice: "20.00",
			discount: "5.00",
			taxCode: "EXEMPT",
		},
	],
});

describe("documentTotals", () => {
	it("prices a US draft through the tax engine", () => {
		const t = documentTotals(sellerSnapshot(DEMO_BUSINESS), draft);
		expect(t.subtotalMinor).toBe(31500);
		expect(t.taxMinor).toBe(2175);
		expect(t.totalMinor).toBe(33675);
	});

	it("rejects tax codes from another country", () => {
		expect(() =>
			documentTotals(sellerSnapshot(DEMO_BUSINESS), {
				...draft,
				lines: [{ ...draft.lines[0]!, taxCode: "IN-GST-18", rate: undefined }],
			}),
		).toThrow(TaxError);
	});

	it("snapshots the business as a printable party", () => {
		expect(sellerSnapshot(DEMO_BUSINESS)).toMatchObject({
			name: DEMO_BUSINESS.legalName,
			addressLines: ["1200 District Way"],
			country: "US",
			taxId: "00-0000000",
		});
	});
});

describe("DocumentDraft", () => {
	it("rejects float-like and negative amounts", () => {
		const bad = { ...draft, lines: [{ ...draft.lines[0]!, unitPrice: "-1" }] };
		expect(DocumentDraft.safeParse(bad).success).toBe(false);
		const words = {
			...draft,
			lines: [{ ...draft.lines[0]!, quantity: "three" }],
		};
		expect(DocumentDraft.safeParse(words).success).toBe(false);
	});
});
