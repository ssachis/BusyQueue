/**
 * Raw MIME → the fields the inbox keeps. postal-mime is plain JS (no Node
 * APIs), so the same parser runs in the Email Worker, the simulate endpoint
 * and Vitest. No I/O.
 */
import PostalMime, { type Address } from "postal-mime";
import { sniffContentType, type UploadType } from "#/lib/import/extraction.ts";

export interface InboundAttachment {
	/** 0-based position in the message, stable across re-parses. */
	index: number;
	filename: string;
	/** As declared by the sender's mail client; not trusted. */
	declaredType: string;
	/** From the file's first bytes; null when it isn't a PDF or image we read. */
	detectedType: UploadType | null;
	/** True for parts shown in the body (logos, signatures), not attached. */
	inline: boolean;
	size: number;
	bytes: Uint8Array;
}

export interface ParsedEmail {
	messageId: string | null;
	from: { address: string | null; name: string | null };
	to: string[];
	subject: string;
	/** The Date header as ISO, when it parses. */
	sentAt: string | null;
	/** Plain-text body (or the HTML with tags stripped), trimmed. */
	text: string;
	attachments: InboundAttachment[];
}

const EXTENSIONS: Record<string, string> = {
	"application/pdf": "pdf",
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/webp": "webp",
};

function mailboxes(list: Address[] | Address | undefined) {
	const all = list === undefined ? [] : Array.isArray(list) ? list : [list];
	return all.flatMap((a) => (a.group ? a.group : [a]));
}

function toBytes(content: ArrayBuffer | Uint8Array | string): Uint8Array {
	if (typeof content === "string") return new TextEncoder().encode(content);
	return content instanceof Uint8Array ? content : new Uint8Array(content);
}

/** Crude HTML → text for bodies that have no text part. */
export function htmlToText(html: string): string {
	return html
		.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
		.replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/[ \t]+/g, " ")
		.replace(/\n\s*\n+/g, "\n")
		.trim();
}

function isoDate(value: string | undefined): string | null {
	if (!value) return null;
	const ms = Date.parse(value);
	return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

export async function parseEmail(
	raw: string | ArrayBuffer | Uint8Array,
): Promise<ParsedEmail> {
	const email = await PostalMime.parse(raw, {
		attachmentEncoding: "arraybuffer",
	});
	const from = mailboxes(email.from)[0];
	const attachments = email.attachments.map((a, index): InboundAttachment => {
		const bytes = toBytes(a.content);
		const detectedType = sniffContentType(bytes);
		const fallbackName = `attachment-${index + 1}${
			detectedType ? `.${EXTENSIONS[detectedType]}` : ""
		}`;
		return {
			index,
			filename: a.filename?.trim() || fallbackName,
			declaredType: a.mimeType.toLowerCase(),
			detectedType,
			inline: a.disposition === "inline" || (!!a.contentId && !a.filename),
			size: bytes.length,
			bytes,
		};
	});
	return {
		messageId: email.messageId?.trim() || null,
		from: {
			address: from?.address?.toLowerCase() || null,
			name: from?.name?.trim() || null,
		},
		to: mailboxes(email.to)
			.map((m) => m.address?.toLowerCase())
			.filter((a): a is string => !!a),
		subject: email.subject?.trim() ?? "",
		sentAt: isoDate(email.date),
		text: (email.text?.trim() || htmlToText(email.html ?? "")).slice(0, 20_000),
		attachments,
	};
}
