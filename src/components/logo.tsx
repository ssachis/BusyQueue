import { cn } from "#/lib/utils.ts";

/**
 * BusyQ mark: a rounded square with a queue of bills, the last one ticked off.
 * Colours come from the chart and sidebar tokens so it follows the theme.
 */
export function LogoMark({ className }: { className?: string }) {
	return (
		<svg
			viewBox="0 0 40 40"
			role="img"
			aria-label="BusyQ"
			className={cn("size-10 shrink-0", className)}
		>
			<defs>
				<linearGradient id="busyq-mark" x1="0" y1="0" x2="1" y2="1">
					<stop offset="0" stopColor="var(--chart-2)" />
					<stop offset="1" stopColor="var(--chart-1)" />
				</linearGradient>
			</defs>
			<rect width="40" height="40" rx="11" fill="url(#busyq-mark)" />
			<g className="fill-sidebar-accent-foreground">
				<rect x="9" y="10" width="22" height="4.5" rx="2.25" />
				<rect x="9" y="17.75" width="16" height="4.5" rx="2.25" opacity="0.8" />
				<rect x="9" y="25.5" width="10" height="4.5" rx="2.25" opacity="0.6" />
			</g>
			<path
				d="M24.5 27.6l2.6 2.6 5-5.4"
				fill="none"
				strokeWidth="2.6"
				strokeLinecap="round"
				strokeLinejoin="round"
				className="stroke-sidebar-accent-foreground"
			/>
		</svg>
	);
}

export function Wordmark({ className }: { className?: string }) {
	return (
		<span className={cn("flex items-center gap-3", className)}>
			<LogoMark />
			<span className="text-2xl font-semibold tracking-tight">BusyQ</span>
		</span>
	);
}
