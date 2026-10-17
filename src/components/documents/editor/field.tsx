import type { ComponentProps, ReactNode } from "react";
import { Label } from "#/components/ui/label.tsx";
import { cn } from "#/lib/utils.ts";

/** Label + control + inline error, the editor's one field layout. */
export function Field({
	id,
	label,
	error,
	hint,
	className,
	children,
}: {
	id: string;
	label: ReactNode;
	error?: string;
	hint?: ReactNode;
	className?: string;
	children: ReactNode;
}) {
	return (
		<div className={cn("min-w-0 space-y-1.5", className)}>
			<Label htmlFor={id} className="text-xs text-muted-foreground">
				{label}
			</Label>
			{children}
			{error ? (
				<p id={`${id}-error`} className="text-xs text-destructive">
					{error}
				</p>
			) : hint ? (
				<p className="text-xs text-muted-foreground">{hint}</p>
			) : null}
		</div>
	);
}

/** A native <select> styled like the Input primitive. */
export function NativeSelect({
	className,
	...props
}: ComponentProps<"select">) {
	return (
		<select
			className={cn(
				"h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30",
				className,
			)}
			{...props}
		/>
	);
}
