import { describe, expect, it } from "vitest";
import { PartySnapshot } from "#/lib/documents/types.ts";
import { ClientInput, clientToParty, removalOutcome } from "./client.ts";

const base = {
	name: "  Lincoln Elementary PTA ",
	addressLine1: "12 Oak St",
	addressLine2: "",
	city: "Northfield",
	region: "MN",
	postalCode: "55057",
	country: "us",
	taxId: "",
	email: "",
	placeOfSupply: "",
};

describe("ClientInput", () => {
	it("trims, uppercases the country and turns blanks into null", () => {
		const c = ClientInput.parse(base);
		expect(c.name).toBe("Lincoln Elementary PTA");
		expect(c.country).toBe("US");
		expect(c.addressLine2).toBeNull();
		expect(c.taxId).toBeNull();
		expect(c.email).toBeNull();
	});

	it("requires a name and a 2-letter country", () => {
		expect(ClientInput.safeParse({ ...base, name: " " }).success).toBe(false);
		expect(ClientInput.safeParse({ ...base, country: "USA" }).success).toBe(
			false,
		);
		expect(ClientInput.safeParse({ ...base, email: "nope" }).success).toBe(
			false,
		);
	});
});

describe("clientToParty", () => {
	it("builds a valid buyer snapshot and drops empty fields", () => {
		const party = clientToParty(ClientInput.parse(base));
		expect(PartySnapshot.safeParse(party).success).toBe(true);
		expect(party.addressLines).toEqual(["12 Oak St"]);
		expect(party).not.toHaveProperty("taxId");
		expect(party).not.toHaveProperty("email");
	});
});

describe("removalOutcome", () => {
	it("deletes a client with no documents and archives one with history", () => {
		expect(removalOutcome(0)).toBe("delete");
		expect(removalOutcome(1)).toBe("archive");
		expect(removalOutcome(40)).toBe("archive");
	});
});
