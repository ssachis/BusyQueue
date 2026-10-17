/**
 * The sweep plan: given what is stored and what the rules compute today,
 * decide what to insert, refresh, reopen and resolve. Pure, so the
 * idempotency guarantees are unit-tested; the store applies the plan.
 */
import { addDays, toDay } from "#/lib/forecast/util.ts";
import { reminderKey } from "./rules.ts";
import type {
	ComputedReminder,
	ReminderState,
	SnoozeDays,
	StoredReminder,
	SubjectOutcome,
} from "./types.ts";

/** Fields a later sweep may update on a still-open reminder (balances change, deadlines near). */
export type ReminderContent = Pick<
	ComputedReminder,
	"severity" | "title" | "detail" | "subjectLabel" | "amountMinor" | "currency"
>;

export interface SweepPlan {
	/** New keys. The store inserts with ON CONFLICT DO NOTHING on the key. */
	insert: ComputedReminder[];
	/** Open reminders whose wording, severity or balance changed. */
	refresh: { id: string; content: ReminderContent }[];
	/** Auto-resolved reminders that apply again (e.g. a payment was voided). */
	reopen: { id: string; content: ReminderContent }[];
	/** Open reminders that no longer apply, with why. */
	resolve: { id: string; reason: string }[];
}

const contentOf = (r: ReminderContent): ReminderContent => ({
	severity: r.severity,
	title: r.title,
	detail: r.detail,
	subjectLabel: r.subjectLabel,
	amountMinor: r.amountMinor,
	currency: r.currency,
});

const sameContent = (a: ReminderContent, b: ReminderContent) =>
	a.severity === b.severity &&
	a.title === b.title &&
	a.detail === b.detail &&
	a.subjectLabel === b.subjectLabel &&
	a.amountMinor === b.amountMinor &&
	a.currency === b.currency;

const subjectKey = (o: { subjectType: string; subjectId: string }) =>
	`${o.subjectType}\u0000${o.subjectId}`;

/** Why a stored reminder stopped applying. */
export function resolutionReason(
	stored: Pick<StoredReminder, "kind">,
	outcome: SubjectOutcome | undefined,
): string {
	if (!outcome) return "no longer on file";
	// The only way a draft stops needing confirmation is being confirmed.
	if (stored.kind === "contract_unconfirmed") return "confirmed";
	// Same subject, different key: due soon → overdue, deadline passed, etc.
	if (outcome.reminders.length > 0) return "superseded";
	return outcome.status;
}

/**
 * Plan one sweep. Dismissed reminders are final: they are never refreshed,
 * reopened or resolved. Running the plan and then planning again with the
 * same inputs yields an empty plan.
 */
export function planSweep(
	stored: readonly StoredReminder[],
	outcomes: readonly SubjectOutcome[],
): SweepPlan {
	const byKey = new Map(stored.map((s) => [reminderKey(s), s]));
	const outcomeBySubject = new Map(outcomes.map((o) => [subjectKey(o), o]));
	const computedKeys = new Set<string>();
	const plan: SweepPlan = { insert: [], refresh: [], reopen: [], resolve: [] };

	for (const r of outcomes.flatMap((o) => o.reminders)) {
		const key = reminderKey(r);
		if (computedKeys.has(key)) continue;
		computedKeys.add(key);
		const s = byKey.get(key);
		if (!s) plan.insert.push(r);
		else if (s.dismissedAt) continue;
		else if (s.resolvedAt)
			plan.reopen.push({ id: s.id, content: contentOf(r) });
		else if (!sameContent(s, r))
			plan.refresh.push({ id: s.id, content: contentOf(r) });
	}

	for (const s of stored) {
		if (s.resolvedAt || s.dismissedAt) continue;
		if (computedKeys.has(reminderKey(s))) continue;
		plan.resolve.push({
			id: s.id,
			reason: resolutionReason(s, outcomeBySubject.get(subjectKey(s))),
		});
	}
	return plan;
}

export const isEmptyPlan = (p: SweepPlan) =>
	p.insert.length + p.refresh.length + p.reopen.length + p.resolve.length === 0;

// ── Snooze, dismiss and state ─────────────────────────────────────────

/** Snoozed reminders come back on this date. */
export function snoozeUntil(today: string, days: SnoozeDays): string {
	return addDays(today, days);
}

/** Where a stored reminder stands on `today`. */
export function reminderState(
	r: Pick<StoredReminder, "resolvedAt" | "dismissedAt" | "snoozedUntil">,
	today: string,
): ReminderState {
	toDay(today);
	if (r.resolvedAt) return "resolved";
	if (r.dismissedAt) return "dismissed";
	if (r.snoozedUntil && r.snoozedUntil > today) return "snoozed";
	return "open";
}
