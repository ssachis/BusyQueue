CREATE TABLE `document_activity` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`document_id` text NOT NULL,
	`kind` text NOT NULL,
	`actor` text NOT NULL,
	`detail` text,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `document_activity_document` ON `document_activity` (`document_id`,`at`);--> statement-breakpoint
CREATE TABLE `document_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency` text NOT NULL,
	`received_on` text NOT NULL,
	`method` text,
	`reference` text,
	`note` text,
	`voided_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `document_payments_document` ON `document_payments` (`document_id`);--> statement-breakpoint
CREATE TABLE `document_lines` (
	`document_id` text NOT NULL,
	`line_no` integer NOT NULL,
	`description` text NOT NULL,
	`quantity` text NOT NULL,
	`unit` text,
	`unit_price` text NOT NULL,
	`discount` text,
	`tax_code` text NOT NULL,
	`rate` text,
	`hsn_sac` text,
	`catalog_item_id` text,
	PRIMARY KEY(`document_id`, `line_no`),
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`number` text,
	`series` text DEFAULT '' NOT NULL,
	`fiscal_year` text,
	`date` text NOT NULL,
	`due_date` text,
	`currency` text NOT NULL,
	`client_id` text,
	`buyer` text NOT NULL,
	`seller` text,
	`place_of_supply` text,
	`notes` text,
	`terms` text,
	`subtotal_minor` integer,
	`tax_minor` integer,
	`total_minor` integer,
	`tax_result` text,
	`issued_at` text,
	`voided_at` text,
	`void_reason` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "documents_type" CHECK("documents"."type" IN ('invoice', 'quote', 'proforma', 'credit_note', 'receipt', 'delivery_note')),
	CONSTRAINT "documents_status" CHECK("documents"."status" IN ('draft', 'issued', 'void')),
	CONSTRAINT "documents_number_when_issued" CHECK(("documents"."status" = 'draft') = ("documents"."number" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `documents_business_type` ON `documents` (`business_id`,`type`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `documents_number_unique` ON `documents` (`business_id`,`type`,`series`,`number`);--> statement-breakpoint
CREATE TABLE `document_counters` (
	`business_id` text NOT NULL,
	`type` text NOT NULL,
	`series` text DEFAULT '' NOT NULL,
	`fiscal_year` text DEFAULT '' NOT NULL,
	`next_number` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`business_id`, `type`, `series`, `fiscal_year`),
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
