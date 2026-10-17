import { describe, expect, it } from "vitest";
import { describeActivity } from "./describe.ts";

describe("describeActivity", () => {
	it("names a conversion by the target type", () => {
		expect(describeActivity("converted", { to: "credit_note", id: "x" })).toBe(
			"Converted to credit note",
		);
	});

	it("says where a converted or copied draft came from", () => {
		expect(
			describeActivity("created", { convertedFrom: "a", number: "QUO-0001" }),
		).toBe("Created from QUO-0001");
		expect(
			describeActivity("created", { duplicatedFrom: "a", number: "INV-0002" }),
		).toBe("Copied from INV-0002");
		expect(describeActivity("created", { type: "invoice" })).toBe(
			"Draft created",
		);
	});

	it("shows the number when issued and falls back for unknown kinds", () => {
		expect(describeActivity("issued", { number: "INV-0001" })).toBe(
			"Issued as INV-0001",
		);
		expect(describeActivity("issued", null)).toBe("Issued");
		expect(describeActivity("something_new", null)).toBe("something_new");
	});
});
