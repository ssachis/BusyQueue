import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ClientList } from "#/components/clients/client-list.tsx";
import { ARCHIVE_FILTERS } from "#/lib/clients/index.ts";
import { getClients } from "#/server/clients.ts";

const Search = z.object({
	q: z.string().max(100).optional().catch(undefined),
	archived: z.enum(ARCHIVE_FILTERS).optional().catch(undefined),
});

export const Route = createFileRoute("/clients/")({
	validateSearch: (search) => Search.parse(search),
	loaderDeps: ({ search }) => ({
		query: search.q ?? "",
		archived: search.archived ?? "active",
	}),
	loader: ({ deps }) => getClients({ data: deps }),
	component: ClientsPage,
});

function ClientsPage() {
	const clients = Route.useLoaderData();
	const { q, archived } = Route.useSearch();
	const navigate = Route.useNavigate();
	return (
		<ClientList
			clients={clients}
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
