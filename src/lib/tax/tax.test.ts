import { describe, expect, it } from "vitest";
import {
	computeTax,
	documentHeading,
	NOTES,
	type TaxContext,
	TaxError,
	type TaxErrorCode,
	type TaxLineInput,
	taxCodes,
} from "./index.ts";

const line = (
	lineNo: number,
	quantity: string,
	unitPrice: string,
	taxCode: string,
	extra: Partial<TaxLineInput> = {},
): TaxLineInput => ({ lineNo, quantity, unitPrice, taxCode, ...extra });

function expectTaxError(fn: () => unknown, code: TaxErrorCode): void {
	try {
		fn();
	} catch (e) {
		expect(e).toBeInstanceOf(TaxError);
		expect((e as TaxError).code).toBe(code);
		return;
	}
	throw new Error(`Expected TaxError(${code}), nothing was thrown`);
}

describe("India GST", () => {
	const intra: TaxContext = {
		seller: { country: "IN", region: "27", taxId: "27AAAAA0000A1Z5" },
		buyer: { country: "IN", region: "27", taxId: "27BBBBB0000B1Z5" },
		currency: "INR",
	};

	it("splits CGST + SGST per line, each rounded to paise (odd paise case)", () => {
		const r = computeTax(intra, [
			line(1, "1", "100.05", "IN-GST-18", { hsnSac: "8471" }),
			line(2, "3", "33.33", "IN-GST-5", { discount: "0.99", hsnSac: "9983" }),
		]);
		expect(r.supplyType).toBe("intra_state");
		expect(r.rounding).toBe("line");
		// 100.05 × 9% = 9.0045 → 9.00 for each half, so 18.00 (IGST would be 18.01).
		expect(r.lines[0]).toEqual({
			lineNo: 1,
			netMinor: 10005,
			components: [
				{ code: "CGST", rate: "9", amountMinor: 900 },
				{ code: "SGST", rate: "9", amountMinor: 900 },
			],
			taxMinor: 1800,
			totalMinor: 11805,
			hsnSac: "8471",
		});
		// 3 × 33.33 − 0.99 = 99.00; × 2.5% = 2.475 → 2.48 each.
		expect(r.lines[1].netMinor).toBe(9900);
		expect(r.lines[1].components).toEqual([
			{ code: "CGST", rate: "2.5", amountMinor: 248 },
			{ code: "SGST", rate: "2.5", amountMinor: 248 },
		]);
		expect(r.lines[1].hsnSac).toBe("9983");
		expect(r.subtotalMinor).toBe(19905);
		expect(r.taxMinor).toBe(2296);
		expect(r.totalMinor).toBe(22201);
		expect(r.taxTotals).toEqual([
			{ code: "CGST", rate: "9", taxableMinor: 10005, amountMinor: 900 },
			{ code: "SGST", rate: "9", taxableMinor: 10005, amountMinor: 900 },
			{ code: "CGST", rate: "2.5", taxableMinor: 9900, amountMinor: 248 },
			{ code: "SGST", rate: "2.5", taxableMinor: 9900, amountMinor: 248 },
		]);
		expect(r.reverseCharge).toBe(false);
		expect(r.notes).toEqual([]);
	});

	it("uses UTGST instead of SGST in a union territory without a legislature", () => {
		const r = computeTax(
			{
				...intra,
				seller: { country: "IN", region: "04" },
				buyer: { country: "IN", region: "04" },
			},
			[line(1, "1", "1000", "IN-GST-18")],
		);
		expect(r.lines[0].components).toEqual([
			{ code: "CGST", rate: "9", amountMinor: 9000 },
			{ code: "UTGST", rate: "9", amountMinor: 9000 },
		]);
	});

	it("charges IGST at the full rate inter-state", () => {
		const r = computeTax({ ...intra, buyer: { country: "IN", region: "29" } }, [
			line(1, "2", "1250.50", "IN-GST-18"),
			line(2, "1", "999.99", "IN-GST-40"),
			line(3, "1", "50", "EXEMPT"),
		]);
		expect(r.supplyType).toBe("inter_state");
		// 2501.00 × 18% = 450.18; 999.99 × 40% = 399.996 → 400.00.
		expect(r.lines.map((l) => l.components)).toEqual([
			[{ code: "IGST", rate: "18", amountMinor: 45018 }],
			[{ code: "IGST", rate: "40", amountMinor: 40000 }],
			[],
		]);
		expect(r.subtotalMinor).toBe(355099);
		expect(r.taxMinor).toBe(85018);
		expect(r.totalMinor).toBe(440117);
	});

	it("lets an explicit place of supply override the buyer's state", () => {
		const r = computeTax(
			{ ...intra, buyer: { country: "IN", region: "29" }, placeOfSupply: "27" },
			[line(1, "1", "100", "IN-GST-5")],
		);
		expect(r.supplyType).toBe("intra_state");
		expect(r.taxMinor).toBe(500);
	});

	it("zero-rates exports under LUT with the Rule 46 endorsement", () => {
		const r = computeTax(
			{ ...intra, buyer: { country: "US", region: "NY" }, currency: "USD" },
			[line(1, "10", "15.75", "IN-GST-18", { hsnSac: "998314" })],
		);
		expect(r.supplyType).toBe("export");
		expect(r.lines[0]).toMatchObject({
			netMinor: 15750,
			components: [],
			taxMinor: 0,
			totalMinor: 15750,
			hsnSac: "998314",
		});
		expect(r.taxMinor).toBe(0);
		expect(r.reverseCharge).toBe(false);
		expect(r.notes).toEqual([NOTES.IN_EXPORT_LUT]);
	});

	it("needs the seller state and the place of supply", () => {
		expectTaxError(
			() =>
				computeTax({ ...intra, seller: { country: "IN" } }, [
					line(1, "1", "1", "IN-GST-5"),
				]),
			"missing_region",
		);
		expectTaxError(
			() =>
				computeTax({ ...intra, buyer: { country: "IN" } }, [
					line(1, "1", "1", "IN-GST-5"),
				]),
			"missing_region",
		);
		expectTaxError(
			() =>
				computeTax({ ...intra, buyer: { country: "IN", region: "MH" } }, [
					line(1, "1", "1", "IN-GST-5"),
				]),
			"invalid_input",
		);
	});
});

