/**
 * AI import with the real dependencies: R2 for the file, D1 for the import
 * row and the saved invoice, Nicrron for the read, PRISM for the trace.
 *
 * Server-only (imports the D1 client and Worker bindings). Imported only by
 * the /api/imports route and the server functions in src/server/imports.ts.
 *
 * One PRISM session per import (`sessionId = importId`): the upload and read
 * is one trace, saving is another, and the agent run on the saved invoice
 * has its own session as usual.
 */
import { env as workerEnv } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from "#/db/index.ts";
import { invoiceLines, invoices } from "#/db/schema/busyq.ts";
import { invoiceImports } from "#/db/schema/imports.ts";
import type { AgentVersion } from "#/lib/busyq/types.ts";
import type {
	ImportErrorResponse,
	ImportResponse,
	ImportRunSummary,
	SavedImport,
} from "#/lib/import/api.ts";
import {
	correctedPaths,
	draftToInvoice,
	type ImportDraft,
	MAX_UPLOAD_BYTES,
	sniffContentType,
} from "#/lib/import/extraction.ts";
import { executeRun } from "#/server/agent/execute.ts";
import { prismConfig } from "#/server/agent/tracing.ts";
import { getServerEnv } from "#/server/env.ts";
import { getNicrron } from "#/server/nicrron.ts";
import { RunTracer } from "#/server/prism.ts";
import { extractInvoice, modelsFor } from "./extract.ts";

export const IMPORT_AGENT_NAME = "busyq-importer";

export type UploadOutcome =
	| { ok: true; body: ImportResponse }
	| {
			ok: false;
			status: 400 | 413 | 415 | 422 | 502;
			body: ImportErrorResponse;
	  };

const stamp = () => new Date().toISOString();

