import { describe, expect, it } from "vitest";
import { BusinessProfile, DEMO_BUSINESS } from "./profile.ts";

const valid = {
	...DEMO_BUSINESS,
	addressLine2: "",
	logoUrl: "",
	accentColor: "#2563EB",
};

describe("BusinessProfile", () => {
	it("accepts the demo business", () => {
		expect(BusinessProfile.parse(DEMO_BUSINESS)).toEqual(DEMO_BUSINESS);
	});

	it("normalises form input: blanks to null, codes and colours", () => {
		const parsed = BusinessProfile.parse({
			...valid,
			legalName: "  Northfield USD  ",
			currency: "usd",
		});
		expect(parsed).toMatchObject({
			legalName: "Northfield USD",
			addressLine2: null,
			logoUrl: null,
			currency: "USD",
			accentColor: "#2563eb",
		});
	});

	it("rejects bad input with field-level messages", () => {
		const result = BusinessProfile.safeParse({
			...valid,
			legalName: " ",
			country: "XX",
			currency: "dollars",
			accentColor: "blue",
			logoUrl: "not a url",
			taxIds: [{ type: "VAT", value: "" }],
		});
		expect(result.success).toBe(false);
		const paths = result.error?.issues.map((i) => i.path.join(".")).sort();
		expect(paths).toEqual([
			"accentColor",
			"country",
			"currency",
			"legalName",
			"logoUrl",
			"taxIds.0.value",
		]);
	});
});
