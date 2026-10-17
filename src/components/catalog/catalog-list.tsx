import { Link, useRouter } from "@tanstack/react-router";
import { Package, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageBody, PageHeader } from "#/components/app-shell.tsx";
import { ListToolbar } from "#/components/clients/list-toolbar.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardContent } from "#/components/ui/card.tsx";
import { type ArchiveFilter, formatUnitPrice } from "#/lib/clients/index.ts";
import { addSampleCatalog } from "#/server/catalog.ts";
import type { CatalogListRow } from "#/server/catalog-store.ts";

export function CatalogList({
	items,
	query,
	archived,
	onFilterChange,
}: {
	items: CatalogListRow[];
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
			const { added } = await addSampleCatalog();
			await router.invalidate();
			toast.success(
				added
					? `Added ${added} sample items`
					: "No samples added (already loaded, or not for this country)",
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
				title="Catalog"
				description="What you sell, with a default price, unit and tax code. Picking an item adds a line; the line keeps its own copy of the price."
			>
				<Button asChild>
					<Link to="/catalog/$id" params={{ id: "new" }}>
						<Plus />
						New item
					</Link>
				</Button>
			</PageHeader>
			<PageBody>
				<ListToolbar
					query={query}
					archived={archived}
					placeholder="Search by name or code"
					onChange={onFilterChange}
				/>
				{items.length === 0 ? (
					<Card>
						<CardContent className="flex flex-col items-center gap-3 py-10 text-center">
							<Package className="size-8 text-muted-foreground" />
							<p className="max-w-md text-sm text-muted-foreground">
								{filtered
									? "No items match."
									: "No items yet. Add meals, catering and services you bill for, or load a few samples."}
							</p>
							{filtered ? null : (
								<Button
									variant="outline"
									disabled={loading}
									onClick={loadSamples}
								>
									{loading ? "Adding…" : "Load sample items"}
								</Button>
							)}
						</CardContent>
					</Card>
				) : (
					<div className="overflow-x-auto rounded-md border">
						<table className="w-full text-sm">
							<thead className="bg-muted/40 text-left text-muted-foreground">
								<tr>
									<th className="px-3 py-2 font-medium">Item</th>
									<th className="px-3 py-2 font-medium">Code</th>
									<th className="px-3 py-2 text-right font-medium">
										Unit price
									</th>
									<th className="px-3 py-2 font-medium">Tax</th>
								</tr>
							</thead>
							<tbody className="divide-y">
								{items.map((i) => (
									<tr key={i.id} className="hover:bg-muted/30">
										<td className="px-3 py-2">
											<div className="flex items-center gap-2">
												<Link
													to="/catalog/$id"
													params={{ id: i.id }}
													className="font-medium hover:underline"
												>
													{i.name}
												</Link>
												{i.archivedAt ? (
													<Badge variant="warning">Archived</Badge>
												) : null}
											</div>
											{i.description ? (
												<div className="max-w-md truncate text-xs text-muted-foreground">
													{i.description}
												</div>
											) : null}
										</td>
										<td className="px-3 py-2 font-mono text-xs">
											{i.code ?? "—"}
										</td>
										<td className="px-3 py-2 text-right tabular-nums">
											{formatUnitPrice(i.unitPrice, i.currency)}
											{i.unit ? (
												<span className="text-muted-foreground">
													{" "}
													/ {i.unit}
												</span>
											) : null}
										</td>
										<td className="px-3 py-2 text-muted-foreground">
											{i.taxCode}
											{i.rate ? ` ${i.rate}%` : ""}
											{i.hsnSac ? ` · HSN/SAC ${i.hsnSac}` : ""}
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
