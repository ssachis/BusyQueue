import { Check } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PageBody } from "#/components/app-shell.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import type { FindingKind } from "#/lib/busyq/types.ts";
import { formatMoney, toMinor } from "#/lib/money/index.ts";
import { cn } from "#/lib/utils.ts";
import { reviews } from "./data.ts";
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

type Version = "v1" | "v2";

const usd = (minor: number, currency = "USD") =>
	formatMoney({ minor, currency });

/** What went wrong, in the words an owner would use, and the token colour for it. */
const KIND: Record<FindingKind, { label: string; dot: string }> = {
	overcharge: { label: "Charged above contract price", dot: "bg-destructive" },
	duplicate_line: { label: "Same line billed twice", dot: "bg-warning" },
	wrong_total: { label: "Total doesn't add up", dot: "bg-info" },
	duplicate_payment: { label: "Paid twice", dot: "bg-primary" },
	orphan_payment: { label: "Paid with no invoice", dot: "bg-muted-foreground" },
};

const STATUS_DOT: Record<ReviewStatus, string> = {
	flagged: "bg-destructive",
	unpriced: "bg-warning",
	clean: "bg-success",
};

const STATUS_TEXT: Record<ReviewStatus, string> = {
	flagged: "Money lost",
	unpriced: "Not fully checked",
	clean: "All good",
};

const FILTERS: { id: ReviewStatus | "all"; label: string }[] = [
	{ id: "flagged", label: "Money lost" },
	{ id: "unpriced", label: "Not fully checked" },
	{ id: "clean", label: "All good" },
	{ id: "all", label: "All" },
];

export function ReviewPage() {
	const [version, setVersion] = useState<Version>("v1");
	const review = reviews[version];
	const { rows, orphans, totals } = review;

	const [selectedId, setSelectedId] = useState<string>(
		() =>
			rows.find((r) => r.status === "flagged")?.invoice.id ??
			rows[0]?.invoice.id ??
			"",
	);
	const [approvals, setApprovals] = useState<Approval[]>([]);
	const [edits, setEdits] = useState<Record<string, string>>({});
	const [filter, setFilter] = useState<ReviewStatus | "all">("flagged");

	useEffect(() => setApprovals(loadApprovals()), []);

	const approvedIds = useMemo(
		() => new Set(approvals.map((a) => a.invoiceId)),
		[approvals],
	);
	const counts = useMemo(
		() => ({
			all: rows.length,
			flagged: rows.filter((r) => r.status === "flagged").length,
			unpriced: rows.filter((r) => r.status === "unpriced").length,
			clean: rows.filter((r) => r.status === "clean").length,
		}),
		[rows],
	);
	const visible = rows
		.filter((r) => filter === "all" || r.status === filter)
		.sort((a, b) => b.impact.minor - a.impact.minor);
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
		<PageBody>
			<div className="mx-auto w-full max-w-6xl space-y-10 py-2">
				<Hero
					version={version}
					onVersion={setVersion}
					totals={totals}
				/>

				<div className="grid gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
					<section aria-label="Invoices">
						<div
							role="tablist"
							aria-label="Filter invoices"
							className="flex flex-wrap gap-x-5 gap-y-1 border-b"
						>
							{FILTERS.map((f) => (
								<button
									key={f.id}
									type="button"
									role="tab"
									aria-selected={filter === f.id}
									onClick={() => setFilter(f.id)}
									className={cn(
										"-mb-px border-b-2 border-transparent pb-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
										filter === f.id &&
											"border-foreground font-medium text-foreground",
									)}
								>
									{f.label}{" "}
									<span className="tabular-nums text-muted-foreground">
										{counts[f.id]}
									</span>
								</button>
							))}
						</div>
						<ul className="max-h-[34rem] divide-y overflow-y-auto">
							{visible.map((r) => {
								const done = approvedIds.has(r.invoice.id);
								return (
									<li key={r.invoice.id}>
										<button
											type="button"
											onClick={() => setSelectedId(r.invoice.id)}
											aria-current={selectedId === r.invoice.id}
											className={cn(
												"flex w-full items-center gap-3 px-2 py-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
												selectedId === r.invoice.id && "bg-accent",
											)}
										>
											<span
												aria-hidden
												className={cn(
													"size-2 shrink-0 rounded-full",
													done ? "bg-info" : STATUS_DOT[r.status],
												)}
											/>
											<span className="min-w-0 flex-1">
												<span className="block truncate text-sm font-medium">
													{r.invoice.vendor}
												</span>
												<span className="block truncate text-xs text-muted-foreground">
													{r.invoice.invoiceNumber} · {r.invoice.issueDate}
													{done ? " · Approved" : ""}
												</span>
											</span>
											<span
												className={cn(
													"shrink-0 text-sm tabular-nums",
													r.impact.minor > 0
														? "font-medium"
														: "text-muted-foreground",
												)}
											>
												{r.impact.minor > 0
													? usd(r.impact.minor)
													: STATUS_TEXT[r.status]}
											</span>
										</button>
									</li>
								);
							})}
							{visible.length === 0 ? (
								<li className="py-10 text-center text-sm text-muted-foreground">
									Nothing here.
								</li>
							) : null}
						</ul>
					</section>

					{selected ? (
						<InvoiceDetail
							key={`${version}-${selected.invoice.id}`}
							r={selected}
							version={version}
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
					<section aria-label="Payments with no invoice" className="space-y-3">
						<div>
							<h2 className="text-base font-semibold">Paid with no invoice</h2>
							<p className="text-sm text-muted-foreground">
								Money left the account with no matching bill on file. Check
								these before the next payment run.
							</p>
						</div>
						<ul className="divide-y border-y text-sm">
							{orphans.map((f) => (
								<li
									key={f.paymentId}
									className="flex items-start justify-between gap-4 py-3"
								>
									<span className="text-muted-foreground">{f.detail}</span>
									<span className="shrink-0 font-medium tabular-nums">
										{usd(f.impactMinor, f.currency)}
									</span>
								</li>
							))}
						</ul>
					</section>
				) : null}

				<p className="text-xs text-muted-foreground">
					Demo data: a fictional district with made-up vendors and invoices.
					Every amount is calculated by code, never by the AI. Nothing is sent
					to a vendor until you approve it.
				</p>
			</div>
		</PageBody>
	);
}

