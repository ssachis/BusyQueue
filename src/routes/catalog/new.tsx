import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { PageBody, PageHeader } from "#/components/app-shell.tsx";
import { emptyItem, ItemForm } from "#/components/catalog/item-form.tsx";
import { type TaxCountry, taxCodes } from "#/lib/tax/index.ts";
import { getBusiness } from "#/server/business.ts";
import { createCatalogItem } from "#/server/catalog.ts";

export const Route = createFileRoute("/catalog/new")({
	loader: () => getBusiness(),
	component: NewItem,
});

function NewItem() {
	const business = Route.useLoaderData();
	const navigate = useNavigate();
	const taxOptions = taxCodes(business.country as TaxCountry);

	return (
		<>
			<PageHeader title="New item" />
			<PageBody>
				<ItemForm
					initial={emptyItem(taxOptions[0]?.code ?? "")}
					taxOptions={taxOptions}
					submitLabel="Add item"
					onSubmit={async (item) => {
						try {
							await createCatalogItem({ data: item });
							toast.success("Item added");
							await navigate({ to: "/catalog" });
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
