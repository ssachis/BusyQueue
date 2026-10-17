/**
 * Display helpers for agreed prices. Unit prices can carry more decimals than
 * the currency's minor unit ($0.785/lb), so they are formatted from the exact
 * decimal string, never rounded to cents.
 */
import { dec } from "#/lib/money/index.ts";

const fractionDigits = (decimal: string) => decimal.split(".")[1]?.length ?? 0;

/** "1.95" USD → "$1.95"; "0.785" → "$0.785"; "16.8" → "$16.80". */
export function formatUnitPrice(
	decimal: string,
	currency: string,
	locale = "en-US",
): string {
	const digits = Math.max(2, fractionDigits(decimal));
	// Intl formats numeric strings exactly; no float conversion happens.
	return new Intl.NumberFormat(locale, {
		style: "currency",
		currency,
		minimumFractionDigits: digits,
		maximumFractionDigits: digits,
	}).format(decimal as unknown as number);
}

/** Signed change: "+$0.40", "−$0.15", "no change". */
export function formatPriceDelta(
	delta: string,
	currency: string,
	locale = "en-US",
): string {
	const d = dec(delta);
	if (d.eq(dec("0"))) return "no change";
	const sign = d.lt(dec("0")) ? "−" : "+";
	return `${sign}${formatUnitPrice(d.abs().toFixed(), currency, locale)}`;
}
