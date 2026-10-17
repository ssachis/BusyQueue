/**
 * Custom Worker entry (wrangler.jsonc `main`).
 *
 * `fetch` is TanStack Start's own handler, passed through untouched, so SSR,
 * server routes and server functions behave exactly as with the default
 * `@tanstack/react-start/server-entry`. This file only adds the handlers
 * Start doesn't provide:
 *
 * - `scheduled`: the daily cron (`triggers.crons` in wrangler.jsonc) runs the
 *   reminder sweep for the cron's UTC date.
 *
 * Queue consumers (AI import, Phase 2) can be added here the same way.
 */
import startEntry from "@tanstack/react-start/server-entry";
import { runReminderSweep, todayIso } from "#/server/reminders-store.ts";

export default {
	fetch: startEntry.fetch,

	async scheduled(controller: ScheduledController) {
		const today = todayIso(new Date(controller.scheduledTime));
		try {
			const result = await runReminderSweep(today);
			console.log(
				`[reminders] sweep for ${today} (cron "${controller.cron}"):`,
				JSON.stringify(result),
			);
		} catch (error) {
			console.error(`[reminders] sweep for ${today} failed:`, error);
			// Rethrow so the invocation is marked failed in Workers observability.
			throw error;
		}
	},
};
