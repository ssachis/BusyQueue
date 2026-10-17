import { describe, expect, it } from "vitest";
import {
	buildExtraction,
	correctedPaths,
	draftToInvoice,
	type ImportDraft,
	normalizeDate,
	normalizeDecimal,
	parseExtractionReply,
	pathsWithoutLine,
	RawExtraction,
	sniffContentType,
	validateDraft,
} from "./extraction.ts";

/** What a good model reply for data/scans/inv-1004.png looks like. */
const reply = {
	documentType: "invoice",
	vendor: "VALLEY FRESH PRODUCE",
	invoiceNumber: "VF-1004",
	issueDate: "2026-08-10",
	dueDate: "2026-09-09",
	currency: "USD",
	statedTotal: "$741.75",
	lines: [
		{
			item: "Broccoli",
			quantity: "10",
			unit: "CS",
			unitPrice: "$22.30",
			amount: "$223.00",
		},
		{
			item: "Bananas",
			quantity: "250",
			unit: "lbs",
			unitPrice: "$0.62",
			amount: "$155.00",
		},
		{
			item: "Apples",
			quantity: "15",
			unit: "Case",
			unitPrice: "$24.25",
			amount: "$363.75",
			uncertain: ["unitPrice"],
		},
	],
	uncertain: [],
	notes: null,
};

const extract = (overrides: Record<string, unknown> = {}) =>
	buildExtraction(RawExtraction.parse({ ...reply, ...overrides }));

describe("normalizeDecimal", () => {
	it.each([
		["$741.75", "741.75"],
		["1,556.90", "1556.90"],
		["$1,982.00", "1982.00"],
		["USD 1,234.50", "1234.50"],
		["1,234.50 USD", "1234.50"],
		["1.234,56", "1234.56"],
		["12,5", "12.5"],
		["(12.50)", "-12.50"],
		["12.50-", "-12.50"],
		["-0.00", "0.00"],
		[".5", "0.5"],
		["  20 ", "20"],
		["0.66", "0.66"],
	])("%s → %s", (printed, expected) => {
		expect(normalizeDecimal(printed)).toBe(expected);
	});

	it.each(["", "abc", "12abc", "l2.00", "1,23,4", "1.2.3", "$"])(
		"rejects %j",
		(printed) => {
			expect(normalizeDecimal(printed)).toBeNull();
		},
	);

	it("never changes digits (no rounding)", () => {
		expect(normalizeDecimal("$0.6666")).toBe("0.6666");
		expect(normalizeDecimal("100.10")).toBe("100.10");
	});
});

describe("normalizeDate", () => {
	it("keeps valid ISO dates", () => {
		expect(normalizeDate("2026-08-07")).toEqual({
			value: "2026-08-07",
			doubtful: false,
		});
	});
	it("flags impossible ISO dates", () => {
		expect(normalizeDate("2026-02-30").doubtful).toBe(true);
	});
	it("reads US dates and flags only ambiguous ones", () => {
		expect(normalizeDate("08/07/2026")).toEqual({
			value: "2026-08-07",
			doubtful: true,
		});
		expect(normalizeDate("8/27/2026")).toEqual({
			value: "2026-08-27",
			doubtful: false,
		});
	});
	it("keeps unreadable text and flags it", () => {
		expect(normalizeDate("Aug 7th")).toEqual({
			value: "Aug 7th",
			doubtful: true,
		});
	});
});

describe("sniffContentType", () => {
	const bytes = (...b: number[]) => new Uint8Array([...b, 0, 0, 0, 0, 0, 0]);
	it("detects allowed types by magic bytes", () => {
		expect(
			sniffContentType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)),
		).toBe("image/png");
		expect(sniffContentType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
		expect(
			sniffContentType(
				new TextEncoder().encode("RIFF\u0000\u0000\u0000\u0000WEBPVP8 "),
			),
		).toBe("image/webp");
		expect(sniffContentType(new TextEncoder().encode("%PDF-1.7\n"))).toBe(
			"application/pdf",
		);
	});
	it("rejects anything else, whatever its name", () => {
		expect(sniffContentType(new TextEncoder().encode("GIF89a"))).toBeNull();
		expect(sniffContentType(new TextEncoder().encode("<html>"))).toBeNull();
		expect(sniffContentType(new Uint8Array())).toBeNull();
	});
});

