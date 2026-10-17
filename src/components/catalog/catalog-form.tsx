import { useNavigate, useRouter } from "@tanstack/react-router";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { PageBody, PageHeader } from "#/components/app-shell.tsx";
import { Field, selectClassName } from "#/components/clients/field.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "#/components/ui/card.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { parseCatalogItem } from "#/lib/clients/index.ts";
import { US_SALES } from "#/lib/tax/index.ts";
import { archiveItem, removeItem, saveItem } from "#/server/catalog.ts";
import type { CatalogFormContext } from "#/server/catalog-store.ts";

type Form = {
	name: string;
	description: string;
	unit: string;
	unitPrice: string;
	currency: string;
	taxCode: string;
	rate: string;
	hsnSac: string;
	code: string;
};
type Key = keyof Form;

function fieldsFrom(ctx: CatalogFormContext): Form {
	const i = ctx.item;
	return {
		name: i?.name ?? "",
		description: i?.description ?? "",
		unit: i?.unit ?? "",
		unitPrice: i?.unitPrice ?? "",
		currency: i?.currency ?? ctx.businessCurrency,
		taxCode: i?.taxCode ?? ctx.taxCodes[0]?.code ?? "",
		rate: i?.rate ?? "",
		hsnSac: i?.hsnSac ?? "",
		code: i?.code ?? "",
	};
}

export function CatalogForm({ ctx }: { ctx: CatalogFormContext }) {
	const { item, businessCountry, taxCodes } = ctx;
	const router = useRouter();
	const navigate = useNavigate();
	const [form, setForm] = useState<Form>(() => fieldsFrom(ctx));
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [busy, setBusy] = useState(false);

	const set = (key: Key, value: string) =>
		setForm((f) => ({ ...f, [key]: value }));
	const usSales = form.taxCode === US_SALES;

	async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
		setBusy(true);
		try {
			return await fn();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Something went wrong");
			return undefined;
		} finally {
			setBusy(false);
		}
	}

	async function onSubmit(e: FormEvent) {
		e.preventDefault();
		// Hidden fields don't apply to this tax code / country.
		const payload = {
			...form,
			rate: usSales ? form.rate : "",
			hsnSac: businessCountry === "IN" ? form.hsnSac : "",
		};
		const local = parseCatalogItem(payload, businessCountry);
		if (!local.ok) {
			setErrors(local.errors);
			return;
		}
		const result = await run(() =>
			saveItem({ data: { id: item?.id ?? null, item: payload } }),
		);
		if (!result) return;
		if (!result.ok) {
			setErrors(result.errors);
			return;
		}
		setErrors({});
		toast.success(item ? "Item saved" : `Added ${result.item.name}`);
		if (item) await router.invalidate();
		else await navigate({ to: "/catalog" });
	}

	async function toggleArchive() {
		if (!item) return;
		const archived = !item.archivedAt;
		const done = await run(() =>
			archiveItem({ data: { id: item.id, archived } }),
		);
		if (!done) return;
		toast.success(archived ? "Item archived" : "Item restored");
		await router.invalidate();
	}

	async function onDelete() {
		if (!item) return;
		if (!window.confirm(`Delete ${item.name}? This can't be undone.`)) return;
		const result = await run(() => removeItem({ data: { id: item.id } }));
		if (!result) return;
		if (!result.deleted) {
			toast.error(result.reason);
			return;
		}
		toast.success("Item deleted");
		await navigate({ to: "/catalog" });
	}

	const input = (
		key: Key,
		label: string,
		props: React.ComponentProps<typeof Input> = {},
		hint?: string,
	) => (
		<Field id={key} label={label} error={errors[key]} hint={hint}>
			<Input
				id={key}
				value={form[key]}
				onChange={(e) => set(key, e.target.value)}
				aria-invalid={errors[key] ? true : undefined}
				aria-describedby={errors[key] ? `${key}-error` : undefined}
				{...props}
			/>
		</Field>
	);

	const used = (item?.useCount ?? 0) > 0;

	return (
		<>
			<PageHeader
				title={
					<span className="flex items-center gap-2">
						{item ? item.name : "New item"}
						{item?.archivedAt ? (
							<Badge variant="warning">Archived</Badge>
						) : null}
					</span>
				}
				description={
					item && used
						? "Used on documents. Edits apply to new lines only."
						: "Defaults for a document line. Every field can still be changed on the line."
				}
			>
				{item ? (
					<>
						<Button
							type="button"
							variant="outline"
							disabled={busy}
							onClick={toggleArchive}
						>
							{item.archivedAt ? <ArchiveRestore /> : <Archive />}
							{item.archivedAt ? "Restore" : "Archive"}
						</Button>
						<Button
							type="button"
							variant="outline"
							disabled={busy || used}
							title={
								used
									? "Items used on documents can only be archived"
									: undefined
							}
							onClick={onDelete}
						>
							<Trash2 />
							Delete
						</Button>
					</>
				) : null}
			</PageHeader>
			<PageBody>
				<form onSubmit={onSubmit} noValidate className="max-w-3xl space-y-6">
					<Card>
						<CardHeader>
							<CardTitle>Item</CardTitle>
						</CardHeader>
						<CardContent className="grid gap-4 sm:grid-cols-2">
							<div className="sm:col-span-2">{input("name", "Name")}</div>
							<Field
								id="description"
								label="Description"
								error={errors.description}
								hint="Added to the line after the name."
								className="sm:col-span-2"
							>
								<Textarea
									id="description"
									rows={2}
									value={form.description}
									onChange={(e) => set("description", e.target.value)}
									aria-invalid={errors.description ? true : undefined}
								/>
							</Field>
							{input("code", "Code / SKU", { className: "font-mono" })}
							{input("unit", "Unit", { placeholder: "meal, tray, hour…" })}
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Price and tax</CardTitle>
							<CardDescription>
								Tax codes are the ones for your business country (
								{businessCountry}).
							</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-4 sm:grid-cols-2">
							{input(
								"unitPrice",
								"Unit price",
								{ inputMode: "decimal", placeholder: "0.00" },
								"Before tax. Use a point for decimals, like 4.25.",
							)}
							{input("currency", "Currency", {
								maxLength: 3,
								className: "uppercase",
							})}
							<Field id="taxCode" label="Tax code" error={errors.taxCode}>
								<select
									id="taxCode"
									value={form.taxCode}
									onChange={(e) => set("taxCode", e.target.value)}
									aria-invalid={errors.taxCode ? true : undefined}
									className={selectClassName}
								>
									{taxCodes.length === 0 ? (
										<option value="">No tax rules for {businessCountry}</option>
									) : null}
									{form.taxCode &&
									!taxCodes.some((c) => c.code === form.taxCode) ? (
										<option value={form.taxCode}>
											{form.taxCode} (not valid for {businessCountry})
										</option>
									) : null}
									{taxCodes.map((c) => (
										<option key={c.code} value={c.code}>
											{c.label}
										</option>
									))}
								</select>
							</Field>
							{usSales
								? input(
										"rate",
										"Sales-tax rate (%)",
										{ inputMode: "decimal", placeholder: "7.25" },
										"Default rate; it can be changed per line.",
									)
								: null}
							{businessCountry === "IN"
								? input("hsnSac", "HSN / SAC", { inputMode: "numeric" })
								: null}
						</CardContent>
					</Card>

					<div className="flex justify-end gap-2">
						<Button
							type="button"
							variant="ghost"
							onClick={() => navigate({ to: "/catalog" })}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={busy}>
							{busy ? "Saving…" : item ? "Save item" : "Add item"}
						</Button>
					</div>
				</form>
			</PageBody>
		</>
	);
}
