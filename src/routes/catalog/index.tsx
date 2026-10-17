import { createFileRoute, Link } from "@tanstack/react-router";
import { Package, Plus } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { PageBody, PageHeader } from "#/components/app-shell.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { rankMatches } from "#/lib/typeahead.ts";
import { getCatalogItems } from "#/server/catalog.ts";

const Search = z.object({
	archived: z.boolean().optional().catch(undefined),
});

export const Route = createFileRoute("/catalog/")({
	validateSearch: (search) => Search.parse(search),
	loaderDeps: ({ search }) => search,
	loader: ({ deps }) =>
		getCatalogItems({ data: { includeArchived: deps.archived } }),
	component: CatalogList,
});

function CatalogList() {
	const rows = Route.useLoaderData();
	const { archived } = Route.useSearch();
	const [query, setQuery] = useState("");
	const shown = rankMatches(query, rows, [(i) => i.name, (i) => i.code], 200);

	return (
		<>
			<PageHeader title="Items">
				<Button asChild>
					<Link to="/catalog/new">
						<Plus />
						New item
					</Link>
				</Button>
			</PageHeader>
			<PageBody className="space-y-5">
				<div className="flex flex-wrap items-center gap-3">
					<Input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search by name or code"
						aria-label="Search items"
						className="max-w-xs"
					/>
					<Button asChild variant={archived ? "default" : "outline"} size="sm">
						<Link to="/catalog" search={{ archived: archived ? undefined : true }}>
							Show archived
						</Link>
					</Button>
				</div>

				{shown.length === 0 ? (
					<div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
						<Package className="size-8 text-muted-foreground" />
						<p className="font-medium">
							{query ? "No items match" : "No items yet"}
						</p>
					</div>
				) : (
					<div className="overflow-x-auto rounded-xl border bg-card">
						<table className="w-full min-w-[560px] text-sm">
							<thead>
								<tr className="border-b text-left text-xs tracking-wide text-muted-foreground uppercase">
									<th className="px-4 py-3 font-medium">Name</th>
									<th className="px-4 py-3 font-medium">Code</th>
									<th className="px-4 py-3 font-medium">Unit</th>
									<th className="px-4 py-3 text-right font-medium">Price</th>
								</tr>
							</thead>
							<tbody>
								{shown.map((i) => (
									<tr
										key={i.id}
										className="relative border-b transition-colors last:border-0 hover:bg-muted/50"
									>
										<td className="px-4 py-3">
											<Link
												to="/catalog/$id"
												params={{ id: i.id }}
												className="font-medium outline-none after:absolute after:inset-0 focus-visible:underline"
											>
												{i.name}
											</Link>
											{i.archivedAt ? (
												<Badge variant="outline" className="ml-2">
													Archived
												</Badge>
											) : null}
										</td>
										<td className="px-4 py-3">{i.code ?? "—"}</td>
										<td className="px-4 py-3">{i.unit ?? "—"}</td>
										<td className="px-4 py-3 text-right tabular-nums">
											{i.unitPrice}
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
