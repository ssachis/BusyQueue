/**
 * Server-only data for the home dashboard. It reuses the other pages'
 * stores (review, reminders, projections, documents and payments) and only
 * adds read queries for recent activity; the arithmetic is in the pure
 * helpers of `#/components/dashboard/summary.ts`.
 *
 * Each section loads on its own, so one failing source shows an error on
 * its card instead of breaking the page. Kept apart from the server
 * functions in dashboard.ts so the client bundle never imports the D1 client.
 */
import { desc, eq } from "drizzle-orm";
import {
	type AuditSummary,
	countWithin,
	mergeActivity,
	type ReceivablesTotal,
	summarizeAudit,
	sumReceivables,
} from "#/components/dashboard/summary.ts";
import { REVIEW_VERSION } from "#/components/review/version.ts";
import { getDb } from "#/db/index.ts";
import { agentRuns } from "#/db/schema/busyq.ts";
import { documentImports } from "#/db/schema/doc-imports.ts";
import { invoiceImports } from "#/db/schema/imports.ts";
import type { AmountRange } from "#/lib/forecast/types.ts";
import { currentBusinessId, loadBusiness } from "./business-store.ts";
import { getDisplayStatuses } from "./documents/payments-store.ts";
import { listDocuments } from "./documents/store.ts";
import { loadProjections } from "./projections-store.ts";
import {
	listReminders,
	type ReminderView,
	todayIso,
} from "./reminders-store.ts";
import { loadReviewSummary, type ReviewSummary } from "./review-store.ts";

/** A section's data, or the reason it couldn't load. */
export type Section<T> = { ok: true; data: T } | { ok: false; error: string };

async function section<T>(load: () => Promise<T>): Promise<Section<T>> {
	try {
		return { ok: true, data: await load() };
	} catch (err) {
		const error = err instanceof Error ? err.message : String(err);
		console.error("[dashboard] section failed:", error);
		return { ok: false, error };
	}
}

export interface AuditCard extends AuditSummary {
	currency: string;
	/** Payments with no bill on file, minor units. */
	orphanMinor: number;
	orphans: number;
}

export interface RemindersCard {
	open: number;
	/** Open reminders, most severe first (then soonest due). */
	top: ReminderView[];
}

export interface CashCard {
	asOf: string;
	/** True when the forecast starts after the latest document, not today. */
	asOfIsDataDate: boolean;
	currency: string | null;
	days: number;
	lastDate: string;
	out: AmountRange;
	in: AmountRange;
	billsDue: number;
	billsPastDue: number;
}

export interface ReceivablesCard {
	totals: ReceivablesTotal[];
	issued: number;
}

export type ActivityItem =
	| {
			kind: "check";
			id: string;
			at: string;
			invoiceId: string;
			invoiceNumber: string | null;
			vendor: string | null;
			status: "running" | "completed" | "failed";
			/** Recoverable on this analysis when it is the bill's latest. */
			amountMinor: number | null;
			currency: string;
	  }
	| {
			kind: "document";
			id: string;
			at: string;
			documentId: string;
			type: string;
			number: string | null;
			buyerName: string;
			totalMinor: number | null;
			currency: string;
	  }
	| {
			kind: "bill_import";
			id: string;
			at: string;
			filename: string;
			status: string;
			invoiceId: string | null;
	  }
	| {
			kind: "document_import";
			id: string;
			at: string;
			filename: string;
			status: string;
			documentId: string | null;
	  };

export interface DashboardData {
	today: string;
	businessName: string;
	currency: string;
	audit: Section<AuditCard>;
	reminders: Section<RemindersCard>;
	cash: Section<CashCard>;
	receivables: Section<ReceivablesCard>;
	activity: Section<ActivityItem[]>;
}

const ACTIVITY_LIMIT = 8;
const PER_SOURCE = 8;

function auditCard(summary: ReviewSummary): AuditCard {
	return {
		...summarizeAudit(summary.invoices),
		currency: summary.currency,
		orphanMinor: summary.totals.orphanMinor,
		orphans: summary.orphans.length,
	};
}

async function remindersCard(today: string): Promise<RemindersCard> {
	// listReminders sorts active reminders by severity, then due date.
	const open = (await listReminders(today)).filter((r) => r.state === "open");
	return { open: open.length, top: open.slice(0, 3) };
}

async function cashCard(): Promise<CashCard> {
	const p = await loadProjections();
	const { calendar } = p.forecast;
	const horizon =
		calendar.horizons.find((h) => h.days === 30) ?? calendar.horizons[0];
	if (!horizon) throw new Error("The cash calendar has no horizons");
	const bills = countWithin(calendar.items, "out", horizon.lastDate);
	return {
		asOf: p.asOf,
		asOfIsDataDate: p.default.reason === "after_latest",
		currency: calendar.currency,
		days: horizon.days,
		lastDate: horizon.lastDate,
		out: horizon.out,
		in: horizon.in,
		billsDue: bills.count,
		billsPastDue: bills.pastDue,
	};
}

