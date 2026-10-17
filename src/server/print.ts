/** Print page server function (#19), callable from the route loader. */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { loadPrintModel } from "./print-store.ts";

const PrintInput = z.object({
	documentId: z.string().min(1).max(100),
	/** The viewer's local date, for "overdue". Defaults to the server's UTC date. */
	today: z.iso.date().optional(),
});

/** The display-ready print model, or null if the document doesn't exist. */
export const getPrintDocument = createServerFn({ method: "GET" })
	.validator((input: unknown) => PrintInput.parse(input))
	.handler(({ data }) => loadPrintModel(data.documentId, data.today));
