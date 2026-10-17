import { Link } from "@tanstack/react-router";
import { TrendingUp } from "lucide-react";
import { Badge } from "#/components/ui/badge.tsx";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "#/components/ui/card.tsx";
import type { PriceRiseAlert, SpendDriftResult } from "#/lib/forecast/index.ts";
import { formatPercent, formatPrice } from "#/lib/projections/format.ts";
import { type ItemLabel, invoiceIdFromRef } from "#/lib/projections/mapping.ts";
import {
	formatDate,
	formatMonth,
	MethodNote,
	money,
	signedMoney,
	signedPercent,
} from "./format.tsx";

export function DriftSection({
	spendDrift,
	priceRises,
	currency,
	priceRiseMethod,
	labels,
}: {
	spendDrift: SpendDriftResult;
	priceRises: PriceRiseAlert[];
	currency: string | null;
	priceRiseMethod: string;
	labels: Record<string, ItemLabel>;
}) {
	return (
		<Card className="gap-5">
			<CardHeader>
				<CardTitle>Drift alerts</CardTitle>
				<CardDescription>
					Spend that moved away from its usual level, and unit prices that went
					up between bills. Every number below is the one that triggered the
					alert.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				<div className="space-y-2">
					<div className="flex items-center gap-2">
						<h3 className="text-sm font-semibold">Price rises</h3>
						<Badge variant={priceRises.length ? "warning" : "success"}>
							{priceRises.length}
						</Badge>
					</div>
					{priceRises.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							No billed unit price went up.
						</p>
					) : (
						<div className="overflow-x-auto rounded-md border">
							<table className="w-full text-sm">
								<thead className="bg-muted/40 text-left text-muted-foreground">
									<tr>
										<th className="px-3 py-2 font-medium">Vendor and item</th>
										<th className="px-3 py-2 text-right font-medium">Before</th>
										<th className="px-3 py-2 text-right font-medium">Now</th>
										<th className="px-3 py-2 text-right font-medium">Rise</th>
										<th className="px-3 py-2 font-medium">Bill</th>
									</tr>
								</thead>
								<tbody className="divide-y">
									{priceRises.map((a) => (
										<PriceRiseRow
											key={`${a.ref}-${a.item}`}
											alert={a}
											currency={currency}
											labels={labels}
										/>
									))}
								</tbody>
							</table>
						</div>
					)}
					<MethodNote method={priceRiseMethod} />
				</div>

				<div className="space-y-2">
					<h3 className="text-sm font-semibold">Spend drift</h3>
					{spendDrift.status === "not_enough_data" ? (
						<p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">
							Not enough data — {spendDrift.completeMonths.length} of{" "}
							{spendDrift.requiredMonths} months. Drift compares the latest
							complete month with the {spendDrift.requiredMonths - 1} before it,
							so no drift numbers are shown yet.
						</p>
					) : spendDrift.alerts.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							No counterparty moved beyond the threshold in{" "}
							{formatMonth(
								spendDrift.completeMonths[
									spendDrift.completeMonths.length - 1
								] ?? "",
							)}
							.
						</p>
					) : (
						<div className="overflow-x-auto rounded-md border">
							<table className="w-full text-sm">
								<thead className="bg-muted/40 text-left text-muted-foreground">
									<tr>
										<th className="px-3 py-2 font-medium">Counterparty</th>
										<th className="px-3 py-2 font-medium">Month</th>
										<th className="px-3 py-2 text-right font-medium">Actual</th>
										<th className="px-3 py-2 text-right font-medium">
											Baseline (avg)
										</th>
										<th className="px-3 py-2 text-right font-medium">Change</th>
									</tr>
								</thead>
								<tbody className="divide-y">
									{spendDrift.alerts.map((a) => (
										<tr key={`${a.direction}-${a.counterparty}`}>
											<td className="px-3 py-2">
												<div className="font-medium">{a.counterparty}</div>
												<div className="text-xs text-muted-foreground">
													{a.direction === "in" ? "Revenue" : "Spend"}
												</div>
											</td>
											<td className="px-3 py-2">{formatMonth(a.month)}</td>
											<td className="px-3 py-2 text-right tabular-nums">
												{money(a.actualMinor, a.currency)}
											</td>
											<td className="px-3 py-2 text-right tabular-nums">
												{money(a.baselineMinor, a.currency)}
												<div className="text-xs text-muted-foreground">
													{a.baselineMonths
														.map(
															(m, i) =>
																`${formatMonth(m)} ${money(a.baselineMonthTotalsMinor[i] ?? 0, a.currency)}`,
														)
														.join(", ")}
												</div>
											</td>
											<td className="px-3 py-2 text-right tabular-nums">
												{signedMoney(a.changeMinor, a.currency)}
												<div className="text-xs text-muted-foreground">
													{a.changeRatio === null
														? "new (no baseline)"
														: `${signedPercent(a.changeRatio)} vs ${formatPercent(a.thresholdRatio)} threshold`}
												</div>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
					<MethodNote method={spendDrift.method} />
				</div>
			</CardContent>
		</Card>
	);
}

function PriceRiseRow({
	alert: a,
	currency,
	labels,
}: {
	alert: PriceRiseAlert;
	currency: string | null;
	labels: Record<string, ItemLabel>;
}) {
	const c = a.currency ?? currency ?? "USD";
	const invoiceId = invoiceIdFromRef(a.ref);
	return (
		<tr>
			<td className="px-3 py-2">
				<div className="font-medium">{a.item}</div>
				<div className="text-xs text-muted-foreground">
					{a.vendor} · per {a.unit}
				</div>
			</td>
			<td className="px-3 py-2 text-right tabular-nums">
				{formatPrice(a.previousPrice, c)}
				<div className="text-xs text-muted-foreground">
					{formatDate(a.previousDate)}
				</div>
			</td>
			<td className="px-3 py-2 text-right tabular-nums">
				{formatPrice(a.newPrice, c)}
				<div className="text-xs text-muted-foreground">
					{formatDate(a.date)}
				</div>
			</td>
			<td className="px-3 py-2 text-right tabular-nums">
				<span className="inline-flex items-center gap-1 font-medium text-warning">
					<TrendingUp className="size-3.5" />+{formatPrice(a.changeAmount, c)}
				</span>
				<div className="text-xs text-muted-foreground">
					{signedPercent(a.changeRatio)}
				</div>
			</td>
			<td className="px-3 py-2">
				{invoiceId ? (
					<Link
						to="/review"
						search={{ invoice: invoiceId }}
						className="text-primary underline-offset-4 hover:underline"
					>
						{labels[invoiceId]?.label ?? invoiceId}
					</Link>
				) : (
					"—"
				)}
			</td>
		</tr>
	);
}
