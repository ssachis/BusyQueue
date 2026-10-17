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
import { buildReview } from "./review.ts";

const invoiceFiles = import.meta.glob("../../../data/invoices/*.json", {
	eager: true,
	import: "default",
});

const invoices = Object.entries(invoiceFiles)
	.sort(([a], [b]) => a.localeCompare(b))
	.map(([, json]) => parseInvoice(json));

export const review = buildReview(
	invoices,
	parsePriceList(priceCsv),
	parsePayments(paymentsCsv),
);
