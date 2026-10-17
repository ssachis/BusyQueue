/**
 * Duplicate guard for vendor-invoice import. Pure, so it is unit-tested.
 *
 * Two invoices are the same bill when the vendor and the invoice number
 * match after normalising spelling. Vendors use the price lookup's normalisation
 * ("ACME SUPPLY INC" = "Acme Supply, Inc."). Invoice numbers ignore only
 * case, spaces and "#" ("inv # 1042" = "INV1042"); dashes and digits stay,
 * because they can be the difference between two real bills.
 */
import { normalizeVendor } from "#/lib/rules/aliases.ts";

export interface StoredInvoiceKey {
	id: string;
	vendor: string;
	invoiceNumber: string;
}

/** "inv # 1042 " → "INV1042". The same rule runs in SQL (see the service). */
export function normalizeInvoiceNumber(value: string): string {
	return value.replace(/[\s#]+/g, "").toUpperCase();
}

const vendorKey = (name: string) =>
	normalizeVendor(name) || name.trim().toLowerCase();

/** Stored invoices that are the same vendor and invoice number as the draft. */
export function findDuplicateInvoices<T extends StoredInvoiceKey>(
	draft: { vendor: string; invoiceNumber: string },
	stored: readonly T[],
): T[] {
	const number = normalizeInvoiceNumber(draft.invoiceNumber);
	const vendor = vendorKey(draft.vendor);
	if (number === "" || vendor === "") return [];
	return stored.filter(
		(s) =>
			normalizeInvoiceNumber(s.invoiceNumber) === number &&
			vendorKey(s.vendor) === vendor,
	);
}
