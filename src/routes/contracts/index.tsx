import { createFileRoute } from "@tanstack/react-router";
import { ContractList } from "#/components/contracts/contract-list.tsx";
import { getContracts } from "#/server/contracts.ts";

export const Route = createFileRoute("/contracts/")({
	loader: () => getContracts(),
	component: ContractsPage,
});

function ContractsPage() {
	return <ContractList contracts={Route.useLoaderData()} />;
}
