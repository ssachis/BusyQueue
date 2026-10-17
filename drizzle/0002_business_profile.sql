CREATE TABLE `businesses` (
	`id` text PRIMARY KEY NOT NULL,
	`legal_name` text NOT NULL,
	`address_line1` text,
	`address_line2` text,
	`city` text,
	`region` text,
	`postal_code` text,
	`country` text NOT NULL,
	`currency` text NOT NULL,
	`tax_ids` text DEFAULT '[]' NOT NULL,
	`logo_url` text,
	`accent_color` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
