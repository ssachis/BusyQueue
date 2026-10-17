import { describe, expect, it } from "vitest";
import { DEMO_BUSINESS } from "#/lib/business/profile.ts";
import { DraftLine, PartySnapshot } from "#/lib/documents/types.ts";
import {
	CatalogItemInput,
	type CatalogItemRecord,
	ClientInput,
	type ClientRecord,
	catalogItemErrors,
	catalogItemToLine,
	catalogTaxCodes,
	clientToBuyer,
	containsPattern,
	formatUnitPrice,
	parseCatalogItem,
	SAMPLE_CATALOG_ITEMS,
	SAMPLE_CLIENTS,
	shortAddress,
	splitAddressLines,
	toPickedClient,
} from "./index.ts";

const clientForm = {
	name: "  Riverbend USD ",
	addressLines: "88 Riverside Drive\n\n  Nutrition Services  \n",
	city: "Riverbend",
	region: "CA",
	postalCode: "95014",
	country: "us",
	taxId: "",
	email: "Nutrition@Riverbend.example",
	placeOfSupply: "",
	currency: "usd",
	notes: "",
};

const record = (over: Partial<ClientRecord> = {}): ClientRecord => ({
	...ClientInput.parse(clientForm),
	id: "cli-1",
	archivedAt: null,
	createdAt: "2026-10-01T00:00:00.000Z",
	updatedAt: "2026-10-01T00:00:00.000Z",
	...over,
});

describe("ClientInput", () => {
	it("normalises form input", () => {
		const c = ClientInput.parse(clientForm);
		expect(c).toEqual({
			name: "Riverbend USD",
			addressLines: ["88 Riverside Drive", "Nutrition Services"],
			city: "Riverbend",
			region: "CA",
			postalCode: "95014",
			country: "US",
			taxId: null,
			email: "nutrition@riverbend.example",
			placeOfSupply: null,
			currency: "USD",
			notes: null,
		});
	});

	it("accepts address lines as an array", () => {
		const c = ClientInput.parse({ ...clientForm, addressLines: ["A", "B"] });
		expect(c.addressLines).toEqual(["A", "B"]);
	});

	it("reports field errors by path", () => {
		const r = ClientInput.safeParse({
			...clientForm,
			name: " ",
			country: "USA",
			email: "nope",
			currency: "dollars",
			placeOfSupply: "Maharashtra",
			addressLines: "1\n2\n3\n4\n5",
		});
		expect(r.success).toBe(false);
		const paths = r.error?.issues.map((i) => i.path.join(".")).sort();
		expect(paths).toEqual([
			"addressLines",
			"country",
			"currency",
			"email",
			"name",
			"placeOfSupply",
		]);
	});

	it("splits textarea lines", () => {
		expect(splitAddressLines(" a \r\n\nb\n")).toEqual(["a", "b"]);
	});
});

describe("clientToBuyer", () => {
	it("maps a client to a valid PartySnapshot without null fields", () => {
		const buyer = clientToBuyer(record());
		expect(buyer).toEqual({
			name: "Riverbend USD",
			addressLines: ["88 Riverside Drive", "Nutrition Services"],
			city: "Riverbend",
			region: "CA",
			postalCode: "95014",
			country: "US",
			email: "nutrition@riverbend.example",
		});
		expect(PartySnapshot.parse(buyer)).toEqual(buyer);
		expect("taxId" in buyer).toBe(false);
	});

	it("carries the tax id when present", () => {
		expect(clientToBuyer(record({ taxId: "27AAAAA0000A1Z5" })).taxId).toBe(
			"27AAAAA0000A1Z5",
		);
	});

	it("builds the picker payload with place of supply and currency", () => {
		const picked = toPickedClient(
			record({ country: "IN", region: "27", placeOfSupply: "29" }),
		);
		expect(picked.id).toBe("cli-1");
		expect(picked.placeOfSupply).toBe("29");
		expect(picked.currency).toBe("USD");
		expect(picked.buyer.country).toBe("IN");
		const bare = toPickedClient(record({ currency: null }));
		expect("currency" in bare).toBe(false);
		expect("placeOfSupply" in bare).toBe(false);
	});

	it("formats a short address", () => {
		expect(shortAddress(record())).toBe("Riverbend, CA 95014, US");
		expect(
			shortAddress({
				city: null,
				region: null,
				postalCode: null,
				country: "DE",
			}),
		).toBe("DE");
	});
});

const itemForm = {
	name: "Catering tray",
	description: "",
	unit: "tray",
	unitPrice: "58.00",
	currency: "usd",
	taxCode: "US-SALES",
	rate: "7.25",
	hsnSac: "",
	code: "CAT-1",
};

