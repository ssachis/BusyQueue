import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { PageBody } from "#/components/app-shell.tsx";
import { DraftEditor } from "#/components/documents/editor/draft-editor.tsx";
import { DocumentView } from "#/components/documents/preview/document-view.tsx";
import { getDocumentPage } from "#/server/documents/drafts.ts";

export const Route = createFileRoute("/documents/$id")({
	loader: async ({ params }) => {
		const data = await getDocumentPage({ data: { id: params.id } });
		if (!data) throw notFound();
		return data;
	},
	component: DocumentPage,
	notFoundComponent: DocumentNotFound,
});

function DocumentPage() {
	const data = Route.useLoaderData();
	return data.document.status === "draft" ? (
		<DraftEditor key={data.document.id} data={data} />
	) : (
		<DocumentView data={data} />
	);
}

function DocumentNotFound() {
	return (
		<PageBody className="py-16 text-center">
			<h1 className="text-lg font-semibold">Document not found</h1>
			<p className="mt-2 text-sm text-muted-foreground">
				It may have been a draft that was deleted.
			</p>
			<Link
				to="/documents"
				className="mt-4 inline-block text-sm text-primary underline underline-offset-4"
			>
				All documents
			</Link>
		</PageBody>
	);
}
