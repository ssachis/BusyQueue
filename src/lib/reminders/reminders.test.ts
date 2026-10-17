import { describe, expect, it } from "vitest";
import {
	type ComputedReminder,
	type ContractInput,
	computeReminders,
	contractReminders,
	inDays,
	isEmptyPlan,
	type OutgoingInvoiceInput,
	outgoingInvoiceReminders,
	planSweep,
	ReminderKey,
	reminderKey,
	reminderState,
	resolutionReason,
	type StoredReminder,
	snoozeUntil,
	type VendorBillInput,
	vendorBillReminders,
} from "./index.ts";

// ── Fixtures ──────────────────────────────────────────────────────────

const contract = (over: Partial<ContractInput> = {}): ContractInput => ({
	id: "c-1",
	title: "Bid No. NUSD-NS-2026-03",
	vendorName: "Harbor Foods, Inc.",
	endDate: "2027-06-30",
	noticeDays: 60,
	autoRenew: true,
	status: "confirmed",
	createdAt: "2026-07-01T10:00:00.000Z",
	...over,
});

const bill = (over: Partial<VendorBillInput> = {}): VendorBillInput => ({
	id: "inv-1024",
	invoiceNumber: "HF-1024",
	vendorName: "Harbor Foods",
	issueDate: "2026-09-19",
	dueDate: "2026-10-19",
	currency: "USD",
	statedTotal: "1410.70",
	payments: [],
	...over,
});

const invoice = (
	over: Partial<OutgoingInvoiceInput> = {},
): OutgoingInvoiceInput => ({
	id: "doc-1",
	type: "invoice",
	status: "issued",
	number: "INV-0001",
	buyerName: "Acme Catering",
	date: "2026-10-01",
	dueDate: "2026-10-31",
	currency: "USD",
	totalMinor: 120_000,
	payments: [],
	...over,
});

const only = (o: { reminders: ComputedReminder[] }) => {
	expect(o.reminders).toHaveLength(1);
	return o.reminders[0] as ComputedReminder;
};

// ── Contracts ─────────────────────────────────────────────────────────

