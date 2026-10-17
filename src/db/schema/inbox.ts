/**
 * Forwarding inbox (#21). One row per email delivered to the inbox address
 * (or simulated on /inbox), one per attachment. Nothing is dropped: an
 * ignored message keeps its reason so real mail never disappears silently.
 *
 * Vendor bills (`invoice_in`) go through the AI import and link to their
 * `invoice_imports` row, which a person confirms on /import. Contracts and
 * our own documents are stored in R2 and listed for manual handling.
 *
 * Dedupe: `sha256` (same bytes) and `dedupe_key` (vendor|invoice number,
 * normalised, set after extraction). A duplicate points at the first copy.
 */
import { sql } from "drizzle-orm";
import {
	type AnySQLiteColumn,
	check,
	index,
	integer,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";
import {
	ATTACHMENT_STATUSES,
	CLASSIFIERS,
	INBOX_KINDS,
	MESSAGE_SOURCES,
	MESSAGE_STATUSES,
} from "#/lib/inbox/types.ts";
import { businesses } from "./business.ts";
import { invoiceImports } from "./imports.ts";

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;
const inList = (values: readonly string[]) =>
	sql.raw(values.map((v) => `'${v}'`).join(", "));

export const inboxMessages = sqliteTable(
	"inbox_messages",
	{
		id: text("id").primaryKey(),
		businessId: text("business_id")
			.notNull()
			.references(() => businesses.id),
		source: text("source", { enum: MESSAGE_SOURCES }).notNull(),
		/** The Message-ID header, as sent. */
		messageId: text("message_id"),
		/** Sender address (envelope, else From header). Shown as its domain only. */
		fromAddress: text("from_address"),
		fromDomain: text("from_domain"),
		toAddress: text("to_address"),
		subject: text("subject").notNull().default(""),
		/** Date header (ISO), when it parses. */
		sentAt: text("sent_at"),
		sizeBytes: integer("size_bytes").notNull(),
		attachmentCount: integer("attachment_count").notNull().default(0),
		classification: text("classification", { enum: INBOX_KINDS }),
		status: text("status", { enum: MESSAGE_STATUSES })
			.notNull()
			.default("received"),
		/** Why it was ignored or needs a person, in plain language. */
		reason: text("reason"),
		error: text("error"),
		/** The email's PRISM session id is this row's id. */
		prismTraceId: text("prism_trace_id"),
		receivedAt: text("received_at").notNull().default(now),
		updatedAt: text("updated_at").notNull().default(now),
	},
	(t) => [
		index("inbox_messages_received").on(t.receivedAt),
		check(
			"inbox_messages_status",
			sql`${t.status} IN (${inList(MESSAGE_STATUSES)})`,
		),
		check(
			"inbox_messages_classification",
			sql`${t.classification} IS NULL OR ${t.classification} IN (${inList(INBOX_KINDS)})`,
		),
		check(
			"inbox_messages_source",
			sql`${t.source} IN (${inList(MESSAGE_SOURCES)})`,
		),
	],
);

export const inboxAttachments = sqliteTable(
	"inbox_attachments",
	{
		id: text("id").primaryKey(),
		messageId: text("message_id")
			.notNull()
			.references(() => inboxMessages.id),
		/** Position in the message (0-based). */
		position: integer("position").notNull(),
		filename: text("filename").notNull(),
		/** Sniffed from the bytes; the declared type when it isn't one we read. */
		contentType: text("content_type").notNull(),
		sizeBytes: integer("size_bytes").notNull(),
		sha256: text("sha256").notNull(),
		/** R2 object: the import's key for vendor bills, inbox/… otherwise. */
		r2Key: text("r2_key"),
		classification: text("classification", { enum: INBOX_KINDS }).notNull(),
		classifiedBy: text("classified_by", { enum: CLASSIFIERS }).notNull(),
		reason: text("reason"),
		status: text("status", { enum: ATTACHMENT_STATUSES })
			.notNull()
			.default("pending"),
		/** The earlier attachment this one repeats (same bytes or same invoice). */
		duplicateOf: text("duplicate_of").references(
			(): AnySQLiteColumn => inboxAttachments.id,
		),
		importId: text("import_id").references(() => invoiceImports.id),
		/** As read by the import (not resolved), for the list and the dedupe key. */
		vendor: text("vendor"),
		invoiceNumber: text("invoice_number"),
		dedupeKey: text("dedupe_key"),
		error: text("error"),
		createdAt: text("created_at").notNull().default(now),
		updatedAt: text("updated_at").notNull().default(now),
	},
	(t) => [
		index("inbox_attachments_message").on(t.messageId),
		index("inbox_attachments_sha256").on(t.sha256),
		index("inbox_attachments_dedupe").on(t.dedupeKey),
		check(
			"inbox_attachments_status",
			sql`${t.status} IN (${inList(ATTACHMENT_STATUSES)})`,
		),
		check(
			"inbox_attachments_classification",
			sql`${t.classification} IN (${inList(INBOX_KINDS)})`,
		),
		check(
			"inbox_attachments_classified_by",
			sql`${t.classifiedBy} IN (${inList(CLASSIFIERS)})`,
		),
	],
);
