import { describe, expect, it } from "vitest";
import { ClientInput } from "#/lib/clients/client.ts";
import { taxCodes } from "#/lib/tax/index.ts";
import {
	applyClient,
	blankLine,
	clearClient,
	clientInputFromBuyer,
	type DraftForm,
	draftCandidate,
	fillFromCatalog,
	formFromDraft,
} from "./form.ts";

const base: DraftForm = formFromDraft({
	type: "invoice",
	date: "2026-10-17",
	currency: "USD",
	buyer: { name: "", addressLines: [], country: "US" },
	lines: [],
});

const client = {
	id: "c-1",
	name: "Acme Logistics",
	addressLine1: "1 Dock Rd",
	addressLine2: "Unit 4",
	city: "Oakland",
	region: "CA",
	postalCode: "94607",
	country: "US",
	taxId: null,
	email: "ap@acme.example",
	placeOfSupply: null,
};

describe("applyClient", () => {
	it("fills the buyer snapshot and links the client", () => {
		const form = applyClient(base, client);
		expect(form.clientId).toBe("c-1");
		expect(form.buyer).toEqual({
			name: "Acme Logistics",
			addressLines: "1 Dock Rd\nUnit 4",
			city: "Oakland",
			region: "CA",
			postalCode: "94607",
			country: "US",
			taxId: "",
			email: "ap@acme.example",
		});
		expect(draftCandidate(form, { country: "US" }).buyer.addressLines).toEqual([
			"1 Dock Rd",
			"Unit 4",
		]);
	});

	it("takes the client's place of supply when it has one", () => {
		const form = applyClient(base, {
			...client,
			country: "IN",
			region: "27",
			placeOfSupply: "29",
		});
		expect(form.placeOfSupply).toBe("29");
	});

	it("clear unlinks and empties the buyer", () => {
		const form = clearClient(applyClient(base, client), "US");
		expect(form.clientId).toBeUndefined();
		expect(form.buyer.name).toBe("");
		expect(form.buyer.country).toBe("US");
	});
});

describe("clientInputFromBuyer", () => {
	it("builds a valid client from a hand-typed buyer", () => {
		const input = clientInputFromBuyer(
			{
				name: " Beta Freight ",
				addressLines: "Pier 9\nGate B\nYard 3",
				city: "Seattle",
				region: "wa",
				postalCode: "98101",
				country: "us",
				taxId: "",
				email: "",
			},
			"",
		);
		const parsed = ClientInput.parse(input);
		expect(parsed).toMatchObject({
			name: "Beta Freight",
			addressLine1: "Pier 9",
			addressLine2: "Gate B, Yard 3",
			region: "WA",
			country: "US",
			taxId: null,
			email: null,
		});
	});
});

describe("fillFromCatalog", () => {
	const us = taxCodes("US");
	const line = blankLine([], "EXEMPT");

	it("fills description, unit, price, tax and the catalog link", () => {
		const { patch, taxCodeRejected } = fillFromCatalog(
			{ ...line, quantity: "3" },
			{
				id: "item-1",
				name: "Pallet storage (week)",
				unit: "pallet",
				unitPrice: "12.50",
				taxCode: "US-SALES",
				rate: "8.25",
				hsnSac: null,
			},
			us,
		);
		expect(taxCodeRejected).toBeUndefined();
		expect(patch).toEqual({
			description: "Pallet storage (week)",
			unit: "pallet",
			unitPrice: "12.50",
			taxCode: "US-SALES",
			rate: "8.25",
			hsnSac: "",
			catalogItemId: "item-1",
		});
		expect(patch).not.toHaveProperty("quantity");
	});

	it("keeps the line's tax code when the item's isn't valid here", () => {
		const { patch, taxCodeRejected } = fillFromCatalog(
			line,
			{
				id: "item-2",
				name: "Handling",
				unit: null,
				unitPrice: "40",
				taxCode: "GB-VAT-20",
				rate: null,
				hsnSac: null,
			},
			us,
		);
		expect(taxCodeRejected).toBe("GB-VAT-20");
		expect(patch.taxCode).toBe("EXEMPT");
		expect(patch.description).toBe("Handling");
	});
});
