import { describe, expect, it } from "vitest";
import { DEMO_BUSINESS } from "#/lib/business/profile.ts";
import { documentTotals, sellerSnapshot } from "#/lib/documents/totals.ts";
import type { DraftLine, PartySnapshot } from "#/lib/documents/types.ts";
import type { TaxTotal } from "#/lib/tax/index.ts";
import {
	buildPrintModel,
	choosePrintSource,
	groupTaxTotals,
	lineTaxLabel,
	type PrintDocumentInput,
	type PrintInput,
	parsePrintSearch,
	type SellerSnapshot,
} from "./model.ts";

const usSeller = sellerSnapshot(DEMO_BUSINESS);

const usBuyer: PartySnapshot = {
	name: "Lincoln Elementary PTA",
	addressLines: ["45 School Rd"],
	city: "Northfield",
	region: "CA",
	postalCode: "95002",
	country: "US",
};

const usLines: DraftLine[] = [
	{
		lineNo: 1,
		description: "Catering, spring fair",
		quantity: "2",
		unit: "event",
		unitPrice: "450.00",
		taxCode: "US-SALES",
		rate: "8.875",
	},
	{
		lineNo: 2,
		description: "Milk, 1/2 pint",
		quantity: "1000",
		unit: "each",
		unitPrice: "0.125",
		discount: "5",
		taxCode: "US-SALES",
		rate: "7.25",
	},
	{
		lineNo: 3,
		description: "Nutrition workshop",
		quantity: "1",
		unitPrice: "200",
		taxCode: "EXEMPT",
	},
];

function doc(over: Partial<PrintDocumentInput> = {}): PrintDocumentInput {
	return {
		id: "doc-1",
		type: "invoice",
		status: "draft",
		number: null,
		date: "2026-10-17",
		dueDate: "2026-11-16",
		currency: "USD",
		buyer: usBuyer,
		seller: null,
		placeOfSupply: null,
		notes: "Thank you.",
		terms: "Net 30",
		subtotalMinor: null,
		taxMinor: null,
		totalMinor: null,
		taxResult: null,
		voidReason: null,
		...over,
	};
}

function input(over: Partial<PrintInput> = {}): PrintInput {
	return {
		document: doc(),
		lines: usLines,
		draftSeller: usSeller,
		branding: { accentColor: "#2563eb", logoUrl: null },
		payment: null,
		...over,
	};
}

/** The document as issueDraft freezes it. */
function issued(
	seller: SellerSnapshot,
	d: PrintDocumentInput,
	lines: DraftLine[],
	over: Partial<PrintDocumentInput> = {},
): PrintDocumentInput {
	const totals = documentTotals(seller, {
		buyer: d.buyer,
		currency: d.currency,
		placeOfSupply: d.placeOfSupply ?? undefined,
		lines,
	});
	return {
		...d,
		status: "issued",
		number: "INV-0007",
		seller,
		subtotalMinor: totals.subtotalMinor,
		taxMinor: totals.taxMinor,
		totalMinor: totals.totalMinor,
		taxResult: totals,
		...over,
	};
}

describe("parsePrintSearch", () => {
	it("keeps known layouts and paper sizes and drops the rest", () => {
		expect(parsePrintSearch({ layout: "modern", paper: "letter" })).toEqual({
			layout: "modern",
			paper: "letter",
		});
		expect(parsePrintSearch({ layout: "fancy", paper: 3 })).toEqual({});
	});
});

describe("choosePrintSource", () => {
	it("prices drafts now and prints issued documents as frozen", () => {
		expect(
			choosePrintSource({
				status: "draft",
				seller: null,
				taxResult: null,
				totalMinor: null,
			}),
		).toBe("computed");
		const frozen = issued(usSeller, doc(), usLines);
		expect(choosePrintSource(frozen)).toBe("frozen");
		expect(choosePrintSource({ ...frozen, status: "void" })).toBe("frozen");
		expect(choosePrintSource({ ...frozen, taxResult: null })).toBe("missing");
	});
});

