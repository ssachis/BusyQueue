import { describe, expect, it } from "vitest";
import { Decimal, dec, toMajor, toMinor } from "#/lib/money/index.ts";
import {
	computeTax,
	ROUNDING,
	type TaxContext,
	type TaxLineInput,
} from "./index.ts";

/** mulberry32: small seeded PRNG, used only to pick integers for test inputs. */
function rng(seed: number): (max: number) => number {
	let a = seed >>> 0;
	return (max) => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		const u = ((t ^ (t >>> 14)) >>> 0) % 0x100000000;
		return u % (max + 1);
	};
}

const pad = (n: number, width: number) => String(n).padStart(width, "0");

interface Scenario {
	ctx: TaxContext;
	codes: string[];
	usRates?: string[];
}

const SCENARIOS: Scenario[] = [
	{
		ctx: {
			seller: { country: "IN", region: "27" },
			buyer: { country: "IN", region: "27" },
			currency: "INR",
		},
		codes: [
			"IN-GST-0.25",
			"IN-GST-1.5",
			"IN-GST-3",
			"IN-GST-5",
			"IN-GST-18",
			"IN-GST-40",
			"EXEMPT",
		],
	},
	{
		ctx: {
			seller: { country: "IN", region: "27" },
			buyer: { country: "IN", region: "07" },
			currency: "INR",
		},
		codes: ["IN-GST-5", "IN-GST-18", "IN-GST-40", "ZERO"],
	},
	...["ON", "QC", "BC", "AB", "NS", "SK"].map((region) => ({
		ctx: {
			seller: { country: "CA" as const, region: "ON" },
			buyer: { country: "CA", region },
			currency: "CAD",
		},
		codes: ["CA-STD", "ZERO", "EXEMPT"],
	})),
	{
		ctx: {
			seller: { country: "DE" },
			buyer: { country: "DE" },
			currency: "EUR",
		},
		codes: ["DE-VAT-19", "DE-VAT-7", "EXEMPT"],
	},
	{
		ctx: {
			seller: { country: "FR" },
			buyer: { country: "FR" },
			currency: "EUR",
		},
		codes: ["FR-VAT-20", "FR-VAT-10", "FR-VAT-5.5", "FR-VAT-2.1"],
	},
	{
		ctx: {
			seller: { country: "GB" },
			buyer: { country: "GB" },
			currency: "GBP",
		},
		codes: ["GB-VAT-20", "GB-VAT-5", "ZERO"],
	},
	{
		ctx: {
			seller: { country: "AU" },
			buyer: { country: "AU" },
			currency: "AUD",
		},
		codes: ["AU-GST-10", "ZERO", "EXEMPT"],
	},
	{
		ctx: {
			seller: { country: "AE" },
			buyer: { country: "AE" },
			currency: "AED",
		},
		codes: ["AE-VAT-5", "ZERO"],
	},
	{
		ctx: {
			seller: { country: "US" },
			buyer: { country: "US" },
			currency: "USD",
		},
		codes: ["US-SALES", "EXEMPT"],
		usRates: ["8.875", "7.25", "6", "4.712", "0"],
	},
	{
		ctx: {
			seller: { country: "US" },
			buyer: { country: "US" },
			currency: "JPY",
		},
		codes: ["US-SALES"],
		usRates: ["10", "8.25"],
	},
];

function randomLines(
	next: (max: number) => number,
	s: Scenario,
): TaxLineInput[] {
	const count = next(7);
	return Array.from({ length: count }, (_, i) => {
		const quantity = `${next(40)}.${pad(next(999), 3)}`;
		const unitPrice = `${next(2500)}.${pad(next(99), 2)}`;
		const taxCode = s.codes[next(s.codes.length - 1)];
		const gross = dec(quantity).times(dec(unitPrice));
		const line: TaxLineInput = { lineNo: i + 1, quantity, unitPrice, taxCode };
		if (next(2) === 0) {
			// Up to ~30% off, rounded down to cents so it never exceeds the gross.
			line.discount = gross
				.times(dec(`0.${pad(next(30), 2)}`))
				.round(2, 0)
				.toFixed(2);
		}
		if (taxCode === "US-SALES" && s.usRates) {
			line.rate = s.usRates[next(s.usRates.length - 1)];
		}
		return line;
	});
}

describe("totals reconcile on seeded random documents", () => {
	const next = rng(20261017);
	const cases = Array.from({ length: 400 }, (_, i) => {
		const s = SCENARIOS[i % SCENARIOS.length];
		return { s, lines: randomLines(next, s) };
	});

	it("total = subtotal + tax, and every breakdown sums to the totals", () => {
		for (const { s, lines } of cases) {
			const r = computeTax(s.ctx, lines);
			const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

			expect(r.totalMinor).toBe(r.subtotalMinor + r.taxMinor);
			expect(sum(r.lines.map((l) => l.netMinor))).toBe(r.subtotalMinor);
			expect(sum(r.lines.map((l) => l.taxMinor))).toBe(r.taxMinor);
			expect(sum(r.lines.map((l) => l.totalMinor))).toBe(r.totalMinor);
			expect(sum(r.taxTotals.map((t) => t.amountMinor))).toBe(r.taxMinor);
			for (const l of r.lines) {
				expect(Number.isSafeInteger(l.netMinor)).toBe(true);
				expect(sum(l.components.map((c) => c.amountMinor))).toBe(l.taxMinor);
				expect(l.totalMinor).toBe(l.netMinor + l.taxMinor);
			}

			// Each rate group against an independent calculation on its taxable base.
			for (const t of r.taxTotals) {
				const expected = toMinor(
					toMajor({ minor: t.taxableMinor, currency: r.currency })
						.times(dec(t.rate))
						.div(new Decimal("100")),
					r.currency,
				).minor;
				const lineCount = r.lines.filter((l) =>
					l.components.some((c) => c.code === t.code && c.rate === t.rate),
				).length;
				if (ROUNDING[s.ctx.seller.country] === "invoice") {
					expect(t.amountMinor).toBe(expected);
				} else {
					// Per-line rounding drifts at most half a minor unit per line.
					expect(Math.abs(t.amountMinor - expected) * 2).toBeLessThanOrEqual(
						lineCount,
					);
				}
			}
		}
	});

	it("is deterministic", () => {
		for (const { s, lines } of cases.slice(0, 50)) {
			expect(computeTax(s.ctx, lines)).toEqual(computeTax(s.ctx, lines));
		}
	});
});
