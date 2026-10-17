import { getRouteApi } from "@tanstack/react-router";
import { Info } from "lucide-react";
import { PageBody, PageHeader } from "#/components/app-shell.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardContent } from "#/components/ui/card.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import type { ProjectionsData } from "#/server/projections-store.ts";
import { CashCalendarSection } from "./cash-calendar.tsx";
import { DigestCard } from "./digest-card.tsx";
import { DriftSection } from "./drift-section.tsx";
import { formatDate, money } from "./format.tsx";
import { TrendSection } from "./trend-section.tsx";

const route = getRouteApi("/projections");

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function ProjectionsPage() {
	const data = route.useLoaderData();
	const picked = route.useSearch().asOf;
	const navigate = route.useNavigate();
	const { forecast, labels, sources } = data;
	const { calendar, currency } = forecast;

	const setAsOf = (value: string | undefined) =>
		navigate({ search: value ? { asOf: value } : {} });

	return (
		<>
			<PageHeader
				title="Projections"
				description="Cash expected in and out, month-over-month trend and drift alerts. Every number is arithmetic from your bills and invoices; the model only writes the summary."
			>
				<div className="flex items-end gap-2">
					<div className="grid gap-1.5">
						<Label htmlFor="as-of">As of</Label>
						<Input
							id="as-of"
							type="date"
							className="w-40"
							value={data.asOf}
							onChange={(e) => {
								if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) {
									setAsOf(e.target.value);
								}
							}}
						/>
					</div>
					{picked ? (
						<Button variant="outline" onClick={() => setAsOf(undefined)}>
							Reset
						</Button>
					) : null}
				</div>
			</PageHeader>
			<PageBody className="space-y-6">
				<AsOfNote data={data} picked={Boolean(picked)} />

				<div className="grid gap-4 sm:grid-cols-3">
					<Stat
						label="Cash out, next 30 days"
						value={money(
							calendar.horizons[0]?.out.expectedMinor ?? 0,
							currency,
						)}
						hint={rangeHint(calendar.horizons[0]?.out, currency)}
					/>
					<Stat
						label="Cash in, next 30 days"
						value={money(calendar.horizons[0]?.in.expectedMinor ?? 0, currency)}
						hint={
							sources.issuedInvoices === 0
								? "No issued invoices yet"
								: rangeHint(calendar.horizons[0]?.in, currency)
						}
					/>
					<PastDueStat data={data} />
				</div>

				<DigestCard key={data.asOf} asOf={data.asOf} />

				<CashCalendarSection
					calendar={calendar}
					behaviour={forecast.behaviour}
					labels={labels}
				/>

				<TrendSection trend={forecast.trend} />
				<DriftSection
					spendDrift={forecast.spendDrift}
					priceRises={forecast.priceRises}
					currency={currency}
					priceRiseMethod={data.digestInput.methods.priceRise}
					labels={labels}
				/>
			</PageBody>
		</>
	);
}

function rangeHint(
	range: { lowMinor: number; highMinor: number } | undefined,
	currency: string | null,
) {
	if (!range) return undefined;
	return range.lowMinor === range.highMinor
		? "Range: no spread"
		: `Range ${money(range.lowMinor, currency)} – ${money(range.highMinor, currency)}`;
}

function Stat({
	label,
	value,
	hint,
}: {
	label: string;
	value: string;
	hint?: string;
}) {
	return (
		<Card className="gap-1 py-4">
			<CardContent className="space-y-1">
				<p className="text-sm text-muted-foreground">{label}</p>
				<p className="text-2xl font-semibold tracking-tight tabular-nums">
					{value}
				</p>
				{hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
			</CardContent>
		</Card>
	);
}

function PastDueStat({ data }: { data: ProjectionsData }) {
	const { currency } = data.forecast;
	const { pastDue } = data.digestInput.cash;
	const bills = data.forecast.calendar.items.filter(
		(i) => i.pastDue && i.direction === "out",
	);
	const owedToUs =
		pastDue.in.count > 0
			? ` · ${plural(pastDue.in.count, "invoice")} owed to you: ${money(pastDue.in.totalMinor, currency)}`
			: "";
	return (
		<Stat
			label={`Past due bills on ${formatDate(data.asOf)}`}
			value={money(pastDue.out.totalMinor, currency)}
			hint={
				bills.length
					? `${plural(bills.length, "bill")}: ${bills
							.map((i) => data.labels[i.id]?.label ?? i.id)
							.join(", ")}${owedToUs}`
					: `Nothing past due${owedToUs}`
			}
		/>
	);
}

function AsOfNote({
	data,
	picked,
}: {
	data: ProjectionsData;
	picked: boolean;
}) {
	const d = data.default;
	const why =
		d.reason === "after_latest" && d.latestIssueDate
			? `the day after the latest document (${formatDate(d.latestIssueDate)}), because the sample bills run past today (${formatDate(data.today)}). Starting there keeps every bill known and the calendar forward-looking.`
			: `today (${formatDate(data.today)}).`;
	const { sources } = data;
	return (
		<div className="flex items-start gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
			<Info className="mt-0.5 size-4 shrink-0" />
			<p>
				{picked ? (
					<>
						Showing what was known on{" "}
						<strong className="text-foreground">{formatDate(data.asOf)}</strong>
						: later documents and payments are left out. The default date is{" "}
						{formatDate(d.asOf)}, {why}
					</>
				) : (
					<>
						As of{" "}
						<strong className="text-foreground">{formatDate(data.asOf)}</strong>
						: {why} Pick another date to replay what was known then.
					</>
				)}{" "}
				From {plural(sources.bills, "vendor bill")} and{" "}
				{plural(sources.issuedInvoices, "issued invoice")}
				{data.forecast.currency ? ` in ${data.forecast.currency}` : ""}.
				{sources.excluded.length
					? ` Left out (other currencies): ${sources.excluded
							.map((e) => `${e.count} in ${e.currency}`)
							.join(", ")}.`
					: ""}
			</p>
		</div>
	);
}
