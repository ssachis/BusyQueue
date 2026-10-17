/**
 * Root cause from our own data: group the failed tool calls of a set of runs
 * and explain them against the price list. Pure, so it works without PRISM's
 * judge and is unit-tested. Every count and example comes from the runs.
 */
import { normalizeItem, resolveVendor } from "#/lib/rules/aliases.ts";
import type { PriceRow } from "./types.ts";

export interface ToolLogEntry {
	name: string;
	status: "ok" | "error";
	errorCode?: string;
	errorMessage?: string;
	details?: Record<string, unknown>;
}

export interface RunFailureInput {
	runId: string;
	invoiceId: string;
	/** Vendor exactly as printed on the invoice. */
	vendor: string;
	toolLog: readonly ToolLogEntry[];
}

export interface FailureGroup {
	tool: string;
	code: string;
	runs: number;
	invoiceIds: string[];
	example: string | null;
}

export interface VendorVariant {
	printed: string;
	/** The price-list vendor it should have matched, if one clearly fits. */
	canonical: string | null;
	invoiceIds: string[];
}

export interface UnitVariant {
	item: string;
	billedUnit: string;
	contractUnits: string[];
	invoiceIds: string[];
}

export interface FailureSummary {
	runs: number;
	failedRuns: number;
	groups: FailureGroup[];
	vendorVariants: VendorVariant[];
	unitVariants: UnitVariant[];
	/** One code-generated sentence naming the cause, or null when nothing failed. */
	cause: string | null;
}

type Unmatched = { line?: number; item?: string; unit?: string };

const unmatchedLines = (details: Record<string, unknown> | undefined) =>
	Array.isArray(details?.unmatched) ? (details.unmatched as Unmatched[]) : [];

const pushUnique = (list: string[], value: string) => {
	if (!list.includes(value)) list.push(value);
};

export function summarizeFailures(
	runs: readonly RunFailureInput[],
	prices: readonly PriceRow[],
): FailureSummary {
	const canonicalVendors = [...new Set(prices.map((p) => p.vendor))];
	const groups = new Map<string, FailureGroup>();
	const vendors = new Map<string, VendorVariant>();
	const units = new Map<string, UnitVariant>();
	let failedRuns = 0;

	for (const run of runs) {
		const errors = run.toolLog.filter((t) => t.status === "error");
		if (errors.length === 0) continue;
		failedRuns++;

		const seenInRun = new Set<string>();
		for (const e of errors) {
			const key = `${e.name}:${e.errorCode ?? "unknown"}`;
			const group = groups.get(key) ?? {
				tool: e.name,
				code: e.errorCode ?? "unknown",
				runs: 0,
				invoiceIds: [],
				example: e.errorMessage ?? null,
			};
			if (!seenInRun.has(key)) {
				group.runs++;
				pushUnique(group.invoiceIds, run.invoiceId);
				seenInRun.add(key);
			}
			groups.set(key, group);

			if (e.name !== "lookup_vendor_prices") continue;
			const exactVendor = canonicalVendors.includes(run.vendor);
			if (!exactVendor) {
				const resolved = resolveVendor(run.vendor, canonicalVendors);
				const v = vendors.get(run.vendor) ?? {
					printed: run.vendor,
					canonical: resolved.ok ? resolved.vendor : null,
					invoiceIds: [],
				};
				pushUnique(v.invoiceIds, run.invoiceId);
				vendors.set(run.vendor, v);
			}
			const vendorForUnits = exactVendor
				? run.vendor
				: (() => {
						const r = resolveVendor(run.vendor, canonicalVendors);
						return r.ok ? r.vendor : null;
					})();
			if (!vendorForUnits) continue;
			for (const line of unmatchedLines(e.details)) {
				if (!line.item || !line.unit) continue;
				const rows = prices.filter(
					(p) =>
						p.vendor === vendorForUnits &&
						normalizeItem(p.item) === normalizeItem(line.item as string),
				);
				if (rows.length === 0 || rows.some((r) => r.unit === line.unit)) {
					continue;
				}
				const key = `${line.item}|${line.unit}`;
				const u = units.get(key) ?? {
					item: line.item,
					billedUnit: line.unit,
					contractUnits: [
						...new Set(
							rows.flatMap((r) =>
								r.packUnit
									? [r.unit, `${r.packUnit} of ${r.packSize}`]
									: [r.unit],
							),
						),
					],
					invoiceIds: [],
				};
				pushUnique(u.invoiceIds, run.invoiceId);
				units.set(key, u);
			}
		}
	}

	const vendorVariants = [...vendors.values()].sort(
		(a, b) => b.invoiceIds.length - a.invoiceIds.length,
	);
	const unitVariants = [...units.values()].sort(
		(a, b) => b.invoiceIds.length - a.invoiceIds.length,
	);
	return {
		runs: runs.length,
		failedRuns,
		groups: [...groups.values()].sort((a, b) => b.runs - a.runs),
		vendorVariants,
		unitVariants,
		cause: describeCause(failedRuns, vendorVariants, unitVariants),
	};
}

function describeCause(
	failedRuns: number,
	vendors: VendorVariant[],
	units: UnitVariant[],
): string | null {
	if (failedRuns === 0) return null;
	const parts: string[] = [];
	if (vendors.length > 0) {
		const invoices = new Set(vendors.flatMap((v) => v.invoiceIds)).size;
		const examples = vendors
			.slice(0, 2)
			.map((v) => `"${v.printed}"${v.canonical ? ` for "${v.canonical}"` : ""}`)
			.join(", ");
		parts.push(
			`${invoices === 1 ? "1 invoice spells" : `${invoices} invoices spell`} the vendor differently from the price list (${examples})`,
		);
	}
	if (units.length > 0) {
		const invoices = new Set(units.flatMap((u) => u.invoiceIds)).size;
		const examples = units
			.slice(0, 2)
			.map((u) => `"${u.billedUnit}" for ${u.contractUnits.join(" / ")}`)
			.join(", ");
		parts.push(
			`${invoices} bill${invoices === 1 ? "s" : ""} in units the contract lists differently (${examples})`,
		);
	}
	if (parts.length === 0) {
		return `${failedRuns} run${failedRuns === 1 ? "" : "s"} had failed tool calls; see the groups below.`;
	}
	return `The price lookup matches vendor, item and unit exactly: ${parts.join("; ")}.`;
}
