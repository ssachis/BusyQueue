/** Document-import server functions (callable from /import-document). */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { DocImportForm } from "#/lib/doc-import/form.ts";
import { createDraftFromImport } from "./service.ts";

export const createImportedDraft = createServerFn({ method: "POST" })
	.validator((input: unknown) =>
		z.object({ importId: z.uuid(), form: DocImportForm }).parse(input),
	)
	.handler(({ data }) => createDraftFromImport(data));
