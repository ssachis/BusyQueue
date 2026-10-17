import { Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatDate } from "#/components/documents/preview/format.ts";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { cn } from "#/lib/utils.ts";
import type { InvoiceRow } from "#/server/review-store.ts";
import { money, plural } from "./format.ts";
import {
	filterRows,
	REVIEW_STATUSES,
	type ReviewFilter,
	type ReviewStatus,
	reviewStatus,
	SORT_KEYS,
	SORT_LABEL,
	type SortKey,
	STATUS_LABEL,
	STATUS_VARIANT,
	vendorOptions,
} from "./order.ts";

/** Statuses that always get a chip, even at zero, so the list reads the same. */
const ALWAYS_SHOWN: ReadonlySet<ReviewStatus> = new Set([
	"flagged",
	"unchecked",
	"clean",
	"not_run",
]);

const selectClass =
	"h-9 rounded-md border border-input bg-background px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

export interface BillListState extends ReviewFilter {
	sort?: SortKey;
}

export function BillList({
	rows,
	currency,
	selectedId,
	state,
	onChange,
	onSelect,
}: {
	rows: InvoiceRow[];
	currency: string;
	selectedId: string | null;
	state: BillListState;
	onChange: (next: BillListState) => void;
	onSelect: (id: string) => void;
}) {
	const sort = state.sort ?? "priority";
	const vendors = useMemo(() => vendorOptions(rows), [rows]);
	const view = useMemo(
		() => filterRows(rows, state, sort),
		[rows, state, sort],
	);
	const sortId = useId();
	const vendorId = useId();
	const searchId = useId();

	// Type freely; the URL catches up after a short pause. Only take the URL's
	// value when it changed from elsewhere (back button, "Clear filters").
	const [q, setQ] = useState(state.q ?? "");
	const pushed = useRef(state.q ?? "");
	useEffect(() => {
		const fromUrl = state.q ?? "";
		if (fromUrl === pushed.current) return;
		pushed.current = fromUrl;
		setQ(fromUrl);
	}, [state.q]);
	useEffect(() => {
		if (q === pushed.current) return;
		const t = setTimeout(() => {
			pushed.current = q;
			onChange({ ...state, q: q || undefined });
		}, 200);
		return () => clearTimeout(t);
	}, [q, state, onChange]);

	const filtered = Boolean(state.status || state.vendor || state.q);

	// Keep the open bill visible inside the list (not the page) when it changes.
	const listRef = useRef<HTMLUListElement>(null);
	useEffect(() => {
		const list = listRef.current;
		if (!list || !selectedId) return;
		const item = list.querySelector<HTMLElement>("[aria-current='true']");
		if (!item) return;
		// The list is `relative`, so offsetTop is measured from its top.
		const top = item.offsetTop;
		if (
			top < list.scrollTop ||
			top + item.offsetHeight > list.scrollTop + list.clientHeight
		) {
			list.scrollTop = Math.max(0, top - list.clientHeight / 3);
		}
	}, [selectedId]);

	return (
		<section
			aria-label="Bills"
			className="flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card shadow-sm"
		>
			<div className="space-y-3 border-b bg-card px-4 pt-4 pb-3">
				<div className="flex items-baseline justify-between gap-2">
					<h2 className="font-semibold">Bills</h2>
					<p className="text-xs text-muted-foreground tabular-nums">
						{view.rows.length === view.total
							? plural(view.total, "bill")
							: `${view.rows.length} of ${plural(view.total, "bill")}`}
						{view.shownMinor > 0
							? ` · ${money(view.shownMinor, currency)} to recover`
							: ""}
					</p>
				</div>
				<div className="relative">
					<label htmlFor={searchId} className="sr-only">
						Search bills
					</label>
					<Search
						aria-hidden
						className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						id={searchId}
						type="search"
						placeholder="Search bill number or vendor"
						value={q}
						onChange={(e) => setQ(e.target.value)}
						className="pl-8"
					/>
				</div>
				<div className="grid grid-cols-2 gap-2">
					<div className="flex min-w-0 flex-col gap-1">
						<label htmlFor={sortId} className="text-xs text-muted-foreground">
							Sort by
						</label>
						<select
							id={sortId}
							className={selectClass}
							value={sort}
							onChange={(e) =>
								onChange({
									...state,
									sort:
										e.target.value === "priority"
											? undefined
											: (e.target.value as SortKey),
								})
							}
						>
							{SORT_KEYS.map((k) => (
								<option key={k} value={k}>
									{SORT_LABEL[k]}
								</option>
							))}
						</select>
					</div>
					<div className="flex min-w-0 flex-col gap-1">
						<label htmlFor={vendorId} className="text-xs text-muted-foreground">
							Vendor
						</label>
						<select
							id={vendorId}
							className={cn(selectClass, "min-w-0")}
							value={state.vendor ?? ""}
							onChange={(e) =>
								onChange({ ...state, vendor: e.target.value || undefined })
							}
						>
							<option value="">All vendors</option>
							{vendors.map((v) => (
								<option key={v.key} value={v.key}>
									{v.label} ({v.count})
								</option>
							))}
						</select>
					</div>
				</div>
				<fieldset className="flex flex-wrap gap-1.5">
					<legend className="sr-only">Status</legend>
					<StatusChip
						active={!state.status}
						label="All"
						count={view.total}
						onClick={() => onChange({ ...state, status: undefined })}
					/>
					{REVIEW_STATUSES.filter(
						(s) => ALWAYS_SHOWN.has(s) || view.counts[s] > 0,
					).map((s) => (
						<StatusChip
							key={s}
							active={state.status === s}
							label={STATUS_LABEL[s]}
							count={view.counts[s]}
							onClick={() =>
								onChange({
									...state,
									status: state.status === s ? undefined : s,
								})
							}
						/>
					))}
				</fieldset>
			</div>

			{view.rows.length === 0 ? (
				<div className="space-y-3 px-4 py-10 text-center text-sm text-muted-foreground">
					<p>
						{rows.length === 0
							? "No vendor bills yet. Import a bill to start checking it."
							: "No bills match these filters."}
					</p>
					{filtered ? (
						<Button
							variant="outline"
							size="sm"
							onClick={() => {
								setQ("");
								pushed.current = "";
								onChange({ sort: state.sort });
							}}
						>
							<X />
							Clear filters
						</Button>
					) : null}
				</div>
			) : (
				<ul
					ref={listRef}
					className="relative min-h-0 flex-1 divide-y overflow-y-auto"
				>
					{view.rows.map((r) => {
						const st = reviewStatus(r);
						const amount = r.run?.totalMinor ?? 0;
						const selected = selectedId === r.id;
						return (
							<li key={r.id}>
								<button
									type="button"
									onClick={() => onSelect(r.id)}
									aria-current={selected ? "true" : undefined}
									className={cn(
										"relative flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none",
										selected && "bg-accent",
									)}
								>
									{selected ? (
										<span
											aria-hidden
											className="absolute inset-y-0 left-0 w-0.5 bg-primary"
										/>
									) : null}
									<span className="min-w-0">
										<span className="block truncate font-medium">
											{r.invoiceNumber}
										</span>
										<span className="block truncate text-xs text-muted-foreground">
											{r.vendor} · {formatDate(r.issueDate)}
										</span>
									</span>
									<span className="flex shrink-0 flex-col items-end gap-1">
										<Badge variant={STATUS_VARIANT[st]}>
											{STATUS_LABEL[st]}
										</Badge>
										{amount > 0 ? (
											<span className="text-xs font-medium tabular-nums">
												{money(amount, currency)}
											</span>
										) : null}
									</span>
								</button>
							</li>
						);
					})}
				</ul>
			)}
		</section>
	);
}

function StatusChip({
	active,
	label,
	count,
	onClick,
}: {
	active: boolean;
	label: string;
	count: number;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={active}
			onClick={onClick}
			className={cn(
				"inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
				active
					? "border-primary bg-primary text-primary-foreground"
					: "bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground",
			)}
		>
			{label}
			<span
				className={cn(
					"tabular-nums",
					active ? "text-primary-foreground/80" : "text-foreground/70",
				)}
			>
				{count}
			</span>
		</button>
	);
}
