import { describe, expect, it } from "vitest";
import {
	assessPayment,
	DisplayStatusesInput,
	isFutureDate,
	MarkPaidInput,
	PAYABLE_TYPES,
	PaymentError,
	paidMinor,
	paymentSummary,
	RecordPaymentInput,
	type StatusInput,
	takesPayments,
	VoidDocumentInput,
	VoidPaymentInput,
} from "./status.ts";
import { DOCUMENT_TYPES } from "./types.ts";

const usd = (amountMinor: number, voidedAt: string | null = null) => ({
	amountMinor,
	currency: "USD",
	voidedAt,
});

const base: StatusInput = {
	type: "invoice",
	status: "issued",
	totalMinor: 100_00,
	currency: "USD",
	dueDate: "2026-10-31",
	payments: [],
	today: "2026-10-17",
};
const summary = (over: Partial<StatusInput>) =>
	paymentSummary({ ...base, ...over });

function codeOf(fn: () => unknown): string | undefined {
	try {
		fn();
	} catch (err) {
		if (err instanceof PaymentError) return err.code;
		throw err;
	}
	return undefined;
}

describe("takesPayments", () => {
	it("is invoices and proformas only", () => {
		expect(PAYABLE_TYPES).toEqual(["invoice", "proforma"]);
		expect(DOCUMENT_TYPES.filter(takesPayments)).toEqual([
			"invoice",
			"proforma",
		]);
	});
});

describe("paidMinor", () => {
	it("sums active payments and skips voided ones", () => {
		expect(paidMinor([usd(10_00), usd(5_50), usd(99_99, "x")], "USD")).toBe(
			15_50,
		);
	});
	it("is 0 with no payments", () => {
		expect(paidMinor([], "USD")).toBe(0);
	});
	it("rejects a payment in another currency", () => {
		expect(
			codeOf(() => paidMinor([{ amountMinor: 1, currency: "EUR" }], "USD")),
		).toBe("currency_mismatch");
	});
	it("ignores currency on voided payments", () => {
		expect(
			paidMinor([{ amountMinor: 1, currency: "EUR", voidedAt: "t" }], "USD"),
		).toBe(0);
	});
	it("rejects non-integer minor units", () => {
		expect(codeOf(() => paidMinor([usd(1.5)], "USD"))).toBe("invalid_amount");
	});
});

