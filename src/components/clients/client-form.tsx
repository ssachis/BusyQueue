import { type FormEvent, useState } from "react";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import { BUSINESS_COUNTRIES } from "#/lib/business/profile.ts";
import {
	ClientInput,
	type ClientFormInput,
} from "#/lib/clients/client.ts";

export type ClientFormValues = {
	[K in keyof ClientFormInput]: string;
};

export const emptyClient = (country: string): ClientFormValues => ({
	name: "",
	addressLine1: "",
	addressLine2: "",
	city: "",
	region: "",
	postalCode: "",
	country,
	taxId: "",
	email: "",
	placeOfSupply: "",
});

type Props = {
	initial: ClientFormValues;
	submitLabel: string;
	onSubmit: (client: ClientInput) => Promise<void>;
};

export function ClientForm({ initial, submitLabel, onSubmit }: Props) {
	const [form, setForm] = useState(initial);
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [saving, setSaving] = useState(false);

	const set = (key: keyof ClientFormValues, value: string) =>
		setForm((f) => ({ ...f, [key]: value }));

	async function submit(e: FormEvent) {
		e.preventDefault();
		const parsed = ClientInput.safeParse(form);
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
		key: keyof ClientFormValues,
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
				{field("addressLine1", "Address")}
				{field("addressLine2", "Address line 2")}
				{field("city", "City")}
				{field("region", "State / province", { maxLength: 20 })}
				{field("postalCode", "Postal code")}
				<div className="space-y-1.5">
					<Label htmlFor="country">Country</Label>
					<select
						id="country"
						value={form.country}
						onChange={(e) => set("country", e.target.value)}
						className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
					>
						{Object.entries(BUSINESS_COUNTRIES).map(([code, name]) => (
							<option key={code} value={code}>
								{name}
							</option>
						))}
					</select>
				</div>
				{field("taxId", "Tax ID")}
				{field("email", "Email", { type: "email" })}
				{form.country === "IN"
					? field("placeOfSupply", "Place of supply (state code)", {
							maxLength: 20,
						})
					: null}
			</div>
			<Button type="submit" disabled={saving}>
				{saving ? "Saving…" : submitLabel}
			</Button>
		</form>
	);
}
