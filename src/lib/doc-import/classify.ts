/**
 * Which of the six document types a paper document is. The printed heading
 * ("QUOTATION", "Tax Invoice", "Packing slip") decides; the model's own
 * reading is the fallback. A disagreement, or no recognisable heading, is a
 * flag for a person, never a silent pick. Pure.
 */
import { DOCUMENT_TYPES, type DocumentType } from "#/lib/documents/types.ts";

/** Most specific first: "Proforma invoice" and "Credit note for invoice 12" aren't invoices. */
const HEADINGS: [RegExp, DocumentType][] = [
	[/\bcredit\s*(note|memo)\b|\badjustment\s*note\b/i, "credit_note"],
	[/\bpro[\s-]?forma\b/i, "proforma"],
	[
		/\b(delivery\s*(note|challan|docket|receipt|slip)|packing\s*(slip|list)|dispatch\s*note|goods\s*received)\b/i,
		"delivery_note",
	],
	[/\b(quot(e|ation)|estimate|bid|proposal)\b/i, "quote"],
	[/\b(receipt|payment\s*received|paid\s*in\s*full)\b/i, "receipt"],
	[/\b(invoice|bill)\b/i, "invoice"],
];

/** A heading or a model label as one of the six types, or null if it's none of them. */
export function typeFromText(
	text: string | null | undefined,
): DocumentType | null {
	const t = text?.trim();
	if (!t) return null;
	const snake = t.toLowerCase().replace(/[\s-]+/g, "_");
	if ((DOCUMENT_TYPES as readonly string[]).includes(snake)) {
		return snake as DocumentType;
	}
	for (const [pattern, type] of HEADINGS) {
		if (pattern.test(t)) return type;
	}
	return null;
}

export interface Classification {
	type: DocumentType;
	/** True when a person should confirm the type. */
	doubtful: boolean;
	/** Why it's doubtful, for the review screen. */
	reason?: string;
}

export function classifyDocumentType(input: {
	/** Heading as printed, e.g. "QUOTE". */
	title?: string | null;
	/** The model's reading, e.g. "quote" or "other". */
	documentType?: string | null;
}): Classification {
	const fromTitle = typeFromText(input.title);
	const fromModel = typeFromText(input.documentType);
	if (fromTitle) {
		return fromModel && fromModel !== fromTitle
			? {
					type: fromTitle,
					doubtful: true,
					reason: `Heading "${input.title?.trim()}" reads as ${label(fromTitle)}, the model said ${label(fromModel)}`,
				}
			: { type: fromTitle, doubtful: false };
	}
	if (fromModel) {
		return {
			type: fromModel,
			doubtful: true,
			reason: input.title?.trim()
				? `Heading "${input.title.trim()}" isn't a known document type`
				: "No heading printed; type inferred from the content",
		};
	}
	return {
		type: "invoice",
		doubtful: true,
		reason: "Couldn't tell the document type; defaulted to invoice",
	};
}

const LABELS: Record<DocumentType, string> = {
	invoice: "Invoice",
	quote: "Quote",
	proforma: "Proforma invoice",
	credit_note: "Credit note",
	receipt: "Receipt",
	delivery_note: "Delivery note",
};

export function label(type: DocumentType): string {
	return LABELS[type];
}
