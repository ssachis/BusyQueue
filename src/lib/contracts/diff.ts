/**
 * Compare a contract's agreed prices with the vendor's current price list.
 * Pure: the review screen shows this, and confirming applies exactly the
 * `apply` rows it returns (recomputed on the server, never sent by the client).
 */
import { dec } from "#/lib/money/index.ts";
import { normalizeUnit } from "#/lib/rules/aliases.ts";
import { priceKey } from "./parse.ts";
import type { ContractPrice } from "./types.ts";

/** A row of the vendor's current price list. */
export interface CurrentPrice {
	item: string;
	unit: string;
	unitPrice: string;
	currency: string;
	packUnit: string | null;
	packSize: string | null;
}

/** The price-list row a confirmed contract line writes. */
export interface PriceListWrite {
	item: string;
	unit: string;
	unitPrice: string;
	currency: string;
	packUnit: string | null;
	packSize: string | null;
}

export type DiffStatus = "new" | "changed" | "unchanged";

export interface DiffRow {
	lineNo: number;
	status: DiffStatus;
	/** Spelling as the price list will hold it (existing spelling when matched). */
	item: string;
	unit: string;
	oldUnitPrice: string | null;
	newUnitPrice: string;
	/** Exact `new − old`, as a decimal string; null for new rows. */
	delta: string | null;
	oldPack: string | null;
	newPack: string | null;
	currency: string;
	/** What changed, for changed rows: "price", "pack", "currency". */
	changes: ("price" | "pack" | "currency")[];
	apply: PriceListWrite;
}

export interface PriceDiff {
	rows: DiffRow[];
	/** Current rows the contract doesn't mention. Kept as they are. */
	notInContract: CurrentPrice[];
	/** Contract lines left out (blocked by a flag or excluded by the director). */
	skipped: number[];
	counts: Record<DiffStatus, number>;
}

const packLabel = (unit: string | null, size: string | null) =>
	unit && size ? `${unit} of ${size}` : null;

const samePack = (
	a: { packUnit: string | null; packSize: string | null },
	b: { packUnit: string | null; packSize: string | null },
) => {
	if (!a.packUnit || !a.packSize || !b.packUnit || !b.packSize) {
		return !a.packUnit && !b.packUnit;
	}
	return (
		normalizeUnit(a.packUnit) === normalizeUnit(b.packUnit) &&
		dec(a.packSize).eq(dec(b.packSize))
	);
};

/**
 * Match each usable contract line to the current list by item and unit
 * (case-, spacing- and unit-synonym-insensitive) and classify it.
 *
 * - new: no current row for that item and unit; written with the contract's
 *   spelling and a canonical unit ("LB" → "lb").
 * - changed: price, pack or currency differs; written with the current
 *   row's spelling so the agent's lookups keep matching.
 * - unchanged: nothing differs; rewritten as is (a no-op).
 */
export function diffPriceList(
	current: readonly CurrentPrice[],
	contract: readonly ContractPrice[],
	currency: string,
	exclude: ReadonlySet<number> = new Set(),
): PriceDiff {
	const byKey = new Map(current.map((c) => [priceKey(c.item, c.unit), c]));
	const matched = new Set<string>();
	const rows: DiffRow[] = [];
	const skipped: number[] = [];

	for (const line of contract) {
		if (line.blocked || !line.unitPrice || exclude.has(line.lineNo)) {
			skipped.push(line.lineNo);
			continue;
		}
		const key = priceKey(line.item, line.unit);
		const existing = byKey.get(key);
		const pack = {
			packUnit: line.packUnit ? normalizeUnit(line.packUnit) : null,
			packSize: line.packSize,
		};

		if (!existing) {
			rows.push({
				lineNo: line.lineNo,
				status: "new",
				item: line.item,
				unit: normalizeUnit(line.unit),
				oldUnitPrice: null,
				newUnitPrice: line.unitPrice,
				delta: null,
				oldPack: null,
				newPack: packLabel(pack.packUnit, pack.packSize),
				currency,
				changes: [],
				apply: {
					item: line.item,
					unit: normalizeUnit(line.unit),
					unitPrice: line.unitPrice,
					currency,
					...pack,
				},
			});
			continue;
		}

		matched.add(key);
		const changes: DiffRow["changes"] = [];
		if (!dec(existing.unitPrice).eq(dec(line.unitPrice))) changes.push("price");
		if (!samePack(existing, pack)) changes.push("pack");
		if (existing.currency !== currency) changes.push("currency");
		rows.push({
			lineNo: line.lineNo,
			status: changes.length ? "changed" : "unchanged",
			item: existing.item,
			unit: existing.unit,
			oldUnitPrice: existing.unitPrice,
			newUnitPrice: line.unitPrice,
			delta: dec(line.unitPrice).minus(dec(existing.unitPrice)).toFixed(),
			oldPack: packLabel(existing.packUnit, existing.packSize),
			newPack: packLabel(pack.packUnit, pack.packSize),
			currency,
			changes,
			apply: {
				item: existing.item,
				unit: existing.unit,
				unitPrice: line.unitPrice,
				currency,
				...pack,
			},
		});
	}

	const counts: Record<DiffStatus, number> = {
		new: 0,
		changed: 0,
		unchanged: 0,
	};
	for (const r of rows) counts[r.status]++;

	return {
		rows,
		notInContract: current.filter(
			(c) => !matched.has(priceKey(c.item, c.unit)),
		),
		skipped,
		counts,
	};
}