describe("contractReminders", () => {
	// end 2027-06-30, 60 days' notice → notice by 2027-05-01, remind from 2027-05-01.
	it("starts at end − max(notice, 30 days)", () => {
		expect(contractReminders(contract(), "2027-04-30").reminders).toEqual([]);
		const r = only(contractReminders(contract(), "2027-05-01"));
		expect(r.kind).toBe("contract_expiring");
		expect(r.remindOn).toBe("2027-05-01");
		expect(r.dueDate).toBe("2027-05-01");
	});

	it("uses the 30-day floor when the notice period is shorter", () => {
		const c = contract({ noticeDays: 10 }); // notice by 2027-06-20, remind from 2027-05-31
		expect(contractReminders(c, "2027-05-30").reminders).toEqual([]);
		const r = only(contractReminders(c, "2027-05-31"));
		expect(r.remindOn).toBe("2027-05-31");
		expect(r.dueDate).toBe("2027-06-20");
		expect(r.severity).toBe("info"); // 20 days to the deadline
		expect(only(contractReminders(c, "2027-06-06")).severity).toBe("warning");
	});

	it("treats a missing notice period as zero days (deadline = end date)", () => {
		const c = contract({ noticeDays: null });
		const r = only(contractReminders(c, "2027-06-01"));
		expect(r.dueDate).toBe("2027-06-30");
		expect(r.remindOn).toBe("2027-05-31");
		expect(r.detail).toContain("no notice period is stated");
	});

	it("words auto-renewal as 'renews automatically unless notice is given by'", () => {
		const r = only(contractReminders(contract(), "2027-05-01"));
		expect(r.title).toBe(
			"Bid No. NUSD-NS-2026-03 renews automatically unless notice is given by 2027-05-01",
		);
		expect(r.severity).toBe("warning");
		expect(r.detail).toContain("60 days' notice");
	});

	it("flags a missed notice window as critical until the end date", () => {
		const r = only(contractReminders(contract(), "2027-05-02"));
		expect(r.kind).toBe("contract_notice_missed");
		expect(r.severity).toBe("critical");
		expect(r.dueDate).toBe("2027-05-01");
		expect(r.title).toContain("renews automatically on 2027-07-01");
		expect(only(contractReminders(contract(), "2027-06-30")).kind).toBe(
			"contract_notice_missed",
		);
	});

	it("says nothing once an auto-renewing contract has renewed", () => {
		const o = contractReminders(contract(), "2027-07-01");
		expect(o.reminders).toEqual([]);
		expect(o.status).toBe("renewed");
	});

	it("reminds a non-renewing contract of its end date, then that it expired", () => {
		const c = contract({ autoRenew: false });
		const r = only(contractReminders(c, "2027-06-01"));
		expect(r.kind).toBe("contract_expiring");
		expect(r.dueDate).toBe("2027-06-30");
		expect(r.title).toBe("Bid No. NUSD-NS-2026-03 ends on 2027-06-30");
		expect(r.detail).toContain("does not renew automatically");
		const x = only(contractReminders(c, "2027-07-01"));
		expect(x.kind).toBe("contract_expired");
		expect(x.severity).toBe("critical");
		expect(x.remindOn).toBe("2027-07-01");
	});

	it("never says 'notice window missed' for a contract that does not auto-renew", () => {
		const c = contract({ autoRenew: false });
		for (const d of ["2027-05-02", "2027-06-15", "2027-06-30"]) {
			expect(only(contractReminders(c, d)).kind).toBe("contract_expiring");
		}
	});

	it("asks to check the terms when renewal is unknown", () => {
		const r = only(
			contractReminders(contract({ autoRenew: null }), "2027-06-01"),
		);
		expect(r.detail).toContain("doesn't say whether it renews");
	});

	it("skips contracts with no end date", () => {
		const o = contractReminders(contract({ endDate: null }), "2027-06-01");
		expect(o.reminders).toEqual([]);
		expect(o.status).toBe("no end date");
	});

	it("asks to confirm a draft, alongside any expiry reminder", () => {
		const c = contract({ status: "draft" });
		const early = contractReminders(c, "2026-08-01");
		expect(early.reminders.map((r) => r.kind)).toEqual([
			"contract_unconfirmed",
		]);
		expect(early.reminders[0]?.dueDate).toBe("2026-07-01");
		const late = contractReminders(c, "2027-05-01");
		expect(late.reminders.map((r) => r.kind)).toEqual([
			"contract_unconfirmed",
			"contract_expiring",
		]);
		expect(late.reminders[1]?.detail).toContain("unconfirmed draft");
	});

	it("falls back to a generic name for untitled contracts", () => {
		const r = only(
			contractReminders(
				contract({ title: null, vendorName: null }),
				"2027-05-01",
			),
		);
		expect(r.subjectLabel).toBe("Untitled contract");
		expect(r.title.startsWith("This contract renews")).toBe(true);
	});
});

// ── Vendor bills ──────────────────────────────────────────────────────

