import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import {
	AlarmClockOff,
	BellRing,
	CircleAlert,
	Clock,
	Info,
	type LucideIcon,
	RefreshCw,
	RotateCcw,
	X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageBody, PageHeader } from "#/components/app-shell.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Card, CardContent } from "#/components/ui/card.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import { formatMoney } from "#/lib/money/index.ts";
import {
	type ReminderKind,
	type Severity,
	SNOOZE_DAYS,
	type SnoozeDays,
	type SubjectType,
} from "#/lib/reminders/types.ts";
import { cn } from "#/lib/utils.ts";
import {
	dismissReminder,
	restoreReminder,
	runSweepNow,
	snoozeReminder,
} from "#/server/reminders.ts";
import type { ReminderView } from "#/server/reminders-store.ts";
import { REMINDERS_COUNT_KEY, RemindersBadge } from "./reminders-badge.tsx";
import { SubjectLink } from "./subject-link.tsx";

const GROUPS: {
	severity: Severity;
	label: string;
	icon: LucideIcon;
	tone: string;
}[] = [
	{
		severity: "critical",
		label: "Act now",
		icon: CircleAlert,
		tone: "text-destructive",
	},
	{
		severity: "warning",
		label: "Coming up",
		icon: Clock,
		tone: "text-warning",
	},
	{
		severity: "info",
		label: "For your information",
		icon: Info,
		tone: "text-info",
	},
];

const SUBJECT_LABELS: Record<SubjectType, string> = {
	contract: "Contract",
	vendor_bill: "Vendor bill",
	document: "Our invoice",
};

/** What the reminder's key date means, per kind. */
const DATE_LABELS: Record<ReminderKind, string> = {
	contract_expiring: "Deadline",
	contract_notice_missed: "Notice was due",
	contract_expired: "Ended",
	contract_unconfirmed: "Added",
	bill_due_soon: "Due",
	bill_overdue: "Due",
	invoice_due_soon: "Due",
	invoice_overdue: "Due",
};

export function RemindersPage({
	today,
	reminders,
}: {
	today: string;
	reminders: ReminderView[];
}) {
	const router = useRouter();
	const navigate = useNavigate({ from: "/reminders" });
	const queryClient = useQueryClient();
	const [busy, setBusy] = useState<string | null>(null);

	async function act(id: string, run: () => Promise<unknown>, done: string) {
		setBusy(id);
		try {
			await run();
			toast.success(done);
			await Promise.all([
				router.invalidate(),
				queryClient.invalidateQueries({ queryKey: REMINDERS_COUNT_KEY }),
			]);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Something went wrong");
		} finally {
			setBusy(null);
		}
	}

	const sweep = () =>
		act(
			"sweep",
			async () => {
				const r = await runSweepNow({ data: { today } });
				toast.message(
					`Sweep for ${r.today}: ${r.computed} apply, ${r.inserted} new, ${r.resolved} resolved, ${r.refreshed + r.reopened} updated`,
				);
			},
			"Reminders are up to date",
		);

	const open = reminders.filter((r) => r.state === "open");
	const snoozed = reminders.filter((r) => r.state === "snoozed");
	const closed = reminders.filter(
		(r) => r.state === "dismissed" || r.state === "resolved",
	);

	return (
		<>
			<PageHeader
				title={
					<span className="flex items-center gap-2">
						Reminders <RemindersBadge today={today} />
					</span>
				}
				description="Contract notice deadlines, vendor bills to pay and invoices to chase. A daily sweep adds new ones; anything paid or confirmed clears itself."
			>
				<div className="flex items-center gap-2">
					<Label htmlFor="reminders-today" className="text-muted-foreground">
						As of
					</Label>
					<Input
						id="reminders-today"
						type="date"
						className="w-40"
						value={today}
						onChange={(e) => {
							const value = e.target.value;
							if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
								void navigate({ search: { today: value } });
							}
						}}
					/>
				</div>
				<Button onClick={sweep} disabled={busy !== null}>
					<RefreshCw className={cn(busy === "sweep" && "animate-spin")} />
					Run sweep now
				</Button>
			</PageHeader>
			<PageBody className="space-y-8">
				{open.length === 0 ? (
					<Card>
						<CardContent className="flex flex-col items-center gap-3 py-10 text-center">
							<BellRing className="size-8 text-muted-foreground" />
							<p className="max-w-md text-sm text-muted-foreground">
								Nothing needs attention on {today}. The sweep runs every
								morning; run it now to check contracts, bills and invoices
								again.
							</p>
						</CardContent>
					</Card>
				) : (
					GROUPS.map((g) => {
						const items = open.filter((r) => r.severity === g.severity);
						if (items.length === 0) return null;
						return (
							<section key={g.severity} className="space-y-3">
								<h2 className="flex items-center gap-2 text-sm font-semibold">
									<g.icon className={cn("size-4", g.tone)} />
									{g.label}
									<span className="font-normal text-muted-foreground">
										{items.length}
									</span>
								</h2>
								<ul className="divide-y rounded-md border">
									{items.map((r) => (
										<ReminderItem key={r.id} reminder={r}>
											<SnoozeButtons
												disabled={busy !== null}
												onSnooze={(days) =>
													act(
														r.id,
														() =>
															snoozeReminder({
																data: { id: r.id, days, today },
															}),
														`Snoozed for ${days} day${days === 1 ? "" : "s"}`,
													)
												}
											/>
											<Button
												variant="ghost"
												size="xs"
												disabled={busy !== null}
												onClick={() =>
													act(
														r.id,
														() => dismissReminder({ data: { id: r.id } }),
														"Dismissed",
													)
												}
											>
												<X />
												Dismiss
											</Button>
										</ReminderItem>
									))}
								</ul>
							</section>
						);
					})
				)}

				{snoozed.length > 0 ? (
					<section className="space-y-3">
						<h2 className="flex items-center gap-2 text-sm font-semibold">
							<AlarmClockOff className="size-4 text-muted-foreground" />
							Snoozed
							<span className="font-normal text-muted-foreground">
								{snoozed.length}
							</span>
						</h2>
						<ul className="divide-y rounded-md border">
							{snoozed.map((r) => (
								<ReminderItem key={r.id} reminder={r} muted>
									<span className="text-xs text-muted-foreground">
										Back on {r.snoozedUntil}
									</span>
									<RestoreButton
										disabled={busy !== null}
										onClick={() =>
											act(
												r.id,
												() => restoreReminder({ data: { id: r.id } }),
												"Unsnoozed",
											)
										}
									/>
								</ReminderItem>
							))}
						</ul>
					</section>
				) : null}

				{closed.length > 0 ? (
					<section className="space-y-3">
						<h2 className="text-sm font-semibold text-muted-foreground">
							Dismissed and resolved
						</h2>
						<ul className="divide-y rounded-md border">
							{closed.map((r) => (
								<ReminderItem key={r.id} reminder={r} muted>
									{r.state === "resolved" ? (
										<Badge variant="success">
											Resolved{r.resolvedReason ? `: ${r.resolvedReason}` : ""}
										</Badge>
									) : (
										<>
											<Badge variant="outline">Dismissed</Badge>
											<RestoreButton
												disabled={busy !== null}
												onClick={() =>
													act(
														r.id,
														() => restoreReminder({ data: { id: r.id } }),
														"Restored",
													)
												}
											/>
										</>
									)}
								</ReminderItem>
							))}
						</ul>
					</section>
				) : null}
			</PageBody>
		</>
	);
}

