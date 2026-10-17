/**
 * Bundles the generated sample data (`data/`) into the page with Vite so the
 * review works before persistence (#4) exists. Replace with a server function
 * reading D1 when that lands.
 */

import {
	parseInvoice,
	parsePayments,
	parsePriceList,
} from "#/lib/busyq/load.ts";
import paymentsCsv from "../../../data/payments.csv?raw";
import priceCsv from "../../../data/price_list.csv?raw";
import { lookupPrices, lookupPricesV2 } from "#/lib/rules/index.ts";
import { buildReview, cashflowByMonth } from "./review.ts";

const invoiceFiles = import.meta.glob("../../../data/invoices/*.json", {
	eager: true,
	import: "default",
});

const invoices = Object.entries(invoiceFiles)
	.sort(([a], [b]) => a.localeCompare(b))
	.map(([, json]) => parseInvoice(json));

const prices = parsePriceList(priceCsv);
const payments = parsePayments(paymentsCsv);

/** The same invoices checked with each lookup, so the page can flip between them. */
export const reviews = {
	v1: buildReview(invoices, prices, payments, "USD", lookupPrices),
	v2: buildReview(invoices, prices, payments, "USD", lookupPricesV2),
};

export const cashflow = cashflowByMonth(invoices, payments);