describe("Canada GST/HST/PST/QST (rounded per invoice per component)", () => {
	const ctx = (region?: string, country = "CA"): TaxContext => ({
		seller: { country: "CA", region: "ON", taxId: "123456789RT0001" },
		buyer: { country, region },
		currency: "CAD",
	});

	it("ON: 13% HST", () => {
		const r = computeTax(ctx("ON"), [
			line(1, "1", "10.99", "CA-STD"),
			line(2, "3", "0.35", "CA-STD"),
		]);
		// 1.4287 + 0.1365 = 1.5652 → 1.57; lines 1.43 + 0.14.
		expect(r.rounding).toBe("invoice");
		expect(r.lines.map((l) => l.components)).toEqual([
			[{ code: "HST", rate: "13", amountMinor: 143 }],
			[{ code: "HST", rate: "13", amountMinor: 14 }],
		]);
		expect(r.subtotalMinor).toBe(1204);
		expect(r.taxMinor).toBe(157);
		expect(r.totalMinor).toBe(1361);
	});

	it("QC: GST 5% + QST 9.975%, with the QST rounding difference on the largest line", () => {
		const r = computeTax(ctx("QC"), [
			line(1, "1", "100.00", "CA-STD"),
			line(2, "1", "49.99", "CA-STD"),
		]);
		// GST: 5 + 2.4995 = 7.4995 → 7.50. QST: 9.975 + 4.9865025 = 14.9615025 → 14.96,
		// while the lines alone round to 9.98 + 4.99 = 14.97, so line 1 gives back 1 cent.
		expect(r.lines[0]).toMatchObject({
			components: [
				{ code: "GST", rate: "5", amountMinor: 500 },
				{ code: "QST", rate: "9.975", amountMinor: 997 },
			],
			taxMinor: 1497,
			totalMinor: 11497,
		});
		expect(r.lines[1]).toMatchObject({
			components: [
				{ code: "GST", rate: "5", amountMinor: 250 },
				{ code: "QST", rate: "9.975", amountMinor: 499 },
			],
			taxMinor: 749,
			totalMinor: 5748,
		});
		expect(r.taxTotals).toEqual([
			{ code: "GST", rate: "5", taxableMinor: 14999, amountMinor: 750 },
			{ code: "QST", rate: "9.975", taxableMinor: 14999, amountMinor: 1496 },
		]);
		expect(r.totalMinor).toBe(17245);
	});

	it("BC: GST 5% + PST 7%", () => {
		const r = computeTax(ctx("BC"), [line(1, "2", "24.99", "CA-STD")]);
		// 49.98 × 5% = 2.499 → 2.50; × 7% = 3.4986 → 3.50.
		expect(r.lines[0].components).toEqual([
			{ code: "GST", rate: "5", amountMinor: 250 },
			{ code: "PST", rate: "7", amountMinor: 350 },
		]);
		expect(r.totalMinor).toBe(5598);
	});

	it("AB: GST only; NS: 14% HST since April 2025", () => {
		expect(
			computeTax(ctx("AB"), [line(1, "1", "80", "CA-STD")]).lines[0].components,
		).toEqual([{ code: "GST", rate: "5", amountMinor: 400 }]);
		expect(
			computeTax(ctx("NS"), [line(1, "1", "100", "CA-STD")]).taxMinor,
		).toBe(1400);
	});

	it("zero-rated and exempt lines carry no tax", () => {
		const r = computeTax(ctx("ON"), [
			line(1, "1", "10", "ZERO"),
			line(2, "1", "10", "EXEMPT"),
		]);
		expect(r.taxMinor).toBe(0);
		expect(r.taxTotals).toEqual([]);
	});

	it("allocates a negative rounding difference deterministically", () => {
		// 3 × (0.05 × 13% = 0.0065): lines round to 0.01 each, invoice total 0.0195 → 0.02.
		const r = computeTax(ctx("ON"), [
			line(1, "1", "0.05", "CA-STD"),
			line(2, "1", "0.05", "CA-STD"),
			line(3, "1", "0.05", "CA-STD"),
		]);
		expect(r.lines.map((l) => l.taxMinor)).toEqual([0, 1, 1]);
		expect(r.taxMinor).toBe(2);
	});

	it("exports outside Canada are zero-rated; a Canadian buyer needs a province", () => {
		const r = computeTax(ctx(undefined, "US"), [line(1, "1", "100", "CA-STD")]);
		expect(r.taxMinor).toBe(0);
		expect(r.notes).toEqual([NOTES.CA_EXPORT]);
		expectTaxError(
			() => computeTax(ctx(), [line(1, "1", "1", "CA-STD")]),
			"missing_region",
		);
		expectTaxError(
			() => computeTax(ctx("XX"), [line(1, "1", "1", "CA-STD")]),
			"invalid_input",
		);
	});
});