describe("groupTaxTotals", () => {
	it("keeps first-appearance order and merges repeats of a code and rate", () => {
		const totals: TaxTotal[] = [
			{ code: "CGST", rate: "9", taxableMinor: 1000, amountMinor: 90 },
			{ code: "SGST", rate: "9", taxableMinor: 1000, amountMinor: 90 },
			{ code: "CGST", rate: "2.5", taxableMinor: 400, amountMinor: 10 },
			{ code: "CGST", rate: "9.0", taxableMinor: 500, amountMinor: 45 },
		];
		expect(groupTaxTotals(totals)).toEqual([
			{ code: "CGST", rate: "9", taxableMinor: 1500, amountMinor: 135 },
			{ code: "SGST", rate: "9", taxableMinor: 1000, amountMinor: 90 },
			{ code: "CGST", rate: "2.5", taxableMinor: 400, amountMinor: 10 },
		]);
	});
});

describe("lineTaxLabel", () => {
	it("adds the component rates of a line", () => {
		expect(
			lineTaxLabel(
				{ taxCode: "IN-GST-18" },
				{
					components: [
						{ code: "CGST", rate: "9", amountMinor: 9 },
						{ code: "SGST", rate: "9", amountMinor: 9 },
					],
				},
			),
		).toBe("18%");
		expect(
			lineTaxLabel(
				{ taxCode: "CA-STD" },
				{
					components: [
						{ code: "GST", rate: "5", amountMinor: 5 },
						{ code: "QST", rate: "9.975", amountMinor: 10 },
					],
				},
			),
		).toBe("14.975%");
		expect(lineTaxLabel({ taxCode: "EXEMPT" }, { components: [] })).toBe(
			"Exempt",
		);
		expect(lineTaxLabel({ taxCode: "DE-VAT-19" }, { components: [] })).toBe(
			"0%",
		);
	});
});

describe("buildPrintModel: US draft", () => {
	const m = buildPrintModel(input());

	it("is computed live and watermarked DRAFT", () => {
		expect(m.source).toBe("computed");
		expect(m.watermark).toBe("DRAFT");
		expect(m.heading).toBe("Invoice");
		expect(m.number).toBeNull();
		expect(m.title).toBe("Invoice (draft)");
	});

	it("formats lines exactly", () => {
		expect(m.lines[0]).toMatchObject({
			quantity: "2",
			unitPrice: "$450.00",
			tax: "8.875%",
			amount: "$900.00",
			discount: null,
		});
		// 1000 × 0.125 − 5 = 120.00
		expect(m.lines[1]).toMatchObject({
			quantity: "1,000",
			unitPrice: "$0.125",
			discount: "$5.00",
			tax: "7.25%",
			amount: "$120.00",
		});
		expect(m.lines[2].tax).toBe("Exempt");
		expect(m.columns).toEqual({ hsnSac: false, unit: true, discount: true });
	});

	it("groups sales tax by rate and totals from the tax engine", () => {
		// 900 × 8.875% = 79.875 → 79.88; 120 × 7.25% = 8.70
		expect(m.taxRows).toEqual([
			{ label: "Sales tax 8.875%", taxable: "$900.00", amount: "$79.88" },
			{ label: "Sales tax 7.25%", taxable: "$120.00", amount: "$8.70" },
		]);
		expect(m.subtotal).toBe("$1,220.00");
		expect(m.tax).toBe("$88.58");
		expect(m.total).toBe("$1,308.58");
		expect(m.payment).toBeNull();
	});

	it("prints the seller's tax IDs and the buyer's address", () => {
		expect(m.seller.taxIds).toEqual([{ label: "EIN", value: "00-0000000" }]);
		expect(m.buyer.lines).toEqual([
			"45 School Rd",
			"Northfield, CA 95002",
			"United States",
		]);
		expect(m.placeOfSupply).toBeNull();
		expect(m.branding).toEqual({
			accentColor: "#2563eb",
			accentInk: "light",
			logoUrl: null,
		});
	});
});

