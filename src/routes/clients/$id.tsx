import {
	createFileRoute,
	useNavigate,
	useRouter,
} from "@tanstack/react-router";
import { toast } from "sonner";
import { PageBody, PageHeader } from "#/components/app-shell.tsx";
import { ClientForm } from "#/components/clients/client-form.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	archiveClient,
	getClientById,
	removeClientRecord,
	updateClientRecord,
} from "#/server/clients.ts";

export const Route = createFileRoute("/clients/$id")({
	loader: async ({ params }) => {
		const client = await getClientById({ data: { id: params.id } });
		if (!client) throw new Error("Client not found");
		return client;
	},
	component: EditClient,
});

function EditClient() {
	const client = Route.useLoaderData();
	const router = useRouter();
	const navigate = useNavigate();
	const archived = client.archivedAt !== null;

	async function toggleArchive() {
		try {
			await archiveClient({ data: { id: client.id, archived: !archived } });
			await router.invalidate();
			toast.success(archived ? "Client restored" : "Client archived");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Could not update");
		}
	}

	async function remove() {
		try {
			const outcome = await removeClientRecord({ data: { id: client.id } });
			toast.success(
				outcome === "deleted" ? "Client deleted" : "Client archived",
			);
			await navigate({ to: "/clients" });
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Could not remove");
		}
	}

	return (
		<>
			<PageHeader
				title={client.name}
				description={
					client.documentCount > 0
						? `${client.documentCount} document${client.documentCount === 1 ? "" : "s"}. Clients with documents can only be archived.`
						: undefined
				}
			>
				<Button variant="outline" onClick={toggleArchive}>
					{archived ? "Restore" : "Archive"}
				</Button>
				{client.documentCount === 0 ? (
					<Button variant="outline" onClick={remove}>
						Delete
					</Button>
				) : null}
			</PageHeader>
			<PageBody>
				<ClientForm
					initial={{
						name: client.name,
						addressLine1: client.addressLine1 ?? "",
						addressLine2: client.addressLine2 ?? "",
						city: client.city ?? "",
						region: client.region ?? "",
						postalCode: client.postalCode ?? "",
						country: client.country,
						taxId: client.taxId ?? "",
						email: client.email ?? "",
						placeOfSupply: client.placeOfSupply ?? "",
					}}
					submitLabel="Save changes"
					onSubmit={async (values) => {
						try {
							await updateClientRecord({
								data: { id: client.id, client: values },
							});
							await router.invalidate();
							toast.success("Client saved");
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
