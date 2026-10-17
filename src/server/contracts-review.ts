/**
 * Review and confirm a contract. Server-only. The diff the director saw is
 * recomputed here from the stored extraction and the current price list, so
 * what gets written never depends on numbers sent by the browser.
 */
import {
	type CurrentPrice,
	cleanVendorName,
	diffPriceList,
	matchContractVendor,
	type VendorMatch,
	type VendorRef,
	vendorSlug,
} from "#/lib/contracts/index.ts";
import { normalizeVendor } from "#/lib/rules/aliases.ts";
import { prismConfig } from "#/server/agent/tracing.ts";
import { CONTRACTS_AGENT } from "./contracts-extract.ts";
import {
	type AppliedPrice,
	applyContract,
	type ContractRow,
	listVendors,
	loadAppliedPrices,
	loadContract,
	pricesByVendor,
} from "./contracts-store.ts";
import { getServerEnv } from "./env.ts";
import { RunTracer } from "./prism.ts";

export interface ContractReview {
	contract: Omit<ContractRow, "rawExtraction">;
	vendors: VendorRef[];
	pricesByVendor: Record<string, CurrentPrice[]>;
	match: VendorMatch;
	applied: AppliedPrice[];
}

export async function loadContractReview(
	id: string,
): Promise<ContractReview | null> {
	const row = await loadContract(id);
	if (!row) return null;
	const [vendors, prices, applied] = await Promise.all([
		listVendors(),
		pricesByVendor(),
		loadAppliedPrices(id),
	]);
	const { rawExtraction: _raw, ...contract } = row;
	return {
		contract,
		vendors,
		pricesByVendor: prices,
		match: matchContractVendor(row.vendorName, vendors),
		applied,
	};
}

export type VendorChoice =
	| { kind: "existing"; id: string }
	| { kind: "new"; name: string };

export interface ConfirmInput {
	contractId: string;
	vendor: VendorChoice;
	/** Contract line numbers the director left out. */
	exclude: number[];
	confirmedBy: string;
}

export interface ConfirmResult {
	vendor: VendorRef;
	counts: { new: number; changed: number; unchanged: number };
}

export class ConfirmError extends Error {}

export async function confirmContract(
	input: ConfirmInput,
): Promise<ConfirmResult> {
	const contract = await loadContract(input.contractId);
	if (!contract) throw new ConfirmError("Contract not found.");
	if (contract.status !== "draft") {
		throw new ConfirmError("This contract is already confirmed.");
	}

	const vendors = await listVendors();
	let vendor: VendorRef;
	let createVendor = false;
	if (input.vendor.kind === "existing") {
		const id = input.vendor.id;
		const found = vendors.find((v) => v.id === id);
		if (!found) throw new ConfirmError("Pick a vendor from the list.");
		vendor = found;
	} else {
		const name = cleanVendorName(input.vendor.name);
		const id = vendorSlug(name);
		if (!id) throw new ConfirmError("Give the new vendor a name.");
		const clash = vendors.find(
			(v) => v.id === id || normalizeVendor(v.name) === normalizeVendor(name),
		);
		if (clash) {
			throw new ConfirmError(
				`"${clash.name}" already exists. Pick it instead of creating a new vendor.`,
			);
		}
		vendor = { id, name };
		createVendor = true;
	}

	const current = (await pricesByVendor())[vendor.id] ?? [];
	const diff = diffPriceList(
		current,
		contract.prices,
		contract.currency,
		new Set(input.exclude),
	);
	if (diff.rows.length === 0) {
		throw new ConfirmError("There are no prices to apply.");
	}

	const env = getServerEnv();
	const tracer = new RunTracer(prismConfig(env), {
		sessionId: contract.id,
		name: "busyq_contract_confirm",
		agentName: CONTRACTS_AGENT,
		input: {
			contractId: contract.id,
			vendorId: vendor.id,
			exclude: input.exclude,
		},
		metadata: {
			contract_id: contract.id,
			step: "confirm",
			vendor_id: vendor.id,
			extraction_trace_id: contract.prismTraceId,
		},
		trajectory: false,
	});
	try {
		await tracer.traceToolCall(
			"apply_to_price_list",
			{
				vendor: vendor.name,
				createVendor,
				rows: diff.rows.map(
					(r) =>
						`${r.status} ${r.item} ${r.unit}: ${r.oldUnitPrice ?? "-"} -> ${r.newUnitPrice}`,
				),
			},
			async () => {
				await applyContract({
					contractId: contract.id,
					vendor,
					createVendor,
					rows: diff.rows,
					confirmedBy: input.confirmedBy,
				});
				return { ok: true as const, data: diff.counts };
			},
		);
		await tracer.finish({ output: { vendor: vendor.name, ...diff.counts } });
	} catch (error) {
		await tracer.finish({ error });
		throw error;
	}
	return { vendor, counts: diff.counts };
}