function Hero({
	version,
	onVersion,
	totals,
}: {
	version: Version;
	onVersion: (v: Version) => void;
	totals: (typeof reviews)["v1"]["totals"];
}) {
	const total = totals.recoverable.minor;
	return (
		<header className="space-y-6">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<p className="text-sm text-muted-foreground">
						Northfield Unified School District food service
					</p>
					<p className="mt-1 text-sm text-muted-foreground">
						{totals.invoices} vendor invoices checked against the contract
					</p>
				</div>
				<div
					role="radiogroup"
					aria-label="How prices are matched"
					className="inline-flex rounded-full border p-0.5 text-sm"
				>
					{(
						[
							["v1", "Exact match"],
							["v2", "Smart match"],
						] as const
					).map(([v, label]) => (
						<button
							key={v}
							type="button"
							role="radio"
							aria-checked={version === v}
							onClick={() => onVersion(v)}
							className={cn(
								"rounded-full px-4 py-1.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
								version === v &&
									"bg-primary text-primary-foreground hover:text-primary-foreground",
							)}
						>
							{label}
						</button>
					))}
				</div>
			</div>

			<div>
				<div className="text-6xl font-semibold tracking-tight tabular-nums sm:text-7xl">
					{usd(total)}
				</div>
				<p className="mt-2 text-lg text-muted-foreground">
					lost to billing mistakes, ready to recover
				</p>
			</div>

			{total > 0 ? (
				<div className="space-y-3">
					<div
						className="flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full"
						role="img"
						aria-label="Money lost, by cause"
					>
						{totals.byKind.map((k) => (
							<div
								key={k.kind}
								className={cn("h-full", KIND[k.kind].dot)}
								style={{ flexGrow: k.impact.minor }}
							/>
						))}
					</div>
					<ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
						{totals.byKind.map((k) => (
							<li key={k.kind} className="flex items-center gap-2">
								<span
									aria-hidden
									className={cn("size-2 rounded-full", KIND[k.kind].dot)}
								/>
								<span className="text-muted-foreground">
									{KIND[k.kind].label}
								</span>
								<span className="font-medium tabular-nums">
									{usd(k.impact.minor)}
								</span>
							</li>
						))}
					</ul>
				</div>
			) : null}

			<p
				className={cn(
					"max-w-2xl text-sm",
					totals.unpricedLines > 0 ? "text-warning" : "text-muted-foreground",
				)}
			>
				{totals.unpricedLines > 0
					? `Exact match couldn't read ${totals.unpricedLines} invoice lines because the vendor or unit is spelled differently from the contract. Those lines were never checked, so overcharges on them are hidden. Switch to Smart match.`
					: version === "v2"
						? "Smart match checked every invoice line against the contract."
						: "Every invoice line was checked."}
			</p>
		</header>
	);
}

