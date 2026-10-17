import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { PageBody, PageHeader } from "#/components/app-shell.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "#/components/ui/card.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import {
	BUSINESS_COUNTRIES,
	BusinessProfile,
	type BusinessProfileInput,
} from "#/lib/business/profile.ts";
import { getBusiness, updateBusiness } from "#/server/business.ts";

export const Route = createFileRoute("/settings/business")({
	loader: () => getBusiness(),
	component: BusinessSettings,
});

type Form = {
	[K in keyof BusinessProfileInput]: K extends "taxIds"
		? { type: string; value: string }[]
		: string;
};

const fieldsFrom = (b: Awaited<ReturnType<typeof getBusiness>>): Form => ({
	legalName: b.legalName,
	addressLine1: b.addressLine1 ?? "",
	addressLine2: b.addressLine2 ?? "",
	city: b.city ?? "",
	region: b.region ?? "",
	postalCode: b.postalCode ?? "",
	country: b.country,
	currency: b.currency,
	taxIds: b.taxIds,
	logoUrl: b.logoUrl ?? "",
	accentColor: b.accentColor ?? "#2563eb",
});

function BusinessSettings() {
	const business = Route.useLoaderData();
	const router = useRouter();
	const [form, setForm] = useState<Form>(() => fieldsFrom(business));
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [saving, setSaving] = useState(false);

	const set = <K extends keyof Form>(key: K, value: Form[K]) =>
		setForm((f) => ({ ...f, [key]: value }));

	async function onSubmit(e: FormEvent) {
		e.preventDefault();
		const parsed = BusinessProfile.safeParse(form);
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
			const saved = await updateBusiness({ data: form });
			setForm(fieldsFrom(saved));
			await router.invalidate();
			toast.success("Business profile saved");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Could not save");
		} finally {
			setSaving(false);
		}
	}

	const field = (
		key: Exclude<keyof Form, "taxIds" | "country">,
		label: string,
		props: React.ComponentProps<typeof Input> = {},
	) => (
		<div className="space-y-1.5">
			<Label htmlFor={key}>{label}</Label>
			<Input
				id={key}
				value={form[key]}
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
		<>
			<PageHeader
				title="Business profile"
				description="Who your documents come from. Printed on every invoice, quote and credit note."
			/>
			<PageBody>
				<form onSubmit={onSubmit} className="max-w-3xl space-y-6">
					<Card>
						<CardHeader>
							<CardTitle>Identity</CardTitle>
							<CardDescription>
								Legal name and where you are registered. The country decides
								which tax rules apply.
							</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-4 sm:grid-cols-2">
							<div className="sm:col-span-2">
								{field("legalName", "Legal name")}
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="country">Country</Label>
								<select
									id="country"
									value={form.country}
									onChange={(e) => set("country", e.target.value)}
									className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
								>
									{Object.entries(BUSINESS_COUNTRIES).map(([code, name]) => (
										<option key={code} value={code}>
											{name}
										</option>
									))}
								</select>
							</div>
							{field("currency", "Currency", { maxLength: 3 })}
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Address</CardTitle>
						</CardHeader>
						<CardContent className="grid gap-4 sm:grid-cols-2">
							<div className="sm:col-span-2">
								{field("addressLine1", "Address line 1")}
							</div>
							<div className="sm:col-span-2">
								{field("addressLine2", "Address line 2")}
							</div>
							{field("city", "City")}
							{field("region", "State / province / region")}
							{field("postalCode", "Postal code")}
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Tax registrations</CardTitle>
							<CardDescription>
								GSTIN, VAT, ABN, TRN, GST/HST and so on. Printed on documents.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-3">
							{form.taxIds.map((t, i) => (
								<div
									// biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity until saved
									key={i}
									className="flex items-end gap-2"
								>
									<div className="w-32 space-y-1.5">
										<Label htmlFor={`tax-type-${i}`}>Type</Label>
										<Input
											id={`tax-type-${i}`}
											value={t.type}
											onChange={(e) =>
												set(
													"taxIds",
													form.taxIds.map((x, j) =>
														j === i ? { ...x, type: e.target.value } : x,
													),
												)
											}
										/>
									</div>
									<div className="flex-1 space-y-1.5">
										<Label htmlFor={`tax-value-${i}`}>Number</Label>
										<Input
											id={`tax-value-${i}`}
											value={t.value}
											onChange={(e) =>
												set(
													"taxIds",
													form.taxIds.map((x, j) =>
														j === i ? { ...x, value: e.target.value } : x,
													),
												)
											}
										/>
									</div>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										aria-label="Remove tax registration"
										onClick={() =>
											set(
												"taxIds",
												form.taxIds.filter((_, j) => j !== i),
											)
										}
									>
										<Trash2 />
									</Button>
								</div>
							))}
							{Object.entries(errors)
								.filter(([k]) => k.startsWith("taxIds"))
								.map(([k, msg]) => (
									<p key={k} className="text-xs text-destructive">
										{msg}
									</p>
								))}
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={form.taxIds.length >= 5}
								onClick={() =>
									set("taxIds", [...form.taxIds, { type: "", value: "" }])
								}
							>
								<Plus />
								Add registration
							</Button>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Branding</CardTitle>
							<CardDescription>Used by the print layouts.</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-4 sm:grid-cols-2">
							<div className="sm:col-span-2">
								{field("logoUrl", "Logo URL", {
									placeholder: "https://…",
									type: "url",
								})}
							</div>
							<div className="space-y-1.5">
								<Label htmlFor="accentColor">Accent colour</Label>
								<div className="flex items-center gap-2">
									<input
										type="color"
										aria-label="Pick accent colour"
										value={form.accentColor}
										onChange={(e) => set("accentColor", e.target.value)}
										className="size-9 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-1"
									/>
									<Input
										id="accentColor"
										value={form.accentColor}
										onChange={(e) => set("accentColor", e.target.value)}
										aria-invalid={errors.accentColor ? true : undefined}
									/>
								</div>
								{errors.accentColor ? (
									<p className="text-xs text-destructive">
										{errors.accentColor}
									</p>
								) : null}
							</div>
						</CardContent>
					</Card>

					<div className="flex justify-end">
						<Button type="submit" disabled={saving}>
							{saving ? "Saving…" : "Save profile"}
						</Button>
					</div>
				</form>
			</PageBody>
		</>
	);
}
