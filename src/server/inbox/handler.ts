/**
 * The Worker's `email()` handler (wired in src/worker.ts). Email Routing
 * delivers mail for the inbox address here. The message is read and
 * recorded before returning; classification and the AI import continue in
 * `ctx.waitUntil`, so delivery is acknowledged quickly.
 *
 * Mail is never rejected: ignored messages are stored with a reason on
 * /inbox. If recording fails the error propagates, so Email Routing reports
 * a failure instead of losing the message silently.
 */
import { MAX_MESSAGE_BYTES } from "#/lib/inbox/types.ts";
import { receiveEmail } from "./process.ts";

export async function handleInboundEmail(
	message: ForwardableEmailMessage,
	ctx: ExecutionContext,
): Promise<void> {
	const tooLarge = message.rawSize > MAX_MESSAGE_BYTES;
	const raw = tooLarge
		? null
		: new Uint8Array(await new Response(message.raw).arrayBuffer());
	const { id, done } = await receiveEmail({
		raw,
		rawSize: message.rawSize,
		envelopeFrom: message.from,
		envelopeTo: message.to,
		headers: {
			subject: message.headers.get("subject"),
			messageId: message.headers.get("message-id"),
		},
		source: "email",
	});
	console.log(`[inbox] received ${id} (${message.rawSize} bytes)`);
	ctx.waitUntil(done);
}
