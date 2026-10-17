/**
 * Ordering, filtering and counting for the review page's bill list. Pure:
 * no I/O, no React, so it is unit-tested on its own.
 *
 * Default order puts what needs a person first: flagged bills (largest
 * recoverable amount first), then bills that couldn't be fully checked,
 * failed analyses, approved disputes, clean bills, and bills not analysed yet.
 */
import { normalizeVendor } from "#/lib/rules/aliases.ts";

/** The fields of a review row this module reads (a subset of `InvoiceRow`). */
export interface ReviewRowLike {
	id: string;
	invoiceNumber: string;
	vendor: string;
	issueDate: string;
	run: {
		status: "running" | "completed" | "failed";
		totalMinor: number;
		failedTools: number;
		toolLogged: boolean;
		approved: boolean;
	} | null;
}

export const REVIEW_STATUSES = [
	"flagged",
	"unchecked",
	"failed",
	"approved",
	"running",
	"rerun",
	"clean",
	"not_run",
] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export const STATUS_LABEL: Record<ReviewStatus, string> = {
	flagged: "Flagged",
	unchecked: "Couldn't check",
	failed: "Analysis failed",
	approved: "Dispute approved",
	running: "Running",
	rerun: "Re-run",
	clean: "Clean",
	not_run: "Not analysed",
};

export const STATUS_VARIANT: Record<
	ReviewStatus,
	"destructive" | "warning" | "success" | "info" | "outline"
> = {
	flagged: "destructive",
	unchecked: "warning",
	failed: "destructive",
	approved: "info",
	running: "info",
	rerun: "outline",
	clean: "success",
	not_run: "outline",
};

/** One status per row, from its latest analysis. */
export function reviewStatus(r: ReviewRowLike): ReviewStatus {
	const run = r.run;
	if (!run) return "not_run";
	if (run.status === "failed") return "failed";
	if (run.status === "running") return "running";
	if (run.approved) return "approved";
	if (run.totalMinor > 0) return "flagged";
	if (run.failedTools > 0) return "unchecked";
	if (!run.toolLogged) return "rerun";
	return "clean";
}

const RANK: Record<ReviewStatus, number> = Object.fromEntries(
	REVIEW_STATUSES.map((s, i) => [s, i]),
) as Record<ReviewStatus, number>;

export const SORT_KEYS = ["priority", "amount", "date", "vendor"] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export const SORT_LABEL: Record<SortKey, string> = {
	priority: "Needs attention",
	amount: "Amount to recover",
	date: "Newest bill",
	vendor: "Vendor A–Z",
};

const amount = (r: ReviewRowLike) => r.run?.totalMinor ?? 0;

/** Stable tie-breakers: newest bill first, then bill number, then id. */
function byDateDesc(a: ReviewRowLike, b: ReviewRowLike): number {
	return (
		b.issueDate.localeCompare(a.issueDate) ||
		a.invoiceNumber.localeCompare(b.invoiceNumber) ||
		a.id.localeCompare(b.id)
	);
}

const COMPARE: Record<SortKey, (a: ReviewRowLike, b: ReviewRowLike) => number> =
	{
		priority: (a, b) =>
			RANK[reviewStatus(a)] - RANK[reviewStatus(b)] ||
			amount(b) - amount(a) ||
			byDateDesc(a, b),
		amount: (a, b) =>
			amount(b) - amount(a) ||
			RANK[reviewStatus(a)] - RANK[reviewStatus(b)] ||
			byDateDesc(a, b),
		date: (a, b) =>
			byDateDesc(a, b) || RANK[reviewStatus(a)] - RANK[reviewStatus(b)],
		vendor: (a, b) =>
			a.vendor.localeCompare(b.vendor, "en", { sensitivity: "base" }) ||
			byDateDesc(a, b),
	};

/** A sorted copy; the input is not changed. */
export function sortRows<T extends ReviewRowLike>(
	rows: readonly T[],
	key: SortKey = "priority",
): T[] {
	return [...rows].sort(COMPARE[key]);
}

/** Vendors grouped by their normalised name ("ACME FREIGHT INC" = "Acme Freight"). */
export interface VendorOption {
	key: string;
	/** A full-name spelling, the most common first (ties: alphabetical). */
	label: string;
	count: number;
}

export function vendorKey(vendor: string): string {
	return normalizeVendor(vendor) || vendor.trim().toLowerCase();
}