describe("catalog validation", () => {
	it("parses a US item with a sales-tax rate", () => {
		const r = parseCatalogItem(itemForm, "US");
		expect(r).toEqual({
			ok: true,
			item: {
				name: "Catering tray",
				description: null,
				unit: "tray",
				unitPrice: "58.00",
				currency: "USD",
				taxCode: "US-SALES",
				rate: "7.25",
				hsnSac: null,
				code: "CAT-1",
			},
		});
	});

	it("rejects non-decimal and negative prices without floats", () => {
		for (const unitPrice of ["1e3", "-1", "12,50", "", "0x10"]) {
			const r = parseCatalogItem({ ...itemForm, unitPrice }, "US");
			expect(r.ok, unitPrice).toBe(false);
			if (!r.ok) expect(r.errors.unitPrice).toBeDefined();
		}
	});

	it("validates the tax code against the business country", () => {
		const item = CatalogItemInput.parse({
			...itemForm,
			taxCode: "IN-GST-18",
			rate: "",
		});
		expect(catalogItemErrors(item, "US").taxCode).toMatch(/Not a tax code/);
		expect(catalogItemErrors(item, "IN")).toEqual({});
	});

	it("requires a rate with US-SALES and forbids it otherwise", () => {
		const noRate = CatalogItemInput.parse({ ...itemForm, rate: "" });
		expect(catalogItemErrors(noRate, "US").rate).toMatch(/Enter/);
		const tooHigh = CatalogItemInput.parse({ ...itemForm, rate: "100.01" });
		expect(catalogItemErrors(tooHigh, "US").rate).toMatch(/percent/);
		const exempt = CatalogItemInput.parse({ ...itemForm, taxCode: "EXEMPT" });
		expect(catalogItemErrors(exempt, "US").rate).toMatch(/only goes/);
	});

	it("allows HSN/SAC only in India", () => {
		const r = parseCatalogItem(
			{ ...itemForm, taxCode: "EXEMPT", rate: "", hsnSac: "996331" },
			"US",
		);
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.errors.hsnSac).toMatch(/India/);
		const inr = parseCatalogItem(
			{
				...itemForm,
				currency: "INR",
				taxCode: "IN-GST-5",
				rate: "",
				hsnSac: "996331",
			},
			"IN",
		);
		expect(inr.ok).toBe(true);
		const bad = parseCatalogItem(
			{ ...itemForm, taxCode: "IN-GST-5", rate: "", hsnSac: "99A" },
			"IN",
		);
		expect(bad.ok).toBe(false);
	});

	it("lists tax codes for supported countries only", () => {
		expect(catalogTaxCodes("US").map((c) => c.code)).toEqual([
			"US-SALES",
			"EXEMPT",
		]);
		expect(catalogTaxCodes("ZZ")).toEqual([]);
	});
});

const item = (over: Partial<CatalogItemRecord> = {}): CatalogItemRecord => ({
	...CatalogItemInput.parse(itemForm),
	id: "itm-1",
	archivedAt: null,
	createdAt: "2026-10-01T00:00:00.000Z",
	updatedAt: "2026-10-01T00:00:00.000Z",
	...over,
});

describe("catalogItemToLine", () => {
	it("fills a draft line with quantity 1 and the item's defaults", () => {
		const line = catalogItemToLine(item(), 3);
		expect(line).toEqual({
			lineNo: 3,
			description: "Catering tray",
			quantity: "1",
			unit: "tray",
			unitPrice: "58.00",
			taxCode: "US-SALES",
			rate: "7.25",
			catalogItemId: "itm-1",
		});
		expect(DraftLine.parse(line)).toEqual(line);
	});

	it("drops the rate unless the code is US-SALES and keeps HSN/SAC", () => {
		const line = catalogItemToLine(
			item({
				taxCode: "IN-GST-18",
				rate: "5",
				hsnSac: "996331",
				unit: null,
				description: "Outdoor catering",
			}),
			1,
		);
		expect(line.rate).toBeUndefined();
		expect(line.unit).toBeUndefined();
		expect(line.hsnSac).toBe("996331");
		expect(line.description).toBe("Catering tray - Outdoor catering");
	});

	it("keeps the description within the line limit", () => {
		const line = catalogItemToLine(
			item({ name: "x".repeat(200), description: "y".repeat(500) }),
			1,
		);
		expect(line.description).toHaveLength(500);
	});
});

describe("formatUnitPrice", () => {
	it("shows minor digits and keeps extra entered digits", () => {
		expect(formatUnitPrice("4.25", "USD")).toBe("$4.25");
		expect(formatUnitPrice("4", "USD")).toBe("$4.00");
		expect(formatUnitPrice("0.125", "USD")).toBe("$0.125");
		expect(formatUnitPrice("1234567.10", "USD")).toBe("$1,234,567.10");
		expect(formatUnitPrice("500", "JPY")).toBe("¥500");
	});
});

describe("containsPattern", () => {
	it("lowercases and escapes LIKE wildcards", () => {
		expect(containsPattern("  PTA ")).toBe("%pta%");
		expect(containsPattern("50%_off\\")).toBe("%50\\%\\_off\\\\%");
		expect(containsPattern("   ")).toBeNull();
	});
});

describe("samples", () => {
	it("are valid for the demo business", () => {
		for (const c of SAMPLE_CLIENTS) {
			const { id: _id, ...input } = c;
			expect(ClientInput.parse(input)).toEqual(input);
		}
		for (const i of SAMPLE_CATALOG_ITEMS) {
			const { id: _id, ...input } = i;
			expect(parseCatalogItem(input, DEMO_BUSINESS.country)).toEqual({
				ok: true,
				item: input,
			});
		}
	});
});
