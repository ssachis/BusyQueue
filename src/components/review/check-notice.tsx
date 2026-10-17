import { ChevronDown, TriangleAlert } from "lucide-react";
import type { ReviewSummary } from "#/server/review-store.ts";
import { plural } from "./format.ts";

/**
 * Small notice when the latest analysis of some bills couldn't check every
 * line (e.g. a vendor or item that isn't on the rate card). Collapsed by
 * default; opens to the reasons, grouped by code.
 */
export function CheckNotice({ summary }: { summary: ReviewSummary }) {
	const { failures } = summary;
	if (failures.failedRuns === 0) return null;
	const hasVariants =
		failures.vendorVariants.length > 0 || failures.unitVariants.length > 0;

	return (
		<details className="group rounded-xl border border-warning/40 bg-warning/5 text-sm">
			<summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
				<TriangleAlert aria-hidden className="size-4 shrink-0 text-warning" />
				<span className="flex-1">
					<span className="font-medium">
						{plural(failures.failedRuns, "bill")} couldn't be fully checked
					</span>
					<span className="text-muted-foreground">
						{" "}
						· some lines have no agreed price to compare with
					</span>
				</span>
				<ChevronDown
					aria-hidden
					className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
				/>
			</summary>
			<div className="space-y-4 border-t border-warning/30 px-4 py-4">
				<ul className="divide-y rounded-lg border bg-card">
					{failures.groups.map((g) => (
						<li
							key={`${g.tool}:${g.code}`}
							className="flex items-start justify-between gap-4 px-3 py-2"
						>
							<span className="min-w-0 text-muted-foreground">
								{g.example ?? g.code}
							</span>
							<span className="shrink-0 text-xs text-muted-foreground">
								{plural(g.runs, "bill")}
							</span>
						</li>
					))}
				</ul>
				{hasVariants ? (
					<div className="grid gap-4 md:grid-cols-2">
						{failures.vendorVariants.length > 0 ? (
							<section className="space-y-2">
								<h3 className="font-medium">Vendor names on the bills</h3>
								<ul className="space-y-1">
									{failures.vendorVariants.map((vv) => (
										<li key={vv.printed} className="flex justify-between gap-2">
											<span>
												“{vv.printed}”
												{vv.canonical ? (
													<span className="text-muted-foreground">
														{" "}
														→ {vv.canonical}
													</span>
												) : (
													<span className="text-muted-foreground">
														{" "}
														(not on the rate card)
													</span>
												)}
											</span>
											<span className="shrink-0 text-muted-foreground">
												{plural(vv.invoiceIds.length, "bill")}
											</span>
										</li>
									))}
								</ul>
							</section>
						) : null}
						{failures.unitVariants.length > 0 ? (
							<section className="space-y-2">
								<h3 className="font-medium">Units billed vs the contract</h3>
								<ul className="space-y-1">
									{failures.unitVariants.map((u) => (
										<li
											key={`${u.item}|${u.billedUnit}`}
											className="flex justify-between gap-2"
										>
											<span>
												{u.item}: “{u.billedUnit}”
												<span className="text-muted-foreground">
													{" "}
													vs {u.contractUnits.join(" / ")}
												</span>
											</span>
											<span className="shrink-0 text-muted-foreground">
												{plural(u.invoiceIds.length, "bill")}
											</span>
										</li>
									))}
								</ul>
							</section>
						) : null}
					</div>
				) : null}
				<p className="text-xs text-muted-foreground">
					Add the missing prices to a contract, then check those bills again.
				</p>
			</div>
		</details>
	);
}