function InvoiceDetail({
	r,
	version,
	approved,
	draft,
	onDraft,
	onApprove,
}: {
	r: InvoiceReview;
	version: Version;
	approved: Approval | undefined;
	draft: string;
	onDraft: (text: string) => void;
	onApprove: (text: string) => void;
}) {
	const { invoice, findings, unpriced, impact, status } = r;
	return (
		<section aria-label="Invoice detail" className="space-y-6">
			<div>
				<h2 className="text-xl font-semibold tracking-tight">
					{invoice.vendor}
				</h2>
				<p className="mt-1 text-sm text-muted-foreground">
					Invoice {invoice.invoiceNumber} · {invoice.issueDate} · billed{" "}
					<span className="tabular-nums">
						{usd(
							toMinor(invoice.statedTotal, invoice.currency).minor,
							invoice.currency,
						)}
					</span>
				</p>
			</div>

			{findings.length > 0 ? (
				<div className="space-y-3">
					<div className="flex items-baseline justify-between gap-4">
						<h3 className="text-sm font-medium">What went wrong</h3>
						<p className="text-sm">
							<span className="text-muted-foreground">Recover </span>
							<span className="text-lg font-semibold tabular-nums">
								{usd(impact.minor, impact.currency)}
							</span>
						</p>
					</div>
					<ul className="divide-y border-y text-sm">
						{findings.map((f) => (
							<li
								key={`${f.kind}-${f.lineNo ?? "x"}-${f.paymentId ?? "x"}`}
								className="flex items-start justify-between gap-4 py-3"
							>
								<span className="flex gap-3">
									<span
										aria-hidden
										className={cn(
											"mt-1.5 size-2 shrink-0 rounded-full",
											KIND[f.kind].dot,
										)}
									/>
									<span>
										<span className="block font-medium">
											{KIND[f.kind].label}
										</span>
										<span className="block text-muted-foreground">
											{f.detail}
										</span>
									</span>
								</span>
								<span className="shrink-0 font-medium tabular-nums">
									{usd(f.impactMinor, f.currency)}
								</span>
							</li>
						))}
					</ul>
				</div>
			) : null}

			{unpriced.length > 0 ? (
				<div className="space-y-3 rounded-lg bg-warning/10 p-4">
					<h3 className="text-sm font-medium">
						{unpriced.length} {unpriced.length === 1 ? "line" : "lines"} not
						checked
					</h3>
					<p className="text-sm text-muted-foreground">
						Exact match found no contract price for{" "}
						{unpriced
							.map((u) => `${u.item} (billed per ${u.unit})`)
							.join(", ")}
						. Any overcharge on{" "}
						{unpriced.length === 1 ? "this line is" : "these lines is"} hidden.
					</p>
				</div>
			) : null}

			{status === "clean" ? (
				<p className="text-sm text-muted-foreground">
					Every line matches the contract and the totals add up. Nothing to
					send.
				</p>
			) : null}

			{findings.length > 0 ? (
				<div className="space-y-3">
					<div>
						<h3 className="text-sm font-medium">Message to the vendor</h3>
						<p className="text-sm text-muted-foreground">
							Edit it if you like. Nothing is sent until you approve.
						</p>
					</div>
					<Textarea
						value={approved ? approved.draft : draft}
						onChange={(e) => onDraft(e.target.value)}
						readOnly={Boolean(approved)}
						rows={13}
						className="font-mono text-xs"
					/>
					{approved ? (
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<Check className="size-4 text-success" />
							Approved {new Date(approved.at).toLocaleString()} for{" "}
							{usd(approved.amountMinor, approved.currency)}. The message is now
							locked.
						</div>
					) : (
						<Button size="lg" onClick={() => onApprove(draft)}>
							Approve and queue for {invoice.vendor}
						</Button>
					)}
					{version === "v1" && unpriced.length > 0 ? (
						<p className="text-xs text-muted-foreground">
							This invoice has unchecked lines. Switch to Smart match before
							approving.
						</p>
					) : null}
				</div>
			) : null}
		</section>
	);
}
