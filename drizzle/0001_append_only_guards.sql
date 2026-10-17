-- Approvals are an audit log: never changed, never removed.
CREATE TRIGGER `approvals_no_update` BEFORE UPDATE ON `approvals`
BEGIN
	SELECT RAISE(ABORT, 'approvals are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `approvals_no_delete` BEFORE DELETE ON `approvals`
BEGIN
	SELECT RAISE(ABORT, 'approvals are append-only');
END;
--> statement-breakpoint
-- Once approved, a dispute draft is frozen: what was approved is what was sent.
CREATE TRIGGER `dispute_drafts_locked_update` BEFORE UPDATE ON `dispute_drafts`
WHEN OLD.`status` = 'approved'
BEGIN
	SELECT RAISE(ABORT, 'approved dispute drafts are read-only');
END;
--> statement-breakpoint
CREATE TRIGGER `dispute_drafts_locked_delete` BEFORE DELETE ON `dispute_drafts`
WHEN OLD.`status` = 'approved'
BEGIN
	SELECT RAISE(ABORT, 'approved dispute drafts are read-only');
END;
--> statement-breakpoint
-- A draft can only become approved through an approval row (inserted first, in the same batch).
CREATE TRIGGER `dispute_drafts_approve_requires_approval` BEFORE UPDATE OF `status` ON `dispute_drafts`
WHEN NEW.`status` = 'approved'
	AND NOT EXISTS (SELECT 1 FROM `approvals` WHERE `draft_id` = NEW.`id`)
BEGIN
	SELECT RAISE(ABORT, 'approve a draft by inserting into approvals first');
END;