describe("buildExtraction", () => {
	it("keeps printed values and strips only formatting", () => {
		const { draft, issues } = extract();
		expect(issues).toEqual({});
		expect(draft.vendor).toBe("VALLEY FRESH PRODUCE");
		expect(draft.statedTotal).toBe("741.75");
		expect(draft.lines.map((l) => [l.unit, l.unitPrice, l.amount])).toEqual([
			["CS", "22.30", "223.00"],
			["lbs", "0.62", "155.00"],
			["Case", "24.25", "363.75"],
		]);
	});

	it("does not correct amounts that don't add up (the agent checks those)", () => {
		const { draft, uncertain, issues } = extract({
			statedTotal: "999.99",
			lines: [{ ...reply.lines[0], amount: "1.00" }],
		});
		expect(draft.statedTotal).toBe("999.99");
		expect(draft.lines[0].amount).toBe("1.00");
		expect(uncertain).toEqual([]);
		expect(issues).toEqual({});
	});

	it("flags fields the model was unsure of, per line and at the top", () => {
		const { uncertain } = extract({
			uncertain: ["dueDate", "lines[0].quantity", "nonsense", "lines.9.unit"],
		});
		expect(uncertain.sort()).toEqual(
			["dueDate", "lines.0.quantity", "lines.2.unitPrice"].sort(),
		);
	});

	it("flags missing and unreadable fields and reports why", () => {
		const { draft, uncertain, issues } = extract({
			invoiceNumber: null,
			issueDate: "sometime in August",
			lines: [{ ...reply.lines[0], unitPrice: "22.3O" }],
		});
		expect(draft.lines[0].unitPrice).toBe("22.3O");
		expect(uncertain).toEqual(
			expect.arrayContaining([
				"invoiceNumber",
				"issueDate",
				"lines.0.unitPrice",
			]),
		);
		expect(issues).toMatchObject({
			invoiceNumber: "Invoice number is required",
			issueDate: "Use a date like 2026-08-07",
			"lines.0.unitPrice": "Use a plain number like 24.00",
		});
	});

	it("flags values the model sent as JSON numbers", () => {
		const { draft, uncertain } = extract({ statedTotal: 741.75 });
		expect(draft.statedTotal).toBe("741.75");
		expect(uncertain).toContain("statedTotal");
	});

	it("treats a missing due date as normal, and a missing currency as a guess", () => {
		const { draft, uncertain, issues } = extract({
			dueDate: null,
			currency: null,
		});
		expect(draft.dueDate).toBe("");
		expect(draft.currency).toBe("USD");
		expect(uncertain).toEqual(["currency", "lines.2.unitPrice"]);
		expect(issues).toEqual({});
	});

	it("maps a printed currency symbol to a code, flagged", () => {
		const { draft, uncertain } = extract({ currency: "€" });
		expect(draft.currency).toBe("EUR");
		expect(uncertain).toContain("currency");
	});

	it("requires at least one line", () => {
		const { issues } = extract({ lines: [] });
		expect(issues.lines).toBe("Add at least one line");
	});
});

describe("draftToInvoice / validateDraft", () => {
	const draft: ImportDraft = extract().draft;

	it("produces a shared Invoice with line numbers in order", () => {
		const result = draftToInvoice(draft, "imp-1");
		expect(result.success).toBe(true);
		expect(result.data).toMatchObject({
			id: "imp-1",
			vendor: "VALLEY FRESH PRODUCE",
			invoiceNumber: "VF-1004",
			dueDate: "2026-09-09",
			statedTotal: "741.75",
		});
		expect(result.data?.lines.map((l) => l.lineNo)).toEqual([1, 2, 3]);
	});

	it("drops an empty due date and upper-cases the currency", () => {
		const result = draftToInvoice(
			{ ...draft, dueDate: " ", currency: "usd" },
			"imp-1",
		);
		expect(result.data?.dueDate).toBeUndefined();
		expect(result.data?.currency).toBe("USD");
	});

	it("rejects a zero quantity and a bad currency", () => {
		const issues = validateDraft({
			...draft,
			currency: "DOLLARS",
			lines: [{ ...draft.lines[0], quantity: "0" }],
		});
		expect(Object.keys(issues).sort()).toEqual(
			["currency", "lines.0.quantity"].sort(),
		);
	});
});

describe("correctedPaths", () => {
	const read = extract().draft;
	it("is empty when nothing changed (whitespace aside)", () => {
		expect(
			correctedPaths(read, { ...read, vendor: ` ${read.vendor} ` }),
		).toEqual([]);
	});
	it("lists changed header and line fields, and added lines", () => {
		const saved: ImportDraft = {
			...read,
			dueDate: "",
			lines: [
				{ ...read.lines[0], unitPrice: "22.00" },
				read.lines[1],
				read.lines[2],
				{ ...read.lines[2], item: "Pears" },
			],
		};
		expect(correctedPaths(read, saved)).toEqual([
			"dueDate",
			"lines",
			"lines.0.unitPrice",
		]);
	});
});

describe("pathsWithoutLine", () => {
	it("drops the removed line's flags and shifts later lines up", () => {
		expect(
			pathsWithoutLine(
				["vendor", "lines.0.unit", "lines.1.amount", "lines.2.item"],
				1,
			),
		).toEqual(["vendor", "lines.0.unit", "lines.1.item"]);
	});
});

describe("parseExtractionReply", () => {
	it("accepts JSON wrapped in prose or code fences", () => {
		const parsed = parseExtractionReply(
			`Here you go:\n\`\`\`json\n${JSON.stringify(reply)}\n\`\`\``,
		);
		expect(parsed.ok).toBe(true);
	});

	it("rejects a reply with no JSON", () => {
		const parsed = parseExtractionReply(
			"I don't see a document attached to our conversation.",
		);
		expect(parsed).toEqual({
			ok: false,
			error: "The model did not return a JSON object",
		});
	});

	it("rejects documents that aren't invoices", () => {
		const parsed = parseExtractionReply(
			JSON.stringify({ documentType: "receipt", lines: [] }),
		);
		expect(parsed.ok).toBe(false);
		if (!parsed.ok)
			expect(parsed.error).toMatch(/doesn't look like an invoice/);
	});

	it("rejects the wrong shape", () => {
		const parsed = parseExtractionReply(JSON.stringify({ lines: "three" }));
		expect(parsed.ok).toBe(false);
		if (!parsed.ok) expect(parsed.error).toMatch(/expected shape: lines/);
	});
});
