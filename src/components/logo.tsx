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
			className={cn("size-9 shrink-0", className)}
		>
			<rect width="40" height="40" rx="10" className="fill-sidebar-foreground" />
			<g className="fill-sidebar">
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
				className="stroke-sidebar"
			/>
		</svg>
	);
}

export function Wordmark({ className }: { className?: string }) {
	return (
		<span className={cn("flex items-center gap-3", className)}>
			<LogoMark />
			<span className="font-serif text-3xl tracking-tight">BusyQ</span>
		</span>
	);
}
