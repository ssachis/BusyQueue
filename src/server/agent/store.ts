/**
 * Data access for agent runs. The loop talks to this interface so tests can
 * run against memory; `createD1Store` is the real implementation.
 */
import { asc, eq } from "drizzle-orm";
import type { Db } from "#/db/index.ts";
import {
	agentRuns,
	disputeDrafts,
	findings as findingsTable,
	invoiceLines,
	invoices,
	payments,
	priceList,
	vendors,
} from "#/db/schema/busyq.ts";
import type {
	AgentVersion,
	Finding,
	Invoice,
	Payment,
	PriceRow,
} from "#/lib/busyq/types.ts";

export interface DraftRecord {
	id: string;
	subject: string;
	body: string;
	totalImpactMinor: number;
	currency: string;
}

export interface FinishedRun {
	id: string;
	invoiceId: string;
	status: "completed" | "failed";
	model: string | null;
	explanation: string | null;
	error: string | null;
	toolCalls: number;
	findings: Finding[];
	draft: DraftRecord | null;
}

export interface AgentStore {
	getInvoice(id: string): Promise<Invoice | null>;
	getPriceList(): Promise<PriceRow[]>;
	getPaymentsForInvoice(invoiceNumber: string): Promise<Payment[]>;
	startRun(run: {
		id: string;
		invoiceId: string;
		version: AgentVersion;
		prismTraceId: string | null;
	}): Promise<void>;
	finishRun(run: FinishedRun): Promise<void>;
}

const orUndefined = (v: string | null) => v ?? undefined;

export function createD1Store(db: Db): AgentStore {
	return {
		async getInvoice(id) {
			const [inv] = await db.select().from(invoices).where(eq(invoices.id, id));
			if (!inv) return null;
			const lines = await db
				.select()
				.from(invoiceLines)
				.where(eq(invoiceLines.invoiceId, id))
				.orderBy(asc(invoiceLines.lineNo));
			return {
				id: inv.id,
				vendor: inv.vendorName,
				invoiceNumber: inv.invoiceNumber,
				issueDate: inv.issueDate,
				dueDate: orUndefined(inv.dueDate),
				currency: inv.currency,
				statedTotal: inv.statedTotal,
				lines: lines.map((l) => ({
					lineNo: l.lineNo,
					item: l.item,
					quantity: l.quantity,
					unit: l.unit,
					unitPrice: l.unitPrice,
					amount: l.amount,
				})),
			};
		},

		async getPriceList() {
			const rows = await db
				.select({ row: priceList, vendor: vendors.name })
				.from(priceList)
				.innerJoin(vendors, eq(priceList.vendorId, vendors.id));
			return rows.map(({ row, vendor }) => ({
				vendor,
				item: row.item,
				unit: row.unit,
				unitPrice: row.unitPrice,
				currency: row.currency,
				packUnit: orUndefined(row.packUnit),
				packSize: orUndefined(row.packSize),
			}));
		},

		async getPaymentsForInvoice(invoiceNumber) {
			const rows = await db
				.select()
				.from(payments)
				.where(eq(payments.invoiceNumber, invoiceNumber));
			return rows.map((p) => ({
				id: p.id,
				vendor: p.vendorName,
				invoiceNumber: p.invoiceNumber,
				amount: p.amount,
				currency: p.currency,
				paidOn: p.paidOn,
				reference: p.reference,
			}));
		},

		async startRun({ id, invoiceId, version, prismTraceId }) {
			await db.insert(agentRuns).values({
				id,
				invoiceId,
				agentVersion: version,
				prismTraceId,
			});
		},

		async finishRun(run) {
			const update = db
				.update(agentRuns)
				.set({
					status: run.status,
					model: run.model,
					explanation: run.explanation,
					error: run.error,
					toolCalls: run.toolCalls,
					finishedAt: new Date().toISOString(),
				})
				.where(eq(agentRuns.id, run.id));
			const writes = [
				...run.findings.map((f) =>
					db.insert(findingsTable).values({ runId: run.id, ...f }),
				),
				...(run.draft
					? [
							db.insert(disputeDrafts).values({
								...run.draft,
								runId: run.id,
								invoiceId: run.invoiceId,
							}),
						]
					: []),
			];
			await db.batch([update, ...writes]);
		},
	};
}