describe("Germany and France VAT", () => {
	const de = (buyer: TaxContext["buyer"]): TaxContext => ({
		seller: { country: "DE", taxId: "DE123456789" },
		buyer,
		currency: "EUR",
	});

	it("DE domestic: 19% and 7%, rounded once per rate", () => {
		const r = computeTax(de({ country: "DE" }), [
			line(1, "3", "19.99", "DE-VAT-19"),
			line(2, "1", "12.50", "DE-VAT-7"),
			line(3, "2", "0.99", "DE-VAT-19"),
		]);
		// 19%: 11.3943 + 0.3762 = 11.7705 → 11.77. 7%: 0.875 → 0.88.
		expect(r.taxTotals).toEqual([
			{ code: "VAT", rate: "19", taxableMinor: 6195, amountMinor: 1177 },
			{ code: "VAT", rate: "7", taxableMinor: 1250, amountMinor: 88 },
		]);
		expect(r.lines.map((l) => l.taxMinor)).toEqual([1139, 88, 38]);
		expect(r.subtotalMinor).toBe(7445);
		expect(r.taxMinor).toBe(1265);
		expect(r.totalMinor).toBe(8710);
		expect(r.reverseCharge).toBe(false);
	});

	it("DE → FR business with a VAT ID: reverse charge", () => {
		const r = computeTax(de({ country: "FR", taxId: "FR40303265045" }), [
			line(1, "1", "1000.00", "DE-VAT-19"),
		]);
		expect(r.reverseCharge).toBe(true);
		expect(r.taxMinor).toBe(0);
		expect(r.totalMinor).toBe(100000);
		expect(r.lines[0].components).toEqual([]);
		expect(r.notes).toEqual([
			NOTES.DE_REVERSE_CHARGE,
			"Customer VAT ID: FR40303265045",
		]);
		expect(r.notes[0]).toContain(
			"Steuerschuldnerschaft des Leistungsempfängers",
		);
	});

	it("DE → FR consumer without a VAT ID pays German VAT; DE → US is outside scope", () => {
		expect(
			computeTax(de({ country: "FR", taxId: "  " }), [
				line(1, "1", "100", "DE-VAT-19"),
			]).taxMinor,
		).toBe(1900);
		const r = computeTax(de({ country: "US", taxId: "12-3456789" }), [
			line(1, "1", "100", "DE-VAT-19"),
		]);
		expect(r.taxMinor).toBe(0);
		expect(r.reverseCharge).toBe(false);
		expect(r.notes).toEqual([NOTES.DE_OUTSIDE_EU]);
	});

	it("FR reduced rates 10%, 5.5%, 2.1%", () => {
		const r = computeTax(
			{ seller: { country: "FR" }, buyer: { country: "FR" }, currency: "EUR" },
			[
				line(1, "4", "2.35", "FR-VAT-5.5"),
				line(2, "1", "18.50", "FR-VAT-10"),
				line(3, "1", "7.90", "FR-VAT-2.1"),
			],
		);
		// 9.40 × 5.5% = 0.517 → 0.52; 18.50 × 10% = 1.85; 7.90 × 2.1% = 0.1659 → 0.17.
		expect(r.lines.map((l) => l.taxMinor)).toEqual([52, 185, 17]);
		expect(r.subtotalMinor).toBe(3580);
		expect(r.totalMinor).toBe(3834);
	});

	it("FR → DE business: Auto-liquidation", () => {
		const r = computeTax(
			{
				seller: { country: "FR" },
				buyer: { country: "DE", taxId: "DE123456789" },
				currency: "EUR",
			},
			[line(1, "1", "500", "FR-VAT-20")],
		);
		expect(r.reverseCharge).toBe(true);
		expect(r.notes[0]).toBe(NOTES.FR_REVERSE_CHARGE);
	});
});

