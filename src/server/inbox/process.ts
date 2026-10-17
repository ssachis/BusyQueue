/**
 * The forwarding inbox pipeline, shared by the Worker's `email()` handler
 * and the /inbox "Simulate an email" form:
 *
 *   receiveEmail   record the message (status `received`), return quickly
 *   processEmail   (in waitUntil) parse → sender check → classify each
 *                  attachment → dedupe → store → AI import for vendor bills
 *
 * Vendor bills become `invoice_imports` rows through the same service as
 * /import; a person confirms them there. Nothing is saved as an invoice
 * here, and nothing is ever dropped: ignored mail keeps its reason.
 *
 * PRISM: one session per email (`sessionId` = the inbox message id). This
 * module's spans are one trace; each import adds its own trace to the same
 * session. Everything sent to PRISM or to a model is redacted first.
 *
 * Server-only (D1, R2, Nicrron, env).
 */
import { env as workerEnv } from "cloudflare:workers";
import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { getDb } from "#/db/index.ts";
import { vendors as vendorsTable } from "#/db/schema/busyq.ts";
import { invoiceImports } from "#/db/schema/imports.ts";
import { inboxAttachments, inboxMessages } from "#/db/schema/inbox.ts";
import {
	type Classification,
	classifyAttachment,
} from "#/lib/inbox/classify.ts";
import { invoiceDedupeKey, sha256Hex } from "#/lib/inbox/dedupe.ts";
import {
	type InboundAttachment,
	type ParsedEmail,
	parseEmail,
} from "#/lib/inbox/mime.ts";
import { bodyExcerpt, emailDomain, redact } from "#/lib/inbox/redact.ts";
import { isAllowedSender } from "#/lib/inbox/senders.ts";
import {
	type AttachmentStatus,
	type Classifier,
	type InboxKind,
	MAX_MESSAGE_BYTES,
	type MessageSource,
	type MessageStatus,
	messageKind,
	messageStatus,
} from "#/lib/inbox/types.ts";
import { prismConfig } from "#/server/agent/tracing.ts";
import { loadBusiness } from "#/server/business-store.ts";
import { getServerEnv, type ServerEnv } from "#/server/env.ts";
import { importUpload } from "#/server/import/service.ts";
import { fallbackList, getNicrron } from "#/server/nicrron.ts";
import { RunTracer } from "#/server/prism.ts";
import { classifyWithModel } from "./classify-model.ts";

export const INBOX_AGENT_NAME = "busyq-inbox";

export interface InboundEmail {
	/** The raw message; null when it was too large to read. */
	raw: Uint8Array | null;
	rawSize: number;
	/** SMTP envelope (Email Routing); null for simulated mail. */
	envelopeFrom: string | null;
	envelopeTo: string | null;
	/** Header fallbacks for mail too large to parse. */
	headers?: { subject?: string | null; messageId?: string | null };
	source: MessageSource;
}

const stamp = () => new Date().toISOString();

