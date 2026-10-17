import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	parseInvoice,
	parsePayments,
	parsePriceList,
} from "#/lib/busyq/load.ts";
import { buildForecast } from "#/lib/forecast/index.ts";
import {
	type BillRow,
	billLinesToObservations,
	billsToCashItems,
	type DocumentRow,
	defaultAsOf,
	documentsToCashItems,
	invoiceIdFromRef,
	itemLabels,
	pickCurrency,
	receivedPartId,
} from "./mapping.ts";

const VENDORS = ["Dairy Pure", "Harbor Foods", "Valley Fresh Produce"];

const bill = (over: Partial<BillRow> = {}): BillRow => ({
	id: "inv-1",
	vendorName: "HARBOR FOODS INC",
	invoiceNumber: "HF-100",
	issueDate: "2026-09-01",
	dueDate: "2026-10-01",
	currency: "USD",
	statedTotal: "1234.50",
	...over,
});

const doc = (over: Partial<DocumentRow> = {}): DocumentRow => ({
	id: "doc-1",
	type: "invoice",
	status: "issued",
	number: "INV-0001",
	date: "2026-09-10",
	dueDate: "2026-10-10",
	currency: "USD",
	totalMinor: 100_000,
	buyerName: " Riverside Catering ",
	...over,
});

describe("billsToCashItems", () => {
	it("maps a bill to a cash-out item with the canonical vendor and stated total", () => {
		const [item] = billsToCashItems([bill()], [], VENDORS);
		expect(item).toEqual({
			id: "inv-1",
			direction: "out",
			counterparty: "Harbor Foods",
			currency: "USD",
			amount: "1234.50",
			issueDate: "2026-09-01",
			dueDate: "2026-10-01",
			paidOn: null,
		});
	});

	it("is paid on the first payment with the same invoice number", () => {
		const [item] = billsToCashItems(
			[bill()],
			[
				{ invoiceNumber: "HF-100", paidOn: "2026-09-28" },
				{ invoiceNumber: "HF-100", paidOn: "2026-09-20" }, // duplicate payment, earlier
				{ invoiceNumber: "HF-999", paidOn: "2026-09-01" },
				{ invoiceNumber: null, paidOn: "2026-09-02" },
			],
			VENDORS,
		);
		expect(item?.paidOn).toBe("2026-09-20");
	});

	it("keeps an unknown vendor as printed and a missing due date as null", () => {
		const [item] = billsToCashItems(
			[bill({ vendorName: " Acme Supply ", dueDate: null })],
			[],
			VENDORS,
		);
		expect(item?.counterparty).toBe("Acme Supply");
		expect(item?.dueDate).toBeNull();
	});
});

describe("billLinesToObservations", () => {
	it("dates each line by its bill and refs it as <invoiceId>#<lineNo>", () => {
		const obs = billLinesToObservations(
			[bill()],
			[
				{
					invoiceId: "inv-1",
					lineNo: 2,
					item: "Penne",
					unit: "case",
					unitPrice: "21.75",
				},
				{
					invoiceId: "missing",
					lineNo: 1,
					item: "X",
					unit: "lb",
					unitPrice: "1",
				},
			],
			VENDORS,
		);
		expect(obs).toEqual([
			{
				vendor: "Harbor Foods",
				item: "Penne",
				unit: "case",
				unitPrice: "21.75",
				date: "2026-09-01",
				currency: "USD",
				ref: "inv-1#2",
			},
		]);
		expect(invoiceIdFromRef("inv-1#2")).toBe("inv-1");
		expect(invoiceIdFromRef(null)).toBeNull();
	});
});

