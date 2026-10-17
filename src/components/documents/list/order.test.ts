import { describe, expect, it } from "vitest";
import {
	countByStatus,
	filterRows,
	type ListRowLike,
	priorityGroup,
	sortRows,
} from "./order.ts";

const row = (id: string, over: Partial<ListRowLike>): ListRowLike => ({
	id,
	type: "invoice",
	status: "issued",
	displayStatus: "issued",
	number: id.toUpperCase(),
	buyerName: "Acme Logistics",
	date: "2026-10-01",
	dueDate: null,
	currency: "USD",
	totalMinor: 10_000,
	balanceMinor: 10_000,
	updatedAt: "2026-10-01T10:00:00.000Z",
	...over,
});

const rows: ListRowLike[] = [
	row("paid", { displayStatus: "paid", balanceMinor: 0, date: "2026-10-09" }),
	row("draft-old", {
		status: "draft",
		displayStatus: "draft",
		number: null,
		balanceMinor: null,
		updatedAt: "2026-10-02T00:00:00.000Z",
	}),
	row("unpaid-late", { dueDate: "2026-11-30" }),
	row("void", { status: "void", displayStatus: "void", balanceMinor: null }),
	row("overdue-new", { displayStatus: "overdue", dueDate: "2026-10-10" }),
	row("quote", {
		type: "quote",
		displayStatus: "issued",
		balanceMinor: null,
	}),
	row("partial", {
		displayStatus: "partially_paid",
		dueDate: "2026-11-01",
		balanceMinor: 4_000,
	}),
	row("draft-new", {
		status: "draft",
		displayStatus: "draft",
		number: null,
		balanceMinor: null,
		updatedAt: "2026-10-15T00:00:00.000Z",
	}),
	row("overdue-old", { displayStatus: "overdue", dueDate: "2026-09-15" }),
	row("unpaid-nodue", { dueDate: null }),
];

describe("sortRows (default)", () => {
	it("puts overdue first, then unpaid by due date, then drafts, then the rest", () => {
		expect(sortRows(rows).map((r) => r.id)).toEqual([
			"overdue-old",
			"overdue-new",
			"partial",
			"unpaid-late",
			"unpaid-nodue",
			"draft-new",
			"draft-old",
			"quote",
			"paid",
			"void",
		]);
	});

	it("treats issued documents that take no payment as settled-ish, after drafts", () => {
		expect(priorityGroup(row("q", { type: "quote", balanceMinor: null }))).toBe(
			3,
		);
		expect(priorityGroup(row("i", {}))).toBe(1);
	});

	it("does not mutate its input", () => {
		const copy = [...rows];
		sortRows(rows, "amount_desc");
		expect(rows).toEqual(copy);
	});
});

describe("sortRows (explicit)", () => {
	const money = [
		row("a", { totalMinor: 500, date: "2026-10-03" }),
		row("b", { totalMinor: null, date: "2026-10-01" }),
		row("c", { totalMinor: 9_000, date: "2026-10-02" }),
	];
	it("sorts by amount with blank totals last", () => {
		expect(sortRows(money, "amount_desc").map((r) => r.id)).toEqual([
			"c",
			"a",
			"b",
		]);
		expect(sortRows(money, "amount_asc").map((r) => r.id)).toEqual([
			"a",
			"c",
			"b",
		]);
	});
	it("sorts by date", () => {
		expect(sortRows(money, "date_desc").map((r) => r.id)).toEqual([
			"a",
			"c",
			"b",
		]);
		expect(sortRows(money, "date_asc").map((r) => r.id)).toEqual([
			"b",
			"c",
			"a",
		]);
	});
});

describe("filterRows", () => {
	it("filters by display status, type, date range and text", () => {
		expect(filterRows(rows, { status: "overdue" }).map((r) => r.id)).toEqual([
			"overdue-new",
			"overdue-old",
		]);
		expect(filterRows(rows, { type: "quote" }).map((r) => r.id)).toEqual([
			"quote",
		]);
		expect(filterRows(rows, { from: "2026-10-05" }).map((r) => r.id)).toEqual([
			"paid",
		]);
		expect(filterRows(rows, { q: "partial" }).map((r) => r.id)).toEqual([
			"partial",
		]);
		expect(filterRows(rows, { q: "acme" })).toHaveLength(rows.length);
	});
});

describe("countByStatus", () => {
	it("counts each display status", () => {
		expect(countByStatus(rows)).toEqual({
			draft: 2,
			issued: 3,
			partially_paid: 1,
			paid: 1,
			overdue: 2,
			void: 1,
		});
	});
});
