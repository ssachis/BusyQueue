import type { ReactNode } from "react";
import { Label } from "#/components/ui/label.tsx";

/** Label, control and field-level error, like the business settings form. */
export function Field({
	id,
	label,
	error,
	hint,
	className,
	children,
}: {
	id: string;
	label: string;
	error?: string;
	hint?: ReactNode;
	className?: string;
	children: ReactNode;
}) {
	return (
		<div className={className ? `space-y-1.5 ${className}` : "space-y-1.5"}>
			<Label htmlFor={id}>{label}</Label>
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

/** Field errors keyed by the first path segment of each zod issue. */
export function issuesToErrors(
	issues: readonly { path: readonly PropertyKey[]; message: string }[],
): Record<string, string> {
	const errors: Record<string, string> = {};
	for (const issue of issues) {
		const key = String(issue.path[0] ?? "");
		errors[key] ??= issue.message;
	}
	return errors;
}

export const selectClassName =
	"h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30";
