import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	parseInvoice,
	parsePayments,
	parsePriceList,
} from "#/lib/busyq/load.ts";
import { lookupPricesV2 } from "#/lib/rules/index.ts";
import { buildReview, disputeDraft } from "./review.ts";

const dir = new URL("../../../data/", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, dir), "utf8");

const invoices = readdirSync(new URL("invoices/", dir))
	.sort()
	.map((f) => parseInvoice(JSON.parse(read(`invoices/${f}`))));
const model = buildReview(
	invoices,
	parsePriceList(read("price_list.csv")),
	parsePayments(read("payments.csv")),
);

describe("review model on the generated data", () => {
	it("summarises every invoice", () => {
		expect(model.rows).toHaveLength(40);
		expect(model.totals.invoices).toBe(40);
		expect(model.totals.flagged).toBeGreaterThan(5);
		expect(model.totals.recoverable.minor).toBeGreaterThan(0);
		expect(model.orphans).toHaveLength(2);
	});
	it("marks status consistently", () => {
		for (const r of model.rows) {
			if (r.status === "flagged") expect(r.findings.length).toBeGreaterThan(0);
			if (r.status === "unpriced") {
				expect(r.findings).toEqual([]);
				expect(r.unpriced.length).toBeGreaterThan(0);
			}
			if (r.status === "clean") {
				expect(r.findings).toEqual([]);
				expect(r.unpriced).toEqual([]);
			}
		}
		expect(model.rows.some((r) => r.status === "unpriced")).toBe(true);
		expect(model.rows.some((r) => r.status === "clean")).toBe(true);
	});
	it("recoverable total is the sum of invoice impacts plus orphan payments", () => {
		const sum =
			model.rows.reduce((n, r) => n + r.impact.minor, 0) +
			model.orphans.reduce((n, f) => n + f.impactMinor, 0);
		expect(model.totals.recoverable.minor).toBe(sum);
	});
});

describe("disputeDraft", () => {
	it("is empty for a clean invoice", () => {
		const clean = model.rows.find((r) => r.status === "clean");
		expect(clean && disputeDraft(clean)).toBe("");
	});
	it("lists each finding and the code-computed total", () => {
		const flagged =
			model.rows.find((r) => r.findings.length > 1) ??
			model.rows.find((r) => r.status === "flagged");
		expect(flagged).toBeDefined();
		if (!flagged) return;
		const text = disputeDraft(flagged);
		expect(text).toContain(`Subject: Invoice ${flagged.invoice.invoiceNumber}`);
		for (const f of flagged.findings) expect(text).toContain(f.detail);
		expect(text).toMatch(/Total to credit or refund: \$[\d,]+\.\d{2}\./);
	});
});

describe("review with the v2 lookup", () => {
	const v2 = buildReview(
		invoices,
		parsePriceList(read("price_list.csv")),
		parsePayments(read("payments.csv")),
		"USD",
		lookupPricesV2,
	);
	it("checks every line and finds more money than v1", () => {
		expect(model.totals.unpricedLines).toBeGreaterThan(0);
		expect(v2.totals.unpricedLines).toBe(0);
		expect(v2.totals.recoverable.minor).toBeGreaterThan(
			model.totals.recoverable.minor,
		);
	});
	it("splits the total by cause, largest first, and the parts add up", () => {
		const parts = v2.totals.byKind;
		expect(parts.map((p) => p.impact.minor)).toEqual(
			[...parts.map((p) => p.impact.minor)].sort((a, b) => b - a),
		);
		expect(parts.reduce((n, p) => n + p.impact.minor, 0)).toBe(
			v2.totals.recoverable.minor,
		);
	});
});
