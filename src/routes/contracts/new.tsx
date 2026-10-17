import { createFileRoute } from "@tanstack/react-router";
import { NewContract } from "#/components/contracts/new-contract.tsx";

export const Route = createFileRoute("/contracts/new")({
	component: NewContract,
});
