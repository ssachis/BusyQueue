/**
 * Contracts → price list. A contract (a district's bid award, a vendor price
 * agreement) carries agreed prices; once the director confirms them they
 * become the price list the BusyQ agent audits invoices against.
 *
 * The model only transcribes the contract into `RawExtraction`. Everything
 * after that (validation, flags, vendor matching, the price diff) is code.
 */
import { z } from "zod";

/** Upper bound on pasted or uploaded contract text. */
export const MAX_CONTRACT_CHARS = 60_000;

/**
 * What the model returns, deliberately lenient: each field is validated on
 * its own in `parseExtraction`, so one bad value is flagged instead of
 * rejecting the whole contract.
 */
export const RawExtraction = z.object({
	vendor: z.string().nullish(),
	title: z.string().nullish(),
	startDate: z.string().nullish(),
	endDate: z.string().nullish(),
	noticeDays: z.union([z.number(), z.string()]).nullish(),
	autoRenew: z.boolean().nullish(),
	currency: z.string().nullish(),
	prices: z.array(z.unknown()).default([]),
	/** Top-level fields the model could not read with confidence. */
	uncertainFields: z.array(z.string()).nullish(),
});
export type RawExtraction = z.infer<typeof RawExtraction>;

export const RawPriceRow = z.object({
	item: z.string().nullish(),
	unit: z.string().nullish(),
	unitPrice: z.union([z.string(), z.number()]).nullish(),
	packUnit: z.string().nullish(),
	packSize: z.union([z.string(), z.number()]).nullish(),
	uncertain: z.boolean().nullish(),
	note: z.string().nullish(),
});

export type FlagSeverity = "warning" | "error";

/**
 * Something the director should look at before confirming. `error` flags on a
 * price row keep that row out of the price list.
 */
export interface ExtractionFlag {
	/** "endDate", "prices.3.unitPrice", ... */
	path: string;
	severity: FlagSeverity;
	/** Who raised it: the model said it was unsure, or a code check failed. */
	source: "model" | "validation";
	message: string;
}

export interface ContractTerms {
	/** Counterparty as printed on the contract. */
	vendorName: string | null;
	title: string | null;
	startDate: string | null;
	endDate: string | null;
	noticeDays: number | null;
	autoRenew: boolean | null;
	currency: string;
}

/** One agreed price as printed. Prices are decimal strings, never numbers. */
export interface ContractPrice {
	/** 1-based position in the contract's price table. */
	lineNo: number;
	item: string;
	unit: string;
	unitPrice: string | null;
	packUnit: string | null;
	packSize: string | null;
	/** True when an error flag keeps this row off the price list. */
	blocked: boolean;
}

export interface ParsedContract {
	terms: ContractTerms;
	prices: ContractPrice[];
	flags: ExtractionFlag[];
}
