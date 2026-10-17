/**
 * Reminders (#24): contract notice windows, vendor bills and our invoices
 * coming due. Written by the daily sweep (`runReminderSweep`), which inserts
 * with ON CONFLICT DO NOTHING on the idempotency key
 * `(subject_type, subject_id, kind, due_date)`, so re-running never duplicates.
 *
 * Reminders are never deleted: they are snoozed, dismissed by the owner, or
 * auto-resolved by the sweep when the subject is paid, confirmed or void.
 * `amount_minor` is the outstanding balance from code, in integer minor units.
 */
import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";
import {
	REMINDER_KINDS,
	SEVERITIES,
	SUBJECT_TYPES,
} from "#/lib/reminders/types.ts";
import { businesses } from "./business.ts";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const inList = (values: readonly string[]) =>
	sql.raw(values.map((v) => `'${v}'`).join(", "));

export const reminders = sqliteTable(
	"reminders",
	{
		id: text("id").primaryKey(),
		businessId: text("business_id")
			.notNull()
			.references(() => businesses.id),
		subjectType: text("subject_type", { enum: SUBJECT_TYPES }).notNull(),
		/** contracts.id, invoices.id (vendor bill) or documents.id. */
		subjectId: text("subject_id").notNull(),
		kind: text("kind", { enum: REMINDER_KINDS }).notNull(),
		/** The deadline the reminder is about (ISO date). Part of the key. */
		dueDate: text("due_date").notNull(),
		/** First day the reminder applied (ISO date). */
		remindOn: text("remind_on").notNull(),
		severity: text("severity", { enum: SEVERITIES }).notNull(),
		subjectLabel: text("subject_label").notNull(),
		title: text("title").notNull(),
		detail: text("detail").notNull(),
		amountMinor: integer("amount_minor"),
		currency: text("currency"),
		/** Hidden while today is before this ISO date. */
		snoozedUntil: text("snoozed_until"),
		dismissedAt: text("dismissed_at"),
		dismissedBy: text("dismissed_by"),
		/** Set by the sweep when the reminder no longer applies. */
		resolvedAt: text("resolved_at"),
		resolvedReason: text("resolved_reason"),
		/** Set once the reminder email went out (sending is not wired yet). */
		emailedAt: text("emailed_at"),
		createdAt: text("created_at").notNull().default(now),
		updatedAt: text("updated_at").notNull().default(now),
	},
	(t) => [
		uniqueIndex("reminders_idempotency").on(
			t.subjectType,
			t.subjectId,
			t.kind,
			t.dueDate,
		),
		index("reminders_business_open").on(t.businessId, t.resolvedAt),
		check(
			"reminders_subject_type",
			sql`${t.subjectType} IN (${inList(SUBJECT_TYPES)})`,
		),
		check("reminders_kind", sql`${t.kind} IN (${inList(REMINDER_KINDS)})`),
		check("reminders_severity", sql`${t.severity} IN (${inList(SEVERITIES)})`),
	],
);