/** Keep the extension and something readable; R2 keys stay ASCII. */
const safeName = (name: string) =>
	name
		.replace(/[^A-Za-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(-80) || "upload";

export async function importUpload(file: File): Promise<UploadOutcome> {
	if (file.size === 0) {
		return { ok: false, status: 400, body: { error: "The file is empty." } };
	}
	if (file.size > MAX_UPLOAD_BYTES) {
		return {
			ok: false,
			status: 413,
			body: { error: "The file is larger than 10 MB." },
		};
	}
	const bytes = new Uint8Array(await file.arrayBuffer());
	const type = sniffContentType(bytes);
	if (!type) {
		return {
			ok: false,
			status: 415,
			body: { error: "Upload a PNG, JPEG or WebP photo, or a PDF." },
		};
	}

	const env = getServerEnv();
	const db = getDb();
	const id = crypto.randomUUID();
	const filename = file.name || "upload";
	const r2Key = `imports/${id}/${safeName(filename)}`;
	const models = modelsFor(type, {
		image: env.IMPORT_MODEL,
		imageFallbacks: env.IMPORT_FALLBACK_MODELS,
		pdf: env.IMPORT_PDF_MODELS,
	});
	const tracer = new RunTracer(prismConfig(env), {
		sessionId: id,
		name: "busyq_invoice_import",
		agentName: IMPORT_AGENT_NAME,
		input: { importId: id, filename, contentType: type, sizeBytes: file.size },
		metadata: {
			import_id: id,
			content_type: type,
			requested_models: models.join(","),
		},
	});

	let finishWith: { output?: unknown; error?: unknown } = {};
	try {
		await tracer.traceToolCall(
			"store_upload",
			{ r2Key, contentType: type, sizeBytes: file.size },
			async () => {
				await workerEnv.UPLOADS.put(r2Key, bytes, {
					httpMetadata: { contentType: type },
					customMetadata: { filename, importId: id },
				});
				await db.insert(invoiceImports).values({
					id,
					r2Key,
					filename,
					contentType: type,
					sizeBytes: file.size,
					requestedModel: models[0],
					prismTraceId: tracer.traceId,
				});
				return { ok: true, data: { r2Key } };
			},
		);

		const result = await extractInvoice({
			client: getNicrron(env),
			tracer,
			bytes,
			type,
			filename,
			models,
		});

		if (!result.ok) {
			await db
				.update(invoiceImports)
				.set({
					status: "failed",
					model: result.model,
					error: result.error,
					updatedAt: stamp(),
				})
				.where(eq(invoiceImports.id, id));
			finishWith = { error: result.error };
			return {
				ok: false,
				status: result.model ? 422 : 502,
				body: {
					error: result.error,
					importId: id,
					prismTraceId: tracer.traceId,
				},
			};
		}

		const { draft, uncertain, issues, notes } = result.extraction;
		await db
			.update(invoiceImports)
			.set({
				status: "extracted",
				model: result.model,
				extracted: draft,
				uncertain,
				updatedAt: stamp(),
			})
			.where(eq(invoiceImports.id, id));
		const existing = draft.invoiceNumber
			? await db
					.select({ id: invoices.id, vendor: invoices.vendorName })
					.from(invoices)
					.where(eq(invoices.invoiceNumber, draft.invoiceNumber))
			: [];

		finishWith = {
			output: {
				model: result.model,
				fallbackUsed: result.fallbackUsed,
				lines: draft.lines.length,
				uncertain: uncertain.length,
				issues: Object.keys(issues).length,
			},
		};
		return {
			ok: true,
			body: {
				importId: id,
				filename,
				contentType: type,
				draft,
				uncertain,
				issues,
				notes,
				requestedModel: result.requestedModel,
				model: result.model,
				fallbackUsed: result.fallbackUsed,
				prismTraceId: tracer.traceId,
				existing,
			},
		};
	} catch (e) {
		finishWith = { error: e };
		throw e;
	} finally {
		await tracer.finish(finishWith);
	}
}

export class ImportError extends Error {}

/** Save the reviewed draft as a new invoice. Saving twice returns the first invoice. */
export async function saveImportedInvoice(input: {
	importId: string;
	draft: ImportDraft;
}): Promise<SavedImport> {
	const env = getServerEnv();
	const db = getDb();
	const [row] = await db
		.select()
		.from(invoiceImports)
		.where(eq(invoiceImports.id, input.importId));
	if (!row) throw new ImportError(`No import ${input.importId}`);
	if (row.status === "saved" && row.invoiceId) {
		return {
			invoiceId: row.invoiceId,
			corrected: [],
			prismTraceId: row.prismTraceId ?? "",
		};
	}
	if (row.status !== "extracted" || !row.extracted) {
		throw new ImportError("This import has nothing to save");
	}

	const invoiceId = `imp-${input.importId.slice(0, 8)}`;
	const parsed = draftToInvoice(input.draft, invoiceId);
	if (!parsed.success) {
		throw new ImportError(
			`Fix these fields first: ${parsed.error.issues
				.map((i) => i.path.join("."))
				.join(", ")}`,
		);
	}
	const invoice = parsed.data;
	const corrected = correctedPaths(row.extracted, input.draft);

	const tracer = new RunTracer(prismConfig(env), {
		sessionId: input.importId,
		name: "busyq_import_save",
		agentName: IMPORT_AGENT_NAME,
		input: { importId: input.importId, invoiceId },
		metadata: {
			import_id: input.importId,
			invoice_id: invoiceId,
			model: row.model,
			corrected_fields: corrected.length,
		},
		trajectory: false,
	});
	let finishWith: { output?: unknown; error?: unknown } = {};
	try {
		await tracer.traceToolCall(
			"save_invoice",
			{ invoiceId, lines: invoice.lines.length, corrected },
			async () => {
				await db.batch([
					db.insert(invoices).values({
						id: invoice.id,
						vendorName: invoice.vendor,
						invoiceNumber: invoice.invoiceNumber,
						issueDate: invoice.issueDate,
						dueDate: invoice.dueDate ?? null,
						currency: invoice.currency,
						statedTotal: invoice.statedTotal,
					}),
					db
						.insert(invoiceLines)
						.values(
							invoice.lines.map((l) => ({ invoiceId: invoice.id, ...l })),
						),
					db
						.update(invoiceImports)
						.set({ status: "saved", invoiceId, updatedAt: stamp() })
						.where(eq(invoiceImports.id, input.importId)),
				]);
				return { ok: true, data: { invoiceId } };
			},
		);
		finishWith = { output: { invoiceId, corrected } };
	} catch (e) {
		finishWith = { error: e };
		throw e;
	} finally {
		await tracer.finish(finishWith);
	}
	return { invoiceId, corrected, prismTraceId: tracer.traceId };
}

/** Audit a saved import with the BusyQ agent (same path as POST /api/runs). */
export async function runAgentOnImport(input: {
	invoiceId: string;
	version: AgentVersion;
}): Promise<ImportRunSummary> {
	const run = await executeRun(input);
	if (!run.ok) throw new ImportError(run.error);
	const r = run.result;
	return {
		runId: r.runId,
		invoiceId: r.invoiceId,
		version: r.version,
		status: r.status,
		error: r.error?.message ?? null,
		findings: r.findings,
		totalMinor: r.total.minor,
		currency: r.total.currency,
		toolCalls: r.toolCalls.length,
		failedTools: r.toolCalls
			.filter((c) => c.status === "error")
			.map((c) => ({ name: c.name, code: c.errorCode ?? null })),
		prismTraceId: r.prismTraceId,
	};
}
