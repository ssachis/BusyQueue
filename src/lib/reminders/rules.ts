/**
 * Reminder rules. Pure: every date and amount comes from the inputs and
 * `today` (an ISO date), never from the clock. Amounts are integer minor
 * units from the money core; nothing here is a float.
 */
import { addDays, daysBetween, toDay } from "#/lib/forecast/util.ts";
import { formatMoney, toMinor } from "#/lib/money/index.ts";
import {
	CONTRACT_WARNING_DAYS,
	type ComputedReminder,
	type ContractInput,
	DUE_SOON_DAYS,
	MIN_CONTRACT_LEAD_DAYS,
	type OutgoingInvoiceInput,
	type ReminderInputs,
	type ReminderKey,
	SEVERITIES,
	type Severity,
	type SubjectOutcome,
	type VendorBillInput,
} from "./types.ts";

// ── Small helpers ─────────────────────────────────────────────────────

/** Stable string form of the idempotency key `(subject_type, subject_id, kind, due_date)`. */
export function reminderKey(k: ReminderKey): string {
	return JSON.stringify([k.subjectType, k.subjectId, k.kind, k.dueDate]);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "today", "tomorrow", "in 5 days". `days` ≥ 0. */
export function inDays(days: number): string {
	if (days === 0) return "today";
	if (days === 1) return "tomorrow";
	return `in ${plural(days, "day")}`;
}

const money = (minor: number, currency: string) =>
	formatMoney({ minor, currency });

/** Same currency, on or before `today`: the payments that count toward a balance. */
function paidMinor(
	payments: { minor: number; currency: string; on: string }[],
	currency: string,
	today: string,
): number {
	// Payments in another currency can't be netted exactly; they are ignored.
	return payments
		.filter((p) => p.currency === currency && p.on <= today)
		.reduce((acc, p) => acc + p.minor, 0);
}

function assertDate(iso: string): void {
	toDay(iso); // throws on anything that isn't a real ISO date
}

// ── Contracts ─────────────────────────────────────────────────────────

/**
 * Contract reminders. The reminder starts at `end − max(noticeDays, 30)`.
 *
 * - Auto-renewing: "renews automatically unless notice is given by
 *   `end − noticeDays`" until that deadline, then "notice window missed"
 *   until the end date. After the end date it has renewed: nothing.
 * - Not auto-renewing (or unknown): "ends on <end>" until the end date,
 *   then "expired" (bills have no agreed price until a new contract).
 * - Draft: also "confirm the prices", which resolves when confirmed.
 */
export function contractReminders(
	c: ContractInput,
	today: string,
): SubjectOutcome {
	assertDate(today);
	const label = [c.title ?? "Untitled contract", c.vendorName]
		.filter(Boolean)
		.join(" · ");
	const name = c.title ?? "This contract";
	const vendor = c.vendorName ?? "this vendor";
	const reminders: ComputedReminder[] = [];
	const base = {
		subjectType: "contract" as const,
		subjectId: c.id,
		subjectLabel: label,
		amountMinor: null,
		currency: null,
	};
	const draftNote =
		c.status === "draft" ? " Dates are from the unconfirmed draft." : "";

	if (c.status === "draft") {
		const created = c.createdAt.slice(0, 10);
		reminders.push({
			...base,
			kind: "contract_unconfirmed",
			dueDate: created,
			remindOn: created,
			severity: "info",
			title: `Confirm the agreed prices in ${name}`,
			detail:
				"BusyQ only checks bills against prices you have confirmed. Review the extracted prices and confirm them.",
		});
	}

	const outcome = (status: string): SubjectOutcome => ({
		subjectType: "contract",
		subjectId: c.id,
		reminders,
		status,
	});

	if (!c.endDate) return outcome("no end date");
	const end = c.endDate;
	const notice = Math.max(0, c.noticeDays ?? 0);
	const remindOn = addDays(end, -Math.max(notice, MIN_CONTRACT_LEAD_DAYS));
	if (today < remindOn) return outcome("not due yet");

	if (c.autoRenew === true) {
		const noticeBy = addDays(end, -notice);
		if (today <= noticeBy) {
			const days = daysBetween(today, noticeBy);
			reminders.push({
				...base,
				kind: "contract_expiring",
				dueDate: noticeBy,
				remindOn,
				severity: days <= CONTRACT_WARNING_DAYS ? "warning" : "info",
				title: `${name} renews automatically unless notice is given by ${noticeBy}`,
				detail:
					(notice > 0
						? `The term ends ${end} and needs ${plural(notice, "day")}' notice of non-renewal. Decide ${inDays(days)} whether to renew or rebid.`
						: `The term ends ${end} and no notice period is stated. Give notice before then (${inDays(days)}) if you don't want it to renew.`) +
					draftNote,
			});
			return outcome("notice window open");
		}
		if (today <= end) {
			reminders.push({
				...base,
				kind: "contract_notice_missed",
				dueDate: noticeBy,
				remindOn: addDays(noticeBy, 1),
				severity: "critical",
				title: `Notice window missed: ${name} renews automatically on ${addDays(end, 1)}`,
				detail: `Notice of non-renewal was due by ${noticeBy}. Unless ${vendor} agrees otherwise, it renews on the current terms.${draftNote}`,
			});
			return outcome("notice window missed");
		}
		return outcome("renewed");
	}

	if (today <= end) {
		const days = daysBetween(today, end);
		reminders.push({
			...base,
			kind: "contract_expiring",
			dueDate: end,
			remindOn,
			severity: days <= CONTRACT_WARNING_DAYS ? "warning" : "info",
			title: `${name} ends on ${end}`,
			detail:
				(c.autoRenew === false
					? `It does not renew automatically. Start the rebid or a new agreement (it ends ${inDays(days)}).`
					: `The contract doesn't say whether it renews. Check the terms and plan the rebid (it ends ${inDays(days)}).`) +
				draftNote,
		});
		return outcome("ending");
	}
	reminders.push({
		...base,
		kind: "contract_expired",
		dueDate: end,
		remindOn: addDays(end, 1),
		severity: "critical",
		title: `${name} ended on ${end}`,
		detail: `Bills from ${vendor} have no agreed price to check against until a new contract is confirmed.${draftNote}`,
	});
	return outcome("expired");
}

// ── Vendor bills (money out) ──────────────────────────────────────────

/**
 * A bill is "due soon" from 7 days before its due date through the due date,
 * and "overdue" after it, while its balance (stated total minus payments on
 * or before `today`) is above zero. Bills not yet issued on `today` and bills
 * with no due date are skipped.
 */
export function vendorBillReminders(
	b: VendorBillInput,
	today: string,
): SubjectOutcome {
	assertDate(today);
	const outcome = (
		status: string,
		reminders: ComputedReminder[] = [],
	): SubjectOutcome => ({
		subjectType: "vendor_bill",
		subjectId: b.id,
		reminders,
		status,
	});
	if (b.issueDate > today) return outcome("not received yet");
	if (!b.dueDate) return outcome("no due date");

	const total = toMinor(b.statedTotal, b.currency).minor;
	const paid = paidMinor(
		b.payments.map((p) => ({
			minor: toMinor(p.amount, p.currency).minor,
			currency: p.currency,
			on: p.paidOn,
		})),
		b.currency,
		today,
	);
	const balance = total - paid;
	if (balance <= 0) return outcome("paid");

	const due = b.dueDate;
	const days = daysBetween(today, due);
	if (days > DUE_SOON_DAYS) return outcome("not due yet");

	const base = {
		subjectType: "vendor_bill" as const,
		subjectId: b.id,
		subjectLabel: `${b.invoiceNumber} · ${b.vendorName}`,
		dueDate: due,
		amountMinor: balance,
		currency: b.currency,
	};
	const owed =
		paid > 0
			? `${money(balance, b.currency)} still owed of ${money(total, b.currency)}`
			: money(balance, b.currency);

	if (days >= 0) {
		return outcome("open", [
			{
				...base,
				kind: "bill_due_soon",
				remindOn: addDays(due, -DUE_SOON_DAYS),
				severity: "warning",
				title: `Pay ${b.invoiceNumber} from ${b.vendorName} ${days === 0 ? "today" : days === 1 ? "by tomorrow" : `by ${due}`}`,
				detail: `${owed}, due ${due} (${inDays(days)}).`,
			},
		]);
	}
	const late = -days;
	return outcome("open", [
		{
			...base,
			kind: "bill_overdue",
			remindOn: addDays(due, 1),
			severity: "critical",
			title: `${b.invoiceNumber} from ${b.vendorName} is ${plural(late, "day")} overdue`,
			detail: `${owed}, due ${due}. Pay it, or note why it is on hold.`,
		},
	]);
}

// ── Our invoices (money in) ───────────────────────────────────────────

/**
 * Issued invoices with a balance (total minus non-voided payments received
 * on or before `today`): "due soon" in the 7 days up to the due date,
 * "overdue" after it. Drafts, void documents and other types are skipped.
 */
export function outgoingInvoiceReminders(
	d: OutgoingInvoiceInput,
	today: string,
): SubjectOutcome {
	assertDate(today);
	const outcome = (
		status: string,
		reminders: ComputedReminder[] = [],
	): SubjectOutcome => ({
		subjectType: "document",
		subjectId: d.id,
		reminders,
		status,
	});
	if (d.type !== "invoice") return outcome("not an invoice");
	if (d.status !== "issued") return outcome(d.status);
	if (d.totalMinor === null || !d.dueDate) return outcome("no due date");

	const paid = paidMinor(
		d.payments
			.filter((p) => p.voidedAt === null)
			.map((p) => ({
				minor: p.amountMinor,
				currency: p.currency,
				on: p.receivedOn,
			})),
		d.currency,
		today,
	);
	const balance = d.totalMinor - paid;
	if (balance <= 0) return outcome("paid");

	const due = d.dueDate;
	const days = daysBetween(today, due);
	if (days > DUE_SOON_DAYS) return outcome("not due yet");

	const number = d.number ?? "Invoice";
	const base = {
		subjectType: "document" as const,
		subjectId: d.id,
		subjectLabel: `${number} · ${d.buyerName}`,
		dueDate: due,
		amountMinor: balance,
		currency: d.currency,
	};
	const owed =
		paid > 0
			? `${money(balance, d.currency)} outstanding of ${money(d.totalMinor, d.currency)}`
			: `${money(balance, d.currency)} outstanding`;

	if (days >= 0) {
		return outcome("open", [
			{
				...base,
				kind: "invoice_due_soon",
				remindOn: addDays(due, -DUE_SOON_DAYS),
				severity: "warning",
				title: `${number} to ${d.buyerName} is due ${inDays(days)}`,
				detail: `${owed}, due ${due}.`,
			},
		]);
	}
	const late = -days;
	return outcome("open", [
		{
			...base,
			kind: "invoice_overdue",
			remindOn: addDays(due, 1),
			severity: "critical",
			title: `Chase ${number}: ${d.buyerName} is ${plural(late, "day")} late`,
			detail: `${owed}, due ${due}.`,
		},
	]);
}

// ── Everything ────────────────────────────────────────────────────────

const severityRank = (s: Severity) => SEVERITIES.indexOf(s);

/** Most urgent first: severity, then due date, then subject. */
export function compareReminders(
	a: Pick<ComputedReminder, "severity" | "dueDate" | "subjectLabel">,
	b: Pick<ComputedReminder, "severity" | "dueDate" | "subjectLabel">,
): number {
	return (
		severityRank(a.severity) - severityRank(b.severity) ||
		a.dueDate.localeCompare(b.dueDate) ||
		a.subjectLabel.localeCompare(b.subjectLabel)
	);
}

/** Every reminder that applies on `today`, plus each subject's outcome. */
export function computeReminders(
	inputs: ReminderInputs,
	today: string,
): { reminders: ComputedReminder[]; outcomes: SubjectOutcome[] } {
	assertDate(today);
	const outcomes = [
		...inputs.contracts.map((c) => contractReminders(c, today)),
		...inputs.vendorBills.map((b) => vendorBillReminders(b, today)),
		...inputs.outgoingInvoices.map((d) => outgoingInvoiceReminders(d, today)),
	];
	const reminders = outcomes.flatMap((o) => o.reminders).sort(compareReminders);
	return { reminders, outcomes };
}
