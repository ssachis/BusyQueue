/**
 * Server-only data for the print page (#19). Import only from server-function
 * handlers (src/server/print.ts), so the client bundle never pulls in D1.
 *
 * Reads the document, the business (draft seller and branding) and, for
 * types that take payments, the derived payment summary; the pure
 * `buildPrintModel` decides frozen vs computed and formats everything.
 */
import { BusinessProfile } from "#/lib/business/profile.ts";
import { takesPayments } from "#/lib/documents/status.ts";
import { sellerSnapshot } from "#/lib/documents/totals.ts";
import { buildPrintModel, type PrintModel } from "#/lib/print/model.ts";
import { loadBusiness } from "#/server/business-store.ts";
import { getPaymentsView } from "#/server/documents/payments-store.ts";
import { getDocument } from "#/server/documents/store.ts";

export async function loadPrintModel(
	documentId: string,
	today?: string,
): Promise<PrintModel | null> {
	const record = await getDocument(documentId);
	if (!record) return null;
	const { document: doc, lines } = record;

	const business = await loadBusiness();
	const profile = BusinessProfile.safeParse(business);

	let payment = null;
	if (takesPayments(doc.type) && doc.status !== "draft") {
		try {
			payment = (await getPaymentsView(doc.id, today)).summary;
		} catch (err) {
			// A broken payment row must not stop the document from printing.
			console.error("[print] payment summary failed:", err);
		}
	}

	return buildPrintModel({
		document: {
			id: doc.id,
			type: doc.type,
			status: doc.status,
			number: doc.number,
			date: doc.date,
			dueDate: doc.dueDate,
			currency: doc.currency,
			buyer: doc.buyer,
			seller: doc.seller,
			placeOfSupply: doc.placeOfSupply,
			notes: doc.notes,
			terms: doc.terms,
			subtotalMinor: doc.subtotalMinor,
			taxMinor: doc.taxMinor,
			totalMinor: doc.totalMinor,
			taxResult: doc.taxResult,
			voidReason: doc.voidReason,
		},
		lines,
		draftSeller: profile.success ? sellerSnapshot(profile.data) : null,
		branding: {
			accentColor: business.accentColor,
			logoUrl: business.logoUrl,
		},
		payment,
	});
}
