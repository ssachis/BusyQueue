import { CalendarClock } from "lucide-react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "#/components/ui/card.tsx";
import type {
	DirectionTrend,
	Trend,
	TrendSeries,
} from "#/lib/forecast/index.ts";
import { cn } from "#/lib/utils.ts";
import {
	formatMonth,
	MethodNote,
	money,
	signedMoney,
	signedPercent,
} from "./format.tsx";

/**
 * Month-over-month totals per direction and counterparty. With fewer than
 * the required complete months it shows only the "not enough data" state:
 * no totals, no change, no band.
 */
export function TrendSection({ trend }: { trend: Trend }) {
	const have = trend.completeMonths.length;
	return (
		<Card className="gap-5">
			<CardHeader>
				<CardTitle>Trend</CardTitle>
				<CardDescription>
					Billed totals per complete month, the change from the month before,
					and the trailing 3-month band.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				{trend.status === "not_enough_data" ? (
					<div className="flex flex-col items-center gap-2 rounded-md border border-dashed px-4 py-8 text-center">
						<CalendarClock className="size-7 text-muted-foreground" />
						<p className="text-base font-semibold">
							Not enough data — {have} of {trend.requiredMonths} months
						</p>
						<p className="max-w-md text-sm text-muted-foreground">
							A trend needs {trend.requiredMonths} complete months of history.{" "}
							{have > 0
								? `Complete so far: ${trend.completeMonths.map(formatMonth).join(", ")}.`
								: "No month is complete yet."}{" "}
							No trend numbers are shown until then.
						</p>
					</div>
				) : (
					<>
						<DirectionTable
							title="Spend (bills received)"
							data={trend.spend}
							currency={trend.currency}
						/>
						<DirectionTable
							title="Revenue (invoices issued)"
							data={trend.revenue}
							currency={trend.currency}
						/>
					</>
				)}
				<MethodNote method={trend.method} />
			</CardContent>
		</Card>
	);
}

function DirectionTable({
	title,
	data,
	currency,
}: {
	title: string;
	data: DirectionTrend;
	currency: string | null;
}) {
	const empty = !data.overall.months.some((m) => m.totalMinor !== 0);
	if (empty) {
		return (
			<div className="space-y-2">
				<h3 className="text-sm font-semibold">{title}</h3>
				<p className="text-sm text-muted-foreground">Nothing in this period.</p>
			</div>
		);
	}
	const months = data.overall.months.map((m) => m.month);
	const rows: TrendSeries[] = [data.overall, ...data.byCounterparty];
	return (
		<div className="space-y-2">
			<h3 className="text-sm font-semibold">{title}</h3>
			<MonthBars series={data.overall} currency={currency} />
			<div className="overflow-x-auto rounded-md border">
				<table className="w-full text-sm">
					<thead className="bg-muted/40 text-left text-muted-foreground">
						<tr>
							<th className="px-3 py-2 font-medium">Counterparty</th>
							{months.map((m) => (
								<th key={m} className="px-3 py-2 text-right font-medium">
									{formatMonth(m)}
								</th>
							))}
							<th className="px-3 py-2 text-right font-medium">
								Month over month
							</th>
							<th className="px-3 py-2 text-right font-medium">
								3-month band (avg, low – high)
							</th>
						</tr>
					</thead>
					<tbody className="divide-y">
						{rows.map((s) => (
							<tr
								key={s.key}
								className={cn(s === data.overall && "bg-muted/20 font-medium")}
							>
								<td className="px-3 py-2">
									{s === data.overall ? "All" : s.key}
								</td>
								{s.months.map((m) => (
									<td
										key={m.month}
										className="px-3 py-2 text-right tabular-nums"
									>
										{money(m.totalMinor, currency)}
									</td>
								))}
								<td className="px-3 py-2 text-right tabular-nums">
									{s.summary ? (
										<>
											<div>
												{signedMoney(s.summary.momChangeMinor, currency)}
											</div>
											<div className="text-xs text-muted-foreground">
												{signedPercent(s.summary.momChangeRatio)}
											</div>
										</>
									) : (
										"—"
									)}
								</td>
								<td className="px-3 py-2 text-right tabular-nums">
									{s.summary ? (
										<>
											<div>
												{money(s.summary.trailing.averageMinor, currency)}
											</div>
											<div className="text-xs text-muted-foreground">
												{money(s.summary.trailing.lowMinor, currency)} –{" "}
												{money(s.summary.trailing.highMinor, currency)}
											</div>
										</>
									) : (
										"—"
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

/** Monthly totals as bars, with the trailing band as a shaded strip. */
function MonthBars({
	series,
	currency,
}: {
	series: TrendSeries;
	currency: string | null;
}) {
	const width = 640;
	const height = 120;
	const top = 10;
	const bottom = 20;
	const plot = height - top - bottom;
	const max = Math.max(1, ...series.months.map((m) => m.totalMinor));
	const group = width / Math.max(1, series.months.length);
	const bar = Math.min(40, group / 2);
	const y = (v: number) => top + plot - (Math.max(0, v) / max) * plot;
	const band = series.summary?.trailing;
	return (
		<svg
			viewBox={`0 0 ${width} ${height}`}
			role="img"
			aria-label={`Monthly totals: ${series.months
				.map((m) => `${formatMonth(m.month)} ${money(m.totalMinor, currency)}`)
				.join(", ")}`}
			className="h-auto w-full max-w-2xl"
		>
			{band ? (
				<rect
					x={0}
					width={width}
					y={y(band.highMinor)}
					height={Math.max(1, y(band.lowMinor) - y(band.highMinor))}
					className="fill-chart-2/20"
				/>
			) : null}
			<line
				x1={0}
				x2={width}
				y1={top + plot}
				y2={top + plot}
				className="stroke-current opacity-20"
			/>
			{series.months.map((m, i) => {
				const cx = group * i + group / 2;
				return (
					<g key={m.month}>
						<rect
							x={cx - bar / 2}
							y={y(m.totalMinor)}
							width={bar}
							height={top + plot - y(m.totalMinor)}
							rx={3}
							className="fill-chart-1"
						/>
						<text
							x={cx}
							y={height - 5}
							textAnchor="middle"
							className="fill-current text-[10px] opacity-60"
						>
							{formatMonth(m.month)}
						</text>
					</g>
				);
			})}
		</svg>
	);
}
