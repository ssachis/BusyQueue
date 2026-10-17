CREATE TABLE `inbox_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`position` integer NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`r2_key` text,
	`classification` text NOT NULL,
	`classified_by` text NOT NULL,
	`reason` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`duplicate_of` text,
	`import_id` text,
	`vendor` text,
	`invoice_number` text,
	`dedupe_key` text,
	`error` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `inbox_messages`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`duplicate_of`) REFERENCES `inbox_attachments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`import_id`) REFERENCES `invoice_imports`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inbox_attachments_status" CHECK("inbox_attachments"."status" IN ('pending', 'extracting', 'ready_for_review', 'needs_manual', 'duplicate', 'ignored', 'failed')),
	CONSTRAINT "inbox_attachments_classification" CHECK("inbox_attachments"."classification" IN ('invoice_in', 'invoice_out', 'contract', 'ignore')),
	CONSTRAINT "inbox_attachments_classified_by" CHECK("inbox_attachments"."classified_by" IN ('rules', 'model'))
);
--> statement-breakpoint
CREATE INDEX `inbox_attachments_message` ON `inbox_attachments` (`message_id`);--> statement-breakpoint
CREATE INDEX `inbox_attachments_sha256` ON `inbox_attachments` (`sha256`);--> statement-breakpoint
CREATE INDEX `inbox_attachments_dedupe` ON `inbox_attachments` (`dedupe_key`);--> statement-breakpoint
CREATE TABLE `inbox_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`source` text NOT NULL,
	`message_id` text,
	`from_address` text,
	`from_domain` text,
	`to_address` text,
	`subject` text DEFAULT '' NOT NULL,
	`sent_at` text,
	`size_bytes` integer NOT NULL,
	`attachment_count` integer DEFAULT 0 NOT NULL,
	`classification` text,
	`status` text DEFAULT 'received' NOT NULL,
	`reason` text,
	`error` text,
	`prism_trace_id` text,
	`received_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "inbox_messages_status" CHECK("inbox_messages"."status" IN ('received', 'classified', 'extracting', 'ready_for_review', 'needs_manual', 'duplicate', 'ignored', 'failed')),
	CONSTRAINT "inbox_messages_classification" CHECK("inbox_messages"."classification" IS NULL OR "inbox_messages"."classification" IN ('invoice_in', 'invoice_out', 'contract', 'ignore')),
	CONSTRAINT "inbox_messages_source" CHECK("inbox_messages"."source" IN ('email', 'simulated'))
);
--> statement-breakpoint
CREATE INDEX `inbox_messages_received` ON `inbox_messages` (`received_at`);