/**
 * Forwarding inbox (#21): vocabulary shared by the Email Worker, the D1
 * schema and the /inbox page. Pure, safe to import from the client.
 */

/** What a message or attachment is, from the business's point of view. */
export const INBOX_KINDS = [
	/** A vendor bill to us: processed end to end (AI import, human review). */
	"invoice_in",
	/** One of our own documents CC'd back: stored, handled by hand. */
	"invoice_out",
	/** A contract or tender: stored, handled by hand on /contracts/new. */
	"contract",
	/** Nothing to do (logos, unsupported files, no attachments). */
	"ignore",
] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

/**
 * Message lifecycle: received → classified → extracting → one of the final
 * states. A message is never dropped: ignored ones keep their reason.
 */
export const MESSAGE_STATUSES = [
	"received",
	"classified",
	"extracting",
	"ready_for_review",
	"needs_manual",
	"duplicate",
	"ignored",
	"failed",
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const ATTACHMENT_STATUSES = [
	"pending",
	"extracting",
	"ready_for_review",
	"needs_manual",
	"duplicate",
	"ignored",
	"failed",
] as const;
export type AttachmentStatus = (typeof ATTACHMENT_STATUSES)[number];

/** Who decided the classification. */
export const CLASSIFIERS = ["rules", "model"] as const;
export type Classifier = (typeof CLASSIFIERS)[number];

export const MESSAGE_SOURCES = ["email", "simulated"] as const;
export type MessageSource = (typeof MESSAGE_SOURCES)[number];

/** Email Routing accepts up to 25 MiB; anything over this is recorded and ignored. */
export const MAX_MESSAGE_BYTES = 20 * 1024 * 1024;

/** Still in progress: the /inbox page keeps polling while any message is. */
export const IN_PROGRESS: readonly MessageStatus[] = [
	"received",
	"classified",
	"extracting",
];

/** Most actionable first: a message takes the kind of its best attachment. */
const KIND_PRIORITY: readonly InboxKind[] = [
	"invoice_in",
	"contract",
	"invoice_out",
	"ignore",
];

export function messageKind(kinds: readonly InboxKind[]): InboxKind {
	for (const k of KIND_PRIORITY) if (kinds.includes(k)) return k;
	return "ignore";
}

/**
 * The message's final status from its attachments' statuses. Any import
 * ready for review wins; then manual work; then duplicates; failures only
 * when nothing else succeeded.
 */
export function messageStatus(
	statuses: readonly AttachmentStatus[],
): MessageStatus {
	if (statuses.includes("ready_for_review")) return "ready_for_review";
	if (statuses.includes("needs_manual")) return "needs_manual";
	if (statuses.includes("failed")) return "failed";
	if (statuses.includes("duplicate")) return "duplicate";
	return "ignored";
}
