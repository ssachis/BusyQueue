import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ReviewPage } from "#/components/review/review-page.tsx";
import { AgentVersion } from "#/lib/busyq/types.ts";
import { getInvoiceDetail, getReviewSummary } from "#/server/review.ts";

const Search = z.object({
	v: AgentVersion.optional().catch(undefined),
	invoice: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/")({
	validateSearch: (search) => Search.parse(search),
	loaderDeps: ({ search }) => search,
	loader: async ({ deps }) => {
		const version = deps.v ?? "v1";
		const summary = await getReviewSummary({ data: { version } });
		const invoiceId =
			deps.invoice ??
			summary.invoices.find((r) => (r.run?.totalMinor ?? 0) > 0)?.id ??
			summary.invoices[0]?.id;
		const detail = invoiceId
			? await getInvoiceDetail({ data: { invoiceId, version } })
			: null;
		return { summary, detail, invoiceId: invoiceId ?? null };
	},
	component: ReviewPage,
});