describe("paymentSummary", () => {
	it("draft is draft with nothing owed", () => {
		expect(summary({ status: "draft", totalMinor: null })).toEqual({
			displayStatus: "draft",
			paidMinor: 0,
			balanceMinor: 0,
			overdue: false,
		});
	});

	it("issued with no payments owes the total", () => {
		expect(summary({})).toEqual({
			displayStatus: "issued",
			paidMinor: 0,
			balanceMinor: 100_00,
			overdue: false,
		});
	});

	it("partial payment is partially_paid", () => {
		expect(summary({ payments: [usd(40_00)] })).toEqual({
			displayStatus: "partially_paid",
			paidMinor: 40_00,
			balanceMinor: 60_00,
			overdue: false,
		});
	});

	it("exact balance is paid", () => {
		expect(summary({ payments: [usd(40_00), usd(60_00)] })).toEqual({
			displayStatus: "paid",
			paidMinor: 100_00,
			balanceMinor: 0,
			overdue: false,
		});
	});

	it("one minor unit short is still partially paid", () => {
		const s = summary({ payments: [usd(99_99)] });
		expect(s.displayStatus).toBe("partially_paid");
		expect(s.balanceMinor).toBe(1);
	});

	it("overpaid reports a negative balance and paid", () => {
		const s = summary({ payments: [usd(120_00)] });
		expect(s.displayStatus).toBe("paid");
		expect(s.balanceMinor).toBe(-20_00);
	});

	it("voided payments don't count", () => {
		const s = summary({ payments: [usd(100_00, "2026-10-10T00:00:00Z")] });
		expect(s.displayStatus).toBe("issued");
		expect(s.balanceMinor).toBe(100_00);
	});

	it("voiding the only completing payment goes back to partially_paid", () => {
		const s = summary({
			payments: [usd(40_00), usd(60_00, "2026-10-12T00:00:00Z")],
		});
		expect(s.displayStatus).toBe("partially_paid");
		expect(s.balanceMinor).toBe(60_00);
	});

	it("zero-total issued invoice is paid immediately and never overdue", () => {
		expect(
			summary({ totalMinor: 0, dueDate: "2026-01-01", today: "2026-10-17" }),
		).toEqual({
			displayStatus: "paid",
			paidMinor: 0,
			balanceMinor: 0,
			overdue: false,
		});
	});

	describe("overdue", () => {
		it("issued past due is overdue", () => {
			const s = summary({ today: "2026-11-01" });
			expect(s.displayStatus).toBe("overdue");
			expect(s.overdue).toBe(true);
			expect(s.balanceMinor).toBe(100_00);
		});
		it("partially paid past due is overdue", () => {
			const s = summary({ today: "2026-11-01", payments: [usd(10_00)] });
			expect(s.displayStatus).toBe("overdue");
			expect(s.overdue).toBe(true);
			expect(s.paidMinor).toBe(10_00);
		});
		it("due today is not overdue yet", () => {
			expect(summary({ today: "2026-10-31" }).overdue).toBe(false);
		});
		it("paid past due is paid, not overdue", () => {
			const s = summary({ today: "2027-01-01", payments: [usd(100_00)] });
			expect(s.displayStatus).toBe("paid");
			expect(s.overdue).toBe(false);
		});
		it("no due date is never overdue", () => {
			expect(summary({ dueDate: null, today: "2099-01-01" }).overdue).toBe(
				false,
			);
		});
	});

	describe("void wins", () => {
		it("void past due is void, not overdue, with nothing owed", () => {
			expect(summary({ status: "void", today: "2027-01-01" })).toEqual({
				displayStatus: "void",
				paidMinor: 0,
				balanceMinor: 0,
				overdue: false,
			});
		});
		it("void keeps reporting active payments", () => {
			expect(summary({ status: "void", payments: [usd(5_00)] }).paidMinor).toBe(
				5_00,
			);
		});
	});

	describe("non-payable types", () => {
		for (const type of [
			"quote",
			"receipt",
			"delivery_note",
			"credit_note",
		] as const) {
			it(`${type} shows issued with nothing owed, even past due`, () => {
				expect(summary({ type, today: "2027-01-01" })).toEqual({
					displayStatus: "issued",
					paidMinor: 0,
					balanceMinor: 0,
					overdue: false,
				});
			});
		}
		it("proforma takes payments like an invoice", () => {
			expect(
				summary({ type: "proforma", payments: [usd(1)] }).displayStatus,
			).toBe("partially_paid");
		});
	});

	it("rejects a payment in another currency", () => {
		expect(
			codeOf(() =>
				summary({ payments: [{ amountMinor: 1_00, currency: "EUR" }] }),
			),
		).toBe("currency_mismatch");
	});

	it("works in zero- and three-decimal currencies", () => {
		const jpy = summary({
			currency: "JPY",
			totalMinor: 5000,
			payments: [{ amountMinor: 5000, currency: "JPY" }],
		});
		expect(jpy.displayStatus).toBe("paid");
		const kwd = summary({
			currency: "KWD",
			totalMinor: 1_500,
			payments: [{ amountMinor: 1_499, currency: "KWD" }],
		});
		expect(kwd.balanceMinor).toBe(1);
	});

	it("rejects bad dates and a missing total", () => {
		expect(codeOf(() => summary({ today: "17/10/2026" }))).toBe(
			"invalid_input",
		);
		expect(codeOf(() => summary({ dueDate: "soon" }))).toBe("invalid_input");
		expect(codeOf(() => summary({ totalMinor: null }))).toBe("invalid_input");
		expect(codeOf(() => summary({ totalMinor: 1.5 }))).toBe("invalid_amount");
	});
});

