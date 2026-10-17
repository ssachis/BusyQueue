/** Shapes the document-import endpoints return; shared by the server and /import-document. */
import type { DocImportForm, SellerContext } from "./form.ts";

/** A saved client the buyer matched (#14), when that table exists. */
export interface ClientMatch {
	id: string;
	name: string;
}

/** `POST /api/document-imports` success body. */
export interface DocImportResponse {
	importId: string;
	filename: string;
	contentType: string;
	form: DocImportForm;
	uncertain: string[];
	reasons: Record<string, string>;
	issues: Record<string, string>;
	mismatches: Record<string, string>;
	legibility: string | null;
	/** Who issued it: the review screen's tax codes, totals and checks use this. */
	seller: SellerContext;
	client: ClientMatch | null;
	requestedModel: string;
	/** The model that actually answered (Nicrron may have fallen back). */
	model: string;
	fallbackUsed: boolean;
	prismTraceId: string;
}

/** `POST /api/document-imports` error body. */
export interface DocImportErrorResponse {
	error: string;
	importId?: string;
	prismTraceId?: string;
}

export interface CreatedDraft {
	documentId: string;
	/** Fields the person changed from what the model read. */
	corrected: string[];
	prismTraceId: string;
	/** True when this import had already created its draft. */
	existing: boolean;
}
