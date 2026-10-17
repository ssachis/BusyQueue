import { createFileRoute } from "@tanstack/react-router";
import { ClientForm } from "#/components/clients/client-form.tsx";
import { getClientForm } from "#/server/clients.ts";

/** `/clients/new` adds a client; `/clients/<id>` edits one. */
export const Route = createFileRoute("/clients/$id")({
	loader: ({ params }) =>
		getClientForm({ data: { id: params.id === "new" ? null : params.id } }),
	component: ClientPage,
});

function ClientPage() {
	const { client, businessCountry, businessCurrency } = Route.useLoaderData();
	return (
		<ClientForm
			// Keyed so the form resets when moving between clients.
			key={client?.id ?? "new"}
			client={client}
			businessCountry={businessCountry}
			businessCurrency={businessCurrency}
		/>
	);
}
