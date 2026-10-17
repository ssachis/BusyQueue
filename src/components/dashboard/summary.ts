/**
 * Pure aggregations behind the home dashboard. No I/O and integer minor units
 * only, so every number on the page is reproducible and unit-tested. The
 * server store (`src/server/dashboard-store.ts`) loads rows and calls these.
 */

// ── Audit (money out) ─────────────────────────────────────────────────

/** The fields of a review row the dashboard reads (a subset of `InvoiceRow`). */
export interface AuditRowLike {
	id: string;
	invoiceNumber: string;
	vendor: string;
	issueDate: string;
	run: {
		id: string;
		status: "running" | "completed" | "failed";
		totalMinor: number;
		failedTools: number;
		approved: boolean;
	} | null;
}

export interface FlaggedBill {
	id: string;
	invoiceNumber: string;
	vendor: string;
	amountMinor: number;
}

export interface AuditSummary {
	/** Bills on file. */
	bills: number;
	/** Bills with a completed or failed analysis. */
	checked: number;
	/** Bills with something to recover (approved or not). */
	flagged: number;
	/** Recoverable on every flagged bill, minor units. */
	recoverableMinor: number;
	/** Flagged bills whose dispute isn't approved yet. */
	awaitingApproval: number;
	awaitingMinor: number;
	/** Disputes approved and logged. */
	approved: number;
	approvedMinor: number;
	/** Latest analysis had failed tool calls (some lines not checked). */
	partlyChecked: number;
	/** Largest unapproved flagged bills first. */
	top: FlaggedBill[];
}

export function summarizeAudit(
	rows: readonly AuditRowLike[],
	topN = 3,
): AuditSummary {
	let checked = 0;
	let flagged = 0;
	let recoverableMinor = 0;
	let awaitingApproval = 0;
	let awaitingMinor = 0;
	let approved = 0;
	let approvedMinor = 0;
	let partlyChecked = 0;
	const open: FlaggedBill[] = [];
	for (const r of rows) {
		const run = r.run;
		if (!run || run.status === "running") continue;
		checked += 1;
		if (run.failedTools > 0) partlyChecked += 1;
		if (run.totalMinor <= 0) continue;
		flagged += 1;
		recoverableMinor += run.totalMinor;
		if (run.approved) {
			approved += 1;
			approvedMinor += run.totalMinor;
		} else {
			awaitingApproval += 1;
			awaitingMinor += run.totalMinor;
			open.push({
				id: r.id,
				invoiceNumber: r.invoiceNumber,
				vendor: r.vendor,
				amountMinor: run.totalMinor,
			});
		}
	}
	open.sort(
		(a, b) =>
			b.amountMinor - a.amountMinor ||
			a.invoiceNumber.localeCompare(b.invoiceNumber),
	);
	return {
		bills: rows.length,
		checked,
		flagged,
		recoverableMinor,
		awaitingApproval,
		awaitingMinor,
		approved,
		approvedMinor,
		partlyChecked,
		top: open.slice(0, topN),
	};
}

// ── Receivables (money in) ────────────────────────────────────────────

export interface ReceivableLike {
	currency: string;
	/** What is still owed, minor units (0 when paid or void). */
	balanceMinor: number;
	overdue: boolean;
}

export interface ReceivablesTotal {
	currency: string;
	balanceMinor: number;
	/** Invoices with something still owed. */
	open: number;
	overdue: number;
	overdueMinor: number;
}

/**
 * Money owed to us, per currency (never summed across currencies). The
 * preferred currency (the business's) comes first, then the others A–Z.
 */
export function sumReceivables(
	rows: readonly ReceivableLike[],
	preferred: string,
): ReceivablesTotal[] {
	const by = new Map<string, ReceivablesTotal>();
	for (const r of rows) {
		if (r.balanceMinor <= 0) continue;
		const t = by.get(r.currency) ?? {
			currency: r.currency,
			balanceMinor: 0,
			open: 0,
			overdue: 0,
			overdueMinor: 0,
		};
		t.balanceMinor += r.balanceMinor;
		t.open += 1;
		if (r.overdue) {
			t.overdue += 1;
			t.overdueMinor += r.balanceMinor;
		}
		by.set(r.currency, t);
	}
	if (!by.has(preferred)) {
		by.set(preferred, {
			currency: preferred,
			balanceMinor: 0,
			open: 0,
			overdue: 0,
			overdueMinor: 0,
		});
	}
	return [...by.values()].sort((a, b) =>
		a.currency === preferred
			? -1
			: b.currency === preferred
				? 1
				: a.currency.localeCompare(b.currency),
	);
}

// ── Cash calendar ─────────────────────────────────────────────────────

export interface CalendarItemLike {
	direction: "in" | "out";
	expectedDate: string;
	pastDue: boolean;
}

/** Open items expected on or before `lastDate`, and how many are past due. */
export function countWithin(
	items: readonly CalendarItemLike[],
	direction: "in" | "out",
	lastDate: string,
): { count: number; pastDue: number } {
	let count = 0;
	let pastDue = 0;
	for (const i of items) {
		if (i.direction !== direction || i.expectedDate > lastDate) continue;
		count += 1;
		if (i.pastDue) pastDue += 1;
	}
	return { count, pastDue };
}

// ── Recent activity ───────────────────────────────────────────────────

/** Anything with an id and an ISO timestamp. */
export interface Timed {
	id: string;
	at: string;
}

/** Newest first across every source; ties broken by id so order is stable. */
export function mergeActivity<T extends Timed>(
	sources: readonly (readonly T[])[],
	limit: number,
): T[] {
	return sources
		.flat()
		.sort((a, b) => b.at.localeCompare(a.at) || a.id.localeCompare(b.id))
		.slice(0, Math.max(0, limit));
}