describe("vendorBillReminders", () => {
	it("is quiet more than 7 days before the due date", () => {
		const o = vendorBillReminders(bill(), "2026-10-11");
		expect(o.reminders).toEqual([]);
		expect(o.status).toBe("not due yet");
	});

	it("is due soon from 7 days before through the due date", () => {
		const first = only(vendorBillReminders(bill(), "2026-10-12"));
		expect(first.kind).toBe("bill_due_soon");
		expect(first.severity).toBe("warning");
		expect(first.remindOn).toBe("2026-10-12");
		expect(first.amountMinor).toBe(141_070);
		expect(first.title).toBe("Pay HF-1024 from Harbor Foods by 2026-10-19");
		expect(first.detail).toBe("$1,410.70, due 2026-10-19 (in 7 days).");
		expect(only(vendorBillReminders(bill(), "2026-10-18")).title).toBe(
			"Pay HF-1024 from Harbor Foods by tomorrow",
		);
		const dueDay = only(vendorBillReminders(bill(), "2026-10-19"));
		expect(dueDay.kind).toBe("bill_due_soon");
		expect(dueDay.title).toBe("Pay HF-1024 from Harbor Foods today");
	});

	it("is overdue (critical) the day after the due date", () => {
		const r = only(vendorBillReminders(bill(), "2026-10-20"));
		expect(r.kind).toBe("bill_overdue");
		expect(r.severity).toBe("critical");
		expect(r.dueDate).toBe("2026-10-19");
		expect(r.remindOn).toBe("2026-10-20");
		expect(r.title).toBe("HF-1024 from Harbor Foods is 1 day overdue");
		expect(only(vendorBillReminders(bill(), "2026-10-29")).title).toContain(
			"10 days overdue",
		);
	});

	it("counts only payments made on or before today", () => {
		const b = bill({
			payments: [{ amount: "1410.70", currency: "USD", paidOn: "2026-10-19" }],
		});
		expect(only(vendorBillReminders(b, "2026-10-18")).kind).toBe(
			"bill_due_soon",
		);
		const o = vendorBillReminders(b, "2026-10-19");
		expect(o.reminders).toEqual([]);
		expect(o.status).toBe("paid");
	});

	it("reminds of the balance after a partial payment, exactly", () => {
		const b = bill({
			payments: [{ amount: "410.60", currency: "USD", paidOn: "2026-10-01" }],
		});
		const r = only(vendorBillReminders(b, "2026-10-15"));
		expect(r.amountMinor).toBe(100_010);
		expect(r.detail).toContain("$1,000.10 still owed of $1,410.70");
	});

	it("treats an overpaid bill (duplicate payment) as paid", () => {
		const p = { amount: "1410.70", currency: "USD", paidOn: "2026-10-01" };
		expect(
			vendorBillReminders(bill({ payments: [p, p] }), "2026-10-25").status,
		).toBe("paid");
	});

	it("ignores payments in another currency", () => {
		const b = bill({
			payments: [{ amount: "1410.70", currency: "EUR", paidOn: "2026-10-01" }],
		});
		expect(only(vendorBillReminders(b, "2026-10-15")).amountMinor).toBe(
			141_070,
		);
	});

	it("skips bills not yet received and bills with no due date", () => {
		expect(vendorBillReminders(bill(), "2026-09-18").status).toBe(
			"not received yet",
		);
		expect(
			vendorBillReminders(bill({ dueDate: null }), "2026-10-15").status,
		).toBe("no due date");
	});
});

// ── Outgoing invoices ─────────────────────────────────────────────────

