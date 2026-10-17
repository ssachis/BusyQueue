CREATE TABLE `catalog_items` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`unit` text,
	`unit_price` text NOT NULL,
	`currency` text NOT NULL,
	`tax_code` text NOT NULL,
	`rate` text,
	`hsn_sac` text,
	`code` text,
	`archived_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `catalog_items_business_name` ON `catalog_items` (`business_id`,`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `catalog_items_business_code` ON `catalog_items` (`business_id`,`code`);--> statement-breakpoint
CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`business_id` text NOT NULL,
	`name` text NOT NULL,
	`address_lines` text DEFAULT '[]' NOT NULL,
	`city` text,
	`region` text,
	`postal_code` text,
	`country` text NOT NULL,
	`tax_id` text,
	`email` text,
	`place_of_supply` text,
	`currency` text,
	`notes` text,
	`archived_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`business_id`) REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `clients_business_name` ON `clients` (`business_id`,`name`);
--> statement-breakpoint
CREATE TRIGGER `clients_no_delete_with_documents` BEFORE DELETE ON `clients`
WHEN EXISTS (SELECT 1 FROM `documents` WHERE `client_id` = OLD.`id`)
BEGIN
	SELECT RAISE(ABORT, 'clients with documents can only be archived');
END;
--> statement-breakpoint
-- Catalog items used on a document line are archived, never deleted.
CREATE TRIGGER `catalog_items_no_delete_when_used` BEFORE DELETE ON `catalog_items`
WHEN EXISTS (SELECT 1 FROM `document_lines` WHERE `catalog_item_id` = OLD.`id`)
BEGIN
	SELECT RAISE(ABORT, 'catalog items used on documents can only be archived');
END;
