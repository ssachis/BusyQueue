/** AI import server functions (callable from the /import page). */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AgentVersion } from "#/lib/busyq/types.ts";
import { ImportDraft } from "#/lib/import/extraction.ts";
import { runAgentOnImport, saveImportedInvoice } from "./import/service.ts";

export const saveImport = createServerFn({ method: "POST" })
	.validator((input: unknown) =>
		z.object({ importId: z.uuid(), draft: ImportDraft }).parse(input),
	)
	.handler(({ data }) => saveImportedInvoice(data));

export const runImportAgent = createServerFn({ method: "POST" })
	.validator((input: unknown) =>
		z
			.object({ invoiceId: z.string().min(1).max(100), version: AgentVersion })
			.parse(input),
	)
	.handler(({ data }) => runAgentOnImport(data));
