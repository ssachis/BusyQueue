import { Plus, Trash2 } from "lucide-react";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import {
	type DocImportForm,
	EMPTY_LINE,
	type LineField,
	linePath,
	type SellerContext,
} from "#/lib/doc-import/form.ts";
import { formatMoney } from "#/lib/money/index.ts";
import {
	type TaxCodeOption,
	type TaxResult,
	taxCodes,
} from "#/lib/tax/index.ts";
import { cn } from "#/lib/utils.ts";
import { type FieldState, flagClass, selectClass } from "./field.tsx";

interface Column {
	field: Exclude<LineField, "taxCode" | "printedRate">;
	label: string;
	className: string;
	numeric?: boolean;
}

/** Tax codes for the seller; Canada's label depends on the buyer's province. */
function codeOptions(seller: SellerContext, region: string): TaxCodeOption[] {
	try {
		return taxCodes(
			seller.country,
			seller.country === "CA" && region ? region.toUpperCase() : undefined,
		);
	} catch {
		return taxCodes(seller.country);
	}
}

export function LinesTable({
	form,
	seller,
	totals,
	state,
	onChange,
	onRemoveLine,
	disabled,
}: {
	form: DocImportForm;
	seller: SellerContext;
	/** Engine totals, when the form is valid enough to compute them. */
	totals: TaxResult | null;
	state: (path: string) => FieldState;
	onChange: (form: DocImportForm, path: string) => void;
	onRemoveLine: (index: number) => void;
	disabled?: boolean;
}) {
	const columns: Column[] = [
		{ field: "description", label: "Description", className: "min-w-56" },
		{ field: "quantity", label: "Qty", className: "min-w-20", numeric: true },
		{ field: "unit", label: "Unit", className: "min-w-20" },
		{
			field: "unitPrice",
			label: "Unit price",
			className: "min-w-24",
			numeric: true,
		},
		{
			field: "discount",
			label: "Discount",
			className: "min-w-24",
			numeric: true,
		},
	];
	const after: Column[] = [
		...(seller.country === "US"
			? [
					{
						field: "rate",
						label: "Rate %",
						className: "min-w-20",
						numeric: true,
					} as Column,
				]
			: []),
		...(seller.country === "IN"
			? [{ field: "hsnSac", label: "HSN/SAC", className: "min-w-24" } as Column]
			: []),
		{
			field: "printedAmount",
			label: "Printed amount",
			className: "min-w-28",
			numeric: true,
		},
	];
	const options = codeOptions(seller, form.buyer.region);
	const setLine = (index: number, field: LineField, value: string) =>
		onChange(
			{
				...form,
				lines: form.lines.map((l, i) =>
					i === index ? { ...l, [field]: value } : l,
				),
			},
			linePath(index, field),
		);

	const cell = (i: number, c: Column) => {
		const path = linePath(i, c.field);
		const s = state(path);
		const line = form.lines[i];
		const off = c.field === "rate" && line.taxCode !== "US-SALES";
		return (
			<td key={c.field} className="px-1 py-1.5">
				<Input
					aria-label={`Line ${i + 1} ${c.label}`}
					title={s.issue ?? s.reason}
					value={off ? "" : line[c.field]}
					disabled={disabled || off}
					onChange={(e) => setLine(i, c.field, e.target.value)}
					aria-invalid={s.issue ? true : undefined}
					className={cn(
						"h-8",
						c.numeric && "text-right tabular-nums",
						flagClass(s.flagged),
					)}
				/>
			</td>
		);
	};

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<h3 className="text-sm font-medium">Lines</h3>
				{state("lines").issue ? (
					<p className="text-xs text-destructive">{state("lines").issue}</p>
				) : null}
			</div>
			<div className="overflow-x-auto rounded-md border">
				<table className="w-full min-w-[72rem] text-sm">
					<thead className="bg-muted/50 text-left text-xs text-muted-foreground">
						<tr>
							<th className="w-8 px-2 py-2 font-medium">#</th>
							{columns.map((c) => (
								<th
									key={c.field}
									className={cn(
										"px-2 py-2 font-medium",
										c.className,
										c.numeric && "text-right",
									)}
								>
									{c.label}
								</th>
							))}
							<th className="min-w-48 px-2 py-2 font-medium">Tax code</th>
							{after.map((c) => (
								<th
									key={c.field}
									className={cn(
										"px-2 py-2 font-medium",
										c.className,
										c.numeric && "text-right",
									)}
								>
									{c.label}
								</th>
							))}
							<th className="w-28 px-2 py-2 text-right font-medium">
								Computed net
							</th>
							<th className="w-10" />
						</tr>
					</thead>
					<tbody>
						{form.lines.map((line, i) => {
							const tax = state(linePath(i, "taxCode"));
							const net = totals?.lines[i];
							return (
								<tr
									// biome-ignore lint/suspicious/noArrayIndexKey: lines are positional (line numbers)
									key={i}
									className="border-t align-top"
								>
									<td className="px-2 py-2.5 text-muted-foreground">{i + 1}</td>
									{columns.map((c) => cell(i, c))}
									<td className="px-1 py-1.5">
										<select
											aria-label={`Line ${i + 1} tax code`}
											title={tax.issue ?? tax.reason}
											value={line.taxCode}
											disabled={disabled}
											onChange={(e) => setLine(i, "taxCode", e.target.value)}
											aria-invalid={tax.issue ? true : undefined}
											className={cn(selectClass, "h-8", flagClass(tax.flagged))}
										>
											<option value="" disabled>
												Pick a code…
											</option>
											{options.map((o) => (
												<option key={o.code} value={o.code}>
													{o.label}
												</option>
											))}
										</select>
										{line.printedRate || (tax.flagged && tax.reason) ? (
											<p
												className={cn(
													"mt-1 text-xs",
													tax.flagged
														? "text-warning"
														: "text-muted-foreground",
												)}
											>
												{tax.flagged && tax.reason
													? tax.reason
													: `Printed ${line.printedRate}`}
											</p>
										) : null}
									</td>
									{after.map((c) => cell(i, c))}
									<td className="px-2 py-2.5 text-right tabular-nums text-muted-foreground">
										{net
											? formatMoney({
													minor: net.netMinor,
													currency: totals.currency,
												})
											: "–"}
									</td>
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
							);
						})}
					</tbody>
				</table>
			</div>
			<Button
				type="button"
				variant="outline"
				size="sm"
				disabled={disabled}
				onClick={() =>
					onChange(
						{
							...form,
							lines: [
								...form.lines,
								{ ...EMPTY_LINE, taxCode: options.at(-1)?.code ?? "" },
							],
						},
						"lines",
					)
				}
			>
				<Plus />
				Add line
			</Button>
		</div>
	);
}
