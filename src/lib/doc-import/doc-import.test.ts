import { describe, expect, it } from "vitest";
import { classifyDocumentType, typeFromText } from "./classify.ts";
import {
	buildDocExtraction,
	normalizeAmount,
	normalizeDocDate,
	parseDocReply,
	RawDocExtraction,
} from "./extraction.ts";
import {
	correctedPaths,
	type DocImportForm,
	EMPTY_LINE,
	type SellerContext,
} from "./form.ts";
import { mapTaxRate } from "./tax-map.ts";
import {
	checkTotals,
	formToDraft,
	formTotals,
	validateForm,
} from "./validate.ts";

const US: SellerContext = {
	name: "Northfield Unified School District, Food Services",
	country: "US",
	region: "CA",
	currency: "USD",
};
const IN: SellerContext = {
	name: "Annapurna Caterers",
	country: "IN",
	region: "27",
	taxId: "27AAACA1234A1Z5",
	currency: "INR",
};

describe("typeFromText / classifyDocumentType", () => {
	it.each([
		["QUOTE", "quote"],
		["Quotation", "quote"],
		["Catering Estimate", "quote"],
		["Tax Invoice", "invoice"],
		["INVOICE", "invoice"],
		["Proforma Invoice", "proforma"],
		["Pro-forma", "proforma"],
		["Credit Note against INV-12", "credit_note"],
		["Credit memo", "credit_note"],
		["Payment Receipt", "receipt"],
		["Delivery Challan", "delivery_note"],
		["Packing slip", "delivery_note"],
		["credit_note", "credit_note"],
		["delivery note", "delivery_note"],
	])("%s → %s", (text, type) => {
		expect(typeFromText(text)).toBe(type);
	});

	it("returns null for headings that aren't a document type", () => {
		expect(typeFromText("Purchase order")).toBeNull();
		expect(typeFromText("")).toBeNull();
		expect(typeFromText(null)).toBeNull();
	});

	it("trusts a recognised heading that agrees with the model", () => {
		expect(
			classifyDocumentType({ title: "QUOTE", documentType: "quote" }),
		).toEqual({ type: "quote", doubtful: false });
	});

	it("follows the heading but flags a disagreement", () => {
		const c = classifyDocumentType({
			title: "Proforma Invoice",
			documentType: "invoice",
		});
		expect(c.type).toBe("proforma");
		expect(c.doubtful).toBe(true);
	});

	it("flags a type inferred without a heading", () => {
		const c = classifyDocumentType({ title: null, documentType: "receipt" });
		expect(c).toMatchObject({ type: "receipt", doubtful: true });
	});

	it("defaults to a flagged invoice when nothing is recognisable", () => {
		expect(
			classifyDocumentType({ title: "Order", documentType: "other" }),
		).toMatchObject({ type: "invoice", doubtful: true });
	});
});

