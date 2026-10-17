import { queryOptions, useQuery } from "@tanstack/react-query";
import { Badge } from "#/components/ui/badge.tsx";
import { cn } from "#/lib/utils.ts";
import { getOpenReminderCount } from "#/server/reminders.ts";

export const REMINDERS_COUNT_KEY = ["reminders", "open-count"] as const;

/** Open reminders (not resolved, dismissed or snoozed) for today or a chosen day. */
export const openRemindersCountQuery = (today?: string) =>
	queryOptions({
		queryKey: [...REMINDERS_COUNT_KEY, today ?? "today"],
		queryFn: () => getOpenReminderCount({ data: { today } }),
		staleTime: 60_000,
	});

export function useOpenReminderCount(today?: string): number | undefined {
	return useQuery(openRemindersCountQuery(today)).data;
}

/**
 * Small count pill for the nav or a page header. Renders nothing while
 * loading or when there is nothing open.
 */
export function RemindersBadge({
	today,
	className,
}: {
	today?: string;
	className?: string;
}) {
	const count = useOpenReminderCount(today);
	if (!count) return null;
	return (
		<Badge
			variant="warning"
			className={cn("tabular-nums", className)}
			aria-label={`${count} open reminder${count === 1 ? "" : "s"}`}
		>
			{count}
		</Badge>
	);
}
