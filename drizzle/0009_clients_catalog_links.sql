CREATE TABLE `catalog_items` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`code` text,
	`name` text NOT NULL,
	`unit_price` text NOT NULL,
	`unit` text,
	`tax_code` text NOT NULL,
	`rate` text,
	`hsn_sac` text,
	`archived_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `catalog_items_business_name` ON `catalog_items` (`business_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_items_code_unique` ON `catalog_items` (`business_id`,`code`);--> statement-breakpoint
CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`name` text NOT NULL,
	`address_line1` text,
	`address_line2` text,
	`city` text,
	`region` text,
	`postal_code` text,
	`country` text NOT NULL,
	`tax_id` text,
	`email` text,
	`place_of_supply` text,
	`archived_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `clients_business_name` ON `clients` (`business_id`,`name`);--> statement-breakpoint
CREATE TABLE `document_links` (
	`document_id` text NOT NULL,
	`related_id` text NOT NULL,
	`relation` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`document_id`, `related_id`, `relation`),
	FOREIGN KEY (`document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`related_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `document_links_related` ON `document_links` (`related_id`);