/** Same rule as the import service: keep the extension, ASCII only. */
const safeName = (name: string) =>
	name
		.replace(/[^A-Za-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(-80) || "attachment";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Record the message and return the processing promise for `waitUntil`.
 * Throws only when the message can't even be recorded (Email Routing then
 * reports a temporary failure to the sender instead of losing the mail).
 */
export async function receiveEmail(
	email: InboundEmail,
): Promise<{ id: string; done: Promise<void> }> {
	const id = crypto.randomUUID();
	const business = await loadBusiness();
	const fromAddress = email.envelopeFrom?.toLowerCase() ?? null;
	await getDb()
		.insert(inboxMessages)
		.values({
			id,
			businessId: business.id,
			source: email.source,
			messageId: email.headers?.messageId ?? null,
			fromAddress,
			fromDomain: emailDomain(fromAddress),
			toAddress: email.envelopeTo?.toLowerCase() ?? null,
			subject: email.headers?.subject ?? "",
			sizeBytes: email.rawSize,
		});
	return {
		id,
		done: processEmail(id, email, business.legalName).catch((e) =>
			console.error(`[inbox] ${id} failed:`, e),
		),
	};
}

async function setMessage(
	id: string,
	values: Partial<typeof inboxMessages.$inferInsert>,
) {
	await getDb()
		.update(inboxMessages)
		.set({ ...values, updatedAt: stamp() })
		.where(eq(inboxMessages.id, id));
}

async function setAttachment(
	id: string,
	values: Partial<typeof inboxAttachments.$inferInsert>,
) {
	await getDb()
		.update(inboxAttachments)
		.set({ ...values, updatedAt: stamp() })
		.where(eq(inboxAttachments.id, id));
}

interface Planned {
	id: string;
	att: InboundAttachment;
	sha256: string;
	kind: InboxKind;
	classifiedBy: Classifier;
	reason: string;
	status: AttachmentStatus;
	duplicateOf: string | null;
	importId: string | null;
}

async function processEmail(
	id: string,
	email: InboundEmail,
	businessName: string,
): Promise<void> {
	const env = getServerEnv();
	const db = getDb();
	const tracer = new RunTracer(prismConfig(env), {
		sessionId: id,
		name: "busyq_inbox_email",
		agentName: INBOX_AGENT_NAME,
		input: {
			inboxMessageId: id,
			source: email.source,
			sizeBytes: email.rawSize,
			fromDomain: emailDomain(email.envelopeFrom),
			subject: redact(email.headers?.subject ?? ""),
		},
		metadata: { inbox_message_id: id, source: email.source },
	});
	await setMessage(id, { prismTraceId: tracer.traceId });

	let finishWith: { output?: unknown; error?: unknown } = {};
	const finish = async (
		status: MessageStatus,
		reason: string,
		extra: Partial<typeof inboxMessages.$inferInsert> = {},
	) => {
		await setMessage(id, { status, reason, ...extra });
		finishWith = { output: { status, reason } };
	};

	try {
		if (!email.raw || email.rawSize > MAX_MESSAGE_BYTES) {
			await tracer.traceToolCall(
				"check_size",
				{ sizeBytes: email.rawSize, maxBytes: MAX_MESSAGE_BYTES },
				() => ({ ok: true, data: { tooLarge: true } }),
			);
			await finish("ignored", "Larger than 20 MB, so it was not opened", {
				classification: "ignore",
			});
			return;
		}

		const raw = email.raw;
		// The tracer records whatever a traced function returns, so the
		// parsed message stays in this closure; only the redacted summary
		// is returned (and sent to PRISM).
		let parsedMail: ParsedEmail | undefined;
		await tracer.traceToolCall(
			"parse_email",
			{ sizeBytes: email.rawSize },
			async () => {
				const p = await parseEmail(raw);
				parsedMail = p;
				return {
					ok: true as const,
					data: {
						subject: redact(p.subject),
						fromDomain: emailDomain(p.from.address),
						attachments: p.attachments.map((a) => ({
							filename: redact(a.filename),
							declared: a.declaredType,
							detected: a.detectedType,
							inline: a.inline,
							sizeBytes: a.size,
						})),
					},
				};
			},
		);
		if (!parsedMail) throw new Error("The message could not be parsed");
		const mail: ParsedEmail = parsedMail;
		const sender = email.envelopeFrom?.toLowerCase() ?? mail.from.address;
		await setMessage(id, {
			messageId: mail.messageId,
			fromAddress: sender,
			fromDomain: emailDomain(sender),
			toAddress: email.envelopeTo?.toLowerCase() ?? mail.to[0] ?? null,
			subject: mail.subject,
			sentAt: mail.sentAt,
			attachmentCount: mail.attachments.length,
		});

		const allowed = await tracer.traceToolCall(
			"check_sender",
			{
				fromDomain: emailDomain(sender),
				allowListSize: env.INBOX_ALLOWED_SENDERS.length,
			},
			() => {
				const ok = isAllowedSender(sender, env.INBOX_ALLOWED_SENDERS);
				return ok
					? { ok: true as const, data: { allowed: true } }
					: {
							ok: false as const,
							error: {
								code: "sender_not_allowed",
								message: "Sender is not on the allow list",
							},
						};
			},
		);
		if (!allowed.ok) {
			await finish(
				"ignored",
				`Sender ${emailDomain(sender) ?? "(unknown)"} is not on the allow list`,
				{ classification: "ignore" },
			);
			return;
		}
		if (mail.attachments.length === 0) {
			await finish("ignored", "No attachments to read", {
				classification: "ignore",
			});
			return;
		}

		const vendors = (
			await db.select({ name: vendorsTable.name }).from(vendorsTable)
		).map((v) => v.name);

		// ── Classify and dedupe on bytes ──
		const planned: Planned[] = [];
		for (const att of mail.attachments) {
			planned.push(
				await planAttachment({
					env,
					tracer,
					att,
					mail,
					sender,
					vendors,
					businessName,
				}),
			);
		}
		await db.insert(inboxAttachments).values(
			planned.map((p) => ({
				id: p.id,
				messageId: id,
				position: p.att.index,
				filename: p.att.filename,
				contentType: p.att.detectedType ?? p.att.declaredType,
				sizeBytes: p.att.size,
				sha256: p.sha256,
				classification: p.kind,
				classifiedBy: p.classifiedBy,
				reason: p.reason,
				status: p.status,
				duplicateOf: p.duplicateOf,
				importId: p.importId,
			})),
		);
		const kind = messageKind(planned.map((p) => p.kind));
		await setMessage(id, { classification: kind, status: "classified" });

		// ── Contracts and our own documents: keep the file, a person files it ──
		for (const p of planned.filter((x) => x.status === "needs_manual")) {
			const r2Key = `inbox/${id}/${p.att.index}-${safeName(p.att.filename)}`;
			await tracer.traceToolCall(
				"store_attachment",
				{
					r2Key: `inbox/${id}/${p.att.index}`,
					kind: p.kind,
					sizeBytes: p.att.size,
				},
				async () => {
					await workerEnv.UPLOADS.put(r2Key, p.att.bytes, {
						httpMetadata: {
							contentType: p.att.detectedType ?? p.att.declaredType,
						},
						customMetadata: { inboxMessageId: id, kind: p.kind },
					});
					await setAttachment(p.id, { r2Key });
					return { ok: true, data: { stored: true } };
				},
			);
		}

		// ── Vendor bills: the same AI import as /import ──
		const bills = planned.filter((p) => p.status === "pending");
		if (bills.length > 0) await setMessage(id, { status: "extracting" });
		for (const p of bills) {
			p.status = await importBill({
				tracer,
				messageId: id,
				planned: p,
				vendors,
			});
		}

		const statuses = planned.map((p) => p.status);
		const status = messageStatus(statuses);
		await finish(status, summarize(planned, status));
	} catch (e) {
		finishWith = { error: e };
		await setMessage(id, {
			status: "failed",
			error: e instanceof Error ? e.message : String(e),
		}).catch(() => undefined);
	} finally {
		await tracer.finish(finishWith);
	}
}

async function planAttachment(input: {
	env: ServerEnv;
	tracer: RunTracer;
	att: InboundAttachment;
	mail: ParsedEmail;
	sender: string | null;
	vendors: string[];
	businessName: string;
}): Promise<Planned> {
	const { env, tracer, att, mail, sender, vendors, businessName } = input;
	const db = getDb();
	const id = crypto.randomUUID();
	const sha256 = await sha256Hex(att.bytes);
	const traceName = redact(att.filename);

	// Same bytes as an earlier email? Reuse its verdict; don't import again.
	const [original] = await db
		.select()
		.from(inboxAttachments)
		.where(
			and(
				eq(inboxAttachments.sha256, sha256),
				isNull(inboxAttachments.duplicateOf),
				ne(inboxAttachments.classification, "ignore"),
				inArray(inboxAttachments.status, [
					"extracting",
					"ready_for_review",
					"needs_manual",
				]),
			),
		)
		.orderBy(asc(inboxAttachments.createdAt))
		.limit(1);
	if (original) {
		await tracer.traceToolCall(
			"dedupe_attachment",
			{ filename: traceName, sha256 },
			() => ({ ok: true, data: { duplicateOf: original.id, by: "sha256" } }),
		);
		return {
			id,
			att,
			sha256,
			kind: original.classification,
			classifiedBy: original.classifiedBy,
			reason: "Same file as an earlier email; not imported again",
			status: "duplicate",
			duplicateOf: original.id,
			importId: original.importId,
		};
	}

	const rules: Classification = await tracer.traceToolCall(
		"classify_attachment",
		{
			filename: traceName,
			detectedType: att.detectedType,
			inline: att.inline,
			sizeBytes: att.size,
			subject: redact(mail.subject),
			fromDomain: emailDomain(sender),
		},
		() =>
			classifyAttachment({
				filename: att.filename,
				detectedType: att.detectedType,
				inline: att.inline,
				size: att.size,
				subject: mail.subject,
				text: mail.text,
				senderAddress: sender,
				senderName: mail.from.name,
				ownDomains: env.INBOX_OWN_DOMAINS,
				businessName,
				vendors,
			}),
	);

	let kind = rules.kind;
	let classifiedBy: Classifier = "rules";
	let reason = rules.reasons.join("; ");
	if (rules.confidence === "low" && env.NICRRON_API_KEY) {
		const model = await classifyWithModel({
			client: getNicrron(env),
			tracer,
			models: fallbackList(
				env.INBOX_CLASSIFY_MODEL,
				env.INBOX_CLASSIFY_FALLBACK_MODELS,
			),
			attachment: {
				subject: redact(mail.subject),
				filename: traceName,
				contentType: att.detectedType ?? att.declaredType,
				senderDomain: emailDomain(sender),
				bodyExcerpt: bodyExcerpt(mail.text),
				vendors,
				rulesGuess: `${rules.kind} (${rules.reasons.join("; ") || "no signals"})`,
			},
		});
		if (model.ok) {
			kind = model.value.kind;
			classifiedBy = "model";
			reason = model.value.reason;
		} else {
			reason = `${reason}; model unavailable, kept the rules' guess`;
		}
	}

	const status: AttachmentStatus =
		kind === "invoice_in"
			? "pending"
			: kind === "ignore"
				? "ignored"
				: "needs_manual";
	return {
		id,
		att,
		sha256,
		kind,
		classifiedBy,
		reason,
		status,
		duplicateOf: null,
		importId: null,
	};
}

async function importBill(input: {
	tracer: RunTracer;
	messageId: string;
	planned: Planned;
	vendors: string[];
}): Promise<AttachmentStatus> {
	const { tracer, messageId, planned: p, vendors } = input;
	const db = getDb();
	await setAttachment(p.id, { status: "extracting" });
	const type = p.att.detectedType ?? p.att.declaredType;
	// The import's own trace sees only the redacted filename.
	const file = new File(
		[p.att.bytes as Uint8Array<ArrayBuffer>],
		redact(p.att.filename),
		{ type },
	);

	// Only ids and counts are returned to the tracer; the read draft has its
	// own trace in the import service.
	let result: Awaited<ReturnType<typeof importUpload>> | undefined;
	let thrown: string | null = null;
	await tracer
		.traceToolCall(
			"import_invoice",
			{
				filename: redact(p.att.filename),
				contentType: type,
				sizeBytes: p.att.size,
			},
			async () => {
				const r = await importUpload(file, {
					sessionId: messageId,
					source: "inbox",
				});
				result = r;
				return r.ok
					? {
							ok: true as const,
							data: {
								importId: r.body.importId,
								lines: r.body.draft.lines.length,
								uncertain: r.body.uncertain.length,
							},
						}
					: {
							ok: false as const,
							error: { code: `import_${r.status}`, message: r.body.error },
						};
			},
		)
		.catch((e: unknown) => {
			// Already recorded as an error span; keep the other attachments going.
			thrown = e instanceof Error ? e.message : String(e);
		});
	if (!result?.ok) {
		await setAttachment(p.id, {
			status: "failed",
			error: result?.body.error ?? thrown ?? "The import did not run",
			importId: result?.body.importId ?? null,
		});
		return "failed";
	}

	const { importId, draft } = result.body;
	const [row] = await db
		.select({ r2Key: invoiceImports.r2Key })
		.from(invoiceImports)
		.where(eq(invoiceImports.id, importId));
	const dedupeKey = invoiceDedupeKey(
		draft.vendor,
		draft.invoiceNumber,
		vendors,
	);
	const earlier = dedupeKey
		? await tracer.traceToolCall("dedupe_invoice", { dedupeKey }, async () => {
				const [hit] = await db
					.select({
						id: inboxAttachments.id,
						importId: inboxAttachments.importId,
					})
					.from(inboxAttachments)
					.where(
						and(
							eq(inboxAttachments.dedupeKey, dedupeKey),
							isNull(inboxAttachments.duplicateOf),
							ne(inboxAttachments.id, p.id),
						),
					)
					.orderBy(asc(inboxAttachments.createdAt))
					.limit(1);
				return {
					ok: true as const,
					data: { duplicateOf: hit?.id ?? null },
					hit,
				};
			})
		: null;
	const duplicate = earlier?.hit;
	await setAttachment(p.id, {
		importId,
		r2Key: row?.r2Key ?? null,
		vendor: draft.vendor || null,
		invoiceNumber: draft.invoiceNumber || null,
		dedupeKey,
		...(duplicate
			? {
					status: "duplicate",
					duplicateOf: duplicate.id,
					reason: `${p.reason}; same vendor and invoice number as an earlier email`,
				}
			: { status: "ready_for_review" }),
	});
	return duplicate ? "duplicate" : "ready_for_review";
}

function summarize(planned: Planned[], status: MessageStatus): string {
	const count = (s: AttachmentStatus) =>
		planned.filter((p) => p.status === s).length;
	const parts: string[] = [];
	const ready = count("ready_for_review");
	if (ready) parts.push(`${plural(ready, "vendor invoice")} ready for review`);
	const manual = planned.filter((p) => p.status === "needs_manual");
	if (manual.length) {
		const kinds = [
			...new Set(
				manual.map((p) =>
					p.kind === "contract" ? "contract" : "our own document",
				),
			),
		];
		parts.push(`${kinds.join(" and ")} to handle by hand`);
	}
	const dup = count("duplicate");
	if (dup) parts.push(`${plural(dup, "duplicate")} of earlier mail`);
	const failed = count("failed");
	if (failed) parts.push(`${plural(failed, "attachment")} failed`);
	if (parts.length === 0 && status === "ignored") {
		return "No vendor invoices, contracts or documents of ours attached";
	}
	const text = parts.join("; ");
	return text.charAt(0).toUpperCase() + text.slice(1);
}
