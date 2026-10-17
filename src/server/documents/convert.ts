/**
 * Conversion server functions (#18), callable from the client: convert an
 * issued document to a new draft, and read a document's links and activity
 * history. The D1 work lives in convert-store.ts.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { DOCUMENT_TYPES } from "#/lib/documents/types.ts";
import {
	convertToDraft,
	loadDocumentLinks,
	loadHistory,
} from "./convert-store.ts";

const DocumentId = z.string().min(1).max(100);

const ConvertInput = z.object({
	documentId: DocumentId,
	toType: z.enum(DOCUMENT_TYPES),
	/** The viewer's local date for the new draft; defaults to the server's UTC date. */
	today: z.iso.date().optional(),
});
export type ConvertInput = z.input<typeof ConvertInput>;

const DocumentInput = z.object({ documentId: DocumentId });

/**
 * Create a new draft of `toType` from an issued document (quote → invoice,
 * invoice → credit note, …). Returns the new draft's id.
 */
export const convertDocument = createServerFn({ method: "POST" })
	.validator((input: unknown) => ConvertInput.parse(input))
	.handler(({ data }) =>
		convertToDraft(data.documentId, data.toType, data.today),
	);

/** Documents this one was made from, and documents made from it. */
export const getDocumentLinks = createServerFn({ method: "GET" })
	.validator((input: unknown) => DocumentInput.parse(input))
	.handler(({ data }) => loadDocumentLinks(data.documentId));

/** The document's activity log, oldest first, with linked documents resolved. */
export const getDocumentHistory = createServerFn({ method: "GET" })
	.validator((input: unknown) => DocumentInput.parse(input))
	.handler(({ data }) => loadHistory(data.documentId));
