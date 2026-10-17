import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { importFile } from "#/server/import/service.ts";

/**
 * GET /api/imports/:importId/file: the stored document of an import, for
 * the preview when an earlier import is reopened on /import?id=….
 */
export const Route = createFileRoute("/api/imports/$importId/file")({
	server: {
		handlers: {
			GET: async ({ params }) => {
				const id = z.uuid().safeParse(params.importId);
				const res = id.success ? await importFile(id.data) : null;
				return res ?? new Response("Not found", { status: 404 });
			},
		},
	},
});
