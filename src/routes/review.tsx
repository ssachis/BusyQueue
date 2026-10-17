import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import {
	defaultSelection,
	REVIEW_STATUSES,
	SORT_KEYS,
} from "#/components/review/order.ts";
import { ReviewPage } from "#/components/review/review-page.tsx";
import { REVIEW_VERSION } from "#/components/review/version.ts";
import { getInvoiceDetail, getReviewSummary } from "#/server/review.ts";

const Search = z.object({
	invoice: z.string().min(1).optional().catch(undefined),
	sort: z.enum(SORT_KEYS).optional().catch(undefined),
	status: z.enum(REVIEW_STATUSES).optional().catch(undefined),
	vendor: z.string().min(1).optional().catch(undefined),
	q: z.string().optional().catch(undefined),
	/** Old links carried an agent version; a redirect drops it. */
	v: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/review")({
	validateSearch: (search) => Search.parse(search),
	beforeLoad: ({ search }) => {
		if (search.v !== undefined) {
			throw redirect({
				to: "/review",
				search: { ...search, v: undefined },
				replace: true,
			});
		}
	},
	// Sorting and filtering happen on the page; only the open bill reloads.
	loaderDeps: ({ search }) => ({ invoice: search.invoice }),
	loader: async ({ deps }) => {
		const version = REVIEW_VERSION;
		const summary = await getReviewSummary({ data: { version } });
		const invoiceId = deps.invoice ?? defaultSelection(summary.invoices);
		const detail = invoiceId
			? await getInvoiceDetail({ data: { invoiceId, version } })
			: null;
		return { summary, detail, invoiceId };
	},
	head: () => ({ meta: [{ title: "Review bills · BusyQ" }] }),
	component: ReviewPage,
});
