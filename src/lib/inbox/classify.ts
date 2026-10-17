/**
 * Cheap, explainable classification of an inbound attachment: filename and
 * subject keywords, who sent it, and whether a known vendor is mentioned.
 * Only a `low` confidence result goes on to the small model call.
 *
 * Pure: the caller passes the vendor list and the business's own domains.
 */
import { z } from "zod";
import type { UploadType } from "#/lib/import/extraction.ts";
import { normalizeVendor, resolveVendor } from "#/lib/rules/aliases.ts";
import { emailDomain } from "./redact.ts";
import { INBOX_KINDS, type InboxKind } from "./types.ts";

/** Images this small that sit inline are logos and signature icons. */
export const INLINE_IMAGE_MAX_BYTES = 20 * 1024;

export interface ClassifyInput {
	filename: string;
	detectedType: UploadType | null;
	inline: boolean;
	size: number;
	subject: string;
	/** Body text (only the first part is looked at). */
	text: string;
	senderAddress: string | null;
	senderName: string | null;
	/** The business's own sending domains (e.g. "atlas-logistics.example"). */
	ownDomains: readonly string[];
	/** Our legal name, e.g. "Atlas Logistics Group, Inc.". */
	businessName: string;
	/** Canonical vendor names from the price list. */
	vendors: readonly string[];
}

export interface Classification {
	kind: InboxKind;
	/** `low` means the rules could only guess: ask the model. */
	confidence: "high" | "low";
	/** Plain-language reasons, shown on /inbox and in PRISM. */
	reasons: string[];
	/** The known vendor the message seems to come from. */
	vendor: string | null;
}

/** "Invoice_VF-1003.final.pdf" → "invoice vf 1003 final pdf" (keywords need word edges). */
const words = (s: string) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();

const INVOICE_WORDS =
	/\b(invoices?|inv \d+|inv no|bill|billing|amount due|past due|balance due)\b/;
const CONTRACT_WORDS =
	/\b(contracts?|agreements?|tenders?|bid award|award letter|renewal|addendum|amendment|rfp|terms and conditions|price agreement)\b/;

/** Our own document numbers (src/lib/documents/numbering.ts): INV-0001, INV-A-0001, INV/26-27/0001. */
const OWN_NUMBER =
	/\b(?:INV|QUO|PRO|CN|RCT|DN)(?:-[A-Z0-9]{1,6})?(?:-|\/\d{2}-\d{2}\/)\d{4,}\b/;

/** Distinctive words of our name ("atlas"), to spot our own documents. */
function nameTokens(businessName: string): string[] {
	// Words many company names share, so they don't mark a document as ours.
	const generic = new Set([
		"company",
		"corporation",
		"group",
		"holdings",
		"international",
		"global",
		"logistics",
		"freight",
		"transport",
		"services",
		"service",
		"solutions",
		"limited",
	]);
	return words(businessName)
		.split(" ")
		.filter((t) => t.length > 3 && !generic.has(t));
}

/**
 * The vendor a message comes from: the sender's display name, the sender's
 * domain ("ridgelinefreight.com" ↔ "Ridgeline Freight"), or a vendor named in the
 * subject or the first lines of the body (forwarded mail).
 */
export function matchVendor(
	input: Pick<
		ClassifyInput,
		"senderAddress" | "senderName" | "subject" | "text" | "vendors"
	>,
): { vendor: string; via: string } | null {
	const { vendors } = input;
	if (input.senderName) {
		const r = resolveVendor(input.senderName, vendors);
		if (r.ok) return { vendor: r.vendor, via: "sender name" };
	}
	const domain = emailDomain(input.senderAddress);
	if (domain) {
		const labels = domain.split(".").slice(0, -1);
		for (const v of vendors) {
			const compact = normalizeVendor(v).replace(/ /g, "");
			if (
				compact.length >= 4 &&
				labels.some(
					(l) =>
						l.replace(/-/g, "").startsWith(compact) ||
						(l.length >= 6 && compact.startsWith(l.replace(/-/g, ""))),
				)
			) {
				return { vendor: v, via: "sender domain" };
			}
		}
	}
	const haystack = ` ${normalizeVendor(`${input.subject} ${input.text.slice(0, 2000)}`)} `;
	const named = vendors.filter((v) => {
		const n = normalizeVendor(v);
		return n.length > 0 && haystack.includes(` ${n} `);
	});
	if (named.length === 1) {
		return { vendor: named[0] as string, via: "named in the message" };
	}
	return null;
}

