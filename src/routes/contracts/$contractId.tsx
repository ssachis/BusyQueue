import { createFileRoute } from "@tanstack/react-router";
import { ContractReview } from "#/components/contracts/contract-review.tsx";
import { getContractReview } from "#/server/contracts.ts";

export const Route = createFileRoute("/contracts/$contractId")({
	loader: ({ params }) =>
		getContractReview({ data: { id: params.contractId } }),
	component: ContractPage,
});

function ContractPage() {
	const review = Route.useLoaderData();
	// Keyed so local choices reset when moving between contracts.
	return <ContractReview key={review.contract.id} review={review} />;
}
