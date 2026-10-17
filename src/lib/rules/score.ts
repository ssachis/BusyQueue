import type { AnswerKeyRow, Finding } from "#/lib/busyq/types.ts";

type Keyed = {
	kind: string;
	invoiceId: string | null;
	lineNo: number | null;
	paymentId: string | null;
};

const keyOf = (r: Keyed) =>
	[r.kind, r.invoiceId ?? "", r.lineNo ?? "", r.paymentId ?? ""].join("|");

export type RunScore = {
	truePositives: number;
	falsePositives: Finding[];
	falseNegatives: AnswerKeyRow[];
	/** Found, but with a different dollar impact than planted. */
	wrongAmount: { finding: Finding; expectedImpactMinor: number }[];
	/** tp / (tp + fp); 1 when nothing was flagged. */
	precision: number;
	/** tp / (tp + fn); 1 when nothing was planted. */
	recall: number;
	foundMinor: number;
	plantedMinor: number;
};

/**
 * Score findings against the answer key. A finding matches a row on
 * kind + invoice + line + payment. Pass `invoiceIds` to score only the
 * invoices a run covered; rows and findings with no invoice (orphan
 * payments) are then left out.
 */
export function scoreRun(
	findings: readonly Finding[],
	answerKey: readonly AnswerKeyRow[],
	invoiceIds?: ReadonlySet<string>,
): RunScore {
	const inScope = (r: Keyed) =>
		invoiceIds === undefined ||
		(r.invoiceId !== null && invoiceIds.has(r.invoiceId));
	const rows = answerKey.filter(inScope);
	const pool = new Map<string, AnswerKeyRow[]>();
	for (const row of rows) {
		const k = keyOf(row);
		pool.set(k, [...(pool.get(k) ?? []), row]);
	}
	const falsePositives: Finding[] = [];
	const wrongAmount: RunScore["wrongAmount"] = [];
	let truePositives = 0;
	let foundMinor = 0;
	for (const f of findings.filter(inScope)) {
		const hit = pool.get(keyOf(f))?.shift();
		if (!hit) {
			falsePositives.push(f);
			continue;
		}
		truePositives += 1;
		foundMinor += f.impactMinor;
		if (hit.expectedImpactMinor !== f.impactMinor) {
			wrongAmount.push({ finding: f, expectedImpactMinor: hit.expectedImpactMinor });
		}
	}
	const falseNegatives = [...pool.values()].flat();
	const fp = falsePositives.length;
	const fn = falseNegatives.length;
	return {
		truePositives,
		falsePositives,
		falseNegatives,
		wrongAmount,
		precision: truePositives + fp === 0 ? 1 : truePositives / (truePositives + fp),
		recall: truePositives + fn === 0 ? 1 : truePositives / (truePositives + fn),
		foundMinor,
		plantedMinor: rows.reduce((a, r) => a + r.expectedImpactMinor, 0),
	};
}
