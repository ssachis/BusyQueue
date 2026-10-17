import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus, Users } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { PageBody, PageHeader } from "#/components/app-shell.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { rankMatches } from "#/lib/typeahead.ts";
import { getClients } from "#/server/clients.ts";

const Search = z.object({
	archived: z.boolean().optional().catch(undefined),
});

export const Route = createFileRoute("/clients/")({
	validateSearch: (search) => Search.parse(search),
	loaderDeps: ({ search }) => search,
	loader: ({ deps }) =>
		getClients({ data: { includeArchived: deps.archived } }),
	component: ClientList,
});

function ClientList() {
	const rows = Route.useLoaderData();
	const { archived } = Route.useSearch();
	const [query, setQuery] = useState("");
	const shown = rankMatches(
		query,
		rows,
		[(c) => c.name, (c) => c.taxId, (c) => c.email, (c) => c.city],
		200,
	);

	return (
		<>
			<PageHeader title="Clients">
				<Button asChild>
					<Link to="/clients/new">
						<Plus />
						New client
					</Link>
				</Button>
			</PageHeader>
			<PageBody className="space-y-5">
				<div className="flex flex-wrap items-center gap-3">
					<Input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search clients"
						aria-label="Search clients"
						className="max-w-xs"
					/>
					<Button asChild variant={archived ? "default" : "outline"} size="sm">
						<Link
							to="/clients"
							search={{ archived: archived ? undefined : true }}
						>
							Show archived
						</Link>
					</Button>
				</div>

				{shown.length === 0 ? (
					<div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
						<Users className="size-8 text-muted-foreground" />
						<p className="font-medium">
							{query ? "No clients match" : "No clients yet"}
						</p>
					</div>
				) : (
					<div className="overflow-x-auto rounded-xl border bg-card">
						<table className="w-full min-w-[560px] text-sm">
							<thead>
								<tr className="border-b text-left text-xs tracking-wide text-muted-foreground uppercase">
									<th className="px-4 py-3 font-medium">Name</th>
									<th className="px-4 py-3 font-medium">City</th>
									<th className="px-4 py-3 font-medium">Tax ID</th>
									<th className="px-4 py-3 text-right font-medium">
										Documents
									</th>
								</tr>
							</thead>
							<tbody>
								{shown.map((c) => (
									<tr
										key={c.id}
										className="relative border-b transition-colors last:border-0 hover:bg-muted/50"
									>
										<td className="px-4 py-3">
											<Link
												to="/clients/$id"
												params={{ id: c.id }}
												className="font-medium outline-none after:absolute after:inset-0 focus-visible:underline"
											>
												{c.name}
											</Link>
											{c.archivedAt ? (
												<Badge variant="outline" className="ml-2">
													Archived
												</Badge>
											) : null}
										</td>
										<td className="px-4 py-3">{c.city ?? "—"}</td>
										<td className="px-4 py-3">{c.taxId ?? "—"}</td>
										<td className="px-4 py-3 text-right tabular-nums">
											{c.documentCount}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</PageBody>
		</>
	);
}
