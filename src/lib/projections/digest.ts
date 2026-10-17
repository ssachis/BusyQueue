/**
 * The digest the model narrates, and the check on what it wrote. Pure.
 *
 * The model must not compute, so it never sees minor units or ratios: every
 * `*Minor` amount is formatted as money and every ratio as a percentage here,
 * in code. The model then copies figures; `checkDigestText` rejects any money
 * amount or percentage in its text that is not literally in those facts.
 */
import type { DigestInput } from "#/lib/forecast/index.ts";
import { dec, formatMoney } from "#/lib/money/index.ts";
import { amountsIn } from "#/server/agent/draft-guard.ts";
import { formatPercent, formatPrice } from "./format.ts";

/** Decimal-string fields that are unit prices (major units, not minor). */
const PRICE_KEYS = new Set(["previousPrice", "newPrice", "changeAmount"]);
/** Decimal-string fields that are ratios (0.1218 → "12.18%"). */
const RATIO_KEYS = new Set(["changeRatio", "momChangeRatio", "thresholdRatio"]);

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/**
 * The digest input with amounts pre-formatted for the model:
 * `totalMinor: 283474` → `total: "$2,834.74"`, `changeRatio: "0.1218"` →
 * `changePercent: "12.18%"`. Everything else (dates, names, counts, methods)
 * is unchanged. Deterministic: the same input gives the same facts.
 */
export function digestFacts(input: DigestInput): Record<string, Json> {
	const currency = input.currency ?? "USD";
	const money = (minor: number) => formatMoney({ minor, currency });

	const walk = (value: unknown, key: string | null): Json => {
		if (Array.isArray(value)) return value.map((v) => walk(v, null));
		if (value !== null && typeof value === "object") {
			const out: Record<string, Json> = {};
			for (const [k, v] of Object.entries(value)) {
				if (k === "amountUnit") continue;
				if (k.endsWith("Minor") && typeof v === "number") {
					out[k.slice(0, -"Minor".length)] = money(v);
				} else if (k.endsWith("Minor") && Array.isArray(v)) {
					out[k.slice(0, -"Minor".length)] = v.map((n) =>
						typeof n === "number" ? money(n) : walk(n, null),
					);
				} else if (RATIO_KEYS.has(k) && typeof v === "string") {
					out[k.replace(/Ratio$/, "Percent")] = formatPercent(v);
				} else if (PRICE_KEYS.has(k) && typeof v === "string") {
					const own = (value as { currency?: unknown }).currency;
					out[k] = formatPrice(v, typeof own === "string" ? own : currency);
				} else {
					out[k] = walk(v, k);
				}
			}
			return out;
		}
		if (
			typeof value === "string" ||
			typeof value === "number" ||
			typeof value === "boolean" ||
			value === null
		) {
			return value;
		}
		return key === null ? null : String(value);
	};
	return {
		note: "Every amount and percentage below was computed by code. Copy them exactly; never calculate, round or estimate.",
		...(walk(input, null) as Record<string, Json>),
	};
}

const PERCENT = /(\d+(?:\.\d+)?)\s?%/g;

export function percentsIn(text: string): string[] {
	return [...text.matchAll(PERCENT)].map((m) => m[1] as string);
}

function strings(value: Json): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.flatMap(strings);
	if (value !== null && typeof value === "object") {
		return Object.values(value).flatMap(strings);
	}
	return [];
}

/** Every money amount and percentage written in the facts (unsigned). */
export function allowedFigures(facts: Record<string, Json>): {
	amounts: string[];
	percents: string[];
} {
	const all = strings(facts);
	return {
		amounts: [...new Set(all.flatMap(amountsIn))],
		percents: [...new Set(all.flatMap(percentsIn))],
	};
}

export type DigestCheck =
	| { ok: true; amounts: number; percents: number }
	| {
			ok: false;
			amounts: number;
			percents: number;
			unknownAmounts: string[];
			unknownPercents: string[];
	  };

/**
 * Every `$` amount and `%` in the model's text must equal (as a number) one
 * written in the facts. Uses the dispute-draft guard's amount parser.
 */
export function checkDigestText(
	text: string,
	facts: Record<string, Json>,
): DigestCheck {
	const allowed = allowedFigures(facts);
	const known = (list: string[]) => (v: string) =>
		list.some((a) => dec(a).eq(dec(v)));
	const amounts = amountsIn(text);
	const percents = percentsIn(text);
	const unknownAmounts = [
		...new Set(amounts.filter((a) => !known(allowed.amounts)(a))),
	];
	const unknownPercents = [
		...new Set(percents.filter((p) => !known(allowed.percents)(p))),
	];
	const counts = { amounts: amounts.length, percents: percents.length };
	return unknownAmounts.length === 0 && unknownPercents.length === 0
		? { ok: true, ...counts }
		: { ok: false, ...counts, unknownAmounts, unknownPercents };
}

export const DIGEST_SYSTEM_PROMPT = `You write a short cash summary for the food-service director of a school district.

Rules:
- Use only the facts JSON you are given. Do not use outside knowledge.
- Never calculate, add, subtract, round or estimate a number. Every money amount and percentage you write must be copied exactly, character for character, from the facts (for example "$1,234.56" or "5.25%").
- Do not write amounts in shorthand like "$28k". Leave a number out rather than change it.
- Ranges are low to high: "between <low> and <high>".
- If trend status is "not_enough_data", say there is not enough history for a month-over-month trend yet (name how many complete months exist and how many are needed) and give no trend figures.
- Mention past-due items, the next 30 days of expected cash, the largest upcoming items, and any alerts (price rises, spend drift).
- Plain text, 4 to 7 sentences or short "- " bullets. No headings, no markdown tables.`;

/** User message: the formatted facts as JSON. */
export const digestUserPrompt = (facts: Record<string, Json>) =>
	`Facts (JSON):\n${JSON.stringify(facts, null, 2)}`;

/** Follow-up when the first draft quoted figures that are not in the facts. */
export function digestRetryPrompt(
	check: Extract<DigestCheck, { ok: false }>,
): string {
	const bad = [
		...check.unknownAmounts.map((a) => `$${a}`),
		...check.unknownPercents.map((p) => `${p}%`),
	].join(", ");
	return `These figures are not in the facts: ${bad}. Rewrite the summary using only amounts and percentages that appear exactly in the facts JSON.`;
}
