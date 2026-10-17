import { createFileRoute } from "@tanstack/react-router";
import { MAX_UPLOAD_BYTES } from "#/lib/import/extraction.ts";
import { importUpload } from "#/server/import/service.ts";

/**
 * POST /api/imports: multipart form with one `file` (PNG, JPEG, WebP or PDF,
 * up to 10 MB). Stores it in R2, reads it through Nicrron and returns the
 * editable draft with the fields a person should check.
 */
export const Route = createFileRoute("/api/imports")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const declared = Number(request.headers.get("content-length") ?? "0");
				// Multipart overhead is small; refuse obviously oversized bodies early.
				if (declared > MAX_UPLOAD_BYTES + 64 * 1024) {
					return Response.json(
						{ error: "The file is larger than 10 MB." },
						{ status: 413 },
					);
				}
				const form = await request.formData().catch(() => null);
				const file = form?.get("file");
				if (!(file instanceof File)) {
					return Response.json(
						{ error: "Send the document as a multipart `file` field." },
						{ status: 400 },
					);
				}
				const outcome = await importUpload(file);
				return outcome.ok
					? Response.json(outcome.body)
					: Response.json(outcome.body, { status: outcome.status });
			},
		},
	},
});
