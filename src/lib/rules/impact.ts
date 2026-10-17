import { addMoney, type Money, zero } from "#/lib/money/index.ts";
import type { Finding, FindingKind } from "#/lib/busyq/types.ts";

export type ImpactSummary = {
	total: Money;
	/** Findings with no invoice (orphan payments) are under "(no invoice)". */
	byInvoice: Record<string, Money>;
	byKind: Partial<Record<FindingKind, { count: number; impact: Money }>>;
};

export const NO_INVOICE = "(no invoice)";

/** Sum what is recoverable. Integer minor units; mixing currencies throws. */
export function calculateImpact(
	findings: readonly Finding[],
	currency = "USD",
): ImpactSummary {
	let total = zero(currency);
	const byInvoice: Record<string, Money> = {};
	const byKind: ImpactSummary["byKind"] = {};
	for (const f of findings) {
		const amount: Money = { minor: f.impactMinor, currency: f.currency };
		total = addMoney(total, amount);
		const key = f.invoiceId ?? NO_INVOICE;
		byInvoice[key] = addMoney(byInvoice[key] ?? zero(currency), amount);
		const slot = byKind[f.kind] ?? { count: 0, impact: zero(currency) };
		byKind[f.kind] = { count: slot.count + 1, impact: addMoney(slot.impact, amount) };
	}
	return { total, byInvoice, byKind };
}
