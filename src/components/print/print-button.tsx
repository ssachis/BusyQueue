/**
 * "Print / PDF" link for a document (#19). Opens the print page in a new
 * tab; the editor page can mount it next to the Issue button.
 */
import { Link } from "@tanstack/react-router";
import { Printer } from "lucide-react";
import { buttonVariants } from "#/components/ui/button.tsx";
import type { PrintLayout } from "#/lib/print/model.ts";
import { cn } from "#/lib/utils.ts";

export interface PrintButtonProps {
	documentId: string;
	/** Preselect a layout; the print page defaults to classic. */
	layout?: PrintLayout;
	className?: string;
}

export function PrintButton({
	documentId,
	layout,
	className,
}: PrintButtonProps) {
	return (
		<Link
			to="/print/$id"
			params={{ id: documentId }}
			search={layout ? { layout } : {}}
			target="_blank"
			rel="noopener"
			className={cn(
				buttonVariants({ variant: "outline", size: "sm" }),
				className,
			)}
		>
			<Printer />
			Print / PDF
		</Link>
	);
}
