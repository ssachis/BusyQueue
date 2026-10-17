CREATE TABLE `contract_prices` (
	`contract_id` text NOT NULL,
	`line_no` integer NOT NULL,
	`vendor_id` text NOT NULL,
	`item` text NOT NULL,
	`unit` text NOT NULL,
	`unit_price` text NOT NULL,
	`previous_unit_price` text,
	`currency` text NOT NULL,
	`pack_unit` text,
	`pack_size` text,
	`change` text NOT NULL,
	PRIMARY KEY(`contract_id`, `line_no`),
	FOREIGN KEY (`contract_id`) REFERENCES `contracts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "contract_prices_change" CHECK("contract_prices"."change" IN ('new', 'changed', 'unchanged'))
);
--> statement-breakpoint
CREATE TABLE `contracts` (
	`id` text PRIMARY KEY NOT NULL,
	`vendor_id` text,
	`vendor_name` text,
	`title` text,
	`start_date` text,
	`end_date` text,
	`notice_days` integer,
	`auto_renew` integer,
	`currency` text NOT NULL,
	`source_name` text,
	`source_text` text NOT NULL,
	`raw_extraction` text,
	`prices` text NOT NULL,
	`flags` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`model` text,
	`prism_trace_id` text,
	`confirmed_by` text,
	`confirmed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`vendor_id`) REFERENCES `vendors`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "contracts_status" CHECK("contracts"."status" IN ('draft', 'confirmed'))
);
--> statement-breakpoint
CREATE INDEX `contracts_vendor` ON `contracts` (`vendor_id`);