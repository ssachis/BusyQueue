import { createFileRoute } from "@tanstack/react-router";
import { ImportPage } from "#/components/import/import-page.tsx";

export const Route = createFileRoute("/import")({
	head: () => ({ meta: [{ title: "Import an invoice · BusyQ" }] }),
	component: ImportPage,
});
