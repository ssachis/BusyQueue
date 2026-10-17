/** Shapes the import endpoints return; shared by the server and the /import page. */
import type { Finding } from "#/lib/busyq/types.ts";
import type { ImportDraft } from "./extraction.ts";

/** `POST /api/imports` success body. */
export interface ImportResponse {
	importId: string;
	filename: string;
	contentType: string;
	draft: ImportDraft;
	uncertain: string[];
	issues: Record<string, string>;
	notes: string | null;
	requestedModel: string;
	/** The model that actually answered (Nicrron may have fallen back). */
	model: string;
	fallbackUsed: boolean;
	prismTraceId: string;
	/** Invoices already stored under the same invoice number. */
	existing: { id: string; vendor: string }[];
}

/** `POST /api/imports` error body. */
export interface ImportErrorResponse {
	error: string;
	importId?: string;
	prismTraceId?: string;
}

/** An earlier import reopened on /import?id=… (e.g. from the inbox). */
export interface StoredImport {
	importId: string;
	status: "uploaded" | "extracted" | "failed" | "saved";
	/** The review state; null until the document has been read. */
	result: ImportResponse | null;
	error: string | null;
	saved: SavedImport | null;
	/** Same-origin URL of the stored document, for the preview. */
	fileUrl: string;
}

export interface SavedImport {
	invoiceId: string;
	corrected: string[];
	prismTraceId: string;
}

export interface ImportRunSummary {
	runId: string;
	invoiceId: string;
	version: "v1" | "v2";
	status: "completed" | "failed";
	error: string | null;
	findings: Finding[];
	totalMinor: number;
	currency: string;
	toolCalls: number;
	failedTools: { name: string; code: string | null }[];
	prismTraceId: string;
}
