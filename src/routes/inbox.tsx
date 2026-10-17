import { createFileRoute } from "@tanstack/react-router";
import { InboxPage } from "#/components/inbox/inbox-page.tsx";
import { getInbox } from "#/server/inbox/functions.ts";

export const Route = createFileRoute("/inbox")({
	head: () => ({ meta: [{ title: "Inbox · BusyQ" }] }),
	loader: () => getInbox(),
	component: InboxRoute,
});

function InboxRoute() {
	const { address, messages } = Route.useLoaderData();
	return <InboxPage address={address} messages={messages} />;
}
