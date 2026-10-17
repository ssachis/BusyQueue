import { describe, expect, it } from "vitest";
import {
	failedOutcome,
	formatReport,
	outcomeFromResponse,
	parseArgs,
	runPool,
	summarize,
} from "./batch.ts";
import type { AnswerKeyRow, Finding } from "./types.ts";

const key: AnswerKeyRow[] = [
	{ kind: "overcharge", invoiceId: "inv-1", lineNo: 1, paymentId: null, expectedImpactMinor: 1000, currency: "USD" },
	{ kind: "wrong_total", invoiceId: "inv-2", lineNo: null, paymentId: null, expectedImpactMinor: 500, currency: "USD" },
];
const f = (kind: Finding["kind"], invoiceId: string, lineNo: number | null, impactMinor: number): Finding => ({
	kind, invoiceId, lineNo, paymentId: null, expected: "", actual: "", impactMinor, currency: "USD", detail: "",
});
const ok = (invoiceId: string, findings: Finding[], repeat = 0) =>
	outcomeFromResponse({ invoiceId, status: "completed", findings }, repeat);

describe("parseArgs", () => {
	it("parses flags and strips trailing slash", () => {
		const a = parseArgs(["--url", "http://x/", "--version", "v2", "--concurrency", "4"]);
		expect(a).toMatchObject({ url: "http://x", version: "v2", concurrency: 4, mode: "http" });
	});
	it("requires url in http mode only", () => {
		expect(() => parseArgs([])).toThrow(/--url/);
		expect(parseArgs(["--mode", "rules"]).mode).toBe("rules");
	});
	it("rejects bad values", () => {
		expect(() => parseArgs(["--version", "v3", "--mode", "rules"])).toThrow();
		expect(() => parseArgs(["--mode", "rules", "--concurrency", "0"])).toThrow();
		expect(() => parseArgs(["--bogus"])).toThrow(/Unknown/);
	});
});

describe("runPool", () => {
	it("keeps order and respects the limit", async () => {
		let active = 0;
		let peak = 0;
		const out = await runPool([1, 2, 3, 4, 5, 6], 2, async (n) => {
			active++;
			peak = Math.max(peak, active);
			await new Promise((r) => setTimeout(r, 5));
			active--;
			return n * 2;
		});
		expect(out).toEqual([2, 4, 6, 8, 10, 12]);
		expect(peak).toBe(2);
	});
});

describe("summarize", () => {
	it("scores a perfect run", () => {
		const r = summarize("v1", [ok("inv-1", [f("overcharge", "inv-1", 1, 1000)]), ok("inv-2", [f("wrong_total", "inv-2", null, 500)])], ["inv-1", "inv-2"], key);
		expect(r.precision).toBe(1);
		expect(r.recall).toBe(1);
		expect(r.foundMinor).toBe(1500);
	});
	it("counts failed runs as misses but separates them", () => {
		const r = summarize("v1", [ok("inv-1", [f("overcharge", "inv-1", 1, 1000)]), failedOutcome("inv-2", 0, "quota", "429")], ["inv-1", "inv-2"], key);
		expect(r.recall).toBe(0.5);
		expect(r.recallCompleted).toBe(1);
		expect(r.runFailures).toEqual([{ key: "quota", count: 1, example: "429" }]);
	});
	it("counts false flags and missed kinds", () => {
		const r = summarize("v1", [ok("inv-1", [f("overcharge", "inv-1", 2, 99)]), ok("inv-2", [])], ["inv-1", "inv-2"], key);
		expect(r.falsePositives).toBe(1);
		expect(r.precision).toBe(0);
		expect(r.missedByKind.map((m) => m.key).sort()).toEqual(["overcharge", "wrong_total"]);
	});
	it("scores repeats separately", () => {
		const good = [ok("inv-1", [f("overcharge", "inv-1", 1, 1000)], 0), ok("inv-2", [f("wrong_total", "inv-2", null, 500)], 0)];
		const bad = [ok("inv-1", [], 1), ok("inv-2", [], 1)];
		const r = summarize("v1", [...good, ...bad], ["inv-1", "inv-2"], key);
		expect(r.repeats).toBe(2);
		expect(r.recall).toBe(0.5);
	});
	it("formats a report", () => {
		const r = summarize("v1", [ok("inv-1", [])], ["inv-1"], key);
		expect(formatReport(r)).toContain("agent v1");
	});
});