describe("mapTaxRate", () => {
	it("US: a printed percent becomes US-SALES with that rate", () => {
		expect(mapTaxRate({ country: "US", rates: ["8.25"] })).toEqual({
			taxCode: "US-SALES",
			rate: "8.25",
			doubtful: false,
		});
	});

	it("US: non-taxable lines and no tax at all are EXEMPT", () => {
		expect(
			mapTaxRate({ country: "US", rates: ["8.25"], taxable: false }).taxCode,
		).toBe("EXEMPT");
		expect(mapTaxRate({ country: "US", rates: [] })).toEqual({
			taxCode: "EXEMPT",
			doubtful: false,
		});
	});

	it("flags a line with no rate when tax is printed on the document", () => {
		expect(
			mapTaxRate({ country: "US", rates: [], taxPrinted: true }),
		).toMatchObject({ taxCode: "EXEMPT", doubtful: true });
	});

	it("IN: CGST 9% + SGST 9% sums (in code) to GST 18%", () => {
		expect(mapTaxRate({ country: "IN", rates: ["9", "9"] })).toMatchObject({
			taxCode: "IN-GST-18",
			doubtful: false,
		});
		expect(mapTaxRate({ country: "IN", rates: ["5"] }).taxCode).toBe(
			"IN-GST-5",
		);
	});

	it("IN: a rate that isn't a current slab is left empty and flagged", () => {
		const m = mapTaxRate({ country: "IN", rates: ["12"] });
		expect(m.taxCode).toBe("");
		expect(m.doubtful).toBe(true);
		expect(m.reason).toMatch(/12%/);
	});

	it("matches decimal rates exactly (5.5 = 5.50)", () => {
		expect(mapTaxRate({ country: "FR", rates: ["5.50"] }).taxCode).toBe(
			"FR-VAT-5.5",
		);
		expect(mapTaxRate({ country: "GB", rates: ["20"] }).taxCode).toBe(
			"GB-VAT-20",
		);
		expect(mapTaxRate({ country: "DE", rates: ["7"] }).taxCode).toBe(
			"DE-VAT-7",
		);
	});

	it("zero percent maps to ZERO where it exists, else EXEMPT", () => {
		expect(mapTaxRate({ country: "GB", rates: ["0"] }).taxCode).toBe("ZERO");
		expect(mapTaxRate({ country: "FR", rates: ["0"] }).taxCode).toBe("EXEMPT");
	});

	it("CA: checks the printed rate against the buyer's province", () => {
		expect(
			mapTaxRate({ country: "CA", region: "ON", rates: ["13"] }),
		).toMatchObject({ taxCode: "CA-STD", doubtful: false });
		expect(
			mapTaxRate({ country: "CA", region: "QC", rates: ["5", "9.975"] }),
		).toMatchObject({ taxCode: "CA-STD", doubtful: false });
		const wrong = mapTaxRate({ country: "CA", region: "ON", rates: ["5"] });
		expect(wrong).toMatchObject({ taxCode: "CA-STD", doubtful: true });
		expect(wrong.reason).toMatch(/Ontario is 13%/);
		expect(mapTaxRate({ country: "CA", rates: ["13"] }).doubtful).toBe(true);
	});

	it("flags an unreadable rate", () => {
		expect(mapTaxRate({ country: "US", rates: ["8,2x"] })).toMatchObject({
			taxCode: "",
			doubtful: true,
		});
	});
});

describe("normalisation", () => {
	it("reads printed amounts without changing digits", () => {
		expect(normalizeAmount("$1,556.90")).toBe("1556.90");
		expect(normalizeAmount("₹1,20,000.00")).toBe("120000.00");
		expect(normalizeAmount("8.25%")).toBe("8.25");
		expect(normalizeAmount("about 40")).toBeNull();
	});

	it("reads dates in the seller's order and flags the ambiguous ones", () => {
		expect(normalizeDocDate("10/09/2026", "MDY")).toMatchObject({
			value: "2026-10-09",
			doubtful: true,
		});
		expect(normalizeDocDate("10/09/2026", "DMY")).toMatchObject({
			value: "2026-09-10",
			doubtful: true,
		});
		expect(normalizeDocDate("10/24/2026", "MDY")).toEqual({
			value: "2026-10-24",
			doubtful: false,
		});
		expect(normalizeDocDate("2026-02-30", "MDY").doubtful).toBe(true);
	});

	it("reads written-out months without guessing the order", () => {
		expect(normalizeDocDate("October 1, 2026", "MDY")).toEqual({
			value: "2026-10-01",
			doubtful: false,
		});
		expect(normalizeDocDate("1 Oct 2026", "MDY").value).toBe("2026-10-01");
		expect(normalizeDocDate("1-Oct-26", "DMY")).toEqual({
			value: "2026-10-01",
			doubtful: true,
		});
		expect(normalizeDocDate("Sept 31, 2026", "MDY").doubtful).toBe(true);
	});

	it("uses the other order, flagged, when only it makes a real date", () => {
		expect(normalizeDocDate("24/10/2026", "MDY")).toMatchObject({
			value: "2026-10-24",
			doubtful: true,
		});
	});
});

const quoteReply = {
	title: "QUOTE",
	documentType: "quote",
	documentNumber: "Q-0412",
	date: "2026-10-09",
	dueDate: null,
	currency: "$",
	buyer: {
		name: "Lincoln Elementary PTA",
		addressLines: ["455 Lincoln Ave"],
		city: "Northfield",
		region: "CA",
		postalCode: "95001",
		country: "USA",
		taxId: null,
		email: "lincolnpta@example.org",
	},
	lines: [
		{
			description: "Cheese pizza 16in",
			quantity: "12",
			unit: "ea",
			unitPrice: "14.50",
			amount: "174.00",
			taxRates: [],
			taxable: true,
			uncertain: [],
		},
		{
			description: "Serving staff",
			quantity: "6",
			unit: "hr",
			unitPrice: "28.00",
			amount: "168.00",
			taxRates: [],
			taxable: false,
			uncertain: ["unitPrice"],
		},
	],
	taxRates: ["8.25"],
	subtotal: "342.00",
	taxTotal: "14.36",
	total: "356.36",
	notes: "Deliver by 5:30pm",
	terms: "Valid 30 days",
	uncertain: ["buyer.email"],
	legibility: null,
};

