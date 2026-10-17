/**
 * Server-only data for the projections page: loads vendor bills (cash out)
 * and issued outgoing invoices (cash in) from D1, maps them to forecast
 * inputs (pure, in `#/lib/projections`) and runs the forecast engine. Every
 * number on the page comes from here; the model only narrates the digest.
 *
 * Kept apart from the server functions in projections.ts so the client
 * bundle never imports the D1 client.
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "#/db/index.ts";
import {
	invoiceLines,
	invoices,
	payments,
	vendors,
} from "#/db/schema/busyq.ts";
import { documentPayments } from "#/db/schema/document-payments.ts";
import { documents } from "#/db/schema/documents.ts";
import {
	buildDigestInput,
	buildForecast,
	type DigestInput,
	type Forecast,
} from "#/lib/forecast/index.ts";
import {
	type AsOfDefault,
	billLinesToObservations,
	billsToCashItems,
	type CurrencyPick,
	defaultAsOf,
	documentsToCashItems,
	type ItemLabel,
	itemLabels,
	pickCurrency,
} from "#/lib/projections/mapping.ts";
import { currentBusinessId, loadBusiness } from "./business-store.ts";

export interface ProjectionsData {
	asOf: string;
	/** What the page would use with no date picked, and why. */
	default: AsOfDefault;
	today: string;
	forecast: Forecast;
	digestInput: DigestInput;
	labels: Record<string, ItemLabel>;
	sources: {
		bills: number;
		issuedInvoices: number;
		priceObservations: number;
		/** Items left out because they are in another currency. */
		excluded: CurrencyPick["excluded"];
	};
}

const todayUtc = () => new Date().toISOString().slice(0, 10);

/** Forecast for the current business, as of `asOf` (default: see `defaultAsOf`). */
export async function loadProjections(asOf?: string): Promise<ProjectionsData> {
	const db = getDb();
	const businessId = currentBusinessId();
	const [business, billRows, paymentRows, lineRows, vendorRows, docRows] =
		await Promise.all([
			loadBusiness(),
			db.select().from(invoices),
			db
				.select({
					invoiceNumber: payments.invoiceNumber,
					paidOn: payments.paidOn,
				})
				.from(payments),
			db
				.select({
					invoiceId: invoiceLines.invoiceId,
					lineNo: invoiceLines.lineNo,
					item: invoiceLines.item,
					unit: invoiceLines.unit,
					unitPrice: invoiceLines.unitPrice,
				})
				.from(invoiceLines),
			db.select({ name: vendors.name }).from(vendors),
			db
				.select()
				.from(documents)
				.where(
					and(
						eq(documents.businessId, businessId),
						eq(documents.type, "invoice"),
						eq(documents.status, "issued"),
					),
				),
		]);
	const docIds = new Set(docRows.map((d) => d.id));
	const docPaymentRows = docIds.size
		? (await db.select().from(documentPayments)).filter((p) =>
				docIds.has(p.documentId),
			)
		: [];

	const canonical = vendorRows.map((v) => v.name).sort();
	const docs = docRows.map((d) => ({
		id: d.id,
		type: d.type,
		status: d.status,
		number: d.number,
		date: d.date,
		dueDate: d.dueDate,
		currency: d.currency,
		totalMinor: d.totalMinor,
		buyerName: d.buyer.name,
	}));
	const allItems = [
		...billsToCashItems(billRows, paymentRows, canonical),
		...documentsToCashItems(docs, docPaymentRows),
	];
	const pick = pickCurrency(allItems, business.currency);
	const items = allItems.filter((i) => i.currency === pick.currency);
	const lines = billLinesToObservations(billRows, lineRows, canonical).filter(
		(l) => l.currency === pick.currency,
	);

	const today = todayUtc();
	const fallback = defaultAsOf(
		today,
		items.map((i) => i.issueDate),
	);
	const effectiveAsOf = asOf ?? fallback.asOf;
	const forecast = buildForecast(items, {
		asOf: effectiveAsOf,
		lines,
		...(pick.currency ? { currency: pick.currency } : {}),
	});

	return {
		asOf: effectiveAsOf,
		default: fallback,
		today,
		forecast,
		digestInput: buildDigestInput(forecast),
		labels: itemLabels(billRows, docs),
		sources: {
			bills: billRows.filter((b) => b.currency === pick.currency).length,
			issuedInvoices: docs.filter((d) => d.currency === pick.currency).length,
			priceObservations: lines.length,
			excluded: pick.excluded,
		},
	};
}
