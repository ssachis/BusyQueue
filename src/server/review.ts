/** Review page server functions (callable from the client). */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { AgentVersion } from "#/lib/busyq/types.ts";
import { executeRun } from "./agent/execute.ts";
import {
	approveDraft,
	loadInvoiceDetail,
	loadReviewSummary,
	updateDraft,
} from "./review-store.ts";

const VersionInput = z.object({ version: AgentVersion });
const DetailInput = z.object({
	invoiceId: z.string().min(1),
	version: AgentVersion,
});

export const getReviewSummary = createServerFn({ method: "GET" })
	.validator((input: unknown) => VersionInput.parse(input))
	.handler(({ data }) => loadReviewSummary(data.version));

export const getInvoiceDetail = createServerFn({ method: "GET" })
	.validator((input: unknown) => DetailInput.parse(input))
	.handler(({ data }) => loadInvoiceDetail(data.invoiceId, data.version));

/** Run the agent from the page: same code, tracing and storage as POST /api/runs. */
export const runAgentOn = createServerFn({ method: "POST" })
	.validator((input: unknown) => DetailInput.parse(input))
	.handler(async ({ data }) => {
		const run = await executeRun(data);
		if (!run.ok) throw new Error(run.error);
		return {
			status: run.result.status,
			error: run.result.error?.message ?? null,
		};
	});

export const saveDraft = createServerFn({ method: "POST" })
	.validator((input: unknown) =>
		z
			.object({
				draftId: z.string().min(1),
				subject: z.string().trim().min(1).max(200),
				body: z.string().trim().min(1).max(5000),
			})
			.parse(input),
	)
	.handler(({ data }) => updateDraft(data));

export const approve = createServerFn({ method: "POST" })
	.validator((input: unknown) =>
		z
			.object({
				draftId: z.string().min(1),
				approvedBy: z.string().trim().min(1, "Who is approving?").max(100),
			})
			.parse(input),
	)
	.handler(({ data }) => approveDraft(data));
