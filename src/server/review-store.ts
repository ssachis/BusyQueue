/**
 * Server-only data for the review page: latest agent runs per invoice from
 * D1, their findings and drafts, approvals, and the failure summary. Kept
 * apart from the server functions in review.ts so the client bundle never
 * imports the D1 client.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "#/db/index.ts";
import {
	agentRuns,
	approvals,
	disputeDrafts,
	findings as findingsTable,
	invoices,
	payments,
} from "#/db/schema/busyq.ts";
import { type CashflowMonth, cashflowByMonth } from "#/lib/busyq/cashflow.ts";
import {
	type FailureSummary,
	summarizeFailures,
} from "#/lib/busyq/failures.ts";
import type { AgentVersion, Finding } from "#/lib/busyq/types.ts";
import { findOrphanPayments } from "#/lib/rules/index.ts";
import { createD1Store } from "#/server/agent/store.ts";

type RunRow = typeof agentRuns.$inferSelect;

export interface InvoiceRow {
	id: string;
	invoiceNumber: string;
	vendor: string;
	issueDate: string;
	run: {
		id: string;
		status: RunRow["status"];
		totalMinor: number;
		findings: number;
		failedTools: number;
		/** False for runs recorded before tool calls were logged. */
		toolLogged: boolean;
		approved: boolean;
	} | null;
}

export interface ReviewSummary {
	version: AgentVersion;
	invoices: InvoiceRow[];
	totals: {
		invoices: number;
		run: number;
		flagged: number;
		recoverableMinor: number;
		failedRuns: number;
		orphanMinor: number;
	};
	failures: FailureSummary;
	orphans: Finding[];
	/** Bills in versus money paid out, by month. */
	cashflow: CashflowMonth[];
	currency: string;
}

/** Latest run per invoice for one version. */
function latestRuns(rows: RunRow[], version: AgentVersion) {
	const latest = new Map<string, RunRow>();
	for (const r of rows) {
		if (r.agentVersion !== version) continue;
		const prev = latest.get(r.invoiceId);
		if (!prev || r.startedAt > prev.startedAt) latest.set(r.invoiceId, r);
	}
	return latest;
}

export async function loadReviewSummary(
	version: AgentVersion,
): Promise<ReviewSummary> {
	const db = getDb();
	const store = createD1Store(db);
	const [invoiceRows, runRows, prices] = await Promise.all([
		db.select().from(invoices).orderBy(invoices.id),
		db.select().from(agentRuns),
		store.getPriceList(),
	]);
	const latest = latestRuns(runRows, version);
	const runIds = [...latest.values()].map((r) => r.id);

	const [findingRows, draftRows] = runIds.length
		? await Promise.all([
				db
					.select()
					.from(findingsTable)
					.where(inArray(findingsTable.runId, runIds)),
				db
					.select()
					.from(disputeDrafts)
					.where(inArray(disputeDrafts.runId, runIds)),
			])
		: [[], []];
	const approvedInvoices = new Set(
		(await db.select({ invoiceId: approvals.invoiceId }).from(approvals)).map(
			(a) => a.invoiceId,
		),
	);

	const rows: InvoiceRow[] = invoiceRows.map((inv) => {
		const run = latest.get(inv.id);
		const fs = run ? findingRows.filter((f) => f.runId === run.id) : [];
		return {
			id: inv.id,
			invoiceNumber: inv.invoiceNumber,
			vendor: inv.vendorName,
			issueDate: inv.issueDate,
			run: run
				? {
						id: run.id,
						status: run.status,
						totalMinor: fs.reduce((n, f) => n + f.impactMinor, 0),
						findings: fs.length,
						failedTools: run.toolLog.filter((t) => t.status === "error").length,
						toolLogged: run.toolLog.length > 0 || run.toolCalls === 0,
						approved:
							approvedInvoices.has(inv.id) &&
							draftRows.some(
								(d) => d.runId === run.id && d.status === "approved",
							),
					}
				: null,
		};
	});

	const paymentRows = await db.select().from(payments);

	// Orphan payments aren't tied to an invoice; only invoice numbers matter here.
	const orphans = findOrphanPayments(
		invoiceRows.map((i) => ({
			id: i.id,
			vendor: i.vendorName,
			invoiceNumber: i.invoiceNumber,
			issueDate: i.issueDate,
			currency: i.currency,
			statedTotal: i.statedTotal,
			lines: [],
		})),
		paymentRows.map((p) => ({
			id: p.id,
			vendor: p.vendorName,
			invoiceNumber: p.invoiceNumber,
			amount: p.amount,
			currency: p.currency,
			paidOn: p.paidOn,
			reference: p.reference,
		})),
	);

	const failures = summarizeFailures(
		[...latest.values()].map((r) => ({
			runId: r.id,
			invoiceId: r.invoiceId,
			vendor: invoiceRows.find((i) => i.id === r.invoiceId)?.vendorName ?? "",
			toolLog: r.toolLog,
		})),
		prices,
	);

	const withRun = rows.filter((r) => r.run);
	return {
		version,
		invoices: rows,
		totals: {
			invoices: rows.length,
			run: withRun.length,
			flagged: withRun.filter((r) => (r.run?.totalMinor ?? 0) > 0).length,
			recoverableMinor: withRun.reduce(
				(n, r) => n + (r.run?.totalMinor ?? 0),
				0,
			),
			failedRuns: failures.failedRuns,
			orphanMinor: orphans.reduce((n, f) => n + f.impactMinor, 0),
		},
		failures,
		orphans,
		cashflow: cashflowByMonth(invoiceRows, paymentRows),
		currency: invoiceRows[0]?.currency ?? "USD",
	};
}

