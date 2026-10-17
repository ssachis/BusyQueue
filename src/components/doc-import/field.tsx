import type { ReactNode } from "react";
import { Label } from "#/components/ui/label.tsx";
import { cn } from "#/lib/utils.ts";

/** What the review screen knows about one field. */
export interface FieldState {
	/** A person should check it (model unsure, guessed, invalid, or doesn't add up). */
	flagged: boolean;
	/** Can't be saved as it is. */
	issue?: string;
	/** Why it's flagged, or a note on how it was read. */
	reason?: string;
}

/** Flagged fields get the warning treatment; invalid ones use aria-invalid (destructive). */
export function flagClass(flagged: boolean) {
	return cn(
		flagged &&
			"border-warning bg-warning/10 ring-[3px] ring-warning/25 dark:bg-warning/10",
	);
}

export const selectClass =
	"h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive dark:bg-input/30";

export function Field({
	id,
	label,
	state,
	className,
	children,
}: {
	id: string;
	label: string;
	state: FieldState;
	className?: string;
	children: ReactNode;
}) {
	return (
		<div className={cn("space-y-1.5", className)}>
			<Label htmlFor={id} className="flex items-center gap-1.5">
				{label}
				{state.flagged ? (
					<span className="text-xs font-normal text-warning">check this</span>
				) : null}
			</Label>
			{children}
			{state.issue ? (
				<p className="text-xs text-destructive">{state.issue}</p>
			) : state.reason ? (
				<p
					className={cn(
						"text-xs",
						state.flagged ? "text-warning" : "text-muted-foreground",
					)}
				>
					{state.reason}
				</p>
			) : null}
		</div>
	);
}
