CREATE TABLE `invoice_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`r2_key` text NOT NULL,
	`filename` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`status` text DEFAULT 'uploaded' NOT NULL,
	`requested_model` text,
	`model` text,
	`extracted` text,
	`uncertain` text DEFAULT '[]' NOT NULL,
	`error` text,
	`invoice_id` text,
	`prism_trace_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "invoice_imports_status" CHECK("invoice_imports"."status" IN ('uploaded', 'extracted', 'failed', 'saved'))
);
--> statement-breakpoint
CREATE INDEX `invoice_imports_created` ON `invoice_imports` (`created_at`);