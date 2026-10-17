/**
 * AI import of the business's own documents with the real dependencies: R2
 * for the file, D1 for the import row and the draft, Nicrron for the read,
 * PRISM for the trace.
 *
 * Server-only (imports the D1 client and Worker bindings). Imported only by
 * the /api/document-imports route and the server functions in functions.ts.
 *
 * One PRISM session per import (`sessionId = importId`): the upload and read
 * is one trace, creating the draft is another.
 */
import { env as workerEnv } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { getDb } from "#/db/index.ts";
import { documentImports } from "#/db/schema/doc-imports.ts";
import { documentLines, documents } from "#/db/schema/documents.ts";
import type {
	CreatedDraft,
	DocImportErrorResponse,
	DocImportResponse,
} from "#/lib/doc-import/api.ts";
import {
	correctedPaths,
	type DocImportForm,
	type SellerContext,
} from "#/lib/doc-import/form.ts";
import { formToDraft, validateForm } from "#/lib/doc-import/validate.ts";
import { MAX_UPLOAD_BYTES, sniffContentType } from "#/lib/import/extraction.ts";
import { isTaxCountry } from "#/lib/tax/index.ts";
import { prismConfig } from "#/server/agent/tracing.ts";
import { currentBusinessId, loadBusiness } from "#/server/business-store.ts";
import { activityInsert } from "#/server/documents/activity.ts";
import { getServerEnv } from "#/server/env.ts";
import { modelsFor } from "#/server/import/extract.ts";
import { getNicrron } from "#/server/nicrron.ts";
import { RunTracer } from "#/server/prism.ts";
import { matchClient } from "./client-match.ts";
import { extractDocument } from "./extract.ts";

export const DOC_IMPORT_AGENT_NAME = "busyq-document-import";

export type DocUploadOutcome =
	| { ok: true; body: DocImportResponse }
	| {
			ok: false;
			status: 400 | 413 | 415 | 422 | 502;
			body: DocImportErrorResponse;
	  };

export class DocImportError extends Error {}

const stamp = () => new Date().toISOString();