describe("outgoingInvoiceReminders", () => {
	it("is due soon in the 7 days up to the due date", () => {
		expect(outgoingInvoiceReminders(invoice(), "2026-10-23").reminders).toEqual(
			[],
		);
		const r = only(outgoingInvoiceReminders(invoice(), "2026-10-24"));
		expect(r.kind).toBe("invoice_due_soon");
		expect(r.subjectType).toBe("document");
		expect(r.title).toBe("INV-0001 to Acme Catering is due in 7 days");
		expect(r.detail).toBe("$1,200.00 outstanding, due 2026-10-31.");
	});

	it("is overdue (critical) after the due date", () => {
		const r = only(outgoingInvoiceReminders(invoice(), "2026-11-03"));
		expect(r.kind).toBe("invoice_overdue");
		expect(r.severity).toBe("critical");
		expect(r.title).toBe("Chase INV-0001: Acme Catering is 3 days late");
	});

	it("nets non-voided payments received by today", () => {
		const d = invoice({
			payments: [
				{
					amountMinor: 20_000,
					currency: "USD",
					receivedOn: "2026-10-10",
					voidedAt: null,
				},
				{
					amountMinor: 100_000,
					currency: "USD",
					receivedOn: "2026-10-11",
					voidedAt: "2026-10-12T09:00:00Z",
				},
				{
					amountMinor: 100_000,
					currency: "USD",
					receivedOn: "2026-11-05",
					voidedAt: null,
				},
			],
		});
		const r = only(outgoingInvoiceReminders(d, "2026-11-01"));
		expect(r.amountMinor).toBe(100_000);
		expect(r.detail).toContain("$1,000.00 outstanding of $1,200.00");
		expect(outgoingInvoiceReminders(d, "2026-11-05").status).toBe("paid");
	});

	it("skips drafts, void documents, other types and missing due dates", () => {
		const day = "2026-11-03";
		expect(
			outgoingInvoiceReminders(invoice({ status: "draft" }), day).status,
		).toBe("draft");
		expect(
			outgoingInvoiceReminders(invoice({ status: "void" }), day).status,
		).toBe("void");
		expect(
			outgoingInvoiceReminders(invoice({ type: "quote" }), day).status,
		).toBe("not an invoice");
		expect(
			outgoingInvoiceReminders(invoice({ dueDate: null }), day).status,
		).toBe("no due date");
	});
});

// ── computeReminders ──────────────────────────────────────────────────

describe("computeReminders", () => {
	it("orders by severity, then due date", () => {
		const { reminders, outcomes } = computeReminders(
			{
				contracts: [contract({ autoRenew: false, endDate: "2026-11-10" })],
				vendorBills: [
					bill(),
					bill({ id: "b2", invoiceNumber: "DP-1016", dueDate: "2026-10-02" }),
				],
				outgoingInvoices: [invoice({ dueDate: "2026-10-22" })],
			},
			"2026-10-21",
		);
		expect(outcomes).toHaveLength(4);
		expect(reminders.map((r) => [r.severity, r.kind, r.dueDate])).toEqual([
			["critical", "bill_overdue", "2026-10-02"],
			["critical", "bill_overdue", "2026-10-19"],
			["warning", "invoice_due_soon", "2026-10-22"],
			["info", "contract_expiring", "2026-11-10"],
		]);
	});

	it("rejects an invalid today", () => {
		expect(() =>
			computeReminders(
				{ contracts: [], vendorBills: [], outgoingInvoices: [] },
				"2026-02-30",
			),
		).toThrow();
	});
});

// ── Idempotency key ───────────────────────────────────────────────────

describe("reminderKey", () => {
	const k = {
		subjectType: "vendor_bill" as const,
		subjectId: "inv-1024",
		kind: "bill_due_soon" as const,
		dueDate: "2026-10-19",
	};

	it("is the (subject type, subject id, kind, due date) tuple", () => {
		expect(reminderKey(k)).toBe(
			'["vendor_bill","inv-1024","bill_due_soon","2026-10-19"]',
		);
		expect(ReminderKey.parse(k)).toEqual(k);
	});

	it("differs when any part differs", () => {
		const keys = new Set([
			reminderKey(k),
			reminderKey({ ...k, subjectType: "document" }),
			reminderKey({ ...k, subjectId: "inv-1025" }),
			reminderKey({ ...k, kind: "bill_overdue" }),
			reminderKey({ ...k, dueDate: "2026-10-20" }),
		]);
		expect(keys.size).toBe(5);
	});

	it("cannot be forged by ids containing separators", () => {
		expect(reminderKey({ ...k, subjectId: 'a","b' })).not.toBe(
			reminderKey({ ...k, subjectId: "a", kind: "bill_due_soon" }),
		);
	});

	it("stays the same for a bill from due soon to its due date", () => {
		const a = only(vendorBillReminders(bill(), "2026-10-12"));
		const b = only(vendorBillReminders(bill(), "2026-10-19"));
		expect(reminderKey(a)).toBe(reminderKey(b));
	});
});

