import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { RemindersPage } from "#/components/reminders/reminders-page.tsx";
import { getReminders } from "#/server/reminders.ts";

const Search = z.object({
	/** View reminders as of this ISO date (defaults to today). */
	today: z.iso.date().optional().catch(undefined),
});

export const Route = createFileRoute("/reminders")({
	validateSearch: (search) => Search.parse(search),
	loaderDeps: ({ search }) => ({ today: search.today }),
	loader: ({ deps }) => getReminders({ data: { today: deps.today } }),
	component: RemindersRoute,
});

function RemindersRoute() {
	const { today, reminders } = Route.useLoaderData();
	return <RemindersPage today={today} reminders={reminders} />;
}
