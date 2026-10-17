import { createFileRoute, useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { PageBody, PageHeader } from "#/components/app-shell.tsx";
import { ItemForm } from "#/components/catalog/item-form.tsx";
import { Button } from "#/components/ui/button.tsx";
import { type TaxCountry, taxCodes } from "#/lib/tax/index.ts";
import { getBusiness } from "#/server/business.ts";
import {
	archiveCatalogItem,
	getCatalogItem,
	updateCatalogItem,
} from "#/server/catalog.ts";

export const Route = createFileRoute("/catalog/$id")({
	loader: async ({ params }) => {
		const [item, business] = await Promise.all([
			getCatalogItem({ data: { id: params.id } }),
			getBusiness(),
		]);
		if (!item) throw new Error("Item not found");
		return { item, country: business.country };
	},
	component: EditItem,
});

function EditItem() {
	const { item, country } = Route.useLoaderData();
	const router = useRouter();
	const archived = item.archivedAt !== null;
	const taxOptions = taxCodes(country as TaxCountry);

	async function toggleArchive() {
		try {
			await archiveCatalogItem({ data: { id: item.id, archived: !archived } });
			await router.invalidate();
			toast.success(archived ? "Item restored" : "Item archived");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Could not update");
		}
	}

	return (
		<>
			<PageHeader title={item.name}>
				<Button variant="outline" onClick={toggleArchive}>
					{archived ? "Restore" : "Archive"}
				</Button>
			</PageHeader>
			<PageBody>
				<ItemForm
					initial={{
						code: item.code ?? "",
						name: item.name,
						unitPrice: item.unitPrice,
						unit: item.unit ?? "",
						taxCode: item.taxCode,
						rate: item.rate ?? "",
						hsnSac: item.hsnSac ?? "",
					}}
					taxOptions={taxOptions}
					submitLabel="Save changes"
					onSubmit={async (values) => {
						try {
							await updateCatalogItem({ data: { id: item.id, item: values } });
							await router.invalidate();
							toast.success("Item saved");
						} catch (err) {
							toast.error(err instanceof Error ? err.message : "Could not save");
						}
					}}
				/>
			</PageBody>
		</>
	);
}