describe("United Kingdom VAT (rounded per line)", () => {
	const gb = (buyer: TaxContext["buyer"]): TaxContext => ({
		seller: { country: "GB", taxId: "GB123456789" },
		buyer,
		currency: "GBP",
	});

	it("standard, reduced and zero rates", () => {
		const r = computeTax(gb({ country: "GB" }), [
			line(1, "1", "49.99", "GB-VAT-20"),
			line(2, "2", "1.25", "ZERO"),
			line(3, "1", "0.99", "GB-VAT-5"),
		]);
		// 9.998 → 10.00; 0; 0.0495 → 0.05.
		expect(r.lines.map((l) => l.taxMinor)).toEqual([1000, 0, 5]);
		expect(r.subtotalMinor).toBe(5348);
		expect(r.taxMinor).toBe(1005);
		expect(r.totalMinor).toBe(6353);
	});

	it("B2B abroad is reverse charge; B2C abroad is a zero-rated export", () => {
		const rc = computeTax(gb({ country: "DE", taxId: "DE123456789" }), [
			line(1, "1", "100", "GB-VAT-20"),
		]);
		expect(rc).toMatchObject({
			reverseCharge: true,
			taxMinor: 0,
			notes: [NOTES.GB_REVERSE_CHARGE],
		});
		const ex = computeTax(gb({ country: "US" }), [
			line(1, "1", "100", "GB-VAT-20"),
		]);
		expect(ex).toMatchObject({
			reverseCharge: false,
			taxMinor: 0,
			notes: [NOTES.GB_EXPORT],
		});
	});
});

describe("Australia GST (total invoice rule)", () => {
	it("GST 10% rounded once on the invoice; GST-free lines carry none", () => {
		const r = computeTax(
			{
				seller: { country: "AU", taxId: "51824753556" },
				buyer: { country: "AU" },
				currency: "AUD",
			},
			[
				line(1, "3", "3.33", "AU-GST-10"),
				line(2, "1", "0.15", "AU-GST-10"),
				line(3, "1", "4.50", "ZERO"),
			],
		);
		// 0.999 + 0.015 = 1.014 → 1.01; lines alone would be 1.00 + 0.02.
		expect(r.lines.map((l) => l.taxMinor)).toEqual([99, 2, 0]);
		expect(r.taxTotals).toEqual([
			{ code: "GST", rate: "10", taxableMinor: 1014, amountMinor: 101 },
		]);
		expect(r.subtotalMinor).toBe(1464);
		expect(r.totalMinor).toBe(1565);
	});

	it("exports are GST-free", () => {
		const r = computeTax(
			{ seller: { country: "AU" }, buyer: { country: "NZ" }, currency: "AUD" },
			[line(1, "1", "100", "AU-GST-10")],
		);
		expect(r.taxMinor).toBe(0);
		expect(r.notes).toEqual([NOTES.AU_EXPORT]);
	});
});