describe("buildPrintModel: frozen vs computed", () => {
	it("prints the issued snapshot even if the profile changed since", () => {
		const frozen = issued(usSeller, doc(), usLines);
		const renamed = { ...usSeller, name: "Renamed District" };
		const m = buildPrintModel(
			input({ document: frozen, draftSeller: renamed }),
		);
		expect(m.source).toBe("frozen");
		expect(m.watermark).toBeNull();
		expect(m.seller.name).toBe(usSeller.name);
		expect(m.number).toBe("INV-0007");
		expect(m.total).toBe("$1,308.58");
	});

	it("uses the frozen totals, not a recalculation", () => {
		const frozen = issued(usSeller, doc(), usLines, { totalMinor: 999_99 });
		expect(buildPrintModel(input({ document: frozen })).total).toBe("$999.99");
	});

	it("shows paid and balance on an issued invoice", () => {
		const frozen = issued(usSeller, doc(), usLines);
		const m = buildPrintModel(
			input({
				document: frozen,
				payment: {
					displayStatus: "partially_paid",
					paidMinor: 50000,
					balanceMinor: 80858,
					overdue: false,
				},
			}),
		);
		expect(m.payment).toEqual({
			status: "partially_paid",
			paid: "$500.00",
			balance: "$808.58",
			overdue: false,
		});
	});

	it("leaves out the paid row until something is paid", () => {
		const frozen = issued(usSeller, doc(), usLines);
		const m = buildPrintModel(
			input({
				document: frozen,
				payment: {
					displayStatus: "overdue",
					paidMinor: 0,
					balanceMinor: 130858,
					overdue: true,
				},
			}),
		);
		expect(m.payment).toEqual({
			status: "overdue",
			paid: null,
			balance: "$1,308.58",
			overdue: true,
		});
	});

	it("watermarks void documents and hides the balance", () => {
		const frozen = issued(usSeller, doc(), usLines, {
			status: "void",
			voidReason: "Duplicate",
		});
		const m = buildPrintModel(
			input({
				document: frozen,
				payment: {
					displayStatus: "void",
					paidMinor: 0,
					balanceMinor: 0,
					overdue: false,
				},
			}),
		);
		expect(m.watermark).toBe("VOID");
		expect(m.voidReason).toBe("Duplicate");
		expect(m.payment).toBeNull();
	});
});

