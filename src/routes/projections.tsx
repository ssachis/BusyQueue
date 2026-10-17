import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ProjectionsPage } from "#/components/projections/projections-page.tsx";
import { IsoDate } from "#/lib/busyq/types.ts";
import { getProjections } from "#/server/projections.ts";

const Search = z.object({
	/** Replay the forecast as of this date; default chosen by the server. */
	asOf: IsoDate.optional().catch(undefined),
});

export const Route = createFileRoute("/projections")({
	validateSearch: (search) => Search.parse(search),
	loaderDeps: ({ search }) => ({ asOf: search.asOf }),
	loader: ({ deps }) => getProjections({ data: { asOf: deps.asOf } }),
	head: () => ({ meta: [{ title: "Projections · BusyQ" }] }),
	component: ProjectionsPage,
});
