/**
 * Moving between related documents (#18). Pure: which conversions exist and
 * what a converted or duplicated draft carries over. The server applies the
 * result; nothing here touches the database.
 *
 * Conversions copy the lines and the client and leave the new document an
 * unnumbered draft. Money is never recomputed here: lines keep their decimal
 * strings and the tax engine prices the draft when it is issued.
 */
import type {
	DocumentDraft,
	DocumentStatus,
	DocumentType,
	DraftLine,
} from "./types.ts";

/** How a linked document relates to this one. */
export const LINK_RELATIONS = ["converted_to", "converted_from"] as const;
export type LinkRelation = (typeof LINK_RELATIONS)[number];

/** What each issued document type can become. */
export const CONVERSIONS: Record<DocumentType, readonly DocumentType[]> = {
	quote: ["invoice"],
	invoice: ["receipt", "credit_note", "delivery_note"],
	proforma: [],
	credit_note: [],
	receipt: [],
	delivery_note: [],
};

export function conversionTargets(
	type: DocumentType,
	status: DocumentStatus,
): readonly DocumentType[] {
	return status === "issued" ? CONVERSIONS[type] : [];
}

export function canConvert(
	from: { type: DocumentType; status: DocumentStatus },
	to: DocumentType,
): boolean {
	return conversionTargets(from.type, from.status).includes(to);
}

/** The fields of a document that a new draft can start from. */
export interface SourceDocument {
	type: DocumentType;
	currency: string;
	clientId: string | null;
	buyer: DocumentDraft["buyer"];
	placeOfSupply: string | null;
	notes: string | null;
	terms: string | null;
	lines: DraftLine[];
}

function carryOver(
	source: SourceDocument,
	type: DocumentType,
	date: string,
): DocumentDraft {
	return {
		type,
		date,
		currency: source.currency,
		...(source.clientId ? { clientId: source.clientId } : {}),
		buyer: source.buyer,
		...(source.placeOfSupply ? { placeOfSupply: source.placeOfSupply } : {}),
		...(source.notes ? { notes: source.notes } : {}),
		...(source.terms ? { terms: source.terms } : {}),
		lines: source.lines.map((l, i) => ({ ...l, lineNo: i + 1 })),
	};
}

/** Draft for the converted document. Due date is left for the user to set. */
export function convertedDraft(
	source: SourceDocument,
	to: DocumentType,
	date: string,
): DocumentDraft {
	return carryOver(source, to, date);
}

/** Draft copy of any document, of the same type. */
export function duplicatedDraft(
	source: SourceDocument,
	date: string,
): DocumentDraft {
	return carryOver(source, source.type, date);
}
