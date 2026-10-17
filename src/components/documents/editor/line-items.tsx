import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import type { TaxCodeOption } from "#/lib/tax/index.ts";
import { US_SALES } from "#/lib/tax/index.ts";
import { Field, NativeSelect } from "./field.tsx";
import {
	blankLine,
	type LineForm,
	moveLine,
	removeLine,
	updateLine,
} from "./form.ts";

const MAX_LINES = 200;

export function LineItems({
	lines,
	onChange,
	taxOptions,
	defaultTaxCode,
	sellerCountry,
	errors,
}: {
	lines: LineForm[];
	onChange: (lines: LineForm[]) => void;
	taxOptions: TaxCodeOption[];
	defaultTaxCode: string;
	sellerCountry: string;
	errors: Record<string, string>;
}) {
	const india = sellerCountry === "IN";

	const add = () => {
		// Carry the previous line's tax code forward: lines usually share one.
		const code = lines.at(-1)?.taxCode ?? defaultTaxCode;
		const rate = code === US_SALES ? (lines.at(-1)?.rate ?? "") : "";
		onChange([...lines, { ...blankLine(lines, code), rate }]);
	};

	return (
		<div className="space-y-3">
			{lines.length === 0 ? (
				<p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
					No lines yet. Add what you are billing for.
				</p>
			) : null}
			<ol className="space-y-3">
				{lines.map((line, i) => (
					<LineRow
						key={line.key}
						index={i}
						count={lines.length}
						line={line}
						india={india}
						taxOptions={taxOptions}
						sellerCountry={sellerCountry}
						errors={errors}
						onPatch={(patch) => onChange(updateLine(lines, i, patch))}
						onMove={(to) => onChange(moveLine(lines, i, to))}
						onRemove={() => onChange(removeLine(lines, i))}
					/>
				))}
			</ol>
			<Button
				type="button"
				variant="outline"
				size="sm"
				onClick={add}
				disabled={lines.length >= MAX_LINES}
			>
				<Plus />
				Add line
			</Button>
		</div>
	);
}

function LineRow({
	index,
	count,
	line,
	india,
	taxOptions,
	sellerCountry,
	errors,
	onPatch,
	onMove,
	onRemove,
}: {
	index: number;
	count: number;
	line: LineForm;
	india: boolean;
	taxOptions: TaxCodeOption[];
	sellerCountry: string;
	errors: Record<string, string>;
	onPatch: (patch: Partial<LineForm>) => void;
	onMove: (to: number) => void;
	onRemove: () => void;
}) {
	const id = (field: string) => `line-${line.key}-${field}`;
	const err = (field: string) => errors[`lines.${index}.${field}`];
	const invalid = (field: string) => (err(field) ? true : undefined);
	const options = taxOptions.some((o) => o.code === line.taxCode)
		? taxOptions
		: [
				...taxOptions,
				{
					code: line.taxCode,
					label: line.taxCode
						? `${line.taxCode} (not valid for ${sellerCountry})`
						: "Choose a tax code",
					rate: "",
				},
			];
	const usSales = line.taxCode === US_SALES;

	return (
		<li className="rounded-lg border bg-background p-3">
			<div className="flex items-start gap-2">
				<span className="mt-7 w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
					{index + 1}
				</span>
				<Field
					id={id("description")}
					label="Description"
					error={err("description")}
					className="flex-1"
				>
					{/* #14: the catalog type-ahead attaches to this input. */}
					<Input
						id={id("description")}
						value={line.description}
						placeholder="What you are billing for"
						aria-invalid={invalid("description")}
						onChange={(e) => onPatch({ description: e.target.value })}
					/>
				</Field>
				<div className="mt-6 flex shrink-0 items-center">
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label={`Move line ${index + 1} up`}
						disabled={index === 0}
						onClick={() => onMove(index - 1)}
					>
						<ArrowUp />
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label={`Move line ${index + 1} down`}
						disabled={index === count - 1}
						onClick={() => onMove(index + 1)}
					>
						<ArrowDown />
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label={`Remove line ${index + 1}`}
						onClick={onRemove}
						className="text-muted-foreground hover:text-destructive"
					>
						<Trash2 />
					</Button>
				</div>
			</div>
			<div className="mt-3 grid grid-cols-2 gap-3 pl-7 sm:grid-cols-4">
				<Field id={id("quantity")} label="Quantity" error={err("quantity")}>
					<Input
						id={id("quantity")}
						inputMode="decimal"
						value={line.quantity}
						aria-invalid={invalid("quantity")}
						onChange={(e) => onPatch({ quantity: e.target.value })}
						className="text-right tabular-nums"
					/>
				</Field>
				<Field id={id("unit")} label="Unit" error={err("unit")}>
					<Input
						id={id("unit")}
						value={line.unit}
						placeholder="case, lb, hr"
						aria-invalid={invalid("unit")}
						onChange={(e) => onPatch({ unit: e.target.value })}
					/>
				</Field>
				<Field id={id("unitPrice")} label="Unit price" error={err("unitPrice")}>
					<Input
						id={id("unitPrice")}
						inputMode="decimal"
						value={line.unitPrice}
						placeholder="0.00"
						aria-invalid={invalid("unitPrice")}
						onChange={(e) => onPatch({ unitPrice: e.target.value })}
						className="text-right tabular-nums"
					/>
				</Field>
				<Field id={id("discount")} label="Discount" error={err("discount")}>
					<Input
						id={id("discount")}
						inputMode="decimal"
						value={line.discount}
						placeholder="0.00"
						aria-invalid={invalid("discount")}
						onChange={(e) => onPatch({ discount: e.target.value })}
						className="text-right tabular-nums"
					/>
				</Field>
				<Field
					id={id("taxCode")}
					label="Tax"
					error={err("taxCode")}
					className="col-span-2"
				>
					<NativeSelect
						id={id("taxCode")}
						value={line.taxCode}
						aria-invalid={invalid("taxCode")}
						onChange={(e) => onPatch({ taxCode: e.target.value })}
					>
						{options.map((o) => (
							<option key={o.code} value={o.code} disabled={o.code === ""}>
								{o.label}
							</option>
						))}
					</NativeSelect>
				</Field>
				{usSales ? (
					<Field id={id("rate")} label="Sales tax %" error={err("rate")}>
						<Input
							id={id("rate")}
							inputMode="decimal"
							value={line.rate}
							placeholder="7.25"
							aria-invalid={invalid("rate")}
							onChange={(e) => onPatch({ rate: e.target.value })}
							className="text-right tabular-nums"
						/>
					</Field>
				) : null}
				{india ? (
					<Field id={id("hsnSac")} label="HSN / SAC" error={err("hsnSac")}>
						<Input
							id={id("hsnSac")}
							value={line.hsnSac}
							placeholder="9963"
							aria-invalid={invalid("hsnSac")}
							onChange={(e) => onPatch({ hsnSac: e.target.value })}
						/>
					</Field>
				) : null}
			</div>
		</li>
	);
}
