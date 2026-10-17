/**
 * Read side of the inbox for the /inbox page. Sender addresses never leave
 * the server: the page gets the domain only.
 */
import { desc, inArray } from "drizzle-orm";
import { getDb } from "#/db/index.ts";
import { inboxAttachments, inboxMessages } from "#/db/schema/inbox.ts";
import type {
	AttachmentStatus,
	Classifier,
	InboxKind,
	MessageSource,
	MessageStatus,
} from "#/lib/inbox/types.ts";

export interface InboxAttachmentView {
	id: string;
	position: number;
	filename: string;
	contentType: string;
	sizeBytes: number;
	classification: InboxKind;
	classifiedBy: Classifier;
	reason: string | null;
	status: AttachmentStatus;
	duplicateOf: string | null;
	importId: string | null;
	vendor: string | null;
	invoiceNumber: string | null;
	error: string | null;
}

export interface InboxMessageView {
	id: string;
	source: MessageSource;
	fromDomain: string | null;
	subject: string;
	receivedAt: string;
	sizeBytes: number;
	classification: InboxKind | null;
	status: MessageStatus;
	reason: string | null;
	error: string | null;
	prismTraceId: string | null;
	attachments: InboxAttachmentView[];
}

export async function listInbox(limit = 50): Promise<InboxMessageView[]> {
	const db = getDb();
	const messages = await db
		.select({
			id: inboxMessages.id,
			source: inboxMessages.source,
			fromDomain: inboxMessages.fromDomain,
			subject: inboxMessages.subject,
			receivedAt: inboxMessages.receivedAt,
			sizeBytes: inboxMessages.sizeBytes,
			classification: inboxMessages.classification,
			status: inboxMessages.status,
			reason: inboxMessages.reason,
			error: inboxMessages.error,
			prismTraceId: inboxMessages.prismTraceId,
		})
		.from(inboxMessages)
		.orderBy(desc(inboxMessages.receivedAt))
		.limit(limit);
	if (messages.length === 0) return [];
	const attachments = await db
		.select({
			id: inboxAttachments.id,
			messageId: inboxAttachments.messageId,
			position: inboxAttachments.position,
			filename: inboxAttachments.filename,
			contentType: inboxAttachments.contentType,
			sizeBytes: inboxAttachments.sizeBytes,
			classification: inboxAttachments.classification,
			classifiedBy: inboxAttachments.classifiedBy,
			reason: inboxAttachments.reason,
			status: inboxAttachments.status,
			duplicateOf: inboxAttachments.duplicateOf,
			importId: inboxAttachments.importId,
			vendor: inboxAttachments.vendor,
			invoiceNumber: inboxAttachments.invoiceNumber,
			error: inboxAttachments.error,
		})
		.from(inboxAttachments)
		.where(
			inArray(
				inboxAttachments.messageId,
				messages.map((m) => m.id),
			),
		);
	return messages.map((m) => ({
		...m,
		attachments: attachments
			.filter((a) => a.messageId === m.id)
			.sort((a, b) => a.position - b.position)
			.map(({ messageId: _, ...a }) => a),
	}));
}
