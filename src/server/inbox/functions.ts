/** Inbox server functions (callable from the /inbox page). */
import { waitUntil } from "cloudflare:workers";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { MAX_MESSAGE_BYTES } from "#/lib/inbox/types.ts";
import { getServerEnv } from "#/server/env.ts";
import { receiveEmail } from "./process.ts";
import { listInbox } from "./store.ts";

export const getInbox = createServerFn({ method: "GET" }).handler(async () => {
	const env = getServerEnv();
	return { address: env.INBOX_ADDRESS, messages: await listInbox() };
});

/**
 * Demo and local testing: run a raw .eml through exactly the pipeline the
 * Email Worker uses (same parsing, classification, dedupe and import).
 */
export const simulateEmail = createServerFn({ method: "POST" })
	.validator((input: unknown) =>
		z
			.object({
				// Base64 inflates attachments by a third; leave room for that.
				raw: z
					.string()
					.min(1)
					.max(Math.ceil(MAX_MESSAGE_BYTES * 1.4)),
			})
			.parse(input),
	)
	.handler(async ({ data }) => {
		const env = getServerEnv();
		const raw = new TextEncoder().encode(data.raw);
		const { id, done } = await receiveEmail({
			raw,
			rawSize: raw.length,
			envelopeFrom: null,
			envelopeTo: env.INBOX_ADDRESS,
			source: "simulated",
		});
		waitUntil(done);
		return { id };
	});