describe("assessPayment", () => {
	const target = {
		type: "invoice" as const,
		status: "issued" as const,
		currency: "USD",
		balanceMinor: 60_00,
	};

	it("converts a decimal string to minor units", () => {
		expect(assessPayment(target, "12.50", "USD")).toEqual({
			minor: 12_50,
			currency: "USD",
		});
		expect(assessPayment(target, " 7 ", "USD").minor).toBe(7_00);
	});

	it("accepts exactly the balance", () => {
		expect(assessPayment(target, "60.00", "USD").minor).toBe(60_00);
		expect(assessPayment(target, "60", "USD").minor).toBe(60_00);
	});

	it("rejects overpayment by one minor unit", () => {
		expect(codeOf(() => assessPayment(target, "60.01", "USD"))).toBe(
			"overpayment",
		);
	});

	it("rejects zero, negative and malformed amounts", () => {
		for (const amount of ["0", "0.00", "-5", "abc", "1e3", "1,000", "", "."]) {
			expect(codeOf(() => assessPayment(target, amount, "USD"))).toBe(
				"invalid_amount",
			);
		}
	});

	it("rejects more decimal places than the currency has, without rounding", () => {
		expect(codeOf(() => assessPayment(target, "10.001", "USD"))).toBe(
			"invalid_amount",
		);
		expect(codeOf(() => assessPayment(target, "10.009", "USD"))).toBe(
			"invalid_amount",
		);
		expect(assessPayment(target, "10.500", "USD").minor).toBe(10_50);
		expect(
			codeOf(() => assessPayment({ ...target, currency: "JPY" }, "1.5", "JPY")),
		).toBe("invalid_amount");
	});

	it("rejects an absurdly large amount", () => {
		expect(
			codeOf(() => assessPayment(target, "99999999999999999999", "USD")),
		).toBe("invalid_amount");
	});

	it("rejects the wrong currency", () => {
		expect(codeOf(() => assessPayment(target, "1.00", "EUR"))).toBe(
			"currency_mismatch",
		);
	});

	it("rejects drafts and void documents", () => {
		expect(
			codeOf(() =>
				assessPayment({ ...target, status: "draft" }, "1.00", "USD"),
			),
		).toBe("not_issued");
		expect(
			codeOf(() => assessPayment({ ...target, status: "void" }, "1.00", "USD")),
		).toBe("not_issued");
	});

	it("rejects types that don't take payments", () => {
		expect(
			codeOf(() => assessPayment({ ...target, type: "quote" }, "1.00", "USD")),
		).toBe("not_payable");
		expect(
			codeOf(() =>
				assessPayment({ ...target, type: "credit_note" }, "1.00", "USD"),
			),
		).toBe("not_payable");
	});

	it("rejects any payment once nothing is owed", () => {
		expect(
			codeOf(() => assessPayment({ ...target, balanceMinor: 0 }, "1", "USD")),
		).toBe("nothing_owed");
	});
});

describe("input schemas", () => {
	const record = {
		documentId: "doc_1",
		amount: "125.50",
		currency: "USD",
		receivedOn: "2026-10-17",
	};

	it("accepts a valid payment and drops empty optional text", () => {
		expect(
			RecordPaymentInput.parse({
				...record,
				method: "check",
				reference: "  ",
				note: " Thanks ",
			}),
		).toEqual({
			...record,
			method: "check",
			reference: undefined,
			note: "Thanks",
		});
	});

	it("rejects negative, signed or float amounts", () => {
		for (const amount of ["-1", "+1", "1e2", 12.5]) {
			expect(RecordPaymentInput.safeParse({ ...record, amount }).success).toBe(
				false,
			);
		}
	});

	it("rejects bad currency, date and method", () => {
		expect(
			RecordPaymentInput.safeParse({ ...record, currency: "usd" }).success,
		).toBe(false);
		expect(
			RecordPaymentInput.safeParse({ ...record, receivedOn: "2026-13-01" })
				.success,
		).toBe(false);
		expect(
			RecordPaymentInput.safeParse({ ...record, method: "bitcoin" }).success,
		).toBe(false);
	});

	it("mark paid needs no amount", () => {
		expect(
			MarkPaidInput.parse({ documentId: "d", receivedOn: "2026-10-17" }),
		).toMatchObject({ documentId: "d" });
	});

	it("void document needs a reason", () => {
		expect(
			VoidDocumentInput.safeParse({ documentId: "d", reason: "   " }).success,
		).toBe(false);
		expect(
			VoidDocumentInput.parse({ documentId: "d", reason: " Duplicate " })
				.reason,
		).toBe("Duplicate");
	});

	it("void payment needs ids", () => {
		expect(
			VoidPaymentInput.safeParse({ documentId: "d", paymentId: "" }).success,
		).toBe(false);
	});

	it("display statuses caps the id list", () => {
		expect(
			DisplayStatusesInput.safeParse({
				ids: Array.from({ length: 501 }, (_, i) => `d${i}`),
			}).success,
		).toBe(false);
	});
});

describe("isFutureDate", () => {
	const now = new Date("2026-10-17T12:00:00Z");
	it("allows today and tomorrow (time zones ahead of UTC)", () => {
		expect(isFutureDate("2026-10-17", now)).toBe(false);
		expect(isFutureDate("2026-10-18", now)).toBe(false);
		expect(isFutureDate("2026-01-01", now)).toBe(false);
	});
	it("rejects later dates", () => {
		expect(isFutureDate("2026-10-19", now)).toBe(true);
	});
});