// ── Sweep plan ────────────────────────────────────────────────────────

let seq = 0;
/** What the store would hold after inserting `r`. */
const store = (
	r: ComputedReminder,
	over: Partial<StoredReminder> = {},
): StoredReminder => ({
	id: `r-${++seq}`,
	subjectType: r.subjectType,
	subjectId: r.subjectId,
	kind: r.kind,
	dueDate: r.dueDate,
	severity: r.severity,
	title: r.title,
	detail: r.detail,
	subjectLabel: r.subjectLabel,
	amountMinor: r.amountMinor,
	currency: r.currency,
	snoozedUntil: null,
	dismissedAt: null,
	resolvedAt: null,
	...over,
});

const inputs = {
	contracts: [contract({ status: "draft", endDate: "2026-11-10" })],
	vendorBills: [bill()],
	outgoingInvoices: [invoice()],
};

describe("planSweep", () => {
	it("inserts everything on the first run and nothing on the second", () => {
		const { outcomes, reminders } = computeReminders(inputs, "2026-10-15");
		const first = planSweep([], outcomes);
		expect(first.insert).toHaveLength(reminders.length);
		const stored = first.insert.map((r) => store(r));
		const second = planSweep(stored, outcomes);
		expect(isEmptyPlan(second)).toBe(true);
	});

	it("does not insert a key twice even if the rules repeat it", () => {
		const { outcomes } = computeReminders(inputs, "2026-10-15");
		const doubled = [...outcomes, ...outcomes];
		const plan = planSweep([], doubled);
		expect(new Set(plan.insert.map(reminderKey)).size).toBe(plan.insert.length);
	});

	it("refreshes wording and severity on an open reminder, keeping its key", () => {
		const c = contract({ autoRenew: false, endDate: "2026-11-10" });
		const early = only(contractReminders(c, "2026-10-15")); // 26 days → info
		const s = store(early);
		const later = contractReminders(c, "2026-10-30"); // 11 days → warning
		const plan = planSweep([s], [later]);
		expect(plan.insert).toEqual([]);
		expect(plan.refresh).toHaveLength(1);
		expect(plan.refresh[0]?.id).toBe(s.id);
		expect(plan.refresh[0]?.content.severity).toBe("warning");
	});

	it("resolves due soon as superseded when the bill becomes overdue", () => {
		const s = store(only(vendorBillReminders(bill(), "2026-10-15")));
		const plan = planSweep([s], [vendorBillReminders(bill(), "2026-10-20")]);
		expect(plan.insert.map((r) => r.kind)).toEqual(["bill_overdue"]);
		expect(plan.resolve).toEqual([{ id: s.id, reason: "superseded" }]);
	});

	it("auto-resolves a reminder once the bill is paid", () => {
		const s = store(only(vendorBillReminders(bill(), "2026-10-15")));
		const paid = bill({
			payments: [{ amount: "1410.70", currency: "USD", paidOn: "2026-10-16" }],
		});
		const plan = planSweep([s], [vendorBillReminders(paid, "2026-10-16")]);
		expect(plan.resolve).toEqual([{ id: s.id, reason: "paid" }]);
		expect(plan.insert).toEqual([]);
	});

	it("auto-resolves 'confirm the prices' once the contract is confirmed", () => {
		const draft = contract({ status: "draft" });
		const s = store(only(contractReminders(draft, "2026-08-01")));
		const confirmed = contractReminders(
			{ ...draft, status: "confirmed" },
			"2026-08-02",
		);
		expect(planSweep([s], [confirmed]).resolve).toEqual([
			{ id: s.id, reason: "confirmed" },
		]);
	});

	it("auto-resolves a voided invoice and one whose subject is gone", () => {
		const a = store(only(outgoingInvoiceReminders(invoice(), "2026-10-30")));
		const b = store(
			only(vendorBillReminders(bill({ id: "gone" }), "2026-10-15")),
		);
		const plan = planSweep(
			[a, b],
			[outgoingInvoiceReminders(invoice({ status: "void" }), "2026-10-30")],
		);
		expect(plan.resolve).toEqual([
			{ id: a.id, reason: "void" },
			{ id: b.id, reason: "no longer on file" },
		]);
	});

	it("reopens an auto-resolved reminder that applies again", () => {
		const r = only(vendorBillReminders(bill(), "2026-10-15"));
		const s = store(r, { resolvedAt: "2026-10-16T00:00:00Z" });
		const plan = planSweep([s], [vendorBillReminders(bill(), "2026-10-17")]);
		expect(plan.insert).toEqual([]);
		expect(plan.reopen.map((x) => x.id)).toEqual([s.id]);
	});

	it("leaves dismissed reminders alone, for good", () => {
		const r = only(vendorBillReminders(bill(), "2026-10-15"));
		const s = store(r, { dismissedAt: "2026-10-15T12:00:00Z" });
		expect(
			isEmptyPlan(planSweep([s], [vendorBillReminders(bill(), "2026-10-17")])),
		).toBe(true);
		const paid = bill({
			payments: [{ amount: "1410.70", currency: "USD", paidOn: "2026-10-16" }],
		});
		expect(
			isEmptyPlan(planSweep([s], [vendorBillReminders(paid, "2026-10-17")])),
		).toBe(true);
	});

	it("keeps a snoozed reminder (snooze is not resolution)", () => {
		const r = only(vendorBillReminders(bill(), "2026-10-15"));
		const s = store(r, { snoozedUntil: "2026-10-18" });
		expect(
			isEmptyPlan(planSweep([s], [vendorBillReminders(bill(), "2026-10-15")])),
		).toBe(true);
	});
});

