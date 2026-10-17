import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	invoices as fixtureInvoices,
	answerKey as fixtureKey,
	payments as fixturePayments,
	priceList as fixturePrices,
} from "#/lib/busyq/fixtures/index.ts";
import {
	AnswerKeyRow,
	type Finding,
	Invoice,
	ok,
	Payment,
	PriceRow,
} from "#/lib/busyq/types.ts";
import {
	calculateImpact,
	checkInvoice,
	checkInvoicePayments,
	checkPayments,
	compareLines,
	findOrphanPayments,
	lookupPrices,
	NO_INVOICE,
	scoreRun,
} from "./index.ts";

const byId = (id: string) => {
	const inv = fixtureInvoices.find((i) => i.id === id);
	if (!inv) throw new Error(`no fixture ${id}`);
	return inv;
};

describe("lookupPrices (v1, exact match)", () => {
	it("finds an exact vendor, item and unit", () => {
		const r = lookupPrices(fixturePrices, "Sysco", {
			item: "Chicken breast",
			unit: "lb",
		});
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.data.agreedUnitPrice).toBe("2.10");
	});
	it("fails with a structured error on any spelling difference", () => {
		for (const probe of [
			{ vendor: "SYSCO Foods", item: "Chicken breast", unit: "lb" },
			{ vendor: "Sysco", item: "Chicken breast", unit: "case" },
			{ vendor: "Sysco", item: "chicken breast", unit: "lb" },
		]) {
			const r = lookupPrices(fixturePrices, probe.vendor, probe);
			expect(r.ok).toBe(false);
			if (!r.ok) {
				expect(r.error.code).toBe("price_not_found");
				expect(r.error.details).toMatchObject({ vendor: probe.vendor });
			}
		}
	});
});

describe("compareLines", () => {
	it("flags the 6 cent overcharge as exactly $72.00", () => {
		const { findings, unpriced } = compareLines(
			byId("inv-overcharge"),
			fixturePrices,
		);
		expect(unpriced).toEqual([]);
		expect(findings).toHaveLength(1);
		expect(findings[0]).toMatchObject({
			kind: "overcharge",
			invoiceId: "inv-overcharge",
			lineNo: 1,
			expected: "2.10",
			actual: "2.16",
			impactMinor: 7200,
			currency: "USD",
		});
	});
	it("finds nothing on a clean invoice", () => {
		expect(compareLines(byId("inv-clean"), fixturePrices)).toEqual({
			findings: [],
			unpriced: [],
		});
	});
	it("does not flag an undercharge", () => {
		const inv = structuredClone(byId("inv-overcharge"));
		inv.lines[0]!.unitPrice = "2.00";
		expect(compareLines(inv, fixturePrices).findings).toEqual([]);
	});
	it("reports unpriced lines instead of guessing (v1 on the variant invoice)", () => {
		const { findings, unpriced } = compareLines(
			byId("inv-variant"),
			fixturePrices,
		);
		expect(findings).toEqual([]);
		expect(unpriced).toHaveLength(1);
		expect(unpriced[0]).toMatchObject({ lineNo: 1, unit: "case" });
		expect(unpriced[0]?.error.code).toBe("price_not_found");
	});
	it("accepts another lookup, which is how v2 plugs in", () => {
		const v2ish = () =>
			ok({ row: fixturePrices[0] as PriceRow, agreedUnitPrice: "2.10" });
		const inv = structuredClone(byId("inv-overcharge"));
		expect(compareLines(inv, fixturePrices, v2ish).findings).toHaveLength(1);
	});
	it("does not re-check a repeated line for price", () => {
		const inv = structuredClone(byId("inv-overcharge"));
		inv.lines.push({ ...inv.lines[0]!, lineNo: 2 });
		expect(compareLines(inv, fixturePrices).findings).toHaveLength(1);
	});
});

describe("checkInvoice", () => {
	it("finds nothing on clean invoices", () => {
		for (const inv of fixtureInvoices) expect(checkInvoice(inv)).toEqual([]);
	});
	it("flags a repeated line once, with the line's amount", () => {
		const inv = structuredClone(byId("inv-overcharge"));
		inv.lines.push({ ...inv.lines[0]!, lineNo: 2 });
		inv.statedTotal = "5184.00";
		const f = checkInvoice(inv);
		expect(f).toHaveLength(1);
		expect(f[0]).toMatchObject({
			kind: "duplicate_line",
			lineNo: 2,
			impactMinor: 259200,
		});
	});
	it("flags a stated total above the sum of the lines", () => {
		const inv = structuredClone(byId("inv-clean"));
		inv.statedTotal = "97.50";
		const f = checkInvoice(inv);
		expect(f).toHaveLength(1);
		expect(f[0]).toMatchObject({
			kind: "wrong_total",
			lineNo: null,
			expected: "85.00",
			actual: "97.50",
			impactMinor: 1250,
		});
	});
	it("flags a line amount above quantity x unit price", () => {
		const inv = structuredClone(byId("inv-clean"));
		inv.lines[0]!.amount = "160.00";
		inv.statedTotal = "160.00";
		const f = checkInvoice(inv);
		expect(f).toHaveLength(1);
		expect(f[0]).toMatchObject({
			kind: "wrong_total",
			lineNo: 1,
			impactMinor: 7500,
		});
	});
	it("ignores a stated total below the lines", () => {
		const inv = structuredClone(byId("inv-clean"));
		inv.statedTotal = "80.00";
		expect(checkInvoice(inv)).toEqual([]);
	});
	it("rounds once, at the end (half-up on exact decimals)", () => {
		const inv = structuredClone(byId("inv-clean"));
		inv.lines[0] = {
			...inv.lines[0]!,
			quantity: "3",
			unitPrice: "0.335",
			amount: "1.01",
		};
		inv.statedTotal = "1.01";
		expect(checkInvoice(inv)).toEqual([]); // 3 x 0.335 = 1.005 -> 1.01
	});
});

