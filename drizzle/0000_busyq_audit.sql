CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`agent_version` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`model` text,
	`prism_trace_id` text,
	`explanation` text,
	`error` text,
	`tool_calls` integer DEFAULT 0 NOT NULL,
	`started_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "agent_runs_version" CHECK("agent_runs"."agent_version" IN ('v1', 'v2')),
	CONSTRAINT "agent_runs_status" CHECK("agent_runs"."status" IN ('running', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `agent_runs_invoice` ON `agent_runs` (`invoice_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `approvals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`draft_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`approved_by` text NOT NULL,
	`approved_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`total_impact_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	FOREIGN KEY (`draft_id`) REFERENCES `dispute_drafts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `approvals_draft_id_unique` ON `approvals` (`draft_id`);--> statement-breakpoint
CREATE TABLE `dispute_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`invoice_id` text NOT NULL,
	`subject` text NOT NULL,
	`body` text NOT NULL,
	`total_impact_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "dispute_drafts_status" CHECK("dispute_drafts"."status" IN ('draft', 'approved'))
);
--> statement-breakpoint
CREATE INDEX `dispute_drafts_invoice` ON `dispute_drafts` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `findings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`kind` text NOT NULL,
	`invoice_id` text,
	`line_no` integer,
	`payment_id` text,
	`expected` text,
	`actual` text,
	`impact_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`detail` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "findings_kind" CHECK("findings"."kind" IN ('overcharge', 'duplicate_line', 'wrong_total', 'duplicate_payment', 'orphan_payment'))
);
--> statement-breakpoint
CREATE INDEX `findings_run` ON `findings` (`run_id`);--> statement-breakpoint
CREATE TABLE `invoice_lines` (
	`invoice_id` text NOT NULL,
	`line_no` integer NOT NULL,
	`item` text NOT NULL,
	`quantity` text NOT NULL,
	`unit` text NOT NULL,
	`unit_price` text NOT NULL,
	`amount` text NOT NULL,
	PRIMARY KEY(`invoice_id`, `line_no`),
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`vendor_name` text NOT NULL,
	`invoice_number` text NOT NULL,
	`issue_date` text NOT NULL,
	`due_date` text,
	`currency` text NOT NULL,
	`stated_total` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `invoices_invoice_number` ON `invoices` (`invoice_number`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`vendor_name` text NOT NULL,
	`invoice_number` text,
	`amount` text NOT NULL,
	`currency` text NOT NULL,
	`paid_on` text NOT NULL,
	`reference` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `payments_invoice_number` ON `payments` (`invoice_number`);--> statement-breakpoint
CREATE TABLE `price_list` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vendor_id` text NOT NULL,
	`item` text NOT NULL,
	`unit` text NOT NULL,
	`unit_price` text NOT NULL,
	`currency` text NOT NULL,
	`pack_unit` text,
	`pack_size` text,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "price_list_pack_pair" CHECK(("price_list"."pack_unit" IS NULL) = ("price_list"."pack_size" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `price_list_vendor_item_unit` ON `price_list` (`vendor_id`,`item`,`unit`);--> statement-breakpoint
CREATE TABLE `vendors` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vendors_name_unique` ON `vendors` (`name`);