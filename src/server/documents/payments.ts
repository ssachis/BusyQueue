/**
 * Payment server functions (#17), callable from the client. Inputs are
 * validated with the shared zod schemas; the D1 work lives in
 * payments-store.ts so the client bundle never imports it.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
	DisplayStatusesInput,
	MarkPaidInput,
	RecordPaymentInput,
	VoidDocumentInput,
	VoidPaymentInput,
} from "#/lib/documents/status.ts";
import {
	getDisplayStatuses,
	getPaymentsView,
	markPaid,
	recordPayment,
	voidDocument,
	voidPayment,
} from "./payments-store.ts";

/** Parse, or throw one readable message (the panel shows it in a toast). */
function parseWith<S extends z.ZodType>(schema: S) {
	return (input: z.input<S>): z.output<S> => {
		const parsed = schema.safeParse(input);
		if (parsed.success) return parsed.data;
		throw new Error(
			parsed.error.issues
				.map((i) => (i.path.length ? `${i.path.join(".")}: ` : "") + i.message)
				.join("; "),
		);
	};
}

const PaymentsViewInput = z.object({
	documentId: z.string().min(1),
	/** The viewer's local date, for "overdue". Defaults to the server's UTC date. */
	today: z.iso.date().optional(),
});

/** Document money summary plus every payment (voided ones included). */
export const getDocumentPayments = createServerFn({ method: "GET" })
	.validator(parseWith(PaymentsViewInput))
	.handler(({ data }) => getPaymentsView(data.documentId, data.today));

/**
 * Display status, paid and balance for many documents at once, keyed by id.
 * For the documents list (Paid / Overdue badges).
 */
export const getDocumentDisplayStatuses = createServerFn({ method: "POST" })
	.validator(parseWith(DisplayStatusesInput))
	.handler(({ data }) => getDisplayStatuses(data.ids, data.today));

export const recordDocumentPayment = createServerFn({ method: "POST" })
	.validator(parseWith(RecordPaymentInput))
	.handler(({ data }) => recordPayment(data));

/** Record a payment for exactly the remaining balance. */
export const markDocumentPaid = createServerFn({ method: "POST" })
	.validator(parseWith(MarkPaidInput))
	.handler(({ data }) => markPaid(data));

export const voidDocumentPayment = createServerFn({ method: "POST" })
	.validator(parseWith(VoidPaymentInput))
	.handler(async ({ data }) => {
		await voidPayment(data);
		return { ok: true as const };
	});

export const voidIssuedDocument = createServerFn({ method: "POST" })
	.validator(parseWith(VoidDocumentInput))
	.handler(async ({ data }) => {
		await voidDocument(data);
		return { ok: true as const };
	});
