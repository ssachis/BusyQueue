/**
 * On-screen controls for the print page (#19): layout, paper size and the
 * browser's Print / Save as PDF. Hidden when printing (`data-print-hidden`).
 */
import { Link } from "@tanstack/react-router";
import { Printer } from "lucide-react";
import { Button } from "#/components/ui/button.tsx";
import {
	LAYOUT_LABELS,
	PAPER_SIZES,
	type PaperSize,
	PRINT_LAYOUTS,
	type PrintLayout,
} from "#/lib/print/model.ts";
import { PAPER_DIMENSIONS } from "#/lib/print/page-css.ts";
import { cn } from "#/lib/utils.ts";

function Segment<T extends string>({
	label,
	options,
	current,
	text,
	search,
	documentId,
}: {
	label: string;
	options: readonly T[];
	current: T;
	text: (v: T) => string;
	search: (v: T) => { layout?: PrintLayout; paper?: PaperSize };
	documentId: string;
}) {
	return (
		<fieldset className="flex items-center gap-2">
			<legend className="sr-only">{label}</legend>
			<span className="text-xs font-medium text-muted-foreground">{label}</span>
			<div className="inline-flex rounded-md border bg-background p-0.5">
				{options.map((option) => (
					<Link
						key={option}
						to="/print/$id"
						params={{ id: documentId }}
						search={search(option)}
						replace
						aria-current={option === current ? "true" : undefined}
						className={cn(
							"rounded px-2.5 py-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
							option === current
								? "bg-primary text-primary-foreground"
								: "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
						)}
					>
						{text(option)}
					</Link>
				))}
			</div>
		</fieldset>
	);
}

export function PrintToolbar({
	documentId,
	title,
	layout,
	paper,
}: {
	documentId: string;
	title: string;
	layout: PrintLayout;
	paper: PaperSize;
}) {
	return (
		<div
			data-print-hidden
			className="sticky top-0 z-20 flex flex-wrap items-center gap-x-6 gap-y-3 border-b bg-background/90 px-4 py-3 backdrop-blur md:px-8"
		>
			<p className="mr-auto min-w-0 truncate text-sm font-medium">{title}</p>
			<Segment
				label="Layout"
				options={PRINT_LAYOUTS}
				current={layout}
				text={(l) => LAYOUT_LABELS[l]}
				search={(l) => ({ layout: l, paper })}
				documentId={documentId}
			/>
			<Segment
				label="Paper"
				options={PAPER_SIZES}
				current={paper}
				text={(p) => PAPER_DIMENSIONS[p].label}
				search={(p) => ({ layout, paper: p })}
				documentId={documentId}
			/>
			<Button type="button" onClick={() => window.print()}>
				<Printer />
				Print / Save as PDF
			</Button>
		</div>
	);
}
