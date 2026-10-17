/**
 * BusyQ audit tables (Phase 1).
 *
 * Money follows the shared rule: amounts copied from source documents
 * (prices, line amounts, payments, stated totals) are decimal strings stored
 * as TEXT exactly as printed; computed amounts (impact) are INTEGER minor
 * units. Timestamps are ISO-8601 UTC strings.
 *
 * `approvals` is append-only and approved `dispute_drafts` are read-only.
 * Both are enforced by triggers in a custom migration, not just by app code.
 */
import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const createdAt = () => text("created_at").notNull().default(now);

export const AGENT_VERSIONS = ["v1", "v2"] as const;
export const RUN_STATUSES = ["running", "completed", "failed"] as const;
export const DRAFT_STATUSES = ["draft", "approved"] as const;
export const FINDING_KINDS = [
	"overcharge",
	"duplicate_line",
	"wrong_total",
	"duplicate_payment",
	"orphan_payment",
] as const;

const inList = (values: readonly string[]) =>
	sql.raw(values.map((v) => `'${v}'`).join(", "));

// ── Reference data (seeded from data/) ───────────────────────────────

/** Canonical vendors, as named on the price list. */
export const vendors = sqliteTable("vendors", {
	id: text("id").primaryKey(),
	name: text("name").notNull().unique(),
	createdAt: createdAt(),
});

/** Agreed prices. One row per vendor, item and unit. */
export const priceList = sqliteTable(
	"price_list",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		vendorId: text("vendor_id")
			.notNull()
			.references(() => vendors.id),
		item: text("item").notNull(),
		unit: text("unit").notNull(),
		unitPrice: text("unit_price").notNull(),
		currency: text("currency").notNull(),
		packUnit: text("pack_unit"),
		packSize: text("pack_size"),
	},
	(t) => [
		uniqueIndex("price_list_vendor_item_unit").on(t.vendorId, t.item, t.unit),
		check(
			"price_list_pack_pair",
			sql`(${t.packUnit} IS NULL) = (${t.packSize} IS NULL)`,
		),
	],
);

/** Vendor invoices exactly as received. `vendorName` is as printed, not resolved. */
export const invoices = sqliteTable(
	"invoices",
	{
		id: text("id").primaryKey(),
		vendorName: text("vendor_name").notNull(),
		invoiceNumber: text("invoice_number").notNull(),
		issueDate: text("issue_date").notNull(),
		dueDate: text("due_date"),
		currency: text("currency").notNull(),
		statedTotal: text("stated_total").notNull(),
		createdAt: createdAt(),
	},
	(t) => [index("invoices_invoice_number").on(t.invoiceNumber)],
);

export const invoiceLines = sqliteTable(
	"invoice_lines",
	{
		invoiceId: text("invoice_id")
			.notNull()
			.references(() => invoices.id, { onDelete: "cascade" }),
		lineNo: integer("line_no").notNull(),
		item: text("item").notNull(),
		quantity: text("quantity").notNull(),
		unit: text("unit").notNull(),
		unitPrice: text("unit_price").notNull(),
		amount: text("amount").notNull(),
	},
	(t) => [primaryKey({ columns: [t.invoiceId, t.lineNo] })],
);

/** Payments from the accounts-payable export. `invoiceNumber` null = no invoice. */
export const payments = sqliteTable(
	"payments",
	{
		id: text("id").primaryKey(),
		vendorName: text("vendor_name").notNull(),
		invoiceNumber: text("invoice_number"),
		amount: text("amount").notNull(),
		currency: text("currency").notNull(),
		paidOn: text("paid_on").notNull(),
		reference: text("reference").notNull(),
	},
	(t) => [index("payments_invoice_number").on(t.invoiceNumber)],
);

// ── Agent runs and their output ──────────────────────────────────────

/** One agent run over one invoice. `prismTraceId` links to the PRISM span tree. */
export const agentRuns = sqliteTable(
	"agent_runs",
	{
		id: text("id").primaryKey(),
		invoiceId: text("invoice_id")
			.notNull()
			.references(() => invoices.id),
		agentVersion: text("agent_version", { enum: AGENT_VERSIONS }).notNull(),
		status: text("status", { enum: RUN_STATUSES }).notNull().default("running"),
		model: text("model"),
		prismTraceId: text("prism_trace_id"),
		/** Model-written plain-English explanation of the findings. */
		explanation: text("explanation"),
		error: text("error"),
		toolCalls: integer("tool_calls").notNull().default(0),
		startedAt: text("started_at").notNull().default(now),
		finishedAt: text("finished_at"),
	},
	(t) => [
		index("agent_runs_invoice").on(t.invoiceId, t.startedAt),
		check(
			"agent_runs_version",
			sql`${t.agentVersion} IN (${inList(AGENT_VERSIONS)})`,
		),
		check("agent_runs_status", sql`${t.status} IN (${inList(RUN_STATUSES)})`),
	],
);

/** Problems found by code (the rules engine), never by the model. */
export const findings = sqliteTable(
	"findings",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		runId: text("run_id")
			.notNull()
			.references(() => agentRuns.id, { onDelete: "cascade" }),
		kind: text("kind", { enum: FINDING_KINDS }).notNull(),
		invoiceId: text("invoice_id"),
		lineNo: integer("line_no"),
		paymentId: text("payment_id"),
		expected: text("expected"),
		actual: text("actual"),
		impactMinor: integer("impact_minor").notNull(),
		currency: text("currency").notNull(),
		detail: text("detail").notNull(),
	},
	(t) => [
		index("findings_run").on(t.runId),
		check("findings_kind", sql`${t.kind} IN (${inList(FINDING_KINDS)})`),
	],
);

/** The vendor email the model drafted; editable by the owner until approved. */
export const disputeDrafts = sqliteTable(
	"dispute_drafts",
	{
		id: text("id").primaryKey(),
		runId: text("run_id")
			.notNull()
			.references(() => agentRuns.id),
		invoiceId: text("invoice_id")
			.notNull()
			.references(() => invoices.id),
		subject: text("subject").notNull(),
		body: text("body").notNull(),
		/** Sum of the run's findings, from code. */
		totalImpactMinor: integer("total_impact_minor").notNull(),
		currency: text("currency").notNull(),
		status: text("status", { enum: DRAFT_STATUSES }).notNull().default("draft"),
		createdAt: createdAt(),
		updatedAt: text("updated_at").notNull().default(now),
	},
	(t) => [
		index("dispute_drafts_invoice").on(t.invoiceId),
		check(
			"dispute_drafts_status",
			sql`${t.status} IN (${inList(DRAFT_STATUSES)})`,
		),
	],
);

/**
 * Owner approvals. Append-only: a snapshot of exactly what was approved.
 * Approve = insert here + set the draft's status to "approved", in one batch.
 */
export const approvals = sqliteTable("approvals", {
	id: integer("id").primaryKey({ autoIncrement: true }),
	draftId: text("draft_id")
		.notNull()
		.unique()
		.references(() => disputeDrafts.id),
	invoiceId: text("invoice_id")
		.notNull()
		.references(() => invoices.id),
	approvedBy: text("approved_by").notNull(),
	approvedAt: text("approved_at").notNull().default(now),
	totalImpactMinor: integer("total_impact_minor").notNull(),
	currency: text("currency").notNull(),
	subject: text("subject").notNull(),
	body: text("body").notNull(),
});
