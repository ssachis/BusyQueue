/**
 * Saved clients: validation shared by the client form and the server
 * functions, and the mapping to the editor's buyer snapshot.
 */
import { z } from "zod";
import { PartySnapshot } from "#/lib/documents/types.ts";
import { isCurrencyCode } from "#/lib/money/index.ts";

const trimmed = (max: number) => z.string().trim().max(max);
/** "" becomes null so optional form fields store as NULL. */
const optionalText = (max: number) =>
	trimmed(max)
		.transform((v) => (v === "" ? null : v))
		.nullable();

export const MAX_ADDRESS_LINES = 4;

/** Split a textarea into trimmed, non-empty lines. */
export function splitAddressLines(value: string): string[] {
	return value
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => l !== "");
}

export const ClientInput = z.object({
	name: trimmed(200).min(1, "Name is required"),
	/** One string per line, or a textarea value split on newlines. */
	addressLines: z.preprocess(
		(v) => (typeof v === "string" ? splitAddressLines(v) : v),
		z
			.array(trimmed(200).min(1))
			.max(MAX_ADDRESS_LINES, `Use at most ${MAX_ADDRESS_LINES} address lines`),
	),
	city: optionalText(100),
	region: optionalText(20),
	postalCode: optionalText(20),
	country: z
		.string()
		.trim()
		.toUpperCase()
		.regex(/^[A-Z]{2}$/, "Use a 2-letter country code"),
	taxId: optionalText(40),
	email: z
		.union([z.literal(""), z.string().trim().pipe(z.email("Not an email"))])
		.transform((v) => (v === "" ? null : v.toLowerCase()))
		.nullable(),
	/** IN only: GST state code of the default place of supply. */
	placeOfSupply: z
		.union([
			z.literal(""),
			z
				.string()
				.trim()
				.regex(/^\d{2}$/, "Use the 2-digit GST state code, like 27"),
		])
		.transform((v) => (v === "" ? null : v))
		.nullable(),
	currency: z
		.union([
			z.literal(""),
			z
				.string()
				.trim()
				.toUpperCase()
				.refine(isCurrencyCode, "Use an ISO 4217 code like USD"),
		])
		.transform((v) => (v === "" ? null : v))
		.nullable(),
	notes: optionalText(2000),
});
export type ClientInput = z.output<typeof ClientInput>;
export type ClientFormInput = z.input<typeof ClientInput>;

/** A saved client as the server returns it. */
export interface ClientRecord extends ClientInput {
	id: string;
	archivedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

/** What the editor needs to fill a document from a saved client. */
export interface PickedClient {
	id: string;
	buyer: PartySnapshot;
	placeOfSupply?: string;
	currency?: string;
}

const some = <T>(v: T | null | undefined): T | undefined => v ?? undefined;

/** The editor's buyer snapshot for a saved client. */
export function clientToBuyer(
	client: Pick<
		ClientInput,
		| "name"
		| "addressLines"
		| "city"
		| "region"
		| "postalCode"
		| "country"
		| "taxId"
		| "email"
	>,
): PartySnapshot {
	const snapshot: PartySnapshot = {
		name: client.name,
		addressLines: client.addressLines.slice(0, MAX_ADDRESS_LINES),
		country: client.country,
	};
	const optional = {
		city: some(client.city),
		region: some(client.region),
		postalCode: some(client.postalCode),
		taxId: some(client.taxId),
		email: some(client.email),
	};
	for (const [k, v] of Object.entries(optional)) {
		if (v !== undefined) (snapshot as Record<string, unknown>)[k] = v;
	}
	return PartySnapshot.parse(snapshot);
}

/** Everything the editor's client picker hands back. */
export function toPickedClient(client: ClientRecord): PickedClient {
	const picked: PickedClient = { id: client.id, buyer: clientToBuyer(client) };
	if (client.placeOfSupply) picked.placeOfSupply = client.placeOfSupply;
	if (client.currency) picked.currency = client.currency;
	return picked;
}

/** One-line address for lists, e.g. "Northfield, CA 95001, US". */
export function shortAddress(
	client: Pick<ClientInput, "city" | "region" | "postalCode" | "country">,
): string {
	const regionPostal = [client.region, client.postalCode]
		.filter(Boolean)
		.join(" ");
	return [client.city, regionPostal, client.country]
		.filter((p) => p !== null && p !== "")
		.join(", ");
}
