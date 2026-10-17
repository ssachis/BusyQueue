import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { FilePlus2, FileText, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { PageBody, PageHeader } from "#/components/app-shell.tsx";
import { localIsoDate } from "#/components/documents/editor/form.ts";
import {
	countByStatus,
	DISPLAY_STATUSES,
	filterRows,
	LIST_SORTS,
	type ListSort,
	SORT_LABEL,
	sortRows,
} from "#/components/documents/list/order.ts";
import {
	DISPLAY_STATUS_LABEL,
	DISPLAY_STATUS_VARIANT,
	formatDate,
	TYPE_LABEL,
} from "#/components/documents/preview/format.ts";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { DOCUMENT_TYPES } from "#/lib/documents/types.ts";
import { formatMoney } from "#/lib/money/index.ts";
import { cn } from "#/lib/utils.ts";
import { getDocumentList } from "#/server/documents/drafts.ts";

const IsoDate = z.iso.date();

const Search = z.object({
	type: z.enum(DOCUMENT_TYPES).optional().catch(undefined),
	status: z.enum(DISPLAY_STATUSES).optional().catch(undefined),
	from: IsoDate.optional().catch(undefined),
	to: IsoDate.optional().catch(undefined),
	q: z.string().max(100).optional().catch(undefined),
	sort: z.enum(LIST_SORTS).optional().catch(undefined),
});
type Search = z.infer<typeof Search>;

export const Route = createFileRoute("/documents/")({
	validateSearch: (search) => Search.parse(search),
	head: () => ({ meta: [{ title: "Documents · BusyQ" }] }),
	// The whole list loads once; filters and sorting run in the page.
	loader: () => getDocumentList({ data: { today: localIsoDate() } }),
	pendingComponent: ListPending,
	component: DocumentList,
});

function ListPending() {
	return (
		<PageBody className="space-y-3">
			<Skeleton className="h-8 w-48" />
			<Skeleton className="h-64 w-full" />
		</PageBody>
	);
}

function FilterChip({
	active,
	label,
	count,
	search,
}: {
	active: boolean;
	label: string;
	count?: number;
	search: Search;
}) {
	return (
		<Link
			to="/documents"
			search={search}
			aria-current={active ? "true" : undefined}
			className={cn(
				"inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
				active
					? "border-primary bg-primary text-primary-foreground"
					: "bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground",
			)}
		>
			{label}
			{count !== undefined ? (
				<span
					className={cn(
						"text-xs tabular-nums",
						active ? "text-primary-foreground/80" : "text-muted-foreground",
					)}
				>
					{count}
				</span>
			) : null}
		</Link>
	);
}

const selectClass =
	"h-9 rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

function DocumentList() {
	const all = Route.useLoaderData();
	const search = Route.useSearch();
	const navigate = useNavigate({ from: "/documents/" });
	const { type, status, from, to, q, sort } = search;
	const [text, setText] = useState(q ?? "");
	// Follow the URL when it changes from outside (Clear filters, back button).
	useEffect(() => setText(q ?? ""), [q]);

	const ofType = useMemo(
		() => (type ? all.filter((r) => r.type === type) : all),
		[all, type],
	);
	const counts = useMemo(() => countByStatus(ofType), [ofType]);
	const rows = useMemo(
		() =>
			sortRows(
				filterRows(all, { type, status, from, to, q }),
				sort ?? "priority",
			),
		[all, type, status, from, to, q, sort],
	);
	const filtered =
		type !== undefined ||
		status !== undefined ||
		from !== undefined ||
		to !== undefined ||
		(q ?? "") !== "";

	const setSearch = (patch: Partial<Search>) =>
		navigate({
			search: (prev) => {
				const next = { ...prev, ...patch };
				for (const k of Object.keys(next) as (keyof Search)[]) {
					if (next[k] === "" || next[k] === undefined) delete next[k];
				}
				return next;
			},
			replace: true,
		});

	return (
		<>
			<PageHeader
				title="Documents"
				description="Invoices, quotes, proformas, credit notes, receipts and delivery notes."
			>
				<Button asChild>
					<Link to="/documents/new">
						<Plus />
						New document
					</Link>
				</Button>
			</PageHeader>
			<PageBody className="space-y-5">
				<div className="space-y-3">
					<nav aria-label="Filter by type" className="flex flex-wrap gap-2">
						<FilterChip
							active={type === undefined}
							label="All types"
							search={{ ...search, type: undefined }}
						/>
						{DOCUMENT_TYPES.map((t) => (
							<FilterChip
								key={t}
								active={type === t}
								label={TYPE_LABEL[t]}
								search={{ ...search, type: t }}
							/>
						))}
					</nav>
					<nav aria-label="Filter by status" className="flex flex-wrap gap-2">
						<FilterChip
							active={status === undefined}
							label="Any status"
							count={ofType.length}
							search={{ ...search, status: undefined }}
						/>
						{DISPLAY_STATUSES.map((s) => (
							<FilterChip
								key={s}
								active={status === s}
								label={DISPLAY_STATUS_LABEL[s]}
								count={counts[s]}
								search={{ ...search, status: s }}
							/>
						))}
					</nav>
					<div className="flex flex-wrap items-end gap-3">
						<label
							htmlFor="doc-search"
							className="space-y-1 text-xs text-muted-foreground"
						>
							<span className="block">Search</span>
							<Input
								id="doc-search"
								type="search"
								value={text}
								placeholder="Number or buyer"
								className="h-9 w-56"
								onChange={(e) => {
									setText(e.target.value);
									void setSearch({ q: e.target.value });
								}}
							/>
						</label>
						<label
							htmlFor="doc-from"
							className="space-y-1 text-xs text-muted-foreground"
						>
							<span className="block">From</span>
							<Input
								id="doc-from"
								type="date"
								value={from ?? ""}
								max={to}
								className="h-9 w-40"
								onChange={(e) => setSearch({ from: e.target.value })}
							/>
						</label>
						<label
							htmlFor="doc-to"
							className="space-y-1 text-xs text-muted-foreground"
						>
							<span className="block">To</span>
							<Input
								id="doc-to"
								type="date"
								value={to ?? ""}
								min={from}
								className="h-9 w-40"
								onChange={(e) => setSearch({ to: e.target.value })}
							/>
						</label>
						<label className="space-y-1 text-xs text-muted-foreground">
							<span className="block">Sort</span>
							<select
								className={selectClass}
								value={sort ?? "priority"}
								onChange={(e) =>
									setSearch({
										sort:
											e.target.value === "priority"
												? undefined
												: (e.target.value as ListSort),
									})
								}
							>
								{LIST_SORTS.map((s) => (
									<option key={s} value={s}>
										{SORT_LABEL[s]}
									</option>
								))}
							</select>
						</label>
						{filtered ? (
							<Button variant="ghost" size="sm" asChild>
								<Link to="/documents" search={sort ? { sort } : {}}>
									<X />
									Clear filters
								</Link>
							</Button>
						) : null}
					</div>
				</div>

				{rows.length === 0 ? (
					<div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
						<FileText className="size-8 text-muted-foreground" />
						<p className="font-medium">
							{filtered
								? "No documents match these filters"
								: "No documents yet"}
						</p>
						<p className="max-w-sm text-sm text-muted-foreground">
							{filtered
								? "Try another type, status or date range."
								: "Create an invoice, quote or any other document. It starts as a draft you can edit freely."}
						</p>
						{filtered ? null : (
							<Button asChild variant="outline">
								<Link to="/documents/new">
									<FilePlus2 />
									New document
								</Link>
							</Button>
						)}
					</div>
				) : (
					<div className="overflow-x-auto rounded-xl border bg-card">
						<table className="w-full min-w-[760px] text-sm">
							<thead>
								<tr className="border-b text-left text-xs tracking-wide text-muted-foreground uppercase">
									<th className="px-4 py-3 font-medium">Number</th>
									<th className="px-4 py-3 font-medium">Type</th>
									<th className="px-4 py-3 font-medium">Buyer</th>
									<th className="px-4 py-3 font-medium">Date</th>
									<th className="px-4 py-3 font-medium">Due</th>
									<th className="px-4 py-3 text-right font-medium">Total</th>
									<th className="px-4 py-3 text-right font-medium">
										Balance due
									</th>
									<th className="px-4 py-3 font-medium">Status</th>
								</tr>
							</thead>
							<tbody>
								{rows.map((r) => (
									<tr
										key={r.id}
										className="relative border-b transition-colors last:border-0 hover:bg-muted/50"
									>
										<td className="px-4 py-3">
											<Link
												to="/documents/$id"
												params={{ id: r.id }}
												className="font-medium outline-none after:absolute after:inset-0 focus-visible:underline"
											>
												{r.number ?? (
													<span className="font-normal text-muted-foreground italic">
														Draft
													</span>
												)}
											</Link>
										</td>
										<td className="px-4 py-3">{TYPE_LABEL[r.type]}</td>
										<td className="max-w-[16rem] truncate px-4 py-3">
											{r.buyerName || (
												<span className="text-muted-foreground">—</span>
											)}
										</td>
										<td className="px-4 py-3 whitespace-nowrap tabular-nums">
											{formatDate(r.date)}
										</td>
										<td
											className={cn(
												"px-4 py-3 whitespace-nowrap tabular-nums",
												r.displayStatus === "overdue"
													? "text-destructive"
													: "text-muted-foreground",
											)}
										>
											{r.dueDate ? formatDate(r.dueDate) : "—"}
										</td>
										<td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
											{r.totalMinor === null ? (
												<span className="text-muted-foreground">—</span>
											) : (
												formatMoney({
													minor: r.totalMinor,
													currency: r.currency,
												})
											)}
										</td>
										<td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
											{r.balanceMinor === null ? (
												<span className="text-muted-foreground">—</span>
											) : (
												<span
													className={cn(
														r.balanceMinor === 0 && "text-muted-foreground",
													)}
												>
													{formatMoney({
														minor: r.balanceMinor,
														currency: r.currency,
													})}
												</span>
											)}
										</td>
										<td className="px-4 py-3">
											<Badge variant={DISPLAY_STATUS_VARIANT[r.displayStatus]}>
												{DISPLAY_STATUS_LABEL[r.displayStatus]}
											</Badge>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
				{rows.length > 0 ? (
					<p className="text-xs text-muted-foreground">
						{rows.length} of {all.length} document
						{all.length === 1 ? "" : "s"}
						{sort && sort !== "priority"
							? ` · ${SORT_LABEL[sort].toLowerCase()}`
							: " · overdue first, then unpaid by due date, then drafts, then paid and void"}
					</p>
				) : null}
			</PageBody>
		</>
	);
}
