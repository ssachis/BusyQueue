import { createFileRoute } from "@tanstack/react-router";
import { CatalogForm } from "#/components/catalog/catalog-form.tsx";
import { getCatalogForm } from "#/server/catalog.ts";

/** `/catalog/new` adds an item; `/catalog/<id>` edits one. */
export const Route = createFileRoute("/catalog/$id")({
	loader: ({ params }) =>
		getCatalogForm({ data: { id: params.id === "new" ? null : params.id } }),
	component: CatalogItemPage,
});

function CatalogItemPage() {
	const ctx = Route.useLoaderData();
	// Keyed so the form resets when moving between items.
	return <CatalogForm key={ctx.item?.id ?? "new"} ctx={ctx} />;
}