describe("UAE VAT", () => {
	const ae = (buyer: TaxContext["buyer"]): TaxContext => ({
		seller: { country: "AE", taxId: "100000000000003" },
		buyer,
		currency: "AED",
	});

	it("5% standard rate and exempt lines", () => {
		const r = computeTax(ae({ country: "AE" }), [
			line(1, "7", "12.35", "AE-VAT-5"),
			line(2, "1", "100", "EXEMPT"),
		]);
		// 86.45 × 5% = 4.3225 → 4.32.
		expect(r.lines.map((l) => l.taxMinor)).toEqual([432, 0]);
		expect(r.subtotalMinor).toBe(18645);
		expect(r.totalMinor).toBe(19077);
	});

	it("foreign business with a tax ID: reverse charge", () => {
		const r = computeTax(ae({ country: "GB", taxId: "GB123456789" }), [
			line(1, "1", "1000", "AE-VAT-5"),
		]);
		expect(r.reverseCharge).toBe(true);
		expect(r.taxMinor).toBe(0);
		expect(r.notes).toEqual([NOTES.AE_REVERSE_CHARGE, NOTES.AE_EXPORT]);
	});
});

describe("US sales tax (user rate, rounded per invoice per rate)", () => {
	it("applies the entered rate and rounds the rate group once", () => {
		const r = computeTax(
			{
				seller: { country: "US", region: "NY" },
				buyer: { country: "US", region: "NY" },
				currency: "USD",
			},
			[
				line(1, "3", "19.99", "US-SALES", { rate: "8.875" }),
				line(2, "1", "0.40", "US-SALES", { rate: "8.875" }),
				line(3, "1", "10.00", "US-SALES", { rate: "4" }),
				line(4, "1", "5.00", "EXEMPT"),
			],
		);
		// 5.3223375 + 0.0355 = 5.3578375 → 5.36; 10.00 × 4% = 0.40.
		expect(r.lines.map((l) => l.taxMinor)).toEqual([532, 4, 40, 0]);
		expect(r.taxTotals).toEqual([
			{
				code: "SALES_TAX",
				rate: "8.875",
				taxableMinor: 6037,
				amountMinor: 536,
			},
			{ code: "SALES_TAX", rate: "4", taxableMinor: 1000, amountMinor: 40 },
		]);
		expect(r.subtotalMinor).toBe(7537);
		expect(r.taxMinor).toBe(576);
		expect(r.totalMinor).toBe(8113);
	});
});

describe("discounts and validation", () => {
	const us: TaxContext = {
		seller: { country: "US" },
		buyer: { country: "US" },
		currency: "USD",
	};
	const de: TaxContext = {
		seller: { country: "DE" },
		buyer: { country: "DE" },
		currency: "EUR",
	};

	it("taxes the discounted net", () => {
		const r = computeTax(de, [
			line(1, "10", "9.99", "DE-VAT-19", { discount: "9.90" }),
		]);
		// 99.90 − 9.90 = 90.00; × 19% = 17.10.
		expect(r.lines[0]).toMatchObject({ netMinor: 9000, taxMinor: 1710 });
	});

	it("rounds a fractional net once, half-up", () => {
		const r = computeTax(de, [line(1, "0.333", "1.5", "DE-VAT-19")]);
		// 0.4995 → 0.50; tax on 0.50 = 0.095 → 0.10.
		expect(r.lines[0]).toMatchObject({ netMinor: 50, taxMinor: 10 });
	});

	it("an empty document is all zeros", () => {
		const r = computeTax(de, []);
		expect(r).toMatchObject({ subtotalMinor: 0, taxMinor: 0, totalMinor: 0 });
	});

	it.each<[string, () => unknown, TaxErrorCode]>([
		[
			"unknown seller country",
			() =>
				computeTax({ ...de, seller: { country: "JP" as "DE" } }, [
					line(1, "1", "1", "EXEMPT"),
				]),
			"unknown_country",
		],
		[
			"unknown tax code",
			() => computeTax(de, [line(1, "1", "1", "DE-VAT-16")]),
			"unknown_tax_code",
		],
		[
			"code from another country",
			() => computeTax(de, [line(1, "1", "1", "FR-VAT-20")]),
			"unknown_tax_code",
		],
		[
			"float-like quantity",
			() => computeTax(de, [line(1, "1e3", "1", "DE-VAT-19")]),
			"invalid_input",
		],
		[
			"negative price",
			() => computeTax(de, [line(1, "1", "-5", "DE-VAT-19")]),
			"invalid_input",
		],
		[
			"discount above the line amount",
			() =>
				computeTax(de, [line(1, "1", "5", "DE-VAT-19", { discount: "5.01" })]),
			"invalid_input",
		],
		[
			"duplicate line numbers",
			() =>
				computeTax(de, [
					line(1, "1", "1", "EXEMPT"),
					line(1, "1", "1", "EXEMPT"),
				]),
			"invalid_input",
		],
		[
			"US-SALES without a rate",
			() => computeTax(us, [line(1, "1", "1", "US-SALES")]),
			"invalid_input",
		],
		[
			"rate above 100%",
			() => computeTax(us, [line(1, "1", "1", "US-SALES", { rate: "101" })]),
			"invalid_input",
		],
		[
			"rate on a non-US code",
			() => computeTax(de, [line(1, "1", "1", "DE-VAT-19", { rate: "19" })]),
			"invalid_input",
		],
		[
			"bad currency",
			() =>
				computeTax({ ...de, currency: "eur" }, [
					line(1, "1", "1", "DE-VAT-19"),
				]),
			"invalid_input",
		],
		[
			"bad buyer country",
			() =>
				computeTax({ ...de, buyer: { country: "Germany" } }, [
					line(1, "1", "1", "DE-VAT-19"),
				]),
			"invalid_input",
		],
	])("throws on %s", (_name, fn, code) => {
		expectTaxError(fn, code);
	});
});

