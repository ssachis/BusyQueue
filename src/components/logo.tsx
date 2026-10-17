import { cn } from "#/lib/utils.ts";

/** BusyQ mark: the money superhero (public/logo.png). */
export function LogoMark({ className }: { className?: string }) {
	return (
		<img
			src="/logo.png"
			alt="BusyQueue"
			width={40}
			height={40}
			className={cn("size-10 shrink-0 object-contain", className)}
		/>
	);
}

export function Wordmark({ className }: { className?: string }) {
	return (
		<span className={cn("flex items-center gap-3", className)}>
			<LogoMark />
			<span className="text-lg font-semibold tracking-tight">BusyQueue</span>
		</span>
	);
}
