CREATE TABLE `document_links` (
	`from_document_id` text NOT NULL,
	`to_document_id` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`from_document_id`, `to_document_id`),
	FOREIGN KEY (`from_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_document_id`) REFERENCES `documents`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "document_links_kind" CHECK(kind IN ('converted', 'duplicated', 'credits')),
	CONSTRAINT "document_links_not_self" CHECK("document_links"."from_document_id" <> "document_links"."to_document_id")
);
--> statement-breakpoint
CREATE INDEX `document_links_to` ON `document_links` (`to_document_id`);