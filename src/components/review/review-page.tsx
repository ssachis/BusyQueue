import { getRouteApi, Link } from "@tanstack/react-router";
import { FileScan } from "lucide-react";
import { useCallback } from "react";
import { PageBody, PageHeader } from "#/components/app-shell.tsx";
import { Button } from "#/components/ui/button.tsx";
import { BillDetail } from "./bill-detail.tsx";
import { BillList, type BillListState } from "./bill-list.tsx";
import { CashflowChart } from "./cashflow-chart.tsx";
import { CheckNotice } from "./check-notice.tsx";
import { money, plural } from "./format.ts";

const route = getRouteApi("/review");

export function ReviewPage() {
	const { summary, detail, invoiceId } = route.useLoaderData();
	const search = route.useSearch();
	const navigate = route.useNavigate();
	const { totals, currency } = summary;
	const found = totals.recoverableMinor + totals.orphanMinor;
	const approved = summary.invoices.filter((r) => r.run?.approved).length;

	const listState: BillListState = {
		sort: search.sort,
		status: search.status,
		vendor: search.vendor,
		q: search.q,
	};
	const onChange = useCallback(
		(next: BillListState) =>
			navigate({
				search: (s) => ({
					...s,
					sort: next.sort,
					status: next.status,
					vendor: next.vendor,
					q: next.q,
				}),
				replace: true,
			}),
		[navigate],
	);
	const select = (id: string) => {
		navigate({ search: (s) => ({ ...s, invoice: id }) });
		// On narrow screens the detail sits below the list; bring it into view.
		if (window.matchMedia("(max-width: 1023px)").matches) {
			requestAnimationFrame(() =>
				document
					.getElementById("bill-detail")
					?.scrollIntoView({ behavior: "smooth" }),
			);
		}
	};

	return (
		<>
			<PageHeader
				title="Review bills"
				description="Every vendor bill is checked line by line against the agreed prices on your contracts and the payments on file. The agent explains, code calculates, and nothing goes to a vendor until you approve."
			>
				<Button asChild variant="outline">
					<Link to="/import">
						<FileScan />
						Import bill
					</Link>
				</Button>
			</PageHeader>
			<PageBody className="space-y-6">
				<section className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
					<div className="flex flex-col justify-center gap-5 rounded-2xl border bg-card p-6 shadow-sm">
						<div>
							<p className="text-sm font-medium text-muted-foreground">
								Found in billing mistakes
							</p>
							<div className="mt-1 text-5xl font-semibold tracking-tighter tabular-nums sm:text-6xl">
								{money(found, currency)}
							</div>
						</div>
						<dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
							<Stat label="Flagged bills" value={String(totals.flagged)} />
							<Stat
								label="Checked"
								value={`${totals.run} of ${totals.invoices}`}
							/>
							<Stat label="Disputes approved" value={String(approved)} />
							<Stat
								label="Paid with no bill"
								value={money(totals.orphanMinor, currency)}
							/>
						</dl>
					</div>
					<div className="rounded-2xl bg-gradient-to-br from-chart-1 to-chart-5 p-6 text-primary-foreground shadow-lg">
						<div className="flex items-baseline justify-between gap-3">
							<h2 className="text-base font-semibold">Cash flow</h2>
							<ul className="flex gap-4 text-xs text-primary-foreground/80">
								<li className="flex items-center gap-1.5">
									<span
										aria-hidden
										className="size-2 rounded-full bg-primary-foreground"
									/>
									Bills in
								</li>
								<li className="flex items-center gap-1.5">
									<span
										aria-hidden
										className="size-2 rounded-full bg-primary-foreground/50"
									/>
									Paid out
								</li>
							</ul>
						</div>
						<div className="mt-3">
							<CashflowChart data={summary.cashflow} />
						</div>
					</div>
				</section>

				<CheckNotice summary={summary} />

				<div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
					<div className="flex max-h-[34rem] min-w-0 flex-col lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)]">
						<BillList
							rows={summary.invoices}
							currency={currency}
							selectedId={invoiceId}
							state={listState}
							onChange={onChange}
							onSelect={select}
						/>
					</div>

					{detail ? (
						<BillDetail
							key={`${detail.invoice.id}-${detail.run?.id ?? "none"}`}
							detail={detail}
						/>
					) : (
						<div className="rounded-xl border border-dashed px-6 py-16 text-center text-sm text-muted-foreground">
							{summary.invoices.length === 0
								? "No vendor bills yet. Import a bill to check it against your agreed prices."
								: "Choose a bill to see what was found."}
						</div>
					)}
				</div>

				{summary.orphans.length > 0 ? (
					<section className="space-y-3 rounded-xl border bg-card p-5 shadow-sm">
						<div className="flex items-baseline justify-between gap-3">
							<h2 className="font-semibold">Payments with no bill</h2>
							<span className="text-sm text-muted-foreground">
								{plural(summary.orphans.length, "payment")} ·{" "}
								{money(totals.orphanMinor, currency)}
							</span>
						</div>
						<ul className="divide-y rounded-lg border text-sm">
							{summary.orphans.map((f) => (
								<li
									key={f.paymentId}
									className="flex items-start justify-between gap-4 px-3 py-2"
								>
									<span className="text-muted-foreground">{f.detail}</span>
									<span className="shrink-0 font-medium tabular-nums">
										{money(f.impactMinor, f.currency)}
									</span>
								</li>
							))}
						</ul>
					</section>
				) : null}
			</PageBody>
		</>
	);
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="min-w-0">
			<dt className="truncate text-xs text-muted-foreground">{label}</dt>
			<dd className="font-semibold tabular-nums">{value}</dd>
		</div>
	);
}