describe("taxCodes", () => {
	it("lists India's GST 2.0 slabs", () => {
		expect(taxCodes("IN").map((c) => c.code)).toEqual([
			"IN-GST-0.25",
			"IN-GST-1.5",
			"IN-GST-3",
			"IN-GST-5",
			"IN-GST-18",
			"IN-GST-40",
			"ZERO",
			"EXEMPT",
		]);
		expect(taxCodes("IN").find((c) => c.code === "IN-GST-18")?.rate).toBe("18");
	});

	it("fills in the Canadian province rate when given", () => {
		expect(taxCodes("CA", "ON")[0]).toMatchObject({
			code: "CA-STD",
			rate: "13",
		});
		expect(taxCodes("CA", "QC")[0]).toMatchObject({ rate: "14.975" });
		expect(taxCodes("CA")[0]).toMatchObject({ code: "CA-STD", rate: "" });
		expectTaxError(() => taxCodes("CA", "ZZ"), "invalid_input");
	});

	it("has a code list for every country and rejects unknown ones", () => {
		for (const c of ["IN", "US", "GB", "DE", "FR", "AU", "CA", "AE"] as const) {
			expect(taxCodes(c).length).toBeGreaterThan(1);
		}
		expect(taxCodes("US")[0]).toMatchObject({ code: "US-SALES", rate: "" });
		expect(taxCodes("DE").map((c) => c.rate)).toEqual(["19", "7", "0", "0"]);
		expectTaxError(() => taxCodes("JP" as "US"), "unknown_country");
	});
});

describe("documentHeading", () => {
	it.each<[Parameters<typeof documentHeading>, string]>([
		[["IN", "invoice"], "Tax Invoice"],
		[["IN", "receipt"], "Receipt Voucher"],
		[["IN", "delivery_note"], "Delivery Challan"],
		[["IN", "credit_note"], "Credit Note"],
		[["AU", "invoice"], "Tax Invoice"],
		[["AU", "credit_note"], "Adjustment Note"],
		[["AE", "invoice"], "Tax Invoice"],
		[["AE", "credit_note"], "Tax Credit Note"],
		[["GB", "invoice"], "VAT Invoice"],
		[["DE", "invoice"], "Invoice"],
		[["FR", "proforma"], "Pro Forma Invoice"],
		[["CA", "quote"], "Quote"],
		[["US", "delivery_note"], "Delivery Note"],
		[["DE", "invoice", { reverseCharge: true }], "Invoice (Reverse Charge)"],
		[
			["AE", "invoice", { reverseCharge: true }],
			"Tax Invoice (Reverse Charge)",
		],
		[["DE", "quote", { reverseCharge: true }], "Quote"],
		[["US", "invoice", { reverseCharge: true }], "Invoice"],
	])("%j → %s", (args, expected) => {
		expect(documentHeading(...args)).toBe(expected);
	});

	it("rejects unknown countries and types", () => {
		expectTaxError(
			() => documentHeading("JP" as "US", "invoice"),
			"unknown_country",
		);
		expectTaxError(
			() => documentHeading("US", "bill" as "invoice"),
			"invalid_input",
		);
	});
});
