import { describe, expect, it } from "vitest";
import {
	type AuditRowLike,
	countWithin,
	mergeActivity,
	summarizeAudit,
	sumReceivables,
} from "./summary.ts";

function bill(
	id: string,
	run: Partial<NonNullable<AuditRowLike["run"]>> | null,
): AuditRowLike {
	return {
		id,
		invoiceNumber: id.toUpperCase(),
		vendor: "Acme Freight",
		issueDate: "2026-09-01",
		run:
			run === null
				? null
				: {
						id: `run-${id}`,
						status: "completed",
						totalMinor: 0,
						failedTools: 0,
						approved: false,
						...run,
					},
	};
}

describe("summarizeAudit", () => {
	const rows = [
		bill("a", { totalMinor: 3_000 }),
		bill("b", { totalMinor: 12_550 }),
		bill("c", { totalMinor: 9_999, approved: true }),
		bill("d", { failedTools: 2 }),
		bill("e", { status: "failed" }),
		bill("f", { status: "running", totalMinor: 400 }),
		bill("g", null),
		bill("h", { totalMinor: 1 }),
		bill("i", {}),
	];

	it("adds up recoverable, awaiting and approved amounts in minor units", () => {
		const s = summarizeAudit(rows);
		expect(s.bills).toBe(9);
		expect(s.checked).toBe(7);
		expect(s.flagged).toBe(4);
		expect(s.recoverableMinor).toBe(3_000 + 12_550 + 9_999 + 1);
		expect(s.awaitingApproval).toBe(3);
		expect(s.awaitingMinor).toBe(3_000 + 12_550 + 1);
		expect(s.approved).toBe(1);
		expect(s.approvedMinor).toBe(9_999);
		expect(s.partlyChecked).toBe(1);
	});

	it("lists the largest unapproved flagged bills first", () => {
		expect(summarizeAudit(rows).top.map((t) => t.id)).toEqual(["b", "a", "h"]);
		expect(summarizeAudit(rows, 1).top).toEqual([
			{
				id: "b",
				invoiceNumber: "B",
				vendor: "Acme Freight",
				amountMinor: 12_550,
			},
		]);
	});

	it("is all zeros with no bills", () => {
		const s = summarizeAudit([]);
		expect(s).toMatchObject({
			bills: 0,
			checked: 0,
			flagged: 0,
			recoverableMinor: 0,
			top: [],
		});
	});
});

describe("sumReceivables", () => {
	it("sums balances per currency, preferred first, ignoring settled invoices", () => {
		const out = sumReceivables(
			[
				{ currency: "USD", balanceMinor: 10_000, overdue: false },
				{ currency: "EUR", balanceMinor: 500, overdue: true },
				{ currency: "USD", balanceMinor: 2_500, overdue: true },
				{ currency: "USD", balanceMinor: 0, overdue: false },
				{ currency: "CAD", balanceMinor: 100, overdue: false },
			],
			"USD",
		);
		expect(out).toEqual([
			{
				currency: "USD",
				balanceMinor: 12_500,
				open: 2,
				overdue: 1,
				overdueMinor: 2_500,
			},
			{
				currency: "CAD",
				balanceMinor: 100,
				open: 1,
				overdue: 0,
				overdueMinor: 0,
			},
			{
				currency: "EUR",
				balanceMinor: 500,
				open: 1,
				overdue: 1,
				overdueMinor: 500,
			},
		]);
	});

	it("shows a zero row for the business currency when nothing is owed", () => {
		expect(sumReceivables([], "GBP")).toEqual([
			{
				currency: "GBP",
				balanceMinor: 0,
				open: 0,
				overdue: 0,
				overdueMinor: 0,
			},
		]);
	});
});

describe("countWithin", () => {
	it("counts items of one direction expected by the last date", () => {
		const items = [
			{ direction: "out" as const, expectedDate: "2026-10-01", pastDue: true },
			{ direction: "out" as const, expectedDate: "2026-10-30", pastDue: false },
			{ direction: "out" as const, expectedDate: "2026-10-31", pastDue: false },
			{ direction: "in" as const, expectedDate: "2026-10-05", pastDue: false },
		];
		expect(countWithin(items, "out", "2026-10-30")).toEqual({
			count: 2,
			pastDue: 1,
		});
		expect(countWithin(items, "in", "2026-10-30")).toEqual({
			count: 1,
			pastDue: 0,
		});
	});
});

describe("mergeActivity", () => {
	it("merges sources newest first with a stable tie-break and a limit", () => {
		const out = mergeActivity(
			[
				[
					{ id: "run-2", at: "2026-10-02T10:00:00.000Z" },
					{ id: "run-1", at: "2026-10-01T10:00:00.000Z" },
				],
				[{ id: "doc-1", at: "2026-10-02T10:00:00.000Z" }],
				[{ id: "imp-1", at: "2026-10-03T09:00:00.000Z" }],
			],
			3,
		);
		expect(out.map((a) => a.id)).toEqual(["imp-1", "doc-1", "run-2"]);
		expect(mergeActivity([[{ id: "x", at: "2026-01-01" }]], 0)).toEqual([]);
	});
});
