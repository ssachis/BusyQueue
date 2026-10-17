/** Contract server functions (callable from the client). */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { MAX_CONTRACT_CHARS } from "#/lib/contracts/types.ts";
import { extractContract } from "./contracts-extract.ts";
import { confirmContract, loadContractReview } from "./contracts-review.ts";
import { listContracts } from "./contracts-store.ts";

export const getContracts = createServerFn({ method: "GET" }).handler(() =>
	listContracts(),
);

export const getContractReview = createServerFn({ method: "GET" })
	.validator((input: unknown) =>
		z.object({ id: z.string().min(1).max(100) }).parse(input),
	)
	.handler(async ({ data }) => {
		const review = await loadContractReview(data.id);
		if (!review) throw new Error("Contract not found");
		return review;
	});

/** Read a contract with the model and save it as a draft. */
export const readContract = createServerFn({ method: "POST" })
	.validator((input: unknown) =>
		z
			.object({
				text: z
					.string()
					.trim()
					.min(40, "Paste the contract text (it looks too short).")
					.max(
						MAX_CONTRACT_CHARS,
						"That contract is too long to read at once.",
					),
				sourceName: z.string().trim().max(200).nullable().default(null),
			})
			.parse(input),
	)
	.handler(({ data }) => extractContract(data));

export const confirmContractPrices = createServerFn({ method: "POST" })
	.validator((input: unknown) =>
		z
			.object({
				contractId: z.string().min(1).max(100),
				vendor: z.discriminatedUnion("kind", [
					z.object({ kind: z.literal("existing"), id: z.string().min(1) }),
					z.object({
						kind: z.literal("new"),
						name: z.string().trim().min(1, "Name the new vendor.").max(120),
					}),
				]),
				exclude: z.array(z.number().int().positive()).max(500).default([]),
				confirmedBy: z.string().trim().min(1, "Who is confirming?").max(100),
			})
			.parse(input),
	)
	.handler(({ data }) => confirmContract(data));
