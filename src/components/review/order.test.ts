import { describe, expect, it } from "vitest";
import {
	defaultSelection,
	filterRows,
	type ReviewRowLike,
	reviewStatus,
	sortRows,
	vendorGroups,
	vendorKey,
	vendorOptions,
} from "./order.ts";

type Run = NonNullable<ReviewRowLike["run"]>;

function row(
	id: string,
	opts: {
		vendor?: string;
		date?: string;
		run?: Partial<Run> | null;
	} = {},
): ReviewRowLike {
	return {
		id,
		invoiceNumber: id.toUpperCase(),
		vendor: opts.vendor ?? "Acme Freight",
		issueDate: opts.date ?? "2026-09-01",
		run:
			opts.run === null || opts.run === undefined
				? null
				: {
						status: "completed",
						totalMinor: 0,
						failedTools: 0,
						toolLogged: true,
						approved: false,
						...opts.run,
					},
	};
}

const flaggedSmall = row("f-small", { run: { totalMinor: 1_000 } });
const flaggedBig = row("f-big", { run: { totalMinor: 9_000 } });
const unchecked = row("unchecked", { run: { failedTools: 2 } });
const failed = row("failed", { run: { status: "failed" } });
const approved = row("approved", {
	run: { totalMinor: 50_000, approved: true },
});
const clean = row("clean", { run: {} });
const notRun = row("not-run", { run: null });

const all = [
	notRun,
	clean,
	approved,
	failed,
	unchecked,
	flaggedSmall,
	flaggedBig,
];

describe("reviewStatus", () => {
	it("derives one status from the latest analysis", () => {
		expect(all.map(reviewStatus)).toEqual([
			"not_run",
			"clean",
			"approved",
			"failed",
			"unchecked",
			"flagged",
			"flagged",
		]);
		expect(reviewStatus(row("r", { run: { status: "running" } }))).toBe(
			"running",
		);
		expect(reviewStatus(row("old", { run: { toolLogged: false } }))).toBe(
			"rerun",
		);
	});

	it("a flagged amount wins over failed tool calls", () => {
		expect(
			reviewStatus(row("x", { run: { totalMinor: 5, failedTools: 1 } })),
		).toBe("flagged");
	});
});

describe("sortRows", () => {
	it("priority: flagged by amount, then couldn't check, failed, approved, clean, not run", () => {
		expect(sortRows(all).map((r) => r.id)).toEqual([
			"f-big",
			"f-small",
			"unchecked",
			"failed",
			"approved",
			"clean",
			"not-run",
		]);
	});

	it("amount: largest recoverable first, ties by priority", () => {
		expect(
			sortRows(all, "amount")
				.map((r) => r.id)
				.slice(0, 4),
		).toEqual(["approved", "f-big", "f-small", "unchecked"]);
	});

	it("date: newest bill first, ties by bill number", () => {
		const rows = [
			row("b", { date: "2026-08-01" }),
			row("c", { date: "2026-09-15" }),
			row("a", { date: "2026-08-01" }),
		];
		expect(sortRows(rows, "date").map((r) => r.id)).toEqual(["c", "a", "b"]);
	});

	it("vendor: A to Z ignoring case, then newest", () => {
		const rows = [
			row("1", { vendor: "zeta Lines", date: "2026-01-01" }),
			row("2", { vendor: "Alpha Haulage", date: "2026-01-01" }),
			row("3", { vendor: "alpha haulage", date: "2026-02-01" }),
		];
		expect(sortRows(rows, "vendor").map((r) => r.id)).toEqual(["3", "2", "1"]);
	});

	it("does not mutate the input", () => {
		const copy = [...all];
		sortRows(all, "amount");
		expect(all).toEqual(copy);
	});
});

describe("vendor grouping", () => {
	it("groups spellings of the same vendor under the most common one", () => {
		const rows = [
			row("1", { vendor: "Acme Freight" }),
			row("2", { vendor: "ACME FREIGHT INC" }),
			row("3", { vendor: "Acme Freight" }),
			row("4", { vendor: "Blue Dock Co." }),
		];
		expect(vendorKey("ACME FREIGHT INC")).toBe(vendorKey("Acme Freight"));
		expect(vendorOptions(rows)).toEqual([
			{ key: vendorKey("Acme Freight"), label: "Acme Freight", count: 3 },
			{ key: vendorKey("Blue Dock Co."), label: "Blue Dock Co.", count: 1 },
		]);
	});
});

describe("vendorGroups", () => {
	it("joins a short name to the one longer name it starts", () => {
		const groups = vendorGroups([
			"Valley Fresh",
			"Valley Fresh Produce",
			"VALLEY FRESH PRODUCE",
		]);
		expect(groups.get("valley fresh")).toBe("valley fresh produce");
		const rows = [
			row("1", { vendor: "Valley Fresh" }),
			row("2", { vendor: "Valley Fresh Produce" }),
			row("3", { vendor: "VALLEY FRESH PRODUCE" }),
		];
		const options = vendorOptions(rows);
		expect(options).toEqual([
			{ key: "valley fresh produce", label: "Valley Fresh Produce", count: 3 },
		]);
		expect(
			filterRows(rows, { vendor: "valley fresh produce" }).rows,
		).toHaveLength(3);
	});

	it("leaves an ambiguous short name on its own", () => {
		const groups = vendorGroups(["Blue", "Blue Dock", "Blue Line"]);
		expect(groups.get("blue")).toBe("blue");
		expect(groups.get("blue dock")).toBe("blue dock");
	});

	it("follows chains to the longest name", () => {
		const groups = vendorGroups(["A1", "A1 Haul", "A1 Haul Express"]);
		expect(groups.get("a1")).toBe("a1 haul express");
	});
});

describe("filterRows", () => {
	const rows = [
		...all,
		row("other-flag", { vendor: "Blue Dock", run: { totalMinor: 700 } }),
	];

	it("counts statuses before the status filter and sums what is shown", () => {
		const out = filterRows(rows, { status: "flagged" });
		expect(out.rows.map((r) => r.id)).toEqual([
			"f-big",
			"f-small",
			"other-flag",
		]);
		expect(out.counts.flagged).toBe(3);
		expect(out.counts.clean).toBe(1);
		expect(out.total).toBe(rows.length);
		expect(out.shownMinor).toBe(10_700);
	});

	it("filters by vendor key and free text", () => {
		const byVendor = filterRows(rows, { vendor: vendorKey("BLUE DOCK") });
		expect(byVendor.rows.map((r) => r.id)).toEqual(["other-flag"]);
		expect(byVendor.counts.flagged).toBe(1);
		expect(byVendor.total).toBe(1);

		const byText = filterRows(rows, { q: "  F-B " });
		expect(byText.rows.map((r) => r.id)).toEqual(["f-big"]);
	});

	it("an empty filter keeps every row in priority order", () => {
		expect(filterRows(rows, {}).rows[0]?.id).toBe("f-big");
	});
});

describe("defaultSelection", () => {
	it("opens the largest flagged bill, or null when empty", () => {
		expect(defaultSelection(all)).toBe("f-big");
		expect(defaultSelection([])).toBeNull();
	});
});
