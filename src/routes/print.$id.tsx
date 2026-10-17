/**
 * Print layouts and save as PDF (#19): /print/<documentId>?layout=…&paper=…
 *
 * A top-level route so it doesn't touch the editor's routes. The page emits
 * its own stylesheet: the four layouts, the `@page` rule for the chosen
 * paper, and print rules that hide the app shell. That stylesheet only
 * exists while this route is mounted, so other pages print as before.
 */
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { PrintDocument } from "#/components/print/print-document.tsx";
import { PRINT_CSS } from "#/components/print/print-styles.ts";
import { PrintToolbar } from "#/components/print/print-toolbar.tsx";
import {
	DEFAULT_LAYOUT,
	DEFAULT_PAPER,
	parsePrintSearch,
} from "#/lib/print/model.ts";
import { pageCss } from "#/lib/print/page-css.ts";
import { getPrintDocument } from "#/server/print.ts";

export const Route = createFileRoute("/print/$id")({
	validateSearch: parsePrintSearch,
	loader: async ({ params }) => {
		const model = await getPrintDocument({ data: { documentId: params.id } });
		if (!model) throw notFound();
		return model;
	},
	// The title is the default file name for "Save as PDF".
	head: ({ loaderData }) => ({
		meta: [{ title: loaderData?.title ?? "Print" }],
	}),
	component: PrintPage,
	notFoundComponent: PrintNotFound,
});

function PrintPage() {
	const model = Route.useLoaderData();
	const search = Route.useSearch();
	const layout = search.layout ?? DEFAULT_LAYOUT;
	const paper = search.paper ?? DEFAULT_PAPER;
	const css = `${PRINT_CSS}\n${pageCss({ paper, footer: model.title })}`;

	return (
		<div className="print-root">
			<style
				// biome-ignore lint/security/noDangerouslySetInnerHtml: static CSS; the only dynamic text is escaped by cssString
				dangerouslySetInnerHTML={{ __html: css }}
			/>
			<PrintToolbar
				documentId={model.id}
				title={model.title}
				layout={layout}
				paper={paper}
			/>
			{model.problem ? (
				<div
					data-print-hidden
					role="status"
					className="mx-4 mt-4 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-foreground md:mx-8"
				>
					<TriangleAlert className="mt-0.5 size-4 shrink-0" />
					{model.problem}
				</div>
			) : null}
			<div className="print-stage">
				<div className="print-paper" data-paper={paper}>
					<PrintDocument model={model} layout={layout} />
				</div>
			</div>
		</div>
	);
}

function PrintNotFound() {
	return (
		<div className="px-4 py-16 text-center">
			<h1 className="text-lg font-semibold">Document not found</h1>
			<p className="mt-2 text-sm text-muted-foreground">
				It may have been deleted, or the link is wrong.
			</p>
			<Link
				to="/"
				className="mt-4 inline-block text-sm text-primary underline underline-offset-4"
			>
				Go home
			</Link>
		</div>
	);
}
