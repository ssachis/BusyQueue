import { Link } from "@tanstack/react-router";
import { Plus, ScrollText } from "lucide-react";
import { PageBody, PageHeader } from "#/components/app-shell.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardContent } from "#/components/ui/card.tsx";
import type { ContractListRow } from "#/server/contracts-store.ts";
import { formatTerm } from "./format.ts";

export function ContractList({ contracts }: { contracts: ContractListRow[] }) {
	return (
		<>
			<PageHeader
				title="Contracts"
				description="Bid awards and price agreements. Confirming a contract makes its agreed prices the price list BusyQ audits invoices against."
			>
				<Button asChild>
					<Link to="/contracts/new">
						<Plus />
						Add contract
					</Link>
				</Button>
			</PageHeader>
			<PageBody>
				{contracts.length === 0 ? (
					<Card>
						<CardContent className="flex flex-col items-center gap-3 py-10 text-center">
							<ScrollText className="size-8 text-muted-foreground" />
							<p className="max-w-md text-sm text-muted-foreground">
								No contracts yet. Paste a vendor's bid award or price agreement
								and BusyQ will read the agreed prices for you to confirm.
							</p>
							<Button asChild variant="outline">
								<Link to="/contracts/new">Add the first contract</Link>
							</Button>
						</CardContent>
					</Card>
				) : (
					<div className="overflow-x-auto rounded-md border">
						<table className="w-full text-sm">
							<thead className="bg-muted/40 text-left text-muted-foreground">
								<tr>
									<th className="px-3 py-2 font-medium">Contract</th>
									<th className="px-3 py-2 font-medium">Vendor</th>
									<th className="px-3 py-2 font-medium">Term</th>
									<th className="px-3 py-2 text-right font-medium">Prices</th>
									<th className="px-3 py-2 font-medium">Status</th>
								</tr>
							</thead>
							<tbody className="divide-y">
								{contracts.map((c) => (
									<tr key={c.id} className="hover:bg-muted/30">
										<td className="px-3 py-2">
											<Link
												to="/contracts/$contractId"
												params={{ contractId: c.id }}
												className="font-medium hover:underline"
											>
												{c.title ?? "Untitled contract"}
											</Link>
											<div className="text-xs text-muted-foreground">
												Added {c.createdAt.slice(0, 10)}
											</div>
										</td>
										<td className="px-3 py-2">
											{c.vendor ?? c.vendorName ?? "—"}
										</td>
										<td className="px-3 py-2 text-muted-foreground">
											{formatTerm(c)}
										</td>
										<td className="px-3 py-2 text-right tabular-nums">
											{c.prices}
										</td>
										<td className="px-3 py-2">
											<div className="flex flex-wrap gap-1">
												{c.status === "confirmed" ? (
													<Badge variant="success">Confirmed</Badge>
												) : (
													<Badge variant="info">Needs review</Badge>
												)}
												{c.status === "draft" && c.errors > 0 ? (
													<Badge variant="destructive">
														{c.errors} blocked
													</Badge>
												) : null}
												{c.status === "draft" && c.warnings > 0 ? (
													<Badge variant="warning">{c.warnings} to check</Badge>
												) : null}
											</div>
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