/**
 * Normalised name → group key. A short name whose words start exactly one
 * longer name ("valley fresh" → "valley fresh produce") joins that group;
 * when it starts several, it stays on its own rather than guess.
 */
export function vendorGroups(vendors: readonly string[]): Map<string, string> {
	// Longest first, so every longer name already knows its own group.
	const keys = [...new Set(vendors.map(vendorKey))].sort(
		(a, b) => b.length - a.length || a.localeCompare(b),
	);
	const groups = new Map<string, string>();
	for (const key of keys) {
		const prefix = `${key} `;
		const targets = new Set(
			keys.filter((k) => k.startsWith(prefix)).map((k) => groups.get(k) ?? k),
		);
		const [only] = targets;
		groups.set(key, targets.size === 1 && only ? only : key);
	}
	return groups;
}

export function vendorOptions(rows: readonly ReviewRowLike[]): VendorOption[] {
	const groupOf = vendorGroups(rows.map((r) => r.vendor));
	const groups = new Map<string, Map<string, number>>();
	for (const r of rows) {
		const raw = vendorKey(r.vendor);
		const key = groupOf.get(raw) ?? raw;
		const spellings = groups.get(key) ?? new Map<string, number>();
		spellings.set(r.vendor, (spellings.get(r.vendor) ?? 0) + 1);
		groups.set(key, spellings);
	}
	return [...groups.entries()]
		.map(([key, spellings]) => {
			// Prefer a full-name spelling, then the most common, then A–Z.
			const full = (s: string) => (vendorKey(s) === key ? 0 : 1);
			const [label] = [...spellings.entries()].sort(
				(a, b) =>
					full(a[0]) - full(b[0]) ||
					b[1] - a[1] ||
					a[0].localeCompare(b[0], "en"),
			)[0] ?? [key];
			const count = [...spellings.values()].reduce((n, c) => n + c, 0);
			return { key, label, count };
		})
		.sort((a, b) => a.label.localeCompare(b.label, "en"));
}

export interface ReviewFilter {
	status?: ReviewStatus;
	/** A vendor group key (`VendorOption.key`). */
	vendor?: string;
	/** Free text matched against bill number, vendor and id. */
	q?: string;
}

function matchesText(r: ReviewRowLike, q: string): boolean {
	const needle = q.trim().toLowerCase();
	if (!needle) return true;
	return [r.invoiceNumber, r.vendor, r.id].some((f) =>
		f.toLowerCase().includes(needle),
	);
}

export interface FilteredRows<T> {
	rows: T[];
	/**
	 * Rows per status after the vendor and text filters (not the status
	 * filter), so the status chips show what each choice would leave.
	 */
	counts: Record<ReviewStatus, number>;
	/** Rows after the vendor and text filters. */
	total: number;
	/** Recoverable amount on the rows shown, minor units. */
	shownMinor: number;
}

export function emptyCounts(): Record<ReviewStatus, number> {
	return Object.fromEntries(REVIEW_STATUSES.map((s) => [s, 0])) as Record<
		ReviewStatus,
		number
	>;
}

/** Filter, count and sort in one pass for the list. */
export function filterRows<T extends ReviewRowLike>(
	rows: readonly T[],
	filter: ReviewFilter,
	sort: SortKey = "priority",
): FilteredRows<T> {
	const counts = emptyCounts();
	const groupOf = filter.vendor
		? vendorGroups(rows.map((r) => r.vendor))
		: new Map<string, string>();
	const inVendor = (r: ReviewRowLike) => {
		const raw = vendorKey(r.vendor);
		return (groupOf.get(raw) ?? raw) === filter.vendor;
	};
	const narrowed = rows.filter(
		(r) => (!filter.vendor || inVendor(r)) && matchesText(r, filter.q ?? ""),
	);
	for (const r of narrowed) counts[reviewStatus(r)] += 1;
	const shown = filter.status
		? narrowed.filter((r) => reviewStatus(r) === filter.status)
		: narrowed;
	return {
		rows: sortRows(shown, sort),
		counts,
		total: narrowed.length,
		shownMinor: shown.reduce((n, r) => n + amount(r), 0),
	};
}

/**
 * The bill to open when none is chosen: the first one in priority order
 * (largest flagged amount), or null for an empty list.
 */
export function defaultSelection(
	rows: readonly ReviewRowLike[],
): string | null {
	return sortRows(rows, "priority")[0]?.id ?? null;
}
