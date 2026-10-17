/** AI import server functions (callable from the /import page). */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AgentVersion } from "#/lib/busyq/types.ts";
import { ImportDraft } from "#/lib/import/extraction.ts";
import {
	loadImport,
	runAgentOnImport,
	saveImportedInvoice,
} from "./import/service.ts";

/** Reopen an earlier import for review (/import?id=…). */
export const getImport = createServerFn({ method: "GET" })
	.validator((input: unknown) => z.object({ importId: z.uuid() }).parse(input))
	.handler(({ data }) => loadImport(data.importId));

export const saveImport = createServerFn({ method: "POST" })
	.validator((input: unknown) =>
		z
			.object({
				importId: z.uuid(),
				draft: ImportDraft,
				/** Save even when the vendor and number are already on file. */
				allowDuplicate: z.boolean().optional(),
			})
			.parse(input),
	)
	.handler(({ data }) => saveImportedInvoice(data));

export const runImportAgent = createServerFn({ method: "POST" })
	.validator((input: unknown) =>
		z
			.object({ invoiceId: z.string().min(1).max(100), version: AgentVersion })
			.parse(input),
	)
	.handler(({ data }) => runAgentOnImport(data));
