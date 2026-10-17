/** Display formatting for forecast figures. Pure; no floats touch the amounts. */
import { Decimal, dec, minorUnitDigits } from "#/lib/money/index.ts";

/** "0.1218" → "12.18%", "-0.5" → "-50%". Exact: a ratio has at most 4 decimals. */
export function formatPercent(ratio: string): string {
	return `${dec(ratio).times(new Decimal("100")).toFixed()}%`;
}

/** A unit price with its own precision, e.g. "0.625" → "$0.625", "9.8" → "$9.80". */
export function formatPrice(amount: string, currency: string): string {
	const decimals = amount.split(".")[1]?.length ?? 0;
	const digits = minorUnitDigits(currency);
	// Intl formats the exact decimal string; no float conversion.
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency,
		minimumFractionDigits: digits,
		maximumFractionDigits: Math.max(digits, decimals),
	}).format(amount as unknown as number);
}
