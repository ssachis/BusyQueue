/**
 * Saved clients: who documents are addressed to. Shared by the forms (client)
 * and the server functions, so both validate the same way. A client with
 * history (any document points at it) is archived, never deleted.
 */
import { z } from "zod";
import type { PartySnapshot } from "#/lib/documents/types.ts";

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
	trimmed(max)
		.transform((v) => (v === "" ? null : v))
		.nullable();

export const ClientInput = z.object({
	name: trimmed(200).min(1, "Name is required"),
	addressLine1: optionalText(200),
	addressLine2: optionalText(200),
	city: optionalText(100),
	/** State / province / emirate code, e.g. "CA", "ON", "27" (Maharashtra). */
	region: optionalText(20),
	postalCode: optionalText(20),
	/** ISO 3166-1 alpha-2. */
	country: trimmed(2)
		.transform((v) => v.toUpperCase())
		.pipe(z.string().regex(/^[A-Z]{2}$/, "Use a 2-letter country code")),
	taxId: optionalText(40),
	email: z
		.union([z.literal(""), z.email("Use a valid email")])
		.transform((v) => (v === "" ? null : v))
		.nullable(),
	/** IN only: GST state code that decides CGST+SGST vs IGST. */
	placeOfSupply: optionalText(20),
});
export type ClientInput = z.infer<typeof ClientInput>;
export type ClientFormInput = z.input<typeof ClientInput>;

/** The stored fields the buyer snapshot needs. */
export type ClientAddress = Pick<
	ClientInput,
	| "name"
	| "addressLine1"
	| "addressLine2"
	| "city"
	| "region"
	| "postalCode"
	| "country"
	| "taxId"
	| "email"
>;

/** What the editor copies into a draft's buyer when a client is picked. */
export function clientToParty(c: ClientAddress): PartySnapshot {
	return {
		name: c.name,
		addressLines: [c.addressLine1, c.addressLine2].filter(
			(l): l is string => !!l,
		),
		...(c.city ? { city: c.city } : {}),
		...(c.region ? { region: c.region } : {}),
		...(c.postalCode ? { postalCode: c.postalCode } : {}),
		country: c.country,
		...(c.taxId ? { taxId: c.taxId } : {}),
		...(c.email ? { email: c.email } : {}),
	};
}

/**
 * Remove or archive. A client that any document points at can only be
 * archived; one with no documents can be deleted outright.
 */
export function removalOutcome(documentCount: number): "delete" | "archive" {
	return documentCount > 0 ? "archive" : "delete";
}