describe("buildPrintModel: drafts the tax engine rejects", () => {
	it("prints line amounts, no totals, and says why", () => {
		const lines: DraftLine[] = [
			{ ...usLines[0], taxCode: "IN-GST-18", rate: undefined },
		];
		const m = buildPrintModel(input({ lines }));
		expect(m.problem).toMatch(/can't be calculated/);
		expect(m.lines[0].amount).toBe("$900.00");
		expect(m.lines[0].tax).toBe("—");
		expect(m.subtotal).toBe("$900.00");
		expect(m.tax).toBeNull();
		expect(m.total).toBeNull();
	});

	it("asks for the business profile when there is no seller", () => {
		const m = buildPrintModel(input({ draftSeller: null }));
		expect(m.problem).toMatch(/business profile/);
		expect(m.total).toBeNull();
	});
});

describe("buildPrintModel: India intra-state", () => {
	const inSeller: SellerSnapshot = {
		name: "Annapurna Kitchens Pvt Ltd",
		addressLines: ["12 MG Road"],
		city: "Pune",
		region: "27",
		postalCode: "411001",
		country: "IN",
		taxId: "27AAACA1234A1Z5",
		taxIds: [
			{ type: "GSTIN", value: "27AAACA1234A1Z5" },
			{ type: "PAN", value: "AAACA1234A" },
		],
	};
	const inBuyer: PartySnapshot = {
		name: "Shree Schools Trust",
		addressLines: ["4 FC Road"],
		city: "Pune",
		region: "27",
		postalCode: "411004",
		country: "IN",
		taxId: "27AAATS9876B1Z2",
	};
	const lines: DraftLine[] = [
		{
			lineNo: 1,
			description: "Midday meal service",
			quantity: "100",
			unit: "plate",
			unitPrice: "45",
			taxCode: "IN-GST-5",
			hsnSac: "996331",
		},
		{
			lineNo: 2,
			description: "Steel tiffin boxes",
			quantity: "20",
			unit: "pc",
			unitPrice: "350",
			taxCode: "IN-GST-18",
			hsnSac: "7323",
		},
	];
	const frozen = issued(
		inSeller,
		doc({ currency: "INR", buyer: inBuyer, notes: null, terms: null }),
		lines,
	);
	const m = buildPrintModel(input({ document: frozen, lines }));

	it("uses the Indian heading, HSN/SAC and place of supply", () => {
		expect(m.heading).toBe("Tax Invoice");
		expect(m.columns.hsnSac).toBe(true);
		expect(m.lines.map((l) => l.hsnSac)).toEqual(["996331", "7323"]);
		expect(m.placeOfSupply).toBe("Maharashtra (27)");
		expect(m.buyer.taxIds).toEqual([
			{ label: "GSTIN", value: "27AAATS9876B1Z2" },
		]);
		expect(m.seller.taxIds.map((t) => t.label)).toEqual(["GSTIN", "PAN"]);
		expect(m.seller.lines).toContain("Pune, Maharashtra (27) 411001");
	});

	it("splits GST into CGST and SGST rows per rate", () => {
		expect(m.taxRows.map((r) => r.label)).toEqual([
			"CGST 2.5%",
			"SGST 2.5%",
			"CGST 9%",
			"SGST 9%",
		]);
		// 4,500 × 2.5% = 112.50; 7,000 × 9% = 630.00
		expect(m.taxRows[0]).toEqual({
			label: "CGST 2.5%",
			taxable: "₹4,500.00",
			amount: "₹112.50",
		});
		expect(m.lines.map((l) => l.tax)).toEqual(["5%", "18%"]);
		expect(m.subtotal).toBe("₹11,500.00");
		// 11,500 + 2 × 112.50 + 2 × 630.00
		expect(m.total).toBe("₹12,985.00");
		expect(m.payment).toBeNull();
	});

	it("prints the export wording for a supply outside India", () => {
		const exportDoc = issued(
			inSeller,
			doc({
				currency: "USD",
				buyer: { ...usBuyer, taxId: undefined },
			}),
			lines,
		);
		const e = buildPrintModel(input({ document: exportDoc, lines }));
		expect(e.taxRows).toEqual([]);
		expect(e.placeOfSupply).toBe("Outside India (United States)");
		expect(e.statutoryNotes.join(" ")).toMatch(/LETTER OF UNDERTAKING/);
	});
});

describe("buildPrintModel: EU reverse charge", () => {
	it("appends the reverse-charge heading and statutory note", () => {
		const deSeller: SellerSnapshot = {
			name: "Küche GmbH",
			addressLines: ["Hauptstr. 1"],
			city: "Berlin",
			postalCode: "10115",
			country: "DE",
			taxId: "DE123456789",
		};
		const frBuyer: PartySnapshot = {
			name: "Cantine SARL",
			addressLines: [],
			country: "FR",
			taxId: "FR12345678901",
		};
		const lines: DraftLine[] = [
			{
				lineNo: 1,
				description: "Ovens",
				quantity: "1",
				unitPrice: "1000",
				taxCode: "DE-VAT-19",
			},
		];
		const frozen = issued(
			deSeller,
			doc({ currency: "EUR", buyer: frBuyer }),
			lines,
		);
		const m = buildPrintModel(input({ document: frozen, lines }));
		expect(m.heading).toBe("Invoice (Reverse Charge)");
		expect(m.lines[0].tax).toBe("0%");
		expect(m.statutoryNotes.length).toBeGreaterThan(0);
		expect(m.buyer.taxIds[0].label).toBe("VAT ID");
		expect(m.seller.taxIds).toEqual([
			{ label: "VAT ID", value: "DE123456789" },
		]);
	});
});
