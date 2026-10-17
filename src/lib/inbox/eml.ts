/**
 * Build a raw RFC 5322 message (multipart/mixed, base64 attachments). Used
 * by the /inbox "Simulate an email" form and the tests, so a simulated
 * email goes through exactly the same MIME parsing as a real one.
 * Pure; runs in the browser, Workers and Node.
 */

export interface EmlAttachment {
	filename: string;
	contentType: string;
	bytes: Uint8Array;
}

export interface EmlInput {
	from: string;
	to: string;
	subject: string;
	text: string;
	attachments: EmlAttachment[];
	/** Defaults to a random id at example.invalid. */
	messageId?: string;
	date?: Date;
}

/** Base64 with 76-character lines, as MIME requires. */
export function base64Lines(bytes: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return (btoa(binary).match(/.{1,76}/g) ?? []).join("\r\n");
}

/** RFC 2047 encoded-word for non-ASCII header values. */
function headerValue(value: string): string {
	const clean = value.replace(/[\r\n]+/g, " ");
	if (/^[\x20-\x7e]*$/.test(clean)) return clean;
	return `=?UTF-8?B?${base64Lines(new TextEncoder().encode(clean)).replace(/\r\n/g, "")}?=`;
}

const quotedName = (name: string) => name.replace(/["\\\r\n]/g, "_");

export function buildEml(input: EmlInput): string {
	const boundary = `----busyq-${crypto.randomUUID()}`;
	const messageId =
		input.messageId ?? `<${crypto.randomUUID()}@simulated.example.invalid>`;
	const lines = [
		`From: ${headerValue(input.from)}`,
		`To: ${headerValue(input.to)}`,
		`Subject: ${headerValue(input.subject)}`,
		`Date: ${(input.date ?? new Date()).toUTCString()}`,
		`Message-ID: ${messageId}`,
		"MIME-Version: 1.0",
		`Content-Type: multipart/mixed; boundary="${boundary}"`,
		"",
		`--${boundary}`,
		'Content-Type: text/plain; charset="utf-8"',
		"Content-Transfer-Encoding: base64",
		"",
		base64Lines(new TextEncoder().encode(input.text)),
	];
	for (const a of input.attachments) {
		const name = quotedName(a.filename);
		lines.push(
			`--${boundary}`,
			`Content-Type: ${a.contentType}; name="${name}"`,
			`Content-Disposition: attachment; filename="${name}"`,
			"Content-Transfer-Encoding: base64",
			"",
			base64Lines(a.bytes),
		);
	}
	lines.push(`--${boundary}--`, "");
	return lines.join("\r\n");
}
