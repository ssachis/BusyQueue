-- Issued documents are immutable; the only allowed change is issued -> void.
CREATE TRIGGER `documents_issued_locked` BEFORE UPDATE ON `documents`
WHEN OLD.`status` = 'issued' AND NOT (
	NEW.`status` = 'void'
	AND NEW.`number` IS OLD.`number`
	AND NEW.`total_minor` IS OLD.`total_minor`
	AND NEW.`buyer` IS OLD.`buyer`
	AND NEW.`seller` IS OLD.`seller`
	AND NEW.`date` IS OLD.`date`
	AND NEW.`type` IS OLD.`type`
)
BEGIN
	SELECT RAISE(ABORT, 'issued documents are immutable (only voiding is allowed)');
END;
--> statement-breakpoint
CREATE TRIGGER `documents_void_locked` BEFORE UPDATE ON `documents`
WHEN OLD.`status` = 'void'
BEGIN
	SELECT RAISE(ABORT, 'void documents are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `documents_no_delete_issued` BEFORE DELETE ON `documents`
WHEN OLD.`status` <> 'draft'
BEGIN
	SELECT RAISE(ABORT, 'only drafts can be deleted');
END;
--> statement-breakpoint
-- Lines of an issued or void document are frozen.
CREATE TRIGGER `document_lines_locked_insert` BEFORE INSERT ON `document_lines`
WHEN (SELECT `status` FROM `documents` WHERE `id` = NEW.`document_id`) <> 'draft'
BEGIN
	SELECT RAISE(ABORT, 'lines of an issued document are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `document_lines_locked_update` BEFORE UPDATE ON `document_lines`
WHEN (SELECT `status` FROM `documents` WHERE `id` = OLD.`document_id`) <> 'draft'
BEGIN
	SELECT RAISE(ABORT, 'lines of an issued document are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `document_lines_locked_delete` BEFORE DELETE ON `document_lines`
WHEN (SELECT `status` FROM `documents` WHERE `id` = OLD.`document_id`) <> 'draft'
BEGIN
	SELECT RAISE(ABORT, 'lines of an issued document are immutable');
END;
--> statement-breakpoint
-- Payments are voided, never deleted, and only on issued documents.
CREATE TRIGGER `document_payments_no_delete` BEFORE DELETE ON `document_payments`
BEGIN
	SELECT RAISE(ABORT, 'payments are voided, not deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `document_payments_issued_only` BEFORE INSERT ON `document_payments`
WHEN (SELECT `status` FROM `documents` WHERE `id` = NEW.`document_id`) <> 'issued'
BEGIN
	SELECT RAISE(ABORT, 'payments can only be recorded on issued documents');
END;
