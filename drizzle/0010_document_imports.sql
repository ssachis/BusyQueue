CREATE TABLE `document_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
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
	`document_id` text,
	`prism_trace_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "document_imports_status" CHECK("document_imports"."status" IN ('uploaded', 'extracted', 'failed', 'created'))
);
--> statement-breakpoint
CREATE INDEX `document_imports_business_created` ON `document_imports` (`business_id`,`created_at`);