/** Duplicate server function (#18), callable from the client. */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { duplicateAsDraft } from "./duplicate-store.ts";

const DuplicateInput = z.object({
	documentId: z.string().min(1).max(100),
	/** The viewer's local date for the new draft; defaults to the server's UTC date. */
	today: z.iso.date().optional(),
});
export type DuplicateInput = z.input<typeof DuplicateInput>;

/** Copy any document (draft, issued or void) as a new draft. Returns its id. */
export const duplicateDocument = createServerFn({ method: "POST" })
	.validator((input: unknown) => DuplicateInput.parse(input))
	.handler(({ data }) => duplicateAsDraft(data.documentId, data.today));