describe("payments", () => {
	it("flags the second payment of an invoice, not the first", () => {
		const f = checkInvoicePayments(byId("inv-clean"), fixturePayments);
		expect(f).toHaveLength(1);
		expect(f[0]).toMatchObject({
			kind: "duplicate_payment",
			invoiceId: "inv-clean",
			paymentId: "pay-2",
			impactMinor: 8500,
		});
		expect(
			checkInvoicePayments(byId("inv-overcharge"), fixturePayments),
		).toEqual([]);
	});
	it("finds payments with no invoice, null or unknown number", () => {
		const f = findOrphanPayments(fixtureInvoices, fixturePayments);
		expect(f.map((x) => x.paymentId)).toEqual(["pay-3"]);
		const extra = [
			...fixturePayments,
			Payment.parse({
				...fixturePayments[0],
				id: "pay-9",
				invoiceNumber: "NOPE-1",
			}),
		];
		expect(
			findOrphanPayments(fixtureInvoices, extra).map((x) => x.paymentId),
		).toEqual(["pay-3", "pay-9"]);
	});
	it("checkPayments returns both kinds", () => {
		expect(
			checkPayments(fixtureInvoices, fixturePayments)
				.map((x) => x.kind)
				.sort(),
		).toEqual(["duplicate_payment", "orphan_payment"]);
	});
});

const finding = (over: Partial<Finding>): Finding => ({
	kind: "overcharge",
	invoiceId: "inv-a",
	lineNo: 1,
	paymentId: null,
	expected: null,
	actual: null,
	impactMinor: 100,
	currency: "USD",
	detail: "x",
	...over,
});

describe("calculateImpact", () => {
	it("sums per invoice and per kind in integer cents", () => {
		const s = calculateImpact([
			finding({ impactMinor: 100 }),
			finding({ lineNo: 2, impactMinor: 250 }),
			finding({
				invoiceId: "inv-b",
				kind: "wrong_total",
				lineNo: null,
				impactMinor: 5,
			}),
			finding({
				invoiceId: null,
				kind: "orphan_payment",
				lineNo: null,
				paymentId: "p",
				impactMinor: 31000,
			}),
		]);
		expect(s.total).toEqual({ minor: 31355, currency: "USD" });
		expect(s.byInvoice["inv-a"]?.minor).toBe(350);
		expect(s.byInvoice["inv-b"]?.minor).toBe(5);
		expect(s.byInvoice[NO_INVOICE]?.minor).toBe(31000);
		expect(s.byKind.overcharge?.count).toBe(2);
	});
	it("is zero for no findings and refuses mixed currencies", () => {
		expect(calculateImpact([]).total.minor).toBe(0);
		expect(() => calculateImpact([finding({ currency: "EUR" })])).toThrow();
	});
});

describe("scoreRun", () => {
	it("scores the v1 run on the fixtures: one miss, no false flags", () => {
		const findings = [
			...fixtureInvoices.flatMap((i) => [
				...compareLines(i, fixturePrices).findings,
				...checkInvoice(i),
			]),
			...checkPayments(fixtureInvoices, fixturePayments),
		];
		const s = scoreRun(findings, fixtureKey);
		expect(s.truePositives).toBe(3);
		expect(s.falsePositives).toEqual([]);
		expect(s.falseNegatives.map((r) => r.invoiceId)).toEqual(["inv-variant"]);
		expect(s.precision).toBe(1);
		expect(s.recall).toBe(0.75);
		expect(s.wrongAmount).toEqual([]);
	});
	it("flags a wrong amount without hiding the match", () => {
		const s = scoreRun(
			[finding({ impactMinor: 90 })],
			[
				{
					kind: "overcharge",
					invoiceId: "inv-a",
					lineNo: 1,
					paymentId: null,
					expectedImpactMinor: 100,
					currency: "USD",
				},
			],
		);
		expect(s.truePositives).toBe(1);
		expect(s.wrongAmount).toHaveLength(1);
	});
	it("scores only the invoices a run covered", () => {
		const key = fixtureKey;
		const s = scoreRun([], key, new Set(["inv-overcharge"]));
		expect(s.falseNegatives).toHaveLength(1);
		expect(s.recall).toBe(0);
	});
	it("treats an empty run on an empty key as perfect", () => {
		const s = scoreRun([], []);
		expect(s.precision).toBe(1);
		expect(s.recall).toBe(1);
	});
});