describe("buildDocExtraction", () => {
	it("builds a valid quote form and maps the document-level rate", () => {
		const raw = RawDocExtraction.parse(quoteReply);
		const x = buildDocExtraction(raw, US);
		expect(x.form.type).toBe("quote");
		expect(x.form.currency).toBe("USD");
		expect(x.form.buyer.country).toBe("US");
		expect(x.form.lines[0]).toMatchObject({
			taxCode: "US-SALES",
			rate: "8.25",
		});
		expect(x.form.lines[1].taxCode).toBe("EXEMPT");
		expect(x.issues).toEqual({});
		// 174.00 × 8.25% = 14.355 → 14.36; total 342.00 + 14.36.
		expect(x.mismatches).toEqual({});
		expect(x.uncertain).toEqual(
			expect.arrayContaining(["lines.1.unitPrice", "buyer.email"]),
		);
		expect(formToDraft(x.form).success).toBe(true);
	});

	it("flags a printed total that doesn't match the computed one", () => {
		const raw = RawDocExtraction.parse({ ...quoteReply, total: "358.36" });
		const x = buildDocExtraction(raw, US);
		expect(Object.keys(x.mismatches)).toEqual(["printed.total"]);
		expect(x.mismatches["printed.total"]).toMatch(
			/Printed \$358\.36.*\$356\.36.*off by \$2\.00/,
		);
		expect(x.uncertain).toContain("printed.total");
		// A mismatch is a flag, not a validation error: the draft can still be created.
		expect(x.issues).toEqual({});
	});

	it("flags a printed line amount that isn't qty × price", () => {
		const lines = [{ ...quoteReply.lines[0], amount: "147.00" }];
		const x = buildDocExtraction(
			RawDocExtraction.parse({
				...quoteReply,
				lines,
				subtotal: null,
				taxTotal: null,
				total: null,
			}),
			US,
		);
		expect(Object.keys(x.mismatches)).toEqual(["lines.0.printedAmount"]);
	});

	it("India: GST slabs, HSN codes, state from GSTIN, day/month dates", () => {
		const raw = RawDocExtraction.parse({
			title: "TAX INVOICE",
			documentType: "invoice",
			date: "03/04/2026",
			currency: "INR",
			buyer: {
				name: "Sunrise School",
				addressLines: [],
				country: "India",
				taxId: "29AABCS1234F1Z2",
			},
			lines: [
				{
					description: "Veg thali",
					quantity: "100",
					unitPrice: "120.00",
					taxRates: ["9", "9"],
					hsnSac: "996331",
					amount: "12,000.00",
				},
				{
					description: "Juice",
					quantity: "10",
					unitPrice: "50",
					taxRates: ["12"],
					amount: "500",
				},
			],
			total: "₹ 14,720.00",
		});
		const x = buildDocExtraction(raw, IN);
		expect(x.form.buyer.region).toBe("29");
		expect(x.form.date).toBe("2026-04-03");
		expect(x.uncertain).toContain("date");
		expect(x.form.lines[0]).toMatchObject({
			taxCode: "IN-GST-18",
			hsnSac: "996331",
			printedRate: "9% + 9%",
		});
		expect(x.form.lines[1].taxCode).toBe("");
		expect(x.issues["lines.1.taxCode"]).toBe("Pick a tax code");
		expect(x.reasons["lines.1.taxCode"]).toMatch(/isn't a IN rate/);
	});

	it("turns a printed discount percent into an exact amount", () => {
		const x = buildDocExtraction(
			RawDocExtraction.parse({
				title: "Invoice",
				date: "2026-10-01",
				currency: "USD",
				buyer: { name: "Riverside USD", country: "US", region: "CA" },
				lines: [
					{
						description: "Milk",
						quantity: "40",
						unitPrice: "18.40",
						discountPercent: "10%",
						amount: "662.40",
					},
				],
				subtotal: "662.40",
				taxTotal: "0.00",
				total: "662.40",
			}),
			US,
		);
		expect(x.form.lines[0].discount).toBe("73.6");
		expect(x.form.lines[0].taxCode).toBe("EXEMPT");
		expect(x.mismatches).toEqual({});
		expect(x.issues).toEqual({});
	});

	it("credit notes keep amounts positive and say so", () => {
		const x = buildDocExtraction(
			RawDocExtraction.parse({
				title: "Credit Note",
				date: "2026-10-01",
				currency: "USD",
				buyer: { name: "Lincoln PTA", country: "US" },
				lines: [
					{
						description: "Returned trays",
						quantity: "2",
						unitPrice: "(22.00)",
					},
				],
			}),
			US,
		);
		expect(x.form.type).toBe("credit_note");
		expect(x.form.lines[0].unitPrice).toBe("22.00");
		expect(x.uncertain).toContain("lines.0.unitPrice");
	});

	it("a lump-sum line becomes 1 at the printed amount, flagged", () => {
		const x = buildDocExtraction(
			RawDocExtraction.parse({
				title: "Quote",
				date: "2026-10-01",
				buyer: { name: "PTA", country: "US" },
				lines: [{ description: "Setup and cleanup", amount: "45.00" }],
			}),
			US,
		);
		expect(x.form.lines[0]).toMatchObject({
			quantity: "1",
			unitPrice: "45.00",
		});
		expect(x.uncertain).toEqual(
			expect.arrayContaining([
				"lines.0.quantity",
				"lines.0.unitPrice",
				"currency",
			]),
		);
	});
});

describe("validateForm / checkTotals", () => {
	const form = (): DocImportForm =>
		buildDocExtraction(RawDocExtraction.parse(quoteReply), US).form;

	it("asks for a rate on US-SALES lines and a buyer name", () => {
		const f = form();
		f.lines[0].rate = "";
		f.buyer.name = " ";
		const issues = validateForm(f, US);
		expect(issues["lines.0.rate"]).toBeDefined();
		expect(issues["buyer.name"]).toBe("Buyer name is required");
	});

	it("rejects a tax code from another country", () => {
		const f = form();
		f.lines[0].taxCode = "GB-VAT-20";
		expect(validateForm(f, US)["lines.0.taxCode"]).toMatch(/isn't a US/);
	});

	it("reports tax-engine errors on the right line", () => {
		const f = form();
		f.lines[1].discount = "500";
		expect(validateForm(f, US)["lines.1.discount"]).toMatch(/discount/);
	});

	it("needs at least one line", () => {
		const f = { ...form(), lines: [] };
		expect(validateForm(f, US).lines).toBeDefined();
	});

	it("computes totals with the tax engine and compares in minor units", () => {
		const f = form();
		const t = formTotals(f, US);
		if (!t.ok) throw new Error(t.error);
		expect(t.result.totalMinor).toBe(35636);
		expect(checkTotals(f, t.result).mismatches).toEqual({});
		f.printed.tax = "14.35";
		expect(Object.keys(checkTotals(f, t.result).mismatches)).toEqual([
			"printed.tax",
		]);
	});
});

describe("correctedPaths", () => {
	it("lists edited fields and added lines", () => {
		const read = buildDocExtraction(
			RawDocExtraction.parse(quoteReply),
			US,
		).form;
		const saved = structuredClone(read);
		saved.buyer.name = "Lincoln Elementary School PTA";
		saved.lines[0].unitPrice = "14.00";
		saved.lines.push({ ...EMPTY_LINE });
		expect(correctedPaths(read, saved)).toEqual([
			"lines",
			"buyer.name",
			"lines.0.unitPrice",
		]);
	});
});

describe("parseDocReply", () => {
	it("rejects replies that aren't JSON or have nothing to import", () => {
		expect(parseDocReply("sorry, I can't", US).ok).toBe(false);
		expect(parseDocReply("{}", US).ok).toBe(false);
	});

	it("accepts fenced JSON", () => {
		const r = parseDocReply(
			`\`\`\`json\n${JSON.stringify(quoteReply)}\n\`\`\``,
			US,
		);
		expect(r.ok).toBe(true);
	});
});
