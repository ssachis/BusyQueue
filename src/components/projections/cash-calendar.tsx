import { Link } from "@tanstack/react-router";
import { Badge } from "#/components/ui/badge.tsx";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "#/components/ui/card.tsx";
import type {
	CalendarItem,
	CashCalendar,
	PaymentBehaviour,
} from "#/lib/forecast/index.ts";
import type { ItemLabel } from "#/lib/projections/mapping.ts";
import { cn } from "#/lib/utils.ts";
import { formatDate, MethodNote, money, RangeCell } from "./format.tsx";
import { WeeklyChart } from "./weekly-chart.tsx";

const BASIS_LABEL: Record<CalendarItem["basis"], string> = {
	own: "own history",
	overall: "all-vendor history",
	none: "on due date",
};

export function CashCalendarSection({
	calendar,
	behaviour,
	labels,
}: {
	calendar: CashCalendar;
	behaviour: PaymentBehaviour;
	labels: Record<string, ItemLabel>;
}) {
	const { currency } = calendar;
	const hasIn = calendar.items.some((i) => i.direction === "in");
	const hasOut = calendar.items.some((i) => i.direction === "out");
	const pastDue = calendar.items.filter((i) => i.pastDue);

	return (
		<Card className="gap-5">
			<CardHeader>
				<CardTitle>Cash calendar</CardTitle>
				<CardDescription>
					Open bills and invoices placed on their due date, shifted by how late
					each counterparty usually pays. Ranges come from the 25th–75th
					percentile of past payments.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				<div className="overflow-x-auto rounded-md border">
					<table className="w-full text-sm">
						<thead className="bg-muted/40 text-left text-muted-foreground">
							<tr>
								<th className="px-3 py-2 font-medium">Period</th>
								<th className="px-3 py-2 text-right font-medium">
									Cash in (expected, low – high)
								</th>
								<th className="px-3 py-2 text-right font-medium">
									Cash out (expected, low – high)
								</th>
								<th className="px-3 py-2 text-right font-medium">Net</th>
							</tr>
						</thead>
						<tbody className="divide-y">
							{calendar.horizons.map((h) => (
								<tr key={h.days}>
									<td className="px-3 py-2">
										<div className="font-medium">Next {h.days} days</div>
										<div className="text-xs text-muted-foreground">
											{formatDate(calendar.asOf)} – {formatDate(h.lastDate)}
										</div>
									</td>
									<td className="px-3 py-2 text-right">
										<RangeCell range={h.in} currency={currency} />
									</td>
									<td className="px-3 py-2 text-right">
										<RangeCell range={h.out} currency={currency} />
									</td>
									<td className="px-3 py-2 text-right">
										<RangeCell range={h.net} currency={currency} />
									</td>
								</tr>
							))}
							<tr className="text-muted-foreground">
								<td className="px-3 py-2">
									After {formatDate(calendar.beyond.firstDate)}
								</td>
								<td className="px-3 py-2 text-right tabular-nums">
									{money(calendar.beyond.in.expectedMinor, currency)}
								</td>
								<td className="px-3 py-2 text-right tabular-nums">
									{money(calendar.beyond.out.expectedMinor, currency)}
								</td>
								<td className="px-3 py-2 text-right tabular-nums">
									{money(calendar.beyond.net.expectedMinor, currency)}
								</td>
							</tr>
						</tbody>
					</table>
				</div>

				<div className="space-y-2">
					<div className="flex flex-wrap items-baseline justify-between gap-2">
						<h3 className="text-sm font-semibold">Per week</h3>
						<ul className="flex gap-4 text-xs text-muted-foreground">
							{hasIn ? (
								<li className="flex items-center gap-1.5">
									<span
										aria-hidden
										className="size-2 rounded-full bg-chart-2"
									/>
									Cash in
								</li>
							) : null}
							<li className="flex items-center gap-1.5">
								<span aria-hidden className="size-2 rounded-full bg-chart-1" />
								Cash out
							</li>
							<li className="flex items-center gap-1.5">
								<span aria-hidden className="h-3 w-px bg-foreground/60" />
								Low – high range
							</li>
						</ul>
					</div>
					<WeeklyChart
						weeks={calendar.weeks}
						currency={currency}
						showIn={hasIn}
						showOut={hasOut || !hasIn}
					/>
				</div>

				<div className="space-y-2">
					<div className="flex flex-wrap items-baseline justify-between gap-2">
						<h3 className="text-sm font-semibold">
							Open items ({calendar.items.length})
						</h3>
						{pastDue.length > 0 ? (
							<p className="text-xs text-muted-foreground">
								{pastDue.length} past due on {formatDate(calendar.asOf)}; they
								are expected from the as-of date on.
							</p>
						) : null}
					</div>
					{calendar.items.length === 0 ? (
						<p className="rounded-md border px-3 py-6 text-center text-sm text-muted-foreground">
							Nothing is open on {formatDate(calendar.asOf)}.
						</p>
					) : (
						<div className="max-h-[28rem] overflow-auto rounded-md border">
							<table className="w-full text-sm">
								<thead className="sticky top-0 bg-muted text-left text-muted-foreground">
									<tr>
										<th className="px-3 py-2 font-medium">Document</th>
										<th className="px-3 py-2 font-medium">Counterparty</th>
										<th className="px-3 py-2 text-right font-medium">Amount</th>
										<th className="px-3 py-2 font-medium">Due</th>
										<th className="px-3 py-2 font-medium">Expected</th>
										<th className="px-3 py-2 font-medium">Window</th>
									</tr>
								</thead>
								<tbody className="divide-y">
									{calendar.items.map((i) => (
										<ItemRow
											key={i.id}
											item={i}
											label={labels[i.id]}
											currency={currency}
										/>
									))}
								</tbody>
							</table>
						</div>
					)}
				</div>

				<BehaviourTable behaviour={behaviour} />

				<div className="grid gap-2 md:grid-cols-2">
					<MethodNote
						title="How the calendar was calculated"
						method={calendar.method}
					/>
					<MethodNote
						title="How payment behaviour was calculated"
						method={behaviour.method}
					/>
				</div>
			</CardContent>
		</Card>
	);
}