export interface ToolCallView {
	name: string;
	status: "ok" | "error";
	errorCode: string | null;
	errorMessage: string | null;
}

export interface InvoiceDetail {
	invoice: NonNullable<
		Awaited<ReturnType<ReturnType<typeof createD1Store>["getInvoice"]>>
	>;
	run:
		| (Omit<RunRow, "toolLog"> & {
				toolLog: ToolCallView[];
				findings: Finding[];
		  })
		| null;
	draft: typeof disputeDrafts.$inferSelect | null;
	approval: typeof approvals.$inferSelect | null;
}

export async function loadInvoiceDetail(
	invoiceId: string,
	version: AgentVersion,
): Promise<InvoiceDetail | null> {
	const db = getDb();
	const invoice = await createD1Store(db).getInvoice(invoiceId);
	if (!invoice) return null;
	const [run] = await db
		.select()
		.from(agentRuns)
		.where(
			and(
				eq(agentRuns.invoiceId, invoiceId),
				eq(agentRuns.agentVersion, version),
			),
		)
		.orderBy(desc(agentRuns.startedAt))
		.limit(1);
	if (!run) return { invoice, run: null, draft: null, approval: null };

	const [fs, [draft]] = await Promise.all([
		db.select().from(findingsTable).where(eq(findingsTable.runId, run.id)),
		db.select().from(disputeDrafts).where(eq(disputeDrafts.runId, run.id)),
	]);
	const [approval] = draft
		? await db.select().from(approvals).where(eq(approvals.draftId, draft.id))
		: [];
	return {
		invoice,
		run: {
			...run,
			toolLog: run.toolLog.map((t) => ({
				name: t.name,
				status: t.status,
				errorCode: t.errorCode ?? null,
				errorMessage: t.errorMessage ?? null,
			})),
			findings: fs.map(({ id: _id, runId: _runId, ...f }) => f),
		},
		draft: draft ?? null,
		approval: approval ?? null,
	};
}

export async function updateDraft(input: {
	draftId: string;
	subject: string;
	body: string;
}) {
	const db = getDb();
	const [draft] = await db
		.select()
		.from(disputeDrafts)
		.where(eq(disputeDrafts.id, input.draftId));
	if (!draft) throw new Error("Draft not found");
	if (draft.status === "approved")
		throw new Error("Approved drafts are read-only");
	await db
		.update(disputeDrafts)
		.set({
			subject: input.subject,
			body: input.body,
			updatedAt: new Date().toISOString(),
		})
		.where(eq(disputeDrafts.id, input.draftId));
}

/**
 * Approve = snapshot the draft into the append-only approvals log, then mark
 * the draft approved, in one batch. DB triggers keep both immutable after.
 */
export async function approveDraft(input: {
	draftId: string;
	approvedBy: string;
}) {
	const db = getDb();
	const [draft] = await db
		.select()
		.from(disputeDrafts)
		.where(eq(disputeDrafts.id, input.draftId));
	if (!draft) throw new Error("Draft not found");
	if (draft.status === "approved") throw new Error("Already approved");
	await db.batch([
		db.insert(approvals).values({
			draftId: draft.id,
			invoiceId: draft.invoiceId,
			approvedBy: input.approvedBy,
			totalImpactMinor: draft.totalImpactMinor,
			currency: draft.currency,
			subject: draft.subject,
			body: draft.body,
		}),
		db
			.update(disputeDrafts)
			.set({ status: "approved", updatedAt: new Date().toISOString() })
			.where(eq(disputeDrafts.id, draft.id)),
	]);
}
