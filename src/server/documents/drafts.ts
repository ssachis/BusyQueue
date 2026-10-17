/** Document editor server functions (callable from the client). */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
	DOCUMENT_STATUSES,
	DOCUMENT_TYPES,
	DocumentDraft,
} from "#/lib/documents/types.ts";
import {
	createDraft,
	deleteDraft,
	loadDocumentList,
	loadDocumentPage,
	saveDraft,
} from "./drafts-store.ts";

const Id = z.string().min(1).max(100);

export const getDocumentList = createServerFn({ method: "GET" })
	.validator((input: unknown) =>
		z
			.object({
				type: z.enum(DOCUMENT_TYPES).optional(),
				status: z.enum(DOCUMENT_STATUSES).optional(),
				today: z.iso.date().optional(),
			})
			.parse(input ?? {}),
	)
	.handler(({ data }) => loadDocumentList(data));

export const getDocumentPage = createServerFn({ method: "GET" })
	.validator((input: unknown) => z.object({ id: Id }).parse(input))
	.handler(({ data }) => loadDocumentPage(data.id));

export const createDraftDocument = createServerFn({ method: "POST" })
	.validator((input: unknown) =>
		z.object({ type: z.enum(DOCUMENT_TYPES), date: z.iso.date() }).parse(input),
	)
	.handler(({ data }) => createDraft(data));

export const saveDraftDocument = createServerFn({ method: "POST" })
	.validator((input: unknown) =>
		z.object({ id: Id, draft: DocumentDraft }).parse(input),
	)
	.handler(({ data }) => saveDraft(data));

export const deleteDraftDocument = createServerFn({ method: "POST" })
	.validator((input: unknown) => z.object({ id: Id }).parse(input))
	.handler(({ data }) => deleteDraft(data.id));
