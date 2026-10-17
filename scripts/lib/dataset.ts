/** Load and validate the generated dataset from disk (Node/Bun scripts only). */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	type Dataset,
	parseAnswerKeyCsv,
	parseInvoiceJson,
	parsePaymentsCsv,
	parsePriceListCsv,
} from "../../src/lib/busyq/dataset.ts";

export const DEFAULT_DATA_DIR = resolve(import.meta.dirname, "../../data");

export function loadDataset(dir = DEFAULT_DATA_DIR): Dataset {
	const read = (name: string) => readFileSync(join(dir, name), "utf8");
	return {
		priceList: parsePriceListCsv(read("price_list.csv")),
		invoices: readdirSync(join(dir, "invoices"))
			.filter((f) => f.endsWith(".json"))
			.sort()
			.map((f) => parseInvoiceJson(read(join("invoices", f)))),
		payments: parsePaymentsCsv(read("payments.csv")),
		answerKey: parseAnswerKeyCsv(read("answer_key.csv")),
	};
}
