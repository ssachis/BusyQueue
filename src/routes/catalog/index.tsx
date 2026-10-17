import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { CatalogList } from "#/components/catalog/catalog-list.tsx";
import { ARCHIVE_FILTERS } from "#/lib/clients/index.ts";
import { getCatalogItems } from "#/server/catalog.ts";

const Search = z.object({
	q: z.string().max(100).optional().catch(undefined),
	archived: z.enum(ARCHIVE_FILTERS).optional().catch(undefined),
});

export const Route = createFileRoute("/catalog/")({
	validateSearch: (search) => Search.parse(search),
	loaderDeps: ({ search }) => ({
		query: search.q ?? "",
		archived: search.archived ?? "active",
	}),
	loader: ({ deps }) => getCatalogItems({ data: deps }),
	component: CatalogPage,
});

function CatalogPage() {
	const items = Route.useLoaderData();
	const { q, archived } = Route.useSearch();
	const navigate = Route.useNavigate();
	return (
		<CatalogList
			items={items}
			query={q ?? ""}
			archived={archived ?? "active"}
			onFilterChange={(next) =>
				navigate({
					search: {
						q: next.query || undefined,
						archived: next.archived === "active" ? undefined : next.archived,
					},
					replace: true,
				})
			}
		/>
	);
}
