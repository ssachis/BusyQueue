/**
 * The business profile: who issues documents. Shared by the settings form
 * (client) and the server functions, so both validate the same way.
 *
 * Single-tenant for the hackathon: there is one business, DEMO_BUSINESS_ID.
 * Everything business-scoped (clients, catalog, documents) still carries a
 * business_id so sign-in and multiple businesses can be added later without
 * a data migration.
 */
import { z } from "zod";
import { isCurrencyCode } from "#/lib/money/index.ts";

export const DEMO_BUSINESS_ID = "northfield-usd";

/** Countries the tax engine supports (ISO 3166-1 alpha-2; the UK is GB). */
export const BUSINESS_COUNTRIES = {
	US: "United States",
	CA: "Canada",
	GB: "United Kingdom",
	DE: "Germany",
	FR: "France",
	IN: "India",
	AU: "Australia",
	AE: "United Arab Emirates",
} as const;
export type BusinessCountry = keyof typeof BUSINESS_COUNTRIES;

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
	trimmed(max)
		.transform((v) => (v === "" ? null : v))
		.nullable();

export const TaxId = z.object({
	/** e.g. "EIN", "GSTIN", "VAT", "ABN", "TRN", "GST/HST", "QST". */
	type: trimmed(20).min(1, "Type is required"),
	value: trimmed(40).min(1, "Number is required"),
});
export type TaxId = z.infer<typeof TaxId>;

export const BusinessProfile = z.object({
	legalName: trimmed(200).min(1, "Legal name is required"),
	addressLine1: optionalText(200),
	addressLine2: optionalText(200),
	city: optionalText(100),
	/** State / province / emirate code, e.g. "CA", "ON", "27" (Maharashtra). */
	region: optionalText(20),
	postalCode: optionalText(20),
	country: z.enum(
		Object.keys(BUSINESS_COUNTRIES) as [BusinessCountry, ...BusinessCountry[]],
	),
	currency: z
		.string()
		.trim()
		.toUpperCase()
		.refine(isCurrencyCode, "Use an ISO 4217 code like USD"),
	taxIds: z.array(TaxId).max(5),
	logoUrl: z
		.union([z.literal(""), z.url("Must be a URL")])
		.transform((v) => (v === "" ? null : v))
		.nullable(),
	/** Accent colour for print layouts, #rrggbb. */
	accentColor: z
		.string()
		.regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #2563eb")
		.transform((v) => v.toLowerCase())
		.nullable(),
});
export type BusinessProfile = z.infer<typeof BusinessProfile>;
export type BusinessProfileInput = z.input<typeof BusinessProfile>;

/** The fictional district the sample data belongs to. */
export const DEMO_BUSINESS: BusinessProfile = {
	legalName: "Northfield Unified School District, Food Services",
	addressLine1: "1200 District Way",
	addressLine2: null,
	city: "Northfield",
	region: "CA",
	postalCode: "95001",
	country: "US",
	currency: "USD",
	taxIds: [{ type: "EIN", value: "00-0000000" }],
	logoUrl: null,
	accentColor: "#2563eb",
};
