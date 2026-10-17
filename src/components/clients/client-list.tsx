import { Link, useRouter } from "@tanstack/react-router";
import { Plus, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageBody, PageHeader } from "#/components/app-shell.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardContent } from "#/components/ui/card.tsx";
import { type ArchiveFilter, shortAddress } from "#/lib/clients/index.ts";
import { addSampleClients } from "#/server/clients.ts";
import type { ClientListRow } from "#/server/clients-store.ts";
import { ListToolbar } from "./list-toolbar.tsx";

export function ClientList({
	clients,
	query,
	archived,
	onFilterChange,
}: {
	clients: ClientListRow[];
	query: string;
	archived: ArchiveFilter;
	onFilterChange: (next: { query: string; archived: ArchiveFilter }) => void;
}) {
	const router = useRouter();
	const [loading, setLoading] = useState(false);
	const filtered = query !== "" || archived !== "active";

	async function loadSamples() {
		setLoading(true);
		try {
			const { added } = await addSampleClients();
			await router.invalidate();
			toast.success(
				added ? `Added ${added} sample clients` : "Samples already loaded",
			);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Could not add samples");
		} finally {
			setLoading(false);
		}
	}

	return (
		<>
			<PageHeader
				title="Clients"
				description="Who you invoice. Picking a client fills the buyer on a document; clients with documents are archived, never deleted."
			>
				<Button asChild>
					<Link to="/clients/$id" params={{ id: "new" }}>
						<Plus />
						New client
					</Link>
				</Button>
			</PageHeader>
			<PageBody>
				<ListToolbar
					query={query}
					archived={archived}
					placeholder="Search by name, email or tax ID"
					onChange={onFilterChange}
				/>
				{clients.length === 0 ? (
					<Card>
						<CardContent className="flex flex-col items-center gap-3 py-10 text-center">
							<Users className="size-8 text-muted-foreground" />
							<p className="max-w-md text-sm text-muted-foreground">
								{filtered
									? "No clients match."
									: "No clients yet. Add the people and organisations you invoice, or load a few samples for Northfield."}
							</p>
							{filtered ? null : (
								<Button
									variant="outline"
									disabled={loading}
									onClick={loadSamples}
								>
									{loading ? "Adding…" : "Load sample clients"}
								</Button>
							)}
						</CardContent>
					</Card>
				) : (
					<div className="overflow-x-auto rounded-md border">
						<table className="w-full text-sm">
							<thead className="bg-muted/40 text-left text-muted-foreground">
								<tr>
									<th className="px-3 py-2 font-medium">Client</th>
									<th className="px-3 py-2 font-medium">Location</th>
									<th className="px-3 py-2 font-medium">Tax ID</th>
									<th className="px-3 py-2 font-medium">Currency</th>
									<th className="px-3 py-2 text-right font-medium">
										Documents
									</th>
								</tr>
							</thead>
							<tbody className="divide-y">
								{clients.map((c) => (
									<tr key={c.id} className="hover:bg-muted/30">
										<td className="px-3 py-2">
											<div className="flex items-center gap-2">
												<Link
													to="/clients/$id"
													params={{ id: c.id }}
													className="font-medium hover:underline"
												>
													{c.name}
												</Link>
												{c.archivedAt ? (
													<Badge variant="warning">Archived</Badge>
												) : null}
											</div>
											{c.email ? (
												<div className="text-xs text-muted-foreground">
													{c.email}
												</div>
											) : null}
										</td>
										<td className="px-3 py-2 text-muted-foreground">
											{shortAddress(c)}
										</td>
										<td className="px-3 py-2 font-mono text-xs">
											{c.taxId ?? "—"}
										</td>
										<td className="px-3 py-2">{c.currency ?? "—"}</td>
										<td className="px-3 py-2 text-right tabular-nums">
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
