/**
 * Documents list: filtering and ordering. Pure (no I/O, no clock), so the
 * route and the tests share it. Amounts are compared as integer minor units
 * within one currency; nothing here does money arithmetic.
 */
import type {
	DisplayStatus,
	DocumentStatus,
	DocumentType,
} from "#/lib/documents/types.ts";

export const DISPLAY_STATUSES = [
	"overdue",
	"partially_paid",
	"issued",
	"draft",
	"paid",
	"void",
] as const satisfies readonly DisplayStatus[];

export const LIST_SORTS = [
	"priority",
	"date_desc",
	"date_asc",
	"due_asc",
	"amount_desc",
	"amount_asc",
	"balance_desc",
] as const;
export type ListSort = (typeof LIST_SORTS)[number];

export const SORT_LABEL: Record<ListSort, string> = {
	priority: "Needs attention first",
	date_desc: "Newest first",
	date_asc: "Oldest first",
	due_asc: "Due soonest",
	amount_desc: "Largest total",
	amount_asc: "Smallest total",
	balance_desc: "Largest balance due",
};

/** The fields ordering and filtering need (a subset of the list row). */
export interface ListRowLike {
	id: string;
	type: DocumentType;
	status: DocumentStatus;
	displayStatus: DisplayStatus;
	number: string | null;
	buyerName: string;
	date: string;
	dueDate: string | null;
	currency: string;
	totalMinor: number | null;
	/** Still owed; null when the document doesn't take payments or isn't issued. */
	balanceMinor: number | null;
	updatedAt: string;
}

export interface ListFilter {
	type?: DocumentType;
	status?: DisplayStatus;
	/** Inclusive ISO dates on the document date. */
	from?: string;
	to?: string;
	/** Free text over number and buyer. */
	q?: string;
}

export function filterRows<T extends ListRowLike>(
	rows: readonly T[],
	f: ListFilter,
): T[] {
	const q = f.q?.trim().toLowerCase() ?? "";
	return rows.filter(
		(r) =>
			(f.type === undefined || r.type === f.type) &&
			(f.status === undefined || r.displayStatus === f.status) &&
			(f.from === undefined || r.date >= f.from) &&
			(f.to === undefined || r.date <= f.to) &&
			(q === "" ||
				r.buyerName.toLowerCase().includes(q) ||
				(r.number ?? "").toLowerCase().includes(q)),
	);
}

/**
 * Default ("needs attention") group: overdue, then unpaid (issued or
 * partially paid with a balance), then drafts, then other open documents
 * that take no payment (quotes, delivery notes…), then paid and void.
 */
export function priorityGroup(r: ListRowLike): number {
	switch (r.displayStatus) {
		case "overdue":
			return 0;
		case "partially_paid":
			return 1;
		case "issued":
			return (r.balanceMinor ?? 0) > 0 ? 1 : 3;
		case "draft":
			return 2;
		default:
			return 4;
	}
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Ascending, with null/undefined last regardless of direction. */
const nullsLast = (a: string | null, b: string | null) =>
	a === b ? 0 : a === null ? 1 : b === null ? -1 : cmp(a, b);
/** Integers in one currency; documents in different currencies group by code. */
const money = (a: number | null, b: number | null, dir: 1 | -1) => {
	if (a === b) return 0;
	if (a === null) return 1;
	if (b === null) return -1;
	return (a - b) * dir;
};

function byPriority(a: ListRowLike, b: ListRowLike): number {
	const g = priorityGroup(a) - priorityGroup(b);
	if (g !== 0) return g;
	switch (priorityGroup(a)) {
		case 0:
		case 1:
			// Earliest due date first; then the older document.
			return nullsLast(a.dueDate, b.dueDate) || cmp(a.date, b.date);
		case 2:
			// Drafts: the one touched most recently first.
			return cmp(b.updatedAt, a.updatedAt);
		default:
			return cmp(b.date, a.date) || cmp(b.updatedAt, a.updatedAt);
	}
}

export function sortRows<T extends ListRowLike>(
	rows: readonly T[],
	sort: ListSort = "priority",
): T[] {
	const compare = (a: T, b: T): number => {
		switch (sort) {
			case "priority":
				return byPriority(a, b);
			case "date_desc":
				return cmp(b.date, a.date) || cmp(b.updatedAt, a.updatedAt);
			case "date_asc":
				return cmp(a.date, b.date) || cmp(a.updatedAt, b.updatedAt);
			case "due_asc":
				return nullsLast(a.dueDate, b.dueDate) || cmp(a.date, b.date);
			case "amount_desc":
				return (
					cmp(a.currency, b.currency) || money(a.totalMinor, b.totalMinor, -1)
				);
			case "amount_asc":
				return (
					cmp(a.currency, b.currency) || money(a.totalMinor, b.totalMinor, 1)
				);
			case "balance_desc":
				return (
					cmp(a.currency, b.currency) ||
					money(a.balanceMinor, b.balanceMinor, -1)
				);
		}
	};
	// Stable: equal rows keep their incoming order; id breaks the last ties.
	return [...rows].sort((a, b) => compare(a, b) || cmp(a.id, b.id));
}

/** How many rows fall under each display status (for the filter chips). */
export function countByStatus(
	rows: readonly ListRowLike[],
): Record<DisplayStatus, number> {
	const out: Record<DisplayStatus, number> = {
		draft: 0,
		issued: 0,
		partially_paid: 0,
		paid: 0,
		overdue: 0,
		void: 0,
	};
	for (const r of rows) out[r.displayStatus] += 1;
	return out;
}
