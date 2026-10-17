/**
 * Dedupe keys. An attachment is a duplicate when its bytes were seen before
 * (SHA-256), or, once read, when the same vendor's invoice number was
 * already imported from the inbox. Vendor and number are normalised so
 * "RIDGELINE FREIGHT LINES INC / rfl-20417" and "Ridgeline Freight Lines / RFL 20417" collide.
 */
import { normalizeVendor, resolveVendor } from "#/lib/rules/aliases.ts";

/** Lowercase hex SHA-256 (Web Crypto: Workers, browsers and Node). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		bytes as Uint8Array<ArrayBuffer>,
	);
	return [...new Uint8Array(digest)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/** "No. hf-1006" → "HF1006"; blank → null. */
export function normalizeInvoiceNumber(number: string): string | null {
	const n = number
		.toUpperCase()
		.replace(/^\s*(?:INVOICE\s*)?(?:NO\.?|NUMBER|#)\s*/, "")
		.replace(/[^A-Z0-9]/g, "");
	return n.length > 0 ? n : null;
}

/**
 * `vendor|number`, with the vendor resolved to its price-list name when it
 * can be (so spelling variants match) and normalised otherwise. Null when
 * either part is missing: an unread invoice can't be a known duplicate.
 */
export function invoiceDedupeKey(
	vendor: string | null | undefined,
	invoiceNumber: string | null | undefined,
	canonicalVendors: readonly string[],
): string | null {
	if (!vendor?.trim() || !invoiceNumber?.trim()) return null;
	const number = normalizeInvoiceNumber(invoiceNumber);
	if (!number) return null;
	const resolved = resolveVendor(vendor, canonicalVendors);
	const name = normalizeVendor(resolved.ok ? resolved.vendor : vendor);
	return name ? `${name}|${number}` : null;
}