function ReminderItem({
	reminder: r,
	muted = false,
	children,
}: {
	reminder: ReminderView;
	muted?: boolean;
	children: React.ReactNode;
}) {
	return (
		<li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
			<div className={cn("min-w-0 space-y-1", muted && "opacity-70")}>
				<p className="font-medium leading-snug">{r.title}</p>
				<p className="text-sm text-muted-foreground">{r.detail}</p>
				<p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
					<span>{SUBJECT_LABELS[r.subjectType]}</span>
					<span aria-hidden>·</span>
					<SubjectLink
						type={r.subjectType}
						id={r.subjectId}
						className="font-medium text-foreground underline-offset-4 hover:underline"
					>
						{r.subjectLabel}
					</SubjectLink>
					<span aria-hidden>·</span>
					<span>
						{DATE_LABELS[r.kind]} {r.dueDate}
					</span>
					{r.amountMinor !== null && r.currency ? (
						<>
							<span aria-hidden>·</span>
							<span className="tabular-nums text-foreground">
								{formatMoney({ minor: r.amountMinor, currency: r.currency })}
							</span>
						</>
					) : null}
				</p>
			</div>
			<div className="flex shrink-0 flex-wrap items-center gap-1.5">
				{children}
			</div>
		</li>
	);
}

function SnoozeButtons({
	disabled,
	onSnooze,
}: {
	disabled: boolean;
	onSnooze: (days: SnoozeDays) => void;
}) {
	return (
		<fieldset className="flex items-center gap-1">
			<legend className="sr-only">Snooze</legend>
			<span className="mr-0.5 text-xs text-muted-foreground">Snooze</span>
			{SNOOZE_DAYS.map((days) => (
				<Button
					key={days}
					variant="outline"
					size="xs"
					disabled={disabled}
					onClick={() => onSnooze(days)}
					aria-label={`Snooze for ${days} day${days === 1 ? "" : "s"}`}
				>
					{days}d
				</Button>
			))}
		</fieldset>
	);
}

function RestoreButton({
	disabled,
	onClick,
}: {
	disabled: boolean;
	onClick: () => void;
}) {
	return (
		<Button variant="ghost" size="xs" disabled={disabled} onClick={onClick}>
			<RotateCcw />
			Restore
		</Button>
	);
}