function ItemRow({
	item,
	label,
	currency,
}: {
	item: CalendarItem;
	label: ItemLabel | undefined;
	currency: string | null;
}) {
	const name = label?.label ?? item.id;
	return (
		<tr className={cn(item.pastDue && "bg-destructive/5")}>
			<td className="px-3 py-2">
				{label?.reviewInvoiceId ? (
					<Link
						to="/"
						search={{ v: "v2", invoice: label.reviewInvoiceId }}
						className="font-medium hover:underline"
					>
						{name}
					</Link>
				) : (
					<span className="font-medium">{name}</span>
				)}
				<div className="text-xs text-muted-foreground">
					{item.direction === "in" ? "Cash in" : "Cash out"}
				</div>
			</td>
			<td className="px-3 py-2">{item.counterparty}</td>
			<td className="px-3 py-2 text-right font-medium tabular-nums">
				{money(item.amountMinor, currency)}
			</td>
			<td className="px-3 py-2 whitespace-nowrap">
				<div className="flex flex-wrap items-center gap-1.5">
					{formatDate(item.dueDate)}
					{item.pastDue ? <Badge variant="destructive">Past due</Badge> : null}
					{item.dueDateAssumed ? (
						<Badge variant="outline">Assumed terms</Badge>
					) : null}
				</div>
			</td>
			<td className="px-3 py-2 whitespace-nowrap">
				{formatDate(item.expectedDate)}
			</td>
			<td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
				{item.earliestDate === item.latestDate
					? formatDate(item.earliestDate)
					: `${formatDate(item.earliestDate, false)} – ${formatDate(item.latestDate)}`}
				<div className="text-xs">{BASIS_LABEL[item.basis]}</div>
			</td>
		</tr>
	);
}

const days = (n: number) =>
	n === 0
		? "on the due date"
		: `${Math.abs(n)} day${Math.abs(n) === 1 ? "" : "s"} ${n < 0 ? "early" : "late"}`;

function BehaviourTable({ behaviour }: { behaviour: PaymentBehaviour }) {
	if (behaviour.counterparties.length === 0) return null;
	return (
		<div className="space-y-2">
			<h3 className="text-sm font-semibold">Payment behaviour</h3>
			<div className="overflow-x-auto rounded-md border">
				<table className="w-full text-sm">
					<thead className="bg-muted/40 text-left text-muted-foreground">
						<tr>
							<th className="px-3 py-2 font-medium">Counterparty</th>
							<th className="px-3 py-2 font-medium">Direction</th>
							<th className="px-3 py-2 text-right font-medium">Paid items</th>
							<th className="px-3 py-2 font-medium">Usually paid</th>
							<th className="px-3 py-2 font-medium">Range (p25 – p75)</th>
							<th className="px-3 py-2 font-medium">Based on</th>
						</tr>
					</thead>
					<tbody className="divide-y">
						{behaviour.counterparties.map((c) => (
							<tr key={`${c.direction}-${c.counterparty}`}>
								<td className="px-3 py-2 font-medium">{c.counterparty}</td>
								<td className="px-3 py-2 text-muted-foreground">
									{c.direction === "in" ? "Cash in" : "Cash out"}
								</td>
								<td className="px-3 py-2 text-right tabular-nums">
									{c.own?.sampleSize ?? 0}
								</td>
								<td className="px-3 py-2">{days(c.expected.medianDays)}</td>
								<td className="px-3 py-2 text-muted-foreground">
									{c.expected.p25Days} to {c.expected.p75Days} days
								</td>
								<td className="px-3 py-2">
									<Badge variant={c.basis === "own" ? "success" : "outline"}>
										{BASIS_LABEL[c.basis]}
									</Badge>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}
