import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { PageBody, PageHeader } from "#/components/app-shell.tsx";
import { ClientForm, emptyClient } from "#/components/clients/client-form.tsx";
import { getBusiness } from "#/server/business.ts";
import { createClientRecord } from "#/server/clients.ts";

export const Route = createFileRoute("/clients/new")({
	loader: () => getBusiness(),
	component: NewClient,
});

function NewClient() {
	const business = Route.useLoaderData();
	const navigate = useNavigate();

	return (
		<>
			<PageHeader title="New client" />
			<PageBody>
				<ClientForm
					initial={emptyClient(business.country)}
					submitLabel="Add client"
					onSubmit={async (client) => {
						try {
							await createClientRecord({ data: client });
							toast.success("Client added");
							await navigate({ to: "/clients" });
						} catch (err) {
							toast.error(
								err instanceof Error ? err.message : "Could not save",
							);
						}
					}}
				/>
			</PageBody>
		</>
	);
}
