/**
 * Conversion and history server functions (#18), callable from the client.
 * The D1 work lives in convert-store.ts so the client bundle never imports it.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { DOCUMENT_TYPES } from "#/lib/documents/types.ts";
import { convertDocument, loadHistory } from "./convert-store.ts";

const Id = z.string().min(1).max(100);

/** Create a draft of another type from an issued document (quote → invoice, …). */
export const convertDocumentTo = createServerFn({ method: "POST" })
	.validator((input: unknown) =>
		z
			.object({
				documentId: Id,
				to: z.enum(DOCUMENT_TYPES),
				date: z.iso.date(),
			})
			.parse(input),
	)
	.handler(({ data }) => convertDocument(data));

/** Linked documents and the activity log. */
export const getDocumentHistory = createServerFn({ method: "GET" })
	.validator((input: unknown) => z.object({ documentId: Id }).parse(input))
	.handler(({ data }) => loadHistory(data.documentId));
