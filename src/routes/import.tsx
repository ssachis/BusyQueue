import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ImportPage } from "#/components/import/import-page.tsx";
import { getImport } from "#/server/imports.ts";

const Search = z.object({
	/** Reopen an earlier import (e.g. one the inbox created) for review. */
	id: z.uuid().optional().catch(undefined),
});

export const Route = createFileRoute("/import")({
	head: () => ({ meta: [{ title: "Import an invoice · BusyQ" }] }),
	validateSearch: (search) => Search.parse(search),
	loaderDeps: ({ search }) => ({ id: search.id }),
	loader: ({ deps }) =>
		deps.id ? getImport({ data: { importId: deps.id } }) : null,
	component: ImportRoute,
});

function ImportRoute() {
	const stored = Route.useLoaderData();
	return <ImportPage key={stored?.importId ?? "new"} stored={stored} />;
}
