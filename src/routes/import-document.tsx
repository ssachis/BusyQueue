import { createFileRoute } from "@tanstack/react-router";
import { DocImportPage } from "#/components/doc-import/doc-import-page.tsx";

export const Route = createFileRoute("/import-document")({
	head: () => ({ meta: [{ title: "Import a paper document · BusyQ" }] }),
	component: DocImportPage,
});