export function classifyAttachment(input: ClassifyInput): Classification {
	if (!input.detectedType) {
		return {
			kind: "ignore",
			confidence: "high",
			reasons: ["Not a PDF, PNG, JPEG or WebP file"],
			vendor: null,
		};
	}
	if (
		input.inline &&
		input.detectedType !== "application/pdf" &&
		input.size <= INLINE_IMAGE_MAX_BYTES
	) {
		return {
			kind: "ignore",
			confidence: "high",
			reasons: ["Small inline image (a logo or signature)"],
			vendor: null,
		};
	}

	const file = words(input.filename);
	const subject = words(input.subject);
	const both = `${file} ${subject}`;
	const invoiceWord = INVOICE_WORDS.test(both);
	const contractWord = CONTRACT_WORDS.test(both);
	const domain = emailDomain(input.senderAddress);
	const ownSender =
		!!domain &&
		input.ownDomains.some(
			(d) =>
				domain === d.toLowerCase() || domain.endsWith(`.${d.toLowerCase()}`),
		);
	const ownNumber = OWN_NUMBER.test(`${input.filename} ${input.subject}`);
	const tokens = nameTokens(input.businessName);
	const namesUs =
		tokens.length > 0 && tokens.some((t) => ` ${subject} `.includes(` ${t} `));
	const match = matchVendor(input);
	const vendor = match?.vendor ?? null;

	const reasons: string[] = [];
	if (invoiceWord) reasons.push("Invoice wording in the filename or subject");
	if (contractWord) reasons.push("Contract wording in the filename or subject");
	if (ownSender) reasons.push("Sent from our own domain");
	if (ownNumber) reasons.push("Carries one of our document numbers");
	if (match) reasons.push(`Known vendor ${match.vendor} (${match.via})`);

	const result = (
		kind: InboxKind,
		confidence: Classification["confidence"],
	): Classification => ({ kind, confidence, reasons, vendor });

	if (ownSender) {
		return contractWord && !invoiceWord
			? result("contract", "low")
			: result("invoice_out", invoiceWord || ownNumber ? "high" : "low");
	}
	if (ownNumber && namesUs && !match) return result("invoice_out", "high");
	if (contractWord && !invoiceWord) return result("contract", "high");
	if (invoiceWord && !contractWord) {
		return result("invoice_in", ownNumber && !match ? "low" : "high");
	}
	if (invoiceWord && contractWord) {
		return result(match ? "invoice_in" : "contract", "low");
	}
	if (match) {
		reasons.push("No invoice or contract wording");
		return result("invoice_in", "low");
	}
	reasons.push("No invoice or contract wording, unknown sender");
	return result("ignore", "low");
}

// ── Model fallback ───────────────────────────────────────────────────

/** What the classification prompt asks the model to return. */
export const ModelClassification = z.object({
	kind: z.enum(INBOX_KINDS),
	reason: z.string().trim().min(1).max(300),
});
export type ModelClassification = z.infer<typeof ModelClassification>;

/** Parse the model's JSON reply (tolerates a ```json fence). */
export function parseClassificationReply(
	content: string,
): { ok: true; value: ModelClassification } | { ok: false; error: string } {
	const body = content
		.trim()
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/\s*```$/, "");
	let json: unknown;
	try {
		json = JSON.parse(body);
	} catch {
		return { ok: false, error: "The model did not return JSON" };
	}
	const parsed = ModelClassification.safeParse(json);
	return parsed.success
		? { ok: true, value: parsed.data }
		: { ok: false, error: "The model's answer did not match the schema" };
}