/** Keep the extension and something readable; R2 keys stay ASCII. */
const safeName = (name: string) =>
	name
		.replace(/[^A-Za-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(-80) || "upload";

/** The current business as the seller the import is checked against. */
async function currentSeller(): Promise<SellerContext> {
	const b = await loadBusiness();
	if (!isTaxCountry(b.country)) {
		throw new DocImportError(
			`No tax rules for the business country ${b.country}`,
		);
	}
	return {
		name: b.legalName,
		country: b.country,
		region: b.region ?? undefined,
		taxId: b.taxIds[0]?.value,
		currency: b.currency,
	};
}

export async function importDocumentUpload(
	file: File,
): Promise<DocUploadOutcome> {
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
	const seller = await currentSeller();
	const businessId = currentBusinessId();
	const id = crypto.randomUUID();
	const filename = file.name || "upload";
	const r2Key = `document-imports/${id}/${safeName(filename)}`;
	const models = modelsFor(type, {
		image: env.DOC_IMPORT_MODEL,
		imageFallbacks: env.DOC_IMPORT_FALLBACK_MODELS,
		pdf: env.DOC_IMPORT_PDF_MODELS,
	});
	const tracer = new RunTracer(prismConfig(env), {
		sessionId: id,
		name: "busyq_document_import",
		agentName: DOC_IMPORT_AGENT_NAME,
		input: { importId: id, filename, contentType: type, sizeBytes: file.size },
		metadata: {
			import_id: id,
			business_id: businessId,
			seller_country: seller.country,
			content_type: type,
			requested_model: models[0],
			fallback_models: models.slice(1).join(","),
		},
	});

	let finishWith: {
		output?: unknown;
		error?: unknown;
		metadata?: Record<string, unknown>;
	} = {};
	try {
		await tracer.traceToolCall(
			"store_upload",
			{ r2Key, contentType: type, sizeBytes: file.size },
			async () => {
				await workerEnv.UPLOADS.put(r2Key, bytes, {
					httpMetadata: { contentType: type },
					customMetadata: { filename, importId: id, kind: "document" },
				});
				await db.insert(documentImports).values({
					id,
					businessId,
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

		const result = await extractDocument({
			client: getNicrron(env),
			tracer,
			bytes,
			type,
			filename,
			models,
			seller,
		});

		if (!result.ok) {
			await db
				.update(documentImports)
				.set({
					status: "failed",
					model: result.model,
					error: result.error,
					updatedAt: stamp(),
				})
				.where(eq(documentImports.id, id));
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

		const { extraction } = result;
		const client = await tracer.traceToolCall(
			"match_client",
			{ buyer: extraction.form.buyer.name },
			async () => {
				const match = await matchClient(
					db,
					businessId,
					extraction.form.buyer.name,
				);
				return { ok: true, data: match };
			},
		);
		const form: DocImportForm = client.data
			? { ...extraction.form, clientId: client.data.id }
			: extraction.form;

		await db
			.update(documentImports)
			.set({
				status: "extracted",
				model: result.model,
				extracted: form,
				uncertain: extraction.uncertain,
				updatedAt: stamp(),
			})
			.where(eq(documentImports.id, id));

		finishWith = {
			output: {
				type: form.type,
				lines: form.lines.length,
				uncertain: extraction.uncertain.length,
				issues: Object.keys(extraction.issues).length,
				totalsMismatch: Object.keys(extraction.mismatches),
				client: client.data?.id ?? null,
			},
			metadata: {
				resolved_model: result.model,
				fallback_used: result.fallbackUsed,
				document_type: form.type,
			},
		};
		return {
			ok: true,
			body: {
				importId: id,
				filename,
				contentType: type,
				form,
				uncertain: extraction.uncertain,
				reasons: extraction.reasons,
				issues: extraction.issues,
				mismatches: extraction.mismatches,
				legibility: extraction.legibility,
				seller,
				client: client.data,
				requestedModel: result.requestedModel,
				model: result.model,
				fallbackUsed: result.fallbackUsed,
				prismTraceId: tracer.traceId,
			},
		};
	} catch (e) {
		finishWith = { error: e };
		throw e;
	} finally {
		await tracer.finish(finishWith);
	}
}

/**
 * Create the reviewed form as a draft document (no number, status draft)
 * with its lines and a `created` activity entry, in one D1 batch. The
 * draft's id is derived from the import, so creating twice (a double click,
 * a retry) can't make a second draft: the second insert fails and the first
 * draft is returned.
 */
export async function createDraftFromImport(input: {
	importId: string;
	form: DocImportForm;
}): Promise<CreatedDraft> {
	const env = getServerEnv();
	const db = getDb();
	const businessId = currentBusinessId();
	const load = async () => {
		const [row] = await db
			.select()
			.from(documentImports)
			.where(
				and(
					eq(documentImports.id, input.importId),
					eq(documentImports.businessId, businessId),
				),
			);
		return row;
	};
	const row = await load();
	if (!row) throw new DocImportError(`No import ${input.importId}`);
	if (row.status === "created" && row.documentId) {
		return {
			documentId: row.documentId,
			corrected: [],
			prismTraceId: row.prismTraceId ?? "",
			existing: true,
		};
	}
	if (row.status !== "extracted" || !row.extracted) {
		throw new DocImportError("This import has nothing to create a draft from");
	}

	const seller = await currentSeller();
	const issues = validateForm(input.form, seller);
	const parsed = formToDraft(input.form);
	if (Object.keys(issues).length > 0 || !parsed.success) {
		throw new DocImportError(
			`Fix these fields first: ${Object.keys(issues).join(", ") || "lines"}`,
		);
	}
	const draft = parsed.data;
	const corrected = correctedPaths(row.extracted, input.form);
	const documentId = `doc-${input.importId}`;
	const printedNumber = input.form.printed.number.trim() || null;

	const tracer = new RunTracer(prismConfig(env), {
		sessionId: input.importId,
		name: "busyq_document_import_create",
		agentName: DOC_IMPORT_AGENT_NAME,
		input: { importId: input.importId, documentId, type: draft.type },
		metadata: {
			import_id: input.importId,
			document_id: documentId,
			document_type: draft.type,
			model: row.model,
			corrected_fields: corrected.length,
		},
		trajectory: false,
	});
	let finishWith: { output?: unknown; error?: unknown } = {};
	try {
		await tracer.traceToolCall(
			"create_draft",
			{ documentId, type: draft.type, lines: draft.lines.length, corrected },
			async () => {
				await db.batch([
					db.insert(documents).values({
						id: documentId,
						businessId,
						type: draft.type,
						status: "draft",
						date: draft.date,
						dueDate: draft.dueDate ?? null,
						currency: draft.currency,
						clientId: draft.clientId ?? null,
						buyer: draft.buyer,
						placeOfSupply: draft.placeOfSupply ?? null,
						notes: draft.notes ?? null,
						terms: draft.terms ?? null,
					}),
					...(draft.lines.length
						? [
								db.insert(documentLines).values(
									draft.lines.map((l) => ({
										documentId,
										lineNo: l.lineNo,
										description: l.description,
										quantity: l.quantity,
										unit: l.unit ?? null,
										unitPrice: l.unitPrice,
										discount: l.discount ?? null,
										taxCode: l.taxCode,
										rate: l.rate ?? null,
										hsnSac: l.hsnSac ?? null,
									})),
								),
							]
						: []),
					activityInsert(db, {
						documentId,
						kind: "created",
						detail: {
							source: "import",
							importId: input.importId,
							printedNumber,
							corrected: corrected.length,
						},
					}),
					db
						.update(documentImports)
						.set({ status: "created", documentId, updatedAt: stamp() })
						.where(eq(documentImports.id, input.importId)),
				]);
				return { ok: true, data: { documentId } };
			},
		);
		finishWith = { output: { documentId, corrected } };
	} catch (e) {
		// Lost a race with another create of the same import: return its draft.
		const again = await load().catch(() => undefined);
		if (again?.status === "created" && again.documentId) {
			finishWith = { output: { documentId: again.documentId, existing: true } };
			return {
				documentId: again.documentId,
				corrected,
				prismTraceId: tracer.traceId,
				existing: true,
			};
		}
		finishWith = { error: e };
		throw e;
	} finally {
		await tracer.finish(finishWith);
	}
	return {
		documentId,
		corrected,
		prismTraceId: tracer.traceId,
		existing: false,
	};
}
