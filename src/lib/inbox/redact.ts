/**
 * Contact-detail redaction for everything the inbox sends to PRISM or to a
 * model: email addresses, phone numbers and street addresses become
 * placeholders. Real mailbox content is personal data; traces only need to
 * show what happened, not who wrote.
 *
 * Pure and deliberately greedy: a false positive costs a word in a trace,
 * a false negative leaks a phone number.
 */

const EMAIL =
	/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/** "mailto:" and "tel:" links, whatever follows. */
const CONTACT_LINK = /\b(?:mailto|tel):[^\s>)"']+/gi;

/** +1 555 123 4567, +44 (20) 7946-0958, +91-98765-43210 */
const PHONE_INTL =
	/\+\d{1,3}[\s.-]?(?:\(\d{1,4}\)[\s.-]?)?\d{1,5}(?:[\s.-]?\d{2,5}){1,4}/g;

/** (555) 123-4567, 555-123-4567, 555.123.4567, 555 123 4567 */
const PHONE_NANP = /(?:\(\d{3}\)\s?|\b\d{3}[\s.-])\d{3}[\s.-]\d{4}\b/g;

const STREET_TYPES = [
	"street",
	"st",
	"avenue",
	"ave",
	"road",
	"rd",
	"boulevard",
	"blvd",
	"lane",
	"ln",
	"drive",
	"dr",
	"way",
	"court",
	"ct",
	"place",
	"pl",
	"terrace",
	"ter",
	"parkway",
	"pkwy",
	"highway",
	"hwy",
	"circle",
	"cir",
	"square",
	"sq",
].join("|");

/** "4100 Rail Yard Road", "42 N. Main St., Suite 300" */
const STREET = new RegExp(
	String.raw`\b\d{1,6}\s+(?:[A-Za-z][A-Za-z0-9.'-]*\s+){1,4}(?:${STREET_TYPES})\b\.?(?:,?\s*(?:suite|ste|apt|unit|#)\s*[\w-]+)?`,
	"gi",
);

const PO_BOX = /\bP\.?\s?O\.?\s*Box\s+\d+/gi;

export const REDACTED = {
	email: "[email]",
	phone: "[phone]",
	address: "[address]",
} as const;

/** Replace contact details in free text. Idempotent. */
export function redact(text: string): string {
	return (
		text
			.replace(CONTACT_LINK, (m) =>
				m.toLowerCase().startsWith("tel:") ? REDACTED.phone : REDACTED.email,
			)
			.replace(EMAIL, REDACTED.email)
			// "+12.50" is a price, not a phone: real numbers have 7+ digits.
			.replace(PHONE_INTL, (m) =>
				m.replace(/\D/g, "").length >= 7 ? REDACTED.phone : m,
			)
			.replace(PHONE_NANP, REDACTED.phone)
			.replace(PO_BOX, REDACTED.address)
			.replace(STREET, REDACTED.address)
	);
}

const SIGN_OFF =
	/^\s*(?:--\s*|thanks|thank you|many thanks|regards|best|best regards|kind regards|warm regards|sincerely|cheers)[,.!]?\s*$/im;
const HEADER_LINE = /^(\s*>?\s*(?:from|to|cc|reply-to|sent by)\s*:).*$/gim;

/**
 * The part of a body a model may see: everything before the sign-off (a
 * signature is names and contact details), forwarded From/To/Cc lines
 * blanked, the rest redacted, cut to `max` characters.
 */
export function bodyExcerpt(text: string, max = 600): string {
	const signOff = SIGN_OFF.exec(text);
	const body = signOff ? text.slice(0, signOff.index) : text;
	return redact(body.replace(HEADER_LINE, "$1 [contact]")).trim().slice(0, max);
}

/** `redact` for optional values. */
export function redactMaybe(text: string | null | undefined): string | null {
	return text == null ? null : redact(text);
}

/** "Billing <ap@ridgelinefreight.com>" → "ridgelinefreight.com"; no address → null. */
export function emailDomain(address: string | null | undefined): string | null {
	const at = address?.lastIndexOf("@") ?? -1;
	if (!address || at < 0) return null;
	const domain = address
		.slice(at + 1)
		.replace(/[>\s].*$/, "")
		.toLowerCase();
	return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) ? domain : null;
}
