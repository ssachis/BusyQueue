import { Check } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PageBody, PageHeader } from "#/components/app-shell.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "#/components/ui/card.tsx";
import { Separator } from "#/components/ui/separator.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { formatMoney, toMinor } from "#/lib/money/index.ts";
import { cn } from "#/lib/utils.ts";
import { review } from "./data.ts";
import {
	disputeDraft,
	type InvoiceReview,
	type ReviewStatus,
} from "./review.ts";

const STORAGE_KEY = "busyq.approvals.v1";

/** One approval: what was approved, when, and for how much. Append-only. */
type Approval = {
	invoiceId: string;
	at: string;
	amountMinor: number;
	currency: string;
	draft: string;
};

function loadApprovals(): Approval[] {
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		return raw ? (JSON.parse(raw) as Approval[]) : [];
	} catch {
		return [];
	}
}

function saveApprovals(list: Approval[]) {
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
	} catch {
		// Storage can be unavailable (private mode); approvals then last for this visit only.
	}
}

const STATUS: Record<
	ReviewStatus,
	{ label: string; variant: "destructive" | "warning" | "success" }
> = {
	flagged: { label: "Flagged", variant: "destructive" },
	unpriced: { label: "Price check failed", variant: "warning" },
	clean: { label: "Clean", variant: "success" },
};

const KIND_LABEL: Record<string, string> = {
	overcharge: "Overcharge",
	duplicate_line: "Duplicate line",
	wrong_total: "Wrong total",
	duplicate_payment: "Duplicate payment",
	orphan_payment: "Payment with no invoice",
};

const usd = (minor: number, currency = "USD") =>
	formatMoney({ minor, currency });

function Stat({
	label,
	value,
	note,
}: {
	label: string;
	value: string;
	note?: string;
}) {
	return (
		<Card className="gap-1 py-4">
			<CardContent className="space-y-1">
				<div className="text-sm text-muted-foreground">{label}</div>
				<div className="text-2xl font-semibold tracking-tight">{value}</div>
				{note ? (
					<div className="text-xs text-muted-foreground">{note}</div>
				) : null}
			</CardContent>
		</Card>
	);
}

export function ReviewPage() {
	const { rows, orphans, totals } = review;
	const [selectedId, setSelectedId] = useState<string>(
		() =>
			rows.find((r) => r.status === "flagged")?.invoice.id ??
			rows[0]?.invoice.id ??
			"",
	);
	const [approvals, setApprovals] = useState<Approval[]>([]);
	const [edits, setEdits] = useState<Record<string, string>>({});
	const [filter, setFilter] = useState<ReviewStatus | "all">("all");

	useEffect(() => setApprovals(loadApprovals()), []);

	const approvedIds = useMemo(
		() => new Set(approvals.map((a) => a.invoiceId)),
		[approvals],
	);
	const visible = rows.filter((r) => filter === "all" || r.status === filter);
	const selected = rows.find((r) => r.invoice.id === selectedId);

	function approve(r: InvoiceReview, draft: string) {
		const next: Approval[] = [
			...approvals,
			{
				invoiceId: r.invoice.id,
				at: new Date().toISOString(),
				amountMinor: r.impact.minor,
				currency: r.impact.currency,
				draft,
			},
		];
		setApprovals(next);
		saveApprovals(next);
	}

	return (
		<>
			<PageHeader
				title="Invoice review"
				description="Northfield Unified School District food service. Sample data: a fictional district, made-up vendors and invoices."
			/>
			<PageBody>
				<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
					<Stat label="Invoices checked" value={String(totals.invoices)} />
					<Stat
						label="Recoverable"
						value={usd(totals.recoverable.minor)}
						note={`${totals.flagged} flagged invoices, plus ${usd(totals.orphanTotal.minor)} in payments with no invoice`}
					/>
					<Stat label="Flagged invoices" value={String(totals.flagged)} />
					<Stat
						label="Lines with no price found"
						value={String(totals.unpricedLines)}
						note="Vendor or unit spelled differently from the contract (the v1 lookup)"
					/>
				</div>

				<div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
					<Card className="gap-4">
						<CardHeader>
							<CardTitle>Invoices</CardTitle>
							<CardDescription>
								All amounts come from code, never from the model.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-3">
							<div className="flex flex-wrap gap-1.5">
								{(["all", "flagged", "unpriced", "clean"] as const).map((f) => (
									<Button
										key={f}
										size="xs"
										variant={filter === f ? "default" : "outline"}
										onClick={() => setFilter(f)}
									>
										{f === "all" ? "All" : STATUS[f].label}
									</Button>
								))}
							</div>
							<ul className="max-h-[28rem] divide-y overflow-y-auto rounded-md border">
								{visible.map((r) => (
									<li key={r.invoice.id}>
										<button
											type="button"
											onClick={() => setSelectedId(r.invoice.id)}
											className={cn(
												"flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
												selectedId === r.invoice.id && "bg-accent",
											)}
										>
											<span className="min-w-0">
												<span className="block truncate font-medium">
													{r.invoice.invoiceNumber}
												</span>
												<span className="block truncate text-xs text-muted-foreground">
													{r.invoice.vendor}
												</span>
											</span>
											<span className="flex shrink-0 items-center gap-2">
												{r.impact.minor > 0 ? (
													<span className="text-xs font-medium">
														{usd(r.impact.minor)}
													</span>
												) : null}
												{approvedIds.has(r.invoice.id) ? (
													<Badge variant="info">Approved</Badge>
												) : (
													<Badge variant={STATUS[r.status].variant}>
														{STATUS[r.status].label}
													</Badge>
												)}
											</span>
										</button>
									</li>
								))}
								{visible.length === 0 ? (
									<li className="px-3 py-6 text-center text-sm text-muted-foreground">
										No invoices in this view.
									</li>
								) : null}
							</ul>
						</CardContent>
					</Card>

					{selected ? (
						<InvoiceDetail
							key={selected.invoice.id}
							r={selected}
							approved={approvals.find(
								(a) => a.invoiceId === selected.invoice.id,
							)}
							draft={edits[selected.invoice.id] ?? disputeDraft(selected)}
							onDraft={(text) =>
								setEdits((e) => ({ ...e, [selected.invoice.id]: text }))
							}
							onApprove={(text) => approve(selected, text)}
						/>
					) : null}
				</div>

				{orphans.length > 0 ? (
					<Card className="mt-6 gap-4">
						<CardHeader>
							<CardTitle>Payments with no invoice</CardTitle>
							<CardDescription>
								Money that left with no matching invoice on file. Review before
								the next payment run.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<ul className="divide-y rounded-md border text-sm">
								{orphans.map((f) => (
									<li
										key={f.paymentId}
										className="flex items-start justify-between gap-4 px-3 py-2"
									>
										<span>{f.detail}</span>
										<span className="shrink-0 font-medium">
											{usd(f.impactMinor, f.currency)}
										</span>
									</li>
								))}
							</ul>
						</CardContent>
					</Card>
				) : null}
			</PageBody>
		</>
	);
}

