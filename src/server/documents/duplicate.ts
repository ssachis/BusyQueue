/** Duplicate server function (#18): a copy is always an unnumbered draft. */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { duplicateDocument } from "./convert-store.ts";

export const duplicateDocumentAsDraft = createServerFn({ method: "POST" })
	.validator((input: unknown) =>
		z
			.object({ documentId: z.string().min(1).max(100), date: z.iso.date() })
			.parse(input),
	)
	.handler(({ data }) => duplicateDocument(data));
