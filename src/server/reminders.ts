/**
 * Reminder server functions (callable from the client). `today` is optional
 * everywhere and defaults to the server's UTC date; the demo passes a chosen
 * date to see reminders for, say, 2026-10-21.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { SNOOZE_DAYS } from "#/lib/reminders/types.ts";
import {
	countOpenReminders,
	dismiss,
	listReminders,
	restore,
	runReminderSweep,
	snooze,
	todayIso,
} from "./reminders-store.ts";

const Today = z.object({ today: z.iso.date().optional() });
const Id = z.string().min(1).max(100);

export const getReminders = createServerFn({ method: "GET" })
	.validator((input: unknown) => Today.parse(input ?? {}))
	.handler(async ({ data }) => {
		const today = data.today ?? todayIso();
		const reminders = await listReminders(today);
		return { today, reminders };
	});

export const getOpenReminderCount = createServerFn({ method: "GET" })
	.validator((input: unknown) => Today.parse(input ?? {}))
	.handler(({ data }) => countOpenReminders(data.today ?? todayIso()));

/** The daily cron's sweep, on demand (the demo's "Run sweep now"). */
export const runSweepNow = createServerFn({ method: "POST" })
	.validator((input: unknown) => Today.parse(input ?? {}))
	.handler(({ data }) => runReminderSweep(data.today ?? todayIso()));

export const snoozeReminder = createServerFn({ method: "POST" })
	.validator((input: unknown) =>
		Today.extend({
			id: Id,
			days: z.literal(SNOOZE_DAYS),
		}).parse(input),
	)
	.handler(({ data }) => snooze(data.id, data.days, data.today ?? todayIso()));

export const dismissReminder = createServerFn({ method: "POST" })
	.validator((input: unknown) =>
		z
			.object({
				id: Id,
				by: z.string().trim().min(1).max(100).default("owner"),
			})
			.parse(input),
	)
	.handler(({ data }) => dismiss(data.id, data.by));

export const restoreReminder = createServerFn({ method: "POST" })
	.validator((input: unknown) => z.object({ id: Id }).parse(input))
	.handler(({ data }) => restore(data.id));
