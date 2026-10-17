import { type FormEvent, useState } from "react";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import {
	type CatalogItemFormInput,
	CatalogItemInput,
} from "#/lib/catalog/item.ts";

export type ItemFormValues = {
	[K in keyof CatalogItemFormInput]: string;
};

export const emptyItem = (taxCode: string): ItemFormValues => ({
	code: "",
	name: "",
	unitPrice: "",
	unit: "",
	taxCode,
	rate: "",
	hsnSac: "",
});

type Props = {
	initial: ItemFormValues;
	submitLabel: string;
	/** Tax codes valid for the business's country. */
	taxOptions: { code: string; label: string }[];
	onSubmit: (item: CatalogItemInput) => Promise<void>;
};

export function ItemForm({
	initial,
	submitLabel,
	taxOptions,
	onSubmit,
}: Props) {
	const [form, setForm] = useState(initial);
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [saving, setSaving] = useState(false);

	const set = (key: keyof ItemFormValues, value: string) =>
		setForm((f) => ({ ...f, [key]: value }));

	async function submit(e: FormEvent) {
		e.preventDefault();
		const parsed = CatalogItemInput.safeParse(form);
		if (!parsed.success) {
			setErrors(
				Object.fromEntries(
					parsed.error.issues.map((i) => [i.path.join("."), i.message]),
				),
			);
			return;
		}
		setErrors({});
		setSaving(true);
		try {
			await onSubmit(parsed.data);
		} finally {
			setSaving(false);
		}
	}

	const field = (
		key: keyof ItemFormValues,
		label: string,
		props: React.ComponentProps<typeof Input> = {},
	) => (
		<div className="space-y-1.5">
			<Label htmlFor={key}>{label}</Label>
			<Input
				id={key}
				value={form[key] ?? ""}
				onChange={(e) => set(key, e.target.value)}
				aria-invalid={errors[key] ? true : undefined}
				{...props}
			/>
			{errors[key] ? (
				<p className="text-xs text-destructive">{errors[key]}</p>
			) : null}
		</div>
	);

	return (
		<form onSubmit={submit} className="max-w-3xl space-y-6">
			<div className="grid gap-4 sm:grid-cols-2">
				<div className="sm:col-span-2">{field("name", "Name")}</div>
				{field("code", "Code", { placeholder: "DM-001" })}
				{field("unit", "Unit", { placeholder: "case" })}
				{field("unitPrice", "Unit price", { inputMode: "decimal" })}
				<div className="space-y-1.5">
					<Label htmlFor="taxCode">Tax</Label>
					<select
						id="taxCode"
						value={form.taxCode}
						onChange={(e) => set("taxCode", e.target.value)}
						className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
					>
						{taxOptions.map((o) => (
							<option key={o.code} value={o.code}>
								{o.label}
							</option>
						))}
					</select>
				</div>
				{form.taxCode === "US-SALES"
					? field("rate", "Sales tax %", { inputMode: "decimal" })
					: null}
				{field("hsnSac", "HSN / SAC")}
			</div>
			<Button type="submit" disabled={saving}>
				{saving ? "Saving…" : submitLabel}
			</Button>
		</form>
	);
}
