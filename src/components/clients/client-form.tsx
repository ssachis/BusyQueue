import { useNavigate, useRouter } from "@tanstack/react-router";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { PageBody, PageHeader } from "#/components/app-shell.tsx";
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
import { ClientInput, MAX_ADDRESS_LINES } from "#/lib/clients/index.ts";
import { archiveClient, removeClient, saveClient } from "#/server/clients.ts";
import type { ClientListRow } from "#/server/clients-store.ts";
import { Field, issuesToErrors } from "./field.tsx";

type Form = {
	name: string;
	addressLines: string;
	city: string;
	region: string;
	postalCode: string;
	country: string;
	taxId: string;
	email: string;
	placeOfSupply: string;
	currency: string;
	notes: string;
};
type Key = keyof Form;

function fieldsFrom(
	client: ClientListRow | null,
	defaults: { country: string; currency: string },
): Form {
	return {
		name: client?.name ?? "",
		addressLines: client?.addressLines.join("\n") ?? "",
		city: client?.city ?? "",
		region: client?.region ?? "",
		postalCode: client?.postalCode ?? "",
		country: client?.country ?? defaults.country,
		taxId: client?.taxId ?? "",
		email: client?.email ?? "",
		placeOfSupply: client?.placeOfSupply ?? "",
		currency: client ? (client.currency ?? "") : defaults.currency,
		notes: client?.notes ?? "",
	};
}

export function ClientForm({
	client,
	businessCountry,
	businessCurrency,
}: {
	client: ClientListRow | null;
	businessCountry: string;
	businessCurrency: string;
}) {
	const router = useRouter();
	const navigate = useNavigate();
	const [form, setForm] = useState<Form>(() =>
		fieldsFrom(client, {
			country: businessCountry,
			currency: businessCurrency,
		}),
	);
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [busy, setBusy] = useState(false);

	const set = (key: Key, value: string) =>
		setForm((f) => ({ ...f, [key]: value }));

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
		const parsed = ClientInput.safeParse(form);
		if (!parsed.success) {
			setErrors(issuesToErrors(parsed.error.issues));
			return;
		}
		setErrors({});
		const saved = await run(() =>
			saveClient({ data: { id: client?.id ?? null, client: form } }),
		);
		if (!saved) return;
		toast.success(client ? "Client saved" : `Added ${saved.name}`);
		if (client) await router.invalidate();
		else await navigate({ to: "/clients" });
	}

	async function toggleArchive() {
		if (!client) return;
		const archived = !client.archivedAt;
		const done = await run(() =>
			archiveClient({ data: { id: client.id, archived } }),
		);
		if (!done) return;
		toast.success(archived ? "Client archived" : "Client restored");
		await router.invalidate();
	}

	async function onDelete() {
		if (!client) return;
		if (!window.confirm(`Delete ${client.name}? This can't be undone.`)) return;
		const result = await run(() => removeClient({ data: { id: client.id } }));
		if (!result) return;
		if (!result.deleted) {
			toast.error(result.reason);
			await router.invalidate();
			return;
		}
		toast.success("Client deleted");
		await navigate({ to: "/clients" });
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

	const hasHistory = (client?.documentCount ?? 0) > 0;

	return (
		<>
			<PageHeader
				title={
					<span className="flex items-center gap-2">
						{client ? client.name : "New client"}
						{client?.archivedAt ? (
							<Badge variant="warning">Archived</Badge>
						) : null}
					</span>
				}
				description={
					client
						? hasHistory
							? `On ${client.documentCount} document${client.documentCount === 1 ? "" : "s"}. Edits apply to new documents; issued ones keep the details they were issued with.`
							: "Not on any document yet."
						: "Saved clients fill the buyer on invoices, quotes and other documents."
				}
			>
				{client ? (
					<>
						<Button
							type="button"
							variant="outline"
							disabled={busy}
							onClick={toggleArchive}
						>
							{client.archivedAt ? <ArchiveRestore /> : <Archive />}
							{client.archivedAt ? "Restore" : "Archive"}
						</Button>
						<Button
							type="button"
							variant="outline"
							disabled={busy || hasHistory}
							title={
								hasHistory
									? "Clients with documents can only be archived"
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
							<CardTitle>Client</CardTitle>
						</CardHeader>
						<CardContent className="grid gap-4 sm:grid-cols-2">
							<div className="sm:col-span-2">{input("name", "Name")}</div>
							{input("email", "Email", { type: "email" })}
							{input(
								"taxId",
								"Tax ID",
								{},
								"GSTIN, VAT ID, ABN, EIN… Decides B2B tax rules.",
							)}
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Address</CardTitle>
						</CardHeader>
						<CardContent className="grid gap-4 sm:grid-cols-2">
							<Field
								id="addressLines"
								label="Street address"
								error={errors.addressLines}
								hint={`One line per row, up to ${MAX_ADDRESS_LINES}.`}
								className="sm:col-span-2"
							>
								<Textarea
									id="addressLines"
									rows={3}
									value={form.addressLines}
									onChange={(e) => set("addressLines", e.target.value)}
									aria-invalid={errors.addressLines ? true : undefined}
								/>
							</Field>
							{input("city", "City")}
							{input(
								"region",
								"State / province / region",
								{},
								businessCountry === "IN"
									? "GST state code, like 27"
									: undefined,
							)}
							{input("postalCode", "Postal code")}
							{input(
								"country",
								"Country",
								{
									maxLength: 2,
									className: "uppercase",
								},
								"2-letter code, like US, GB, IN",
							)}
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Defaults</CardTitle>
							<CardDescription>
								Filled in when you pick this client on a new document.
							</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-4 sm:grid-cols-2">
							{input(
								"currency",
								"Currency",
								{ maxLength: 3, className: "uppercase" },
								"Leave blank to use your business currency.",
							)}
							{businessCountry === "IN"
								? input(
										"placeOfSupply",
										"Place of supply",
										{ maxLength: 2, inputMode: "numeric" },
										"GST state code; defaults to the client's state.",
									)
								: null}
							<Field
								id="notes"
								label="Notes"
								error={errors.notes}
								className="sm:col-span-2"
							>
								<Textarea
									id="notes"
									rows={3}
									value={form.notes}
									onChange={(e) => set("notes", e.target.value)}
								/>
							</Field>
						</CardContent>
					</Card>

					<div className="flex justify-end gap-2">
						<Button
							type="button"
							variant="ghost"
							onClick={() => navigate({ to: "/clients" })}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={busy}>
							{busy ? "Saving…" : client ? "Save client" : "Add client"}
						</Button>
					</div>
				</form>
			</PageBody>
		</>
	);
}