function InvoiceDetail({
	r,
	approved,
	draft,
	onDraft,
	onApprove,
}: {
	r: InvoiceReview;
	approved: Approval | undefined;
	draft: string;
	onDraft: (text: string) => void;
	onApprove: (text: string) => void;
}) {
	const { invoice, findings, unpriced, impact, status } = r;
	return (
		<Card className="gap-4">
			<CardHeader>
				<CardTitle className="flex flex-wrap items-center gap-2">
					{invoice.invoiceNumber}
					<Badge variant={STATUS[status].variant}>{STATUS[status].label}</Badge>
				</CardTitle>
				<CardDescription>
					{invoice.vendor} · issued {invoice.issueDate} · stated total{" "}
					{usd(
						toMinor(invoice.statedTotal, invoice.currency).minor,
						invoice.currency,
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{findings.length > 0 ? (
					<section className="space-y-2">
						<h3 className="text-sm font-medium">Findings</h3>
						<ul className="divide-y rounded-md border text-sm">
							{findings.map((f) => (
								<li
									key={`${f.kind}-${f.lineNo ?? "x"}-${f.paymentId ?? "x"}`}
									className="flex items-start justify-between gap-4 px-3 py-2"
								>
									<span className="space-y-1">
										<Badge variant="destructive">
											{KIND_LABEL[f.kind] ?? f.kind}
										</Badge>
										<span className="block text-muted-foreground">
											{f.detail}
										</span>
									</span>
									<span className="shrink-0 font-medium">
										{usd(f.impactMinor, f.currency)}
									</span>
								</li>
							))}
						</ul>
						<div className="flex justify-between text-sm font-medium">
							<span>Recoverable on this invoice</span>
							<span>{usd(impact.minor, impact.currency)}</span>
						</div>
					</section>
				) : null}

				{unpriced.length > 0 ? (
					<section className="space-y-2">
						<h3 className="text-sm font-medium">No agreed price found</h3>
						<p className="text-xs text-muted-foreground">
							The v1 lookup needs vendor, item and unit to match the contract
							exactly. These lines could not be checked, so any overcharge on
							them is invisible.
						</p>
						<ul className="divide-y rounded-md border text-sm">
							{unpriced.map((u) => (
								<li
									key={u.lineNo}
									className="flex items-start justify-between gap-4 px-3 py-2"
								>
									<span>
										Line {u.lineNo}: {u.item} billed per “{u.unit}” by “
										{invoice.vendor}”
									</span>
									<Badge variant="warning">{u.error.code}</Badge>
								</li>
							))}
						</ul>
					</section>
				) : null}

				{status === "clean" ? (
					<p className="text-sm text-muted-foreground">
						Every line matches the contract and the totals add up. Nothing to
						send.
					</p>
				) : null}

				{findings.length > 0 ? (
					<>
						<Separator />
						<section className="space-y-2">
							<h3 className="text-sm font-medium">Dispute draft</h3>
							<p className="text-xs text-muted-foreground">
								A template built from the findings above; the agent will write
								the prose later. Nothing is sent without Approve.
							</p>
							<Textarea
								value={approved ? approved.draft : draft}
								onChange={(e) => onDraft(e.target.value)}
								readOnly={Boolean(approved)}
								rows={14}
								className="font-mono text-xs"
							/>
							{approved ? (
								<div className="flex items-center gap-2 text-sm text-muted-foreground">
									<Check className="size-4 text-success" />
									Approved {new Date(approved.at).toLocaleString()} for{" "}
									{usd(approved.amountMinor, approved.currency)}. The draft is
									now read-only.
								</div>
							) : (
								<Button onClick={() => onApprove(draft)}>
									Approve and queue for the vendor
								</Button>
							)}
						</section>
					</>
				) : null}
			</CardContent>
		</Card>
	);
}
