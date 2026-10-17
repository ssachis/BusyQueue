import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { DashboardPage } from "#/components/dashboard/dashboard-page.tsx";
import { getDashboard } from "#/server/dashboard.ts";

const Search = z.object({
	/** The review page used to live here: `/?v=…&invoice=…` now redirects. */
	v: z.string().optional().catch(undefined),
	invoice: z.string().min(1).optional().catch(undefined),
	/** See reminders as of this ISO date (defaults to today), as on /reminders. */
	today: z.iso.date().optional().catch(undefined),
});

export const Route = createFileRoute("/")({
	validateSearch: (search) => Search.parse(search),
	beforeLoad: ({ search }) => {
		if (search.v !== undefined || search.invoice !== undefined) {
			throw redirect({
				to: "/review",
				search: search.invoice ? { invoice: search.invoice } : {},
				replace: true,
			});
		}
	},
	loaderDeps: ({ search }) => ({ today: search.today }),
	loader: ({ deps }) => getDashboard({ data: { today: deps.today } }),
	component: Dashboard,
});

function Dashboard() {
	return <DashboardPage data={Route.useLoaderData()} />;
}
