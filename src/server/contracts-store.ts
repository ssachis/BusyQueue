/**
 * Server-only contract data access (D1). Kept apart from the server functions
 * in contracts.ts so the client bundle never imports the D1 client.
 */
import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "#/db/index.ts";
import { priceList, vendors } from "#/db/schema/busyq.ts";
import { contractPrices, contracts } from "#/db/schema/contracts.ts";
import type {
	ContractPrice,
	ContractTerms,
	CurrentPrice,
	DiffRow,
	ExtractionFlag,
	VendorRef,
} from "#/lib/contracts/index.ts";

export type ContractRow = typeof contracts.$inferSelect;
export type AppliedPrice = typeof contractPrices.$inferSelect;

export interface ContractListRow {
	id: string;
	title: string | null;
	vendorName: string | null;
	/** Canonical vendor, once confirmed. */
	vendor: string | null;
	startDate: string | null;
	endDate: string | null;
	noticeDays: number | null;
	autoRenew: boolean | null;
	status: ContractRow["status"];
	prices: number;
	errors: number;
	warnings: number;
	createdAt: string;
	confirmedAt: string | null;
}

export async function listContracts(): Promise<ContractListRow[]> {
	const rows = await getDb()
		.select({ c: contracts, vendor: vendors.name })
		.from(contracts)
		.leftJoin(vendors, eq(contracts.vendorId, vendors.id))
		.orderBy(desc(contracts.createdAt));
	return rows.map(({ c, vendor }) => ({
		id: c.id,
		title: c.title,
		vendorName: c.vendorName,
		vendor,
		startDate: c.startDate,
		endDate: c.endDate,
		noticeDays: c.noticeDays,
		autoRenew: c.autoRenew,
		status: c.status,
		prices: c.prices.filter((p) => !p.blocked).length,
		errors: c.flags.filter((f) => f.severity === "error").length,
		warnings: c.flags.filter((f) => f.severity === "warning").length,
		createdAt: c.createdAt,
		confirmedAt: c.confirmedAt,
	}));
}

export async function loadContract(id: string): Promise<ContractRow | null> {
	const [row] = await getDb()
		.select()
		.from(contracts)
		.where(eq(contracts.id, id));
	return row ?? null;
}

export async function loadAppliedPrices(id: string): Promise<AppliedPrice[]> {
	return getDb()
		.select()
		.from(contractPrices)
		.where(eq(contractPrices.contractId, id))
		.orderBy(asc(contractPrices.lineNo));
}

export async function listVendors(): Promise<VendorRef[]> {
	return getDb()
		.select({ id: vendors.id, name: vendors.name })
		.from(vendors)
		.orderBy(asc(vendors.name));
}

/** Every vendor's current agreed prices, keyed by vendor id. */
export async function pricesByVendor(): Promise<
	Record<string, CurrentPrice[]>
> {
	const rows = await getDb()
		.select()
		.from(priceList)
		.orderBy(asc(priceList.id));
	const out: Record<string, CurrentPrice[]> = {};
	for (const r of rows) {
		const list = out[r.vendorId] ?? [];
		out[r.vendorId] = list;
		list.push({
			item: r.item,
			unit: r.unit,
			unitPrice: r.unitPrice,
			currency: r.currency,
			packUnit: r.packUnit,
			packSize: r.packSize,
		});
	}
	return out;
}

export async function insertContractDraft(draft: {
	id: string;
	terms: ContractTerms;
	prices: ContractPrice[];
	flags: ExtractionFlag[];
	sourceName: string | null;
	sourceText: string;
	rawExtraction: string | null;
	model: string | null;
	prismTraceId: string | null;
}): Promise<void> {
	const { terms, ...rest } = draft;
	await getDb()
		.insert(contracts)
		.values({
			...rest,
			vendorName: terms.vendorName,
			title: terms.title,
			startDate: terms.startDate,
			endDate: terms.endDate,
			noticeDays: terms.noticeDays,
			autoRenew: terms.autoRenew,
			currency: terms.currency,
		});
}

/**
 * Apply a confirmed contract in one D1 batch: create the vendor if new,
 * upsert each price-list row, snapshot what was applied, and mark the
 * contract confirmed. The snapshot's primary key makes a second confirm of
 * the same contract fail, which rolls the whole batch back.
 */
export async function applyContract(input: {
	contractId: string;
	vendor: VendorRef;
	createVendor: boolean;
	rows: DiffRow[];
	confirmedBy: string;
}): Promise<void> {
	const db = getDb();
	const { contractId, vendor, rows } = input;
	const at = new Date().toISOString();

	const upserts = rows.map((r) =>
		db
			.insert(priceList)
			.values({ vendorId: vendor.id, ...r.apply })
			.onConflictDoUpdate({
				target: [priceList.vendorId, priceList.item, priceList.unit],
				set: {
					unitPrice: r.apply.unitPrice,
					currency: r.apply.currency,
					packUnit: r.apply.packUnit,
					packSize: r.apply.packSize,
				},
			}),
	);
	const snapshot = rows.map((r) =>
		db.insert(contractPrices).values({
			contractId,
			lineNo: r.lineNo,
			vendorId: vendor.id,
			...r.apply,
			previousUnitPrice: r.oldUnitPrice,
			change: r.status,
		}),
	);
	const confirm = db
		.update(contracts)
		.set({
			status: "confirmed",
			vendorId: vendor.id,
			confirmedBy: input.confirmedBy,
			confirmedAt: at,
			updatedAt: at,
		})
		.where(and(eq(contracts.id, contractId), eq(contracts.status, "draft")));

	const writes = [...upserts, ...snapshot];
	// A new vendor goes first: everything after references it.
	await (input.createVendor
		? db.batch([
				db.insert(vendors).values({ id: vendor.id, name: vendor.name }),
				confirm,
				...writes,
			])
		: db.batch([confirm, ...writes]));
}