describe("documentsToCashItems", () => {
	it("maps an issued invoice to cash in, converting minor units exactly", () => {
		const [item] = documentsToCashItems([doc({ totalMinor: 123_456 })], []);
		expect(item).toMatchObject({
			id: "doc-1",
			direction: "in",
			counterparty: "Riverside Catering",
			amount: "1234.56",
			issueDate: "2026-09-10",
			dueDate: "2026-10-10",
			paidOn: null,
		});
	});

	it("skips drafts, voided documents, other types and missing totals", () => {
		const items = documentsToCashItems(
			[
				doc({ id: "a", status: "draft", number: null }),
				doc({ id: "b", status: "void" }),
				doc({ id: "c", type: "quote" }),
				doc({ id: "d", totalMinor: null }),
			],
			[],
		);
		expect(items).toEqual([]);
	});

	it("is paid on the day non-voided payments reach the total", () => {
		const [item, ...rest] = documentsToCashItems(
			[doc()],
			[
				{
					documentId: "doc-1",
					amountMinor: 40_000,
					receivedOn: "2026-10-01",
					voidedAt: null,
				},
				{
					documentId: "doc-1",
					amountMinor: 60_000,
					receivedOn: "2026-10-12",
					voidedAt: "2026-10-13T00:00:00Z",
				},
				{
					documentId: "doc-1",
					amountMinor: 60_000,
					receivedOn: "2026-10-15",
					voidedAt: null,
				},
			],
		);
		expect(rest).toEqual([]);
		expect(item).toMatchObject({ amount: "1000", paidOn: "2026-10-15" });
	});

	it("splits a partly paid invoice into the received part and the open balance", () => {
		const items = documentsToCashItems(
			[doc()],
			[
				{
					documentId: "doc-1",
					amountMinor: 25_050,
					receivedOn: "2026-10-05",
					voidedAt: null,
				},
			],
		);
		expect(items).toEqual([
			expect.objectContaining({
				id: receivedPartId("doc-1"),
				amount: "250.5",
				paidOn: "2026-10-05",
			}),
			expect.objectContaining({ id: "doc-1", amount: "749.5", paidOn: null }),
		]);
	});

	it("labels documents by number and bills by invoice number with a review link", () => {
		const labels = itemLabels([bill()], [doc()]);
		expect(labels["inv-1"]).toEqual({
			label: "HF-100",
			reviewInvoiceId: "inv-1",
		});
		expect(labels["doc-1"]).toEqual({
			label: "INV-0001",
			reviewInvoiceId: null,
		});
		expect(labels[receivedPartId("doc-1")]?.label).toBe(
			"INV-0001 (received part)",
		);
	});
});

describe("pickCurrency", () => {
	const items = [
		{ currency: "USD" },
		{ currency: "EUR" },
		{ currency: "EUR" },
		{ currency: "GBP" },
	];
	it("prefers the business currency when it has items", () => {
		expect(pickCurrency(items, "USD")).toEqual({
			currency: "USD",
			excluded: [
				{ currency: "EUR", count: 2 },
				{ currency: "GBP", count: 1 },
			],
		});
	});
	it("falls back to the most common currency", () => {
		expect(pickCurrency(items, "INR").currency).toBe("EUR");
		expect(pickCurrency([], "USD")).toEqual({ currency: "USD", excluded: [] });
	});
});

describe("defaultAsOf", () => {
	it("is today when every document is older", () => {
		expect(defaultAsOf("2026-10-17", ["2026-09-01", "2026-10-16"])).toEqual({
			asOf: "2026-10-17",
			reason: "today",
			latestIssueDate: "2026-10-16",
		});
	});
	it("is the day after the latest document when data runs past today", () => {
		expect(defaultAsOf("2026-10-17", ["2026-10-20", "2026-09-01"])).toEqual({
			asOf: "2026-10-21",
			reason: "after_latest",
			latestIssueDate: "2026-10-20",
		});
		expect(defaultAsOf("2026-12-31", ["2026-12-31"]).asOf).toBe("2027-01-01");
	});
});

describe("on the generated data set", () => {
	const dir = new URL("../../../data/", import.meta.url);
	const read = (p: string) => readFileSync(new URL(p, dir), "utf8");
	const invoices = readdirSync(new URL("invoices/", dir))
		.sort()
		.map((f) => parseInvoice(JSON.parse(read(`invoices/${f}`))));
	const vendors = [
		...new Set(parsePriceList(read("price_list.csv")).map((p) => p.vendor)),
	];
	const bills: BillRow[] = invoices.map((i) => ({
		id: i.id,
		vendorName: i.vendor,
		invoiceNumber: i.invoiceNumber,
		issueDate: i.issueDate,
		dueDate: i.dueDate ?? null,
		currency: i.currency,
		statedTotal: i.statedTotal,
	}));
	const items = billsToCashItems(
		bills,
		parsePayments(read("payments.csv")),
		vendors,
	);
	const lines = billLinesToObservations(
		bills,
		invoices.flatMap((i) => i.lines.map((l) => ({ ...l, invoiceId: i.id }))),
		vendors,
	);
	const { asOf } = defaultAsOf(
		"2026-10-17",
		items.map((i) => i.issueDate),
	);
	const forecast = buildForecast(items, { asOf, lines });

	it("resolves every printed vendor variant to a canonical vendor", () => {
		expect(new Set(items.map((i) => i.counterparty))).toEqual(new Set(vendors));
	});

	it("matches the forecast report: 14 open bills, 7 price rises, no trend yet", () => {
		expect(asOf).toBe("2026-10-21");
		expect(forecast.calendar.items).toHaveLength(14);
		expect(forecast.priceRises).toHaveLength(7);
		expect(forecast.trend.status).toBe("not_enough_data");
		expect(forecast.trend.completeMonths).toEqual(["2026-08", "2026-09"]);
		expect(forecast.calendar.horizons[0]?.out.expectedMinor).toBe(2_834_740);
	});
});