async function receivablesCard(
	currency: string,
	today: string,
): Promise<ReceivablesCard> {
	const issued = await listDocuments({ type: "invoice", status: "issued" });
	const statuses = await getDisplayStatuses(
		issued.map((d) => d.id),
		today,
	);
	const rows = issued.flatMap((d) => {
		const s = statuses[d.id];
		return s
			? [
					{
						currency: d.currency,
						balanceMinor: s.balanceMinor,
						overdue: s.overdue,
					},
				]
			: [];
	});
	return { totals: sumReceivables(rows, currency), issued: issued.length };
}

async function activity(
	summary: ReviewSummary | null,
): Promise<ActivityItem[]> {
	const db = getDb();
	const [runs, issued, billImports, docImports] = await Promise.all([
		db
			.select({
				id: agentRuns.id,
				invoiceId: agentRuns.invoiceId,
				status: agentRuns.status,
				startedAt: agentRuns.startedAt,
				finishedAt: agentRuns.finishedAt,
			})
			.from(agentRuns)
			.where(eq(agentRuns.agentVersion, REVIEW_VERSION))
			.orderBy(desc(agentRuns.startedAt))
			.limit(PER_SOURCE),
		listDocuments({ status: "issued" }),
		db
			.select({
				id: invoiceImports.id,
				filename: invoiceImports.filename,
				status: invoiceImports.status,
				invoiceId: invoiceImports.invoiceId,
				at: invoiceImports.updatedAt,
			})
			.from(invoiceImports)
			.orderBy(desc(invoiceImports.updatedAt))
			.limit(PER_SOURCE),
		db
			.select({
				id: documentImports.id,
				filename: documentImports.filename,
				status: documentImports.status,
				documentId: documentImports.documentId,
				at: documentImports.updatedAt,
			})
			.from(documentImports)
			.where(eq(documentImports.businessId, currentBusinessId()))
			.orderBy(desc(documentImports.updatedAt))
			.limit(PER_SOURCE),
	]);

	const rowsById = new Map(summary?.invoices.map((r) => [r.id, r]) ?? []);
	const currency = summary?.currency ?? "USD";
	const checks: ActivityItem[] = runs.map((r) => {
		const row = rowsById.get(r.invoiceId);
		return {
			kind: "check",
			id: `run:${r.id}`,
			at: r.finishedAt ?? r.startedAt,
			invoiceId: r.invoiceId,
			invoiceNumber: row?.invoiceNumber ?? null,
			vendor: row?.vendor ?? null,
			status: r.status,
			amountMinor: row?.run?.id === r.id ? row.run.totalMinor : null,
			currency,
		};
	});
	const documents: ActivityItem[] = issued
		.filter((d) => d.issuedAt)
		.sort((a, b) => (b.issuedAt ?? "").localeCompare(a.issuedAt ?? ""))
		.slice(0, PER_SOURCE)
		.map((d) => ({
			kind: "document",
			id: `doc:${d.id}`,
			at: d.issuedAt ?? d.updatedAt,
			documentId: d.id,
			type: d.type,
			number: d.number,
			buyerName: d.buyer.name,
			totalMinor: d.totalMinor,
			currency: d.currency,
		}));
	const bills: ActivityItem[] = billImports.map((i) => ({
		kind: "bill_import",
		id: `bill-import:${i.id}`,
		at: i.at,
		filename: i.filename,
		status: i.status,
		invoiceId: i.invoiceId,
	}));
	const docs: ActivityItem[] = docImports.map((i) => ({
		kind: "document_import",
		id: `doc-import:${i.id}`,
		at: i.at,
		filename: i.filename,
		status: i.status,
		documentId: i.documentId,
	}));
	return mergeActivity([checks, documents, bills, docs], ACTIVITY_LIMIT);
}

export async function loadDashboard(
	today = todayIso(),
): Promise<DashboardData> {
	const business = await loadBusiness();
	const reviewSummary = await section(() => loadReviewSummary(REVIEW_VERSION));
	const summary = reviewSummary.ok ? reviewSummary.data : null;
	const [reminders, cash, receivables, recent] = await Promise.all([
		section(() => remindersCard(today)),
		section(cashCard),
		section(() => receivablesCard(business.currency, today)),
		section(() => activity(summary)),
	]);
	return {
		today,
		businessName: business.legalName,
		currency: business.currency,
		audit: reviewSummary.ok
			? { ok: true, data: auditCard(reviewSummary.data) }
			: reviewSummary,
		reminders,
		cash,
		receivables,
		activity: recent,
	};
}