describe("resolutionReason", () => {
	it("explains why a reminder stopped applying", () => {
		const o = vendorBillReminders(bill(), "2026-10-11");
		expect(resolutionReason({ kind: "bill_due_soon" }, o)).toBe("not due yet");
		expect(resolutionReason({ kind: "bill_due_soon" }, undefined)).toBe(
			"no longer on file",
		);
	});
});

// ── Snooze and state ──────────────────────────────────────────────────

describe("snooze and state", () => {
	const blank = { resolvedAt: null, dismissedAt: null, snoozedUntil: null };

	it("snoozes for 1, 3 or 7 days", () => {
		expect(snoozeUntil("2026-10-21", 1)).toBe("2026-10-22");
		expect(snoozeUntil("2026-10-29", 3)).toBe("2026-11-01");
		expect(snoozeUntil("2026-12-28", 7)).toBe("2027-01-04");
	});

	it("hides a snoozed reminder until the snooze date, then shows it again", () => {
		const r = { ...blank, snoozedUntil: "2026-10-24" };
		expect(reminderState(r, "2026-10-21")).toBe("snoozed");
		expect(reminderState(r, "2026-10-23")).toBe("snoozed");
		expect(reminderState(r, "2026-10-24")).toBe("open");
	});

	it("ranks resolved over dismissed over snoozed", () => {
		expect(reminderState(blank, "2026-10-21")).toBe("open");
		expect(
			reminderState(
				{ ...blank, dismissedAt: "x", snoozedUntil: "2026-12-01" },
				"2026-10-21",
			),
		).toBe("dismissed");
		expect(
			reminderState(
				{ ...blank, resolvedAt: "x", dismissedAt: "y" },
				"2026-10-21",
			),
		).toBe("resolved");
	});
});

describe("inDays", () => {
	it("reads naturally", () => {
		expect(inDays(0)).toBe("today");
		expect(inDays(1)).toBe("tomorrow");
		expect(inDays(5)).toBe("in 5 days");
	});
});
