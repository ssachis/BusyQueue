import { createLink, Link } from "@tanstack/react-router";
import {
	ArrowRight,
	ArrowUpRight,
	BellRing,
	CircleAlert,
	Clock,
	FilePen,
	FilePlus2,
	FileScan,
	FileText,
	Info,
	type LucideIcon,
	PlayCircle,
	ScanSearch,
	TriangleAlert,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { PageBody, PageHeader } from "#/components/app-shell.tsx";
import {
	formatDate,
	TYPE_LABEL,
} from "#/components/documents/preview/format.ts";
import { SubjectLink } from "#/components/reminders/subject-link.tsx";
import { money, plural } from "#/components/review/format.ts";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import type { DocumentType } from "#/lib/documents/types.ts";
import type { Severity } from "#/lib/reminders/types.ts";
import { cn } from "#/lib/utils.ts";
import type {
	ActivityItem,
	AuditCard,
	CashCard,
	DashboardData,
	ReceivablesCard,
	RemindersCard,
	Section,
} from "#/server/dashboard-store.ts";

const when = (iso: string) =>
	`${formatDate(iso.slice(0, 10))} · ${iso.slice(11, 16)} UTC`;

export function DashboardPage({ data }: { data: DashboardData }) {
	return (
		<>
			<PageHeader
				title="Dashboard"
				description={
					<>
						<span className="font-medium text-foreground">
							{data.businessName}
						</span>{" "}
						· money found in vendor bills, cash coming due, and what needs you
						today. Every number is calculated by code.
					</>
				}
			>
				<Button asChild>
					<Link to="/review">
						<PlayCircle />
						Run audit
					</Link>
				</Button>
				<Button asChild variant="outline">
					<Link to="/documents/new">
						<FilePlus2 />
						New invoice
					</Link>
				</Button>
				<Button asChild variant="outline">
					<Link to="/import">
						<FileScan />
						Import bill
					</Link>
				</Button>
			</PageHeader>
			<PageBody className="space-y-6">
				<div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
					<Load
						section={data.audit}
						title="Billing mistakes"
						className="lg:col-span-2"
					>
						{(audit) => <AuditPanel audit={audit} />}
					</Load>
					<Load section={data.reminders} title="Reminders">
						{(r) => <RemindersPanel reminders={r} />}
					</Load>
				</div>
				<div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
					<Load section={data.cash} title="Cash out, next 30 days">
						{(cash) => <CashOutPanel cash={cash} />}
					</Load>
					<Load section={data.receivables} title="Owed to you">
						{(rec) => (
							<ReceivablesPanel
								receivables={rec}
								cashIn={data.cash.ok ? data.cash.data : null}
							/>
						)}
					</Load>
					<QuickActions />
				</div>
				<Load section={data.activity} title="Recent activity">
					{(items) => <ActivityPanel items={items} />}
				</Load>
			</PageBody>
		</>
	);
}

// ── Building blocks ───────────────────────────────────────────────────

function Panel({
	title,
	icon: Icon,
	action,
	className,
	children,
}: {
	title: string;
	icon?: LucideIcon;
	action?: ReactNode;
	className?: string;
	children: ReactNode;
}) {
	return (
		<section
			aria-label={title}
			className={cn(
				"flex flex-col rounded-xl border bg-card p-5 text-card-foreground shadow-sm",
				className,
			)}
		>
			<div className="mb-4 flex items-center justify-between gap-3">
				<h2 className="flex items-center gap-2 text-sm font-semibold">
					{Icon ? <Icon className="size-4 text-primary" /> : null}
					{title}
				</h2>
				{action}
			</div>
			<div className="flex flex-1 flex-col">{children}</div>
		</section>
	);
}

function Load<T>({
	section,
	title,
	className,
	children,
}: {
	section: Section<T>;
	title: string;
	className?: string;
	children: (data: T) => ReactNode;
}) {
	if (section.ok)
		return (
			<div className={cn("min-w-0", className)}>{children(section.data)}</div>
		);
	return (
		<Panel title={title} className={className}>
			<p className="flex items-start gap-2 text-sm text-destructive">
				<TriangleAlert className="mt-0.5 size-4 shrink-0" />
				Couldn't load this card: {section.error}
			</p>
		</Panel>
	);
}

/** A small "see more" anchor; `createLink` keeps `to`/`search` fully typed. */
function MoreAnchor({ children, className, ...props }: ComponentProps<"a">) {
	return (
		<a
			{...props}
			className={cn(
				"inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline",
				className,
			)}
		>
			{children}
			<ArrowRight className="size-3.5" />
		</a>
	);
}

const MoreLink = createLink(MoreAnchor);

function Empty({ children }: { children: ReactNode }) {
	return (
		<p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
			{children}
		</p>
	);
}

// ── Cards ─────────────────────────────────────────────────────────────

function AuditPanel({ audit }: { audit: AuditCard }) {
	const found = audit.recoverableMinor + audit.orphanMinor;
	const { currency } = audit;
	return (
		<Panel
			title="Billing mistakes found"
			icon={ScanSearch}
			action={<MoreLink to="/review">Review bills</MoreLink>}
			className="h-full"
		>
			{audit.checked === 0 ? (
				<Empty>
					No vendor bills checked yet. Import a bill, or open{" "}
					<Link to="/review" className="text-primary underline">
						Review bills
					</Link>{" "}
					and check one against your agreed prices.
				</Empty>
			) : (
				<div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
					<div className="space-y-4">
						<div>
							<div className="text-4xl font-semibold tracking-tighter tabular-nums sm:text-5xl">
								{money(found, currency)}
							</div>
							<p className="mt-1 text-sm text-muted-foreground">
								to recover from {plural(audit.flagged, "bill")}
								{audit.orphanMinor > 0 ? " and payments with no bill" : ""}
							</p>
						</div>
						<dl className="grid grid-cols-2 gap-3 text-sm">
							<Figure
								label="Awaiting approval"
								value={money(audit.awaitingMinor, currency)}
								note={plural(audit.awaitingApproval, "bill")}
								tone={audit.awaitingApproval > 0 ? "warning" : undefined}
							/>
							<Figure
								label="Disputes approved"
								value={money(audit.approvedMinor, currency)}
								note={plural(audit.approved, "bill")}
							/>
							<Figure
								label="Bills checked"
								value={`${audit.checked} of ${audit.bills}`}
								note={
									audit.partlyChecked > 0
										? `${audit.partlyChecked} only partly`
										: "all lines checked"
								}
							/>
							<Figure
								label="Paid with no bill"
								value={money(audit.orphanMinor, currency)}
								note={plural(audit.orphans, "payment")}
							/>
						</dl>
					</div>
					<div className="space-y-2">
						<h3 className="text-xs font-medium text-muted-foreground">
							Largest open disputes
						</h3>
						{audit.top.length === 0 ? (
							<Empty>Every flagged bill has an approved dispute.</Empty>
						) : (
							<ul className="divide-y rounded-lg border">
								{audit.top.map((b) => (
									<li key={b.id}>
										<Link
											to="/review"
											search={{ invoice: b.id }}
											className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-accent/60"
										>
											<span className="min-w-0">
												<span className="block truncate font-medium">
													{b.invoiceNumber}
												</span>
												<span className="block truncate text-xs text-muted-foreground">
													{b.vendor}
												</span>
											</span>
											<span className="flex shrink-0 items-center gap-2 font-medium tabular-nums">
												{money(b.amountMinor, currency)}
												<ArrowUpRight className="size-3.5 text-muted-foreground" />
											</span>
										</Link>
									</li>
								))}
							</ul>
						)}
						{audit.awaitingApproval > audit.top.length ? (
							<MoreLink to="/review" search={{ status: "flagged" }}>
								All {audit.awaitingApproval} flagged bills
							</MoreLink>
						) : null}
					</div>
				</div>
			)}
		</Panel>
	);
}

function Figure({
	label,
	value,
	note,
	tone,
}: {
	label: string;
	value: string;
	note?: string;
	tone?: "warning";
}) {
	return (
		<div
			className={cn(
				"min-w-0 rounded-lg border px-3 py-2",
				tone === "warning" && "border-warning/40 bg-warning/5",
			)}
		>
			<dt className="truncate text-xs text-muted-foreground">{label}</dt>
			<dd className="font-semibold tabular-nums">{value}</dd>
			{note ? (
				<dd className="truncate text-xs text-muted-foreground">{note}</dd>
			) : null}
		</div>
	);
}

const SEVERITY: Record<
	Severity,
	{ icon: LucideIcon; tone: string; label: string }
> = {
	critical: { icon: CircleAlert, tone: "text-destructive", label: "Act now" },
	warning: { icon: Clock, tone: "text-warning", label: "Coming up" },
	info: { icon: Info, tone: "text-info", label: "For your information" },
};

function RemindersPanel({ reminders }: { reminders: RemindersCard }) {
	return (
		<Panel
			title="Reminders"
			icon={BellRing}
			action={
				reminders.open > 0 ? (
					<Badge variant="warning" className="tabular-nums">
						{reminders.open} open
					</Badge>
				) : null
			}
			className="h-full"
		>
			{reminders.top.length === 0 ? (
				<Empty>
					Nothing needs you right now. Reminders appear when a contract nears
					its notice date or a bill or invoice comes due.
				</Empty>
			) : (
				<ul className="space-y-3">
					{reminders.top.map((r) => {
						const s = SEVERITY[r.severity];
						return (
							<li key={r.id} className="flex gap-3">
								<s.icon
									aria-label={s.label}
									className={cn("mt-0.5 size-4 shrink-0", s.tone)}
								/>
								<div className="min-w-0 space-y-0.5 text-sm">
									<SubjectLink
										type={r.subjectType}
										id={r.subjectId}
										className="block truncate font-medium hover:underline"
									>
										{r.title}
									</SubjectLink>
									<p className="line-clamp-2 text-xs text-muted-foreground">
										{r.detail}
									</p>
								</div>
							</li>
						);
					})}
				</ul>
			)}
			<div className="mt-auto pt-4">
				<MoreLink to="/reminders">
					{reminders.open > reminders.top.length
						? `All ${reminders.open} reminders`
						: "Open reminders"}
				</MoreLink>
			</div>
		</Panel>
	);
}

function Range({
	expected,
	low,
	high,
	currency,
}: {
	expected: number;
	low: number;
	high: number;
	currency: string;
}) {
	return (
		<>
			<div className="text-3xl font-semibold tracking-tight tabular-nums">
				{money(expected, currency)}
			</div>
			{low !== high ? (
				<p className="text-xs text-muted-foreground tabular-nums">
					likely between {money(low, currency)} and {money(high, currency)}
				</p>
			) : null}
		</>
	);
}

function CashOutPanel({ cash }: { cash: CashCard }) {
	const currency = cash.currency ?? "USD";
	return (
		<Panel
			title={`Cash out, next ${cash.days} days`}
			icon={ArrowUpRight}
			className="h-full"
		>
			{cash.out.expectedMinor === 0 && cash.billsDue === 0 ? (
				<Empty>
					No vendor bills expected to be paid in the next {cash.days} days.
				</Empty>
			) : (
				<div className="space-y-2">
					<Range
						expected={cash.out.expectedMinor}
						low={cash.out.lowMinor}
						high={cash.out.highMinor}
						currency={currency}
					/>
					<p className="text-sm text-muted-foreground">
						{plural(cash.billsDue, "vendor bill")} expected to be paid
						{cash.billsPastDue > 0 ? (
							<span className="text-destructive">
								{" "}
								· {cash.billsPastDue} already past due
							</span>
						) : null}
					</p>
				</div>
			)}
			<div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
				<span className="text-xs text-muted-foreground">
					{formatDate(cash.asOf)} to {formatDate(cash.lastDate)}
					{cash.asOfIsDataDate ? " (from the latest bill)" : ""}
				</span>
				<MoreLink to="/projections">Projections</MoreLink>
			</div>
		</Panel>
	);
}

function ReceivablesPanel({
	receivables,
	cashIn,
}: {
	receivables: ReceivablesCard;
	cashIn: CashCard | null;
}) {
	const [main, ...others] = receivables.totals;
	return (
		<Panel title="Owed to you" icon={FileText} className="h-full">
			{!main || main.open === 0 ? (
				<Empty>
					Nothing is owed to you yet.{" "}
					<Link to="/documents/new" className="text-primary underline">
						Issue an invoice
					</Link>{" "}
					and its unpaid balance shows here.
				</Empty>
			) : (
				<div className="space-y-2">
					<div className="text-3xl font-semibold tracking-tight tabular-nums">
						{money(main.balanceMinor, main.currency)}
					</div>
					<p className="text-sm text-muted-foreground">
						on {plural(main.open, "issued invoice")}
						{main.overdue > 0 ? (
							<span className="text-destructive">
								{" "}
								· {money(main.overdueMinor, main.currency)} overdue
							</span>
						) : null}
					</p>
					{others.map((o) => (
						<p key={o.currency} className="text-xs text-muted-foreground">
							Also {money(o.balanceMinor, o.currency)} on{" "}
							{plural(o.open, "invoice")} in {o.currency}
						</p>
					))}
				</div>
			)}
			<div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4">
				<span className="text-xs text-muted-foreground tabular-nums">
					{cashIn?.currency
						? `Expected in, next ${cashIn.days} days: ${money(cashIn.in.expectedMinor, cashIn.currency)}`
						: `${plural(receivables.issued, "invoice")} issued`}
				</span>
				<MoreLink
					to="/documents"
					search={{ type: "invoice", status: "issued" }}
				>
					Invoices
				</MoreLink>
			</div>
		</Panel>
	);
}

const ACTIONS: {
	to: "/review" | "/documents/new" | "/import" | "/import-document";
	label: string;
	hint: string;
	icon: LucideIcon;
}[] = [
	{
		to: "/review",
		label: "Run audit",
		hint: "Check vendor bills against agreed prices",
		icon: PlayCircle,
	},
	{
		to: "/import",
		label: "Import bill",
		hint: "Read a vendor bill from a photo or PDF",
		icon: FileScan,
	},
	{
		to: "/documents/new",
		label: "New invoice",
		hint: "Bill a client from your item list",
		icon: FilePlus2,
	},
	{
		to: "/import-document",
		label: "Import document",
		hint: "Turn a paper invoice or quote into a draft",
		icon: FilePen,
	},
];

function QuickActions() {
	return (
		<Panel title="Quick actions" className="h-full md:col-span-2 lg:col-span-1">
			<ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
				{ACTIONS.map((a) => (
					<li key={a.to}>
						<Link
							to={a.to}
							className="group flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors hover:border-primary/40 hover:bg-accent/50"
						>
							<span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
								<a.icon className="size-4" />
							</span>
							<span className="min-w-0">
								<span className="block text-sm font-medium">{a.label}</span>
								<span className="block truncate text-xs text-muted-foreground">
									{a.hint}
								</span>
							</span>
						</Link>
					</li>
				))}
			</ul>
		</Panel>
	);
}

const IMPORT_STATUS: Record<string, string> = {
	uploaded: "uploaded",
	extracted: "read, waiting for a check",
	failed: "couldn't be read",
	saved: "saved as a bill",
	created: "turned into a draft",
};

function ActivityRow({ item }: { item: ActivityItem }) {
	switch (item.kind) {
		case "check":
			return (
				<Row
					icon={ScanSearch}
					at={item.at}
					title={
						<Link
							to="/review"
							search={{ invoice: item.invoiceId }}
							className="font-medium hover:underline"
						>
							Checked bill {item.invoiceNumber ?? item.invoiceId}
						</Link>
					}
					detail={[
						item.vendor,
						item.status === "failed"
							? "analysis failed"
							: item.status === "running"
								? "still running"
								: item.amountMinor === null
									? null
									: item.amountMinor > 0
										? `${money(item.amountMinor, item.currency)} to recover`
										: "no mistakes found",
					]}
					tone={
						item.status === "failed"
							? "destructive"
							: (item.amountMinor ?? 0) > 0
								? "warning"
								: undefined
					}
				/>
			);
		case "document":
			return (
				<Row
					icon={FileText}
					at={item.at}
					title={
						<Link
							to="/documents/$id"
							params={{ id: item.documentId }}
							className="font-medium hover:underline"
						>
							Issued {TYPE_LABEL[item.type as DocumentType] ?? item.type}{" "}
							{item.number ?? ""}
						</Link>
					}
					detail={[
						item.buyerName,
						item.totalMinor === null
							? null
							: money(item.totalMinor, item.currency),
					]}
				/>
			);
		case "bill_import":
			return (
				<Row
					icon={FileScan}
					at={item.at}
					title={
						item.invoiceId ? (
							<Link
								to="/review"
								search={{ invoice: item.invoiceId }}
								className="font-medium hover:underline"
							>
								Imported bill {item.filename}
							</Link>
						) : (
							<Link to="/import" className="font-medium hover:underline">
								Imported bill {item.filename}
							</Link>
						)
					}
					detail={[IMPORT_STATUS[item.status] ?? item.status]}
					tone={item.status === "failed" ? "destructive" : undefined}
				/>
			);
		case "document_import":
			return (
				<Row
					icon={FilePen}
					at={item.at}
					title={
						item.documentId ? (
							<Link
								to="/documents/$id"
								params={{ id: item.documentId }}
								className="font-medium hover:underline"
							>
								Imported document {item.filename}
							</Link>
						) : (
							<Link
								to="/import-document"
								className="font-medium hover:underline"
							>
								Imported document {item.filename}
							</Link>
						)
					}
					detail={[IMPORT_STATUS[item.status] ?? item.status]}
					tone={item.status === "failed" ? "destructive" : undefined}
				/>
			);
	}
}

function Row({
	icon: Icon,
	at,
	title,
	detail,
	tone,
}: {
	icon: LucideIcon;
	at: string;
	title: ReactNode;
	detail: (string | null)[];
	tone?: "warning" | "destructive";
}) {
	return (
		<li className="flex items-start gap-3 py-2.5">
			<span
				className={cn(
					"mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground",
					tone === "warning" && "bg-warning/15 text-warning",
					tone === "destructive" && "bg-destructive/10 text-destructive",
				)}
			>
				<Icon className="size-3.5" />
			</span>
			<div className="min-w-0 flex-1 text-sm">
				<div className="truncate">{title}</div>
				<p className="truncate text-xs text-muted-foreground">
					{detail.filter(Boolean).join(" · ")}
				</p>
				<p className="text-xs text-muted-foreground tabular-nums sm:hidden">
					{when(at)}
				</p>
			</div>
			<time
				dateTime={at}
				className="hidden shrink-0 pt-0.5 text-xs text-muted-foreground tabular-nums sm:block"
			>
				{when(at)}
			</time>
		</li>
	);
}

function ActivityPanel({ items }: { items: ActivityItem[] }) {
	return (
		<Panel title="Recent activity" icon={Clock}>
			{items.length === 0 ? (
				<Empty>
					Nothing has happened yet. Checked bills, issued invoices and imports
					will show up here.
				</Empty>
			) : (
				<ul className="divide-y">
					{items.map((item) => (
						<ActivityRow key={item.id} item={item} />
					))}
				</ul>
			)}
		</Panel>
	);
}
