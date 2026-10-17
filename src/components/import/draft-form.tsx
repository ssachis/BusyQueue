import { Plus, Trash2 } from "lucide-react";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import {
	type DraftLine,
	type HeaderField,
	type ImportDraft,
	type LineField,
	linePath,
} from "#/lib/import/extraction.ts";
import { cn } from "#/lib/utils.ts";

const HEADER: { field: HeaderField; label: string; placeholder?: string }[] = [
	{ field: "vendor", label: "Vendor (as printed)" },
	{ field: "invoiceNumber", label: "Invoice number" },
	{ field: "issueDate", label: "Issue date", placeholder: "YYYY-MM-DD" },
	{ field: "dueDate", label: "Due date", placeholder: "YYYY-MM-DD or empty" },
	{ field: "currency", label: "Currency", placeholder: "USD" },
	{ field: "statedTotal", label: "Total (as printed)", placeholder: "0.00" },
];

const COLUMNS: { field: LineField; label: string; className: string }[] = [
	{ field: "item", label: "Item", className: "min-w-40" },
	{ field: "quantity", label: "Qty", className: "w-24 text-right" },
	{ field: "unit", label: "Unit", className: "w-24" },
	{ field: "unitPrice", label: "Unit price", className: "w-28 text-right" },
	{ field: "amount", label: "Amount", className: "w-28 text-right" },
];

const EMPTY_LINE: DraftLine = {
	item: "",
	quantity: "",
	unit: "",
	unitPrice: "",
	amount: "",
};

/** Uncertain fields get the warning treatment; invalid ones use aria-invalid (destructive). */
function fieldClass(uncertain: boolean) {
	return cn(
		uncertain &&
			"border-warning bg-warning/10 ring-[3px] ring-warning/25 dark:bg-warning/10",
	);
}

export function DraftForm({
	draft,
	onChange,
	onRemoveLine,
	uncertain,
	issues,
	disabled,
}: {
	draft: ImportDraft;
	/** `path` is the edited field, so the page can clear its flag. */
	onChange: (draft: ImportDraft, path: string) => void;
	onRemoveLine: (index: number) => void;
	uncertain: ReadonlySet<string>;
	issues: Record<string, string>;
	disabled?: boolean;
}) {
	const setHeader = (field: HeaderField, value: string) =>
		onChange({ ...draft, [field]: value }, field);
	const setLine = (index: number, field: LineField, value: string) =>
		onChange(
			{
				...draft,
				lines: draft.lines.map((l, i) =>
					i === index ? { ...l, [field]: value } : l,
				),
			},
			linePath(index, field),
		);

	return (
		<div className="space-y-6">
			<div className="grid gap-4 sm:grid-cols-2">
				{HEADER.map(({ field, label, placeholder }) => {
					const flagged = uncertain.has(field);
					return (
						<div key={field} className="space-y-1.5">
							<Label
								htmlFor={`f-${field}`}
								className="flex items-center gap-1.5"
							>
								{label}
								{flagged ? (
									<span className="text-xs font-normal text-warning">
										check this
									</span>
								) : null}
							</Label>
							<Input
								id={`f-${field}`}
								value={draft[field]}
								placeholder={placeholder}
								disabled={disabled}
								onChange={(e) => setHeader(field, e.target.value)}
								aria-invalid={issues[field] ? true : undefined}
								className={fieldClass(flagged)}
							/>
							{issues[field] ? (
								<p className="text-xs text-destructive">{issues[field]}</p>
							) : null}
						</div>
					);
				})}
			</div>

			<div className="space-y-2">
				<div className="flex items-center justify-between">
					<h3 className="text-sm font-medium">Lines</h3>
					{issues.lines ? (
						<p className="text-xs text-destructive">{issues.lines}</p>
					) : null}
				</div>
				<div className="overflow-x-auto rounded-md border">
					<table className="w-full text-sm">
						<thead className="bg-muted/50 text-left text-xs text-muted-foreground">
							<tr>
								<th className="w-8 px-2 py-2 font-medium">#</th>
								{COLUMNS.map((c) => (
									<th
										key={c.field}
										className={cn("px-2 py-2 font-medium", c.className)}
									>
										{c.label}
									</th>
								))}
								<th className="w-10" />
							</tr>
						</thead>
						<tbody>
							{draft.lines.map((line, i) => (
								<tr
									// biome-ignore lint/suspicious/noArrayIndexKey: lines are positional (line numbers)
									key={i}
									className="border-t align-top"
								>
									<td className="px-2 py-2.5 text-muted-foreground">{i + 1}</td>
									{COLUMNS.map((c) => {
										const path = linePath(i, c.field);
										return (
											<td key={c.field} className="px-1 py-1.5">
												<Input
													aria-label={`Line ${i + 1} ${c.label}`}
													title={issues[path]}
													value={line[c.field]}
													disabled={disabled}
													onChange={(e) => setLine(i, c.field, e.target.value)}
													aria-invalid={issues[path] ? true : undefined}
													className={cn(
														"h-8",
														c.className.includes("text-right") &&
															"text-right tabular-nums",
														fieldClass(uncertain.has(path)),
													)}
												/>
											</td>
										);
									})}
									<td className="px-1 py-1.5">
										<Button
											type="button"
											variant="ghost"
											size="icon-sm"
											disabled={disabled}
											aria-label={`Remove line ${i + 1}`}
											onClick={() => onRemoveLine(i)}
										>
											<Trash2 />
										</Button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={disabled}
					onClick={() =>
						onChange({ ...draft, lines: [...draft.lines, EMPTY_LINE] }, "lines")
					}
				>
					<Plus />
					Add line
				</Button>
			</div>
		</div>
	);
}
