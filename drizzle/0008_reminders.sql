CREATE TABLE `reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`subject_type` text NOT NULL,
	`subject_id` text NOT NULL,
	`kind` text NOT NULL,
	`due_date` text NOT NULL,
	`remind_on` text NOT NULL,
	`severity` text NOT NULL,
	`subject_label` text NOT NULL,
	`title` text NOT NULL,
	`detail` text NOT NULL,
	`amount_minor` integer,
	`currency` text,
	`snoozed_until` text,
	`dismissed_at` text,
	`dismissed_by` text,
	`resolved_at` text,
	`resolved_reason` text,
	`emailed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "reminders_subject_type" CHECK("reminders"."subject_type" IN ('contract', 'vendor_bill', 'document')),
	CONSTRAINT "reminders_kind" CHECK("reminders"."kind" IN ('contract_expiring', 'contract_notice_missed', 'contract_expired', 'contract_unconfirmed', 'bill_due_soon', 'bill_overdue', 'invoice_due_soon', 'invoice_overdue')),
	CONSTRAINT "reminders_severity" CHECK("reminders"."severity" IN ('critical', 'warning', 'info'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reminders_idempotency` ON `reminders` (`subject_type`,`subject_id`,`kind`,`due_date`);--> statement-breakpoint
CREATE INDEX `reminders_business_open` ON `reminders` (`business_id`,`resolved_at`);