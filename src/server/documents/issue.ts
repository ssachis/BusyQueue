/** Issuing server functions (callable from the client). */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { issueDraft, loadIssueState } from "./issue-store.ts";

const DocumentInput = z.object({ documentId: z.string().min(1).max(100) });

/** Assign the next number, snapshot seller and totals, and lock the draft. */
export const issueDocument = createServerFn({ method: "POST" })
	.validator((input: unknown) => DocumentInput.parse(input))
	.handler(({ data }) => issueDraft(data.documentId));

/** Number and lifecycle of a document, for the Issue button. */
export const getIssueState = createServerFn({ method: "GET" })
	.validator((input: unknown) => DocumentInput.parse(input))
	.handler(({ data }) => loadIssueState(data.documentId));