// ── The generated school-district dataset ────────────────────────────

const dataDir = new URL("../../../data/", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, dataDir), "utf8");

function parseCsv(text: string): Record<string, string>[] {
	const [head, ...rows] = text.trim().split("\n");
	const cols = (head as string).split(",");
	return rows.map((row) => {
		const cells: string[] = [];
		let cur = "";
		let quoted = false;
		for (const ch of row) {
			if (ch === '"') quoted = !quoted;
			else if (ch === "," && !quoted) {
				cells.push(cur);
				cur = "";
			} else cur += ch;
		}
		cells.push(cur);
		return Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? ""]));
	});
}

const opt = (s: string | undefined) =>
	s === undefined || s === "" ? undefined : s;
const nul = (s: string | undefined) => (s === undefined || s === "" ? null : s);

const prices = parseCsv(read("price_list.csv")).map((r) =>
	PriceRow.parse({
		vendor: r.vendor,
		item: r.item,
		unit: r.unit,
		unitPrice: r.unit_price,
		currency: r.currency,
		packUnit: opt(r.pack_unit),
		packSize: opt(r.pack_size),
	}),
);
const invoices = readdirSync(new URL("invoices/", dataDir))
	.sort()
	.map((f) => Invoice.parse(JSON.parse(read(`invoices/${f}`))));
const payments = parseCsv(read("payments.csv")).map((r) =>
	Payment.parse({
		id: r.id,
		vendor: r.vendor,
		invoiceNumber: nul(r.invoice_number),
		amount: r.amount,
		currency: r.currency,
		paidOn: r.paid_on,
		reference: r.reference,
	}),
);
const key = parseCsv(read("answer_key.csv")).map((r) =>
	AnswerKeyRow.parse({
		kind: r.kind,
		invoiceId: nul(r.invoice_id),
		lineNo: r.line_no === "" ? null : Number(r.line_no),
		paymentId: nul(r.payment_id),
		expectedImpactMinor: Number(r.expected_impact_minor),
		currency: r.currency,
	}),
);
const index = parseCsv(read("invoice_index.csv"));

describe("generated school-district data, v1 rules", () => {
	const unpricedInvoices = new Set<string>();
	const findings: Finding[] = [];
	for (const inv of invoices) {
		const c = compareLines(inv, prices);
		if (c.unpriced.length > 0) unpricedInvoices.add(inv.id);
		findings.push(...c.findings, ...checkInvoice(inv));
	}
	findings.push(...checkPayments(invoices, payments));

	const variantIds = new Set(
		index
			.filter((r) => r.name_variant === "1" || r.unit_variant === "1")
			.map((r) => r.invoice_id as string),
	);
	const cleanIds = new Set(
		invoices.map((i) => i.id).filter((id) => !variantIds.has(id)),
	);

	it("loads: 40 invoices, all five kinds of planted problem covered", () => {
		expect(invoices).toHaveLength(40);
		expect(new Set(key.map((k) => k.kind))).toEqual(
			new Set([
				"overcharge",
				"duplicate_line",
				"wrong_total",
				"duplicate_payment",
				"orphan_payment",
			]),
		);
		expect(prices.length).toBeGreaterThanOrEqual(15);
	});
	it("has 10+ variant invoices where exact-match lookup fails", () => {
		expect(variantIds.size).toBeGreaterThanOrEqual(10);
		for (const id of variantIds) expect(unpricedInvoices.has(id)).toBe(true);
		for (const id of cleanIds) expect(unpricedInvoices.has(id)).toBe(false);
	});
	it("finds every planted mistake on the non-variant invoices", () => {
		const s = scoreRun(findings, key, cleanIds);
		expect(s.recall).toBe(1);
		expect(s.precision).toBe(1);
		expect(s.wrongAmount).toEqual([]);
	});
	it("misses only price overcharges on variant invoices (and flags nothing wrong)", () => {
		const s = scoreRun(findings, key);
		expect(s.falsePositives).toEqual([]);
		expect(s.recall).toBeLessThan(1);
		for (const miss of s.falseNegatives) {
			expect(miss.kind).toBe("overcharge");
			expect(variantIds.has(miss.invoiceId as string)).toBe(true);
		}
		expect(s.wrongAmount).toEqual([]);
	});
	it("totals match the key for what was found", () => {
		const s = scoreRun(findings, key);
		expect(calculateImpact(findings).total.minor).toBe(s.foundMinor);
		expect(s.foundMinor).toBeLessThan(s.plantedMinor);
	});
	it("printed totals equal the sum of printed lines except where planted", () => {
		const planted = new Set(
			key.filter((k) => k.kind === "wrong_total").map((k) => k.invoiceId),
		);
		for (const inv of invoices) {
			const wrong = checkInvoice(inv).some((f) => f.kind === "wrong_total");
			expect(wrong).toBe(planted.has(inv.id));
		}
	});
});
