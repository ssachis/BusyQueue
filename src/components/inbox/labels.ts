import type {
	AttachmentStatus,
	InboxKind,
	MessageStatus,
} from "#/lib/inbox/types.ts";

type Tone =
	| "success"
	| "warning"
	| "info"
	| "destructive"
	| "outline"
	| "secondary";

export const KIND_LABELS: Record<InboxKind, string> = {
	invoice_in: "Vendor invoice",
	invoice_out: "Our own document",
	contract: "Contract",
	ignore: "Not for us",
};

export const MESSAGE_STATUS: Record<
	MessageStatus,
	{ label: string; tone: Tone }
> = {
	received: { label: "Received", tone: "info" },
	classified: { label: "Classified", tone: "info" },
	extracting: { label: "Reading", tone: "info" },
	ready_for_review: { label: "Ready for review", tone: "success" },
	needs_manual: { label: "Needs manual handling", tone: "warning" },
	duplicate: { label: "Duplicate", tone: "secondary" },
	ignored: { label: "Ignored", tone: "outline" },
	failed: { label: "Failed", tone: "destructive" },
};

export const ATTACHMENT_STATUS: Record<
	AttachmentStatus,
	{ label: string; tone: Tone }
> = {
	pending: { label: "Queued", tone: "info" },
	extracting: { label: "Reading", tone: "info" },
	ready_for_review: { label: "Ready for review", tone: "success" },
	needs_manual: { label: "Needs manual handling", tone: "warning" },
	duplicate: { label: "Duplicate", tone: "secondary" },
	ignored: { label: "Ignored", tone: "outline" },
	failed: { label: "Failed", tone: "destructive" },
};

/** "2026-10-17T15:04:05.123Z" → "2026-10-17 15:04 UTC" (same on server and client). */
export const formatReceived = (iso: string) =>
	`${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

export function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
	return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
