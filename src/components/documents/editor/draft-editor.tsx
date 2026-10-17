/**
 * The draft editor (#15): one form for all six document types, with a live
 * preview beside it. Totals in the preview come from the tax engine via
 * `previewTotals`, recomputed on every change; nothing here does arithmetic.
 *
 * Saved clients (#14) fill the buyer through the picker; catalog items fill
 * lines through the description type-ahead. Issue saves pending edits first
 * and issues only if that save succeeded.
 */
import { useQueryClient } from "@tanstack/react-query";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import { Loader2, Printer, Save, Trash2, UserPlus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PageBody, PageHeader } from "#/components/app-shell.tsx";
import { ClientPicker } from "#/components/clients/client-picker.tsx";
import {
	HistoryPanel,
	historyKey,
} from "#/components/documents/history/history-panel.tsx";
import { IssueButton } from "#/components/documents/issue-button.tsx";
import { DocumentPreview } from "#/components/documents/preview/document-preview.tsx";
import { TYPE_LABEL } from "#/components/documents/preview/format.ts";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "#/components/ui/card.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { ClientInput } from "#/lib/clients/client.ts";
import { DOCUMENT_TYPES } from "#/lib/documents/types.ts";
import { createClientRecord } from "#/server/clients.ts";
import {
	deleteDraftDocument,
	saveDraftDocument,
} from "#/server/documents/drafts.ts";
import type { DocumentPageData } from "#/server/documents/drafts-store.ts";
import { Field, NativeSelect } from "./field.tsx";
import {
	applyClient,
	type BuyerForm,
	clearClient,
	clientInputFromBuyer,
	type DraftForm,
	defaultTaxCode,
	draftCandidate,
	formFromDraft,
	parseDraft,
	previewTotals,
	taxCodeOptions,
} from "./form.ts";
import { LineItems } from "./line-items.tsx";

function initialForm({ document: d, lines }: DocumentPageData): DraftForm {
	return formFromDraft({
		type: d.type,
		date: d.date,
		dueDate: d.dueDate ?? undefined,
		currency: d.currency,
		clientId: d.clientId ?? undefined,
		buyer: { ...d.buyer, addressLines: d.buyer.addressLines ?? [] },
		placeOfSupply: d.placeOfSupply ?? undefined,
		notes: d.notes ?? undefined,
		terms: d.terms ?? undefined,
		lines,
	});
}

export function DraftEditor({ data }: { data: DocumentPageData }) {
	const { document: doc, seller, accentColor } = data;
	const navigate = useNavigate();
	const [form, setForm] = useState<DraftForm>(() => initialForm(data));
	const [saved, setSaved] = useState(() =>
		JSON.stringify(draftCandidate(initialForm(data), seller)),
	);
	const [showErrors, setShowErrors] = useState(false);
	const [busy, setBusy] = useState<
		"save" | "delete" | "client" | "print" | null
	>(null);
	const queryClient = useQueryClient();

	const india = seller.country === "IN";
	const candidate = useMemo(() => draftCandidate(form, seller), [form, seller]);
	const dirty = JSON.stringify(candidate) !== saved;
	const parsed = useMemo(() => parseDraft(form, seller), [form, seller]);
	const errors = showErrors && !parsed.ok ? parsed.errors : {};
	const totals = useMemo(
		() => previewTotals(seller, candidate),
		[seller, candidate],
	);
	const taxOptions = useMemo(
		() => taxCodeOptions(seller, form.buyer),
		[seller, form.buyer],
	);

	const set = <K extends keyof DraftForm>(key: K, value: DraftForm[K]) =>
		setForm((f) => ({ ...f, [key]: value }));
	const setBuyer = <K extends keyof BuyerForm>(key: K, value: string) =>
		setForm((f) => ({ ...f, buyer: { ...f.buyer, [key]: value } }));

	useBlocker({
		shouldBlockFn: () =>
			busy === null &&
			dirty &&
			!window.confirm("You have unsaved changes. Leave without saving?"),
		enableBeforeUnload: () => dirty,
	});

	/**
	 * Save the form. Resolves true when the server has exactly what's on
	 * screen (saved now, or nothing changed), false when it doesn't.
	 */
	const save = useCallback(
		async ({ quiet = false }: { quiet?: boolean } = {}): Promise<boolean> => {
			if (!parsed.ok) {
				setShowErrors(true);
				toast.error("Fix the highlighted fields before saving");
				return false;
			}
			if (!dirty) {
				if (!quiet) toast.success("Already saved");
				return true;
			}
			setBusy("save");
			try {
				await saveDraftDocument({
					data: { id: doc.id, draft: parsed.draft },
				});
				setSaved(JSON.stringify(candidate));
				setShowErrors(false);
				if (!quiet) toast.success("Draft saved");
				void queryClient.invalidateQueries({ queryKey: historyKey(doc.id) });
				return true;
			} catch (err) {
				toast.error(err instanceof Error ? err.message : "Could not save");
				return false;
			} finally {
				setBusy(null);
			}
		},
		[parsed, candidate, dirty, doc.id, queryClient],
	);

	/** Issue runs this first: what gets issued is what's on screen. */
	const saveBeforeIssue = useCallback(() => save({ quiet: true }), [save]);

	/** Print preview reads the saved draft, so save first, then open it. */
	async function printPreview() {
		const url = `/print/${encodeURIComponent(doc.id)}`;
		if (!dirty) {
			window.open(url, "_blank", "noopener");
			return;
		}
		// Open the tab inside the click (popup blockers), point it once saved.
		const tab = window.open("about:blank", "_blank");
		setBusy("print");
		const ok = await save({ quiet: true });
		setBusy(null);
		if (!ok) {
			tab?.close();
			return;
		}
		if (tab) tab.location.href = url;
		else window.open(url, "_blank", "noopener");
	}

	/** "Save as client": a buyer typed by hand becomes a saved client. */
	async function saveAsClient() {
		const input = ClientInput.safeParse(
			clientInputFromBuyer(form.buyer, india ? form.placeOfSupply : ""),
		);
		if (!input.success) {
			setShowErrors(true);
			const first = input.error.issues[0];
			toast.error(
				first
					? `Can't save the client: ${first.path.join(".") || "buyer"}: ${first.message}`
					: "Can't save the client",
			);
			return;
		}
		setBusy("client");
		try {
			const id = await createClientRecord({ data: input.data });
			setForm((f) => ({ ...f, clientId: id }));
			await queryClient.invalidateQueries({ queryKey: ["clients"] });
			toast.success(`Saved ${input.data.name} as a client`);
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : "Could not save the client",
			);
		} finally {
			setBusy(null);
		}
	}

	// Cmd/Ctrl+S saves.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
				e.preventDefault();
				void save();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [save]);

	async function remove() {
		if (!window.confirm("Delete this draft? This can't be undone.")) return;
		setBusy("delete");
		try {
			await deleteDraftDocument({ data: { id: doc.id } });
			toast.success("Draft deleted");
			await navigate({ to: "/documents" });
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Could not delete");
			setBusy(null);
		}
	}

	const typeLabel = TYPE_LABEL[form.type];

	return (
		<>
			<PageHeader
				title={
					<span className="flex items-center gap-3">
						{typeLabel} draft
						<Badge variant="outline">Draft</Badge>
					</span>
				}
				description={
					dirty ? (
						<span className="text-warning">Unsaved changes</span>
					) : (
						"All changes saved. Drafts have no number until they are issued."
					)
				}
			>
				<Button
					variant="ghost"
					onClick={remove}
					disabled={busy !== null}
					className="text-muted-foreground hover:text-destructive"
				>
					{busy === "delete" ? (
						<Loader2 className="animate-spin" />
					) : (
						<Trash2 />
					)}
					Delete
				</Button>
				<Button
					variant="outline"
					onClick={printPreview}
					disabled={busy !== null}
					title="Opens the print layout in a new tab (saves first)"
				>
					{busy === "print" ? (
						<Loader2 className="animate-spin" />
					) : (
						<Printer />
					)}
					Print preview
				</Button>
				<Button
					variant={dirty ? "default" : "outline"}
					onClick={() => void save()}
					disabled={busy !== null}
				>
					{busy === "save" ? <Loader2 className="animate-spin" /> : <Save />}
					Save draft
				</Button>
				<IssueButton
					documentId={doc.id}
					status={doc.status}
					beforeIssue={saveBeforeIssue}
					disabled={busy === "delete" || busy === "client"}
				/>
			</PageHeader>
			<PageBody>
				<div className="grid items-start gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
					<form
						className="min-w-0 space-y-6"
						onSubmit={(e) => {
							e.preventDefault();
							void save();
						}}
					>
						<Card className="gap-4">
							<CardHeader>
								<CardTitle>Details</CardTitle>
							</CardHeader>
							<CardContent className="grid gap-4 sm:grid-cols-2">
								<Field id="type" label="Document type">
									<NativeSelect
										id="type"
										value={form.type}
										onChange={(e) =>
											set("type", e.target.value as DraftForm["type"])
										}
									>
										{DOCUMENT_TYPES.map((t) => (
											<option key={t} value={t}>
												{TYPE_LABEL[t]}
											</option>
										))}
									</NativeSelect>
								</Field>
								<Field id="currency" label="Currency" error={errors.currency}>
									<Input
										id="currency"
										value={form.currency}
										maxLength={3}
										aria-invalid={errors.currency ? true : undefined}
										onChange={(e) =>
											set("currency", e.target.value.toUpperCase())
										}
									/>
								</Field>
								<Field id="date" label="Date" error={errors.date}>
									<Input
										id="date"
										type="date"
										value={form.date}
										aria-invalid={errors.date ? true : undefined}
										onChange={(e) => set("date", e.target.value)}
									/>
								</Field>
								<Field
									id="dueDate"
									label={form.type === "quote" ? "Valid until" : "Due date"}
									error={errors.dueDate}
								>
									<Input
										id="dueDate"
										type="date"
										value={form.dueDate}
										min={form.date || undefined}
										aria-invalid={errors.dueDate ? true : undefined}
										onChange={(e) => set("dueDate", e.target.value)}
									/>
								</Field>
							</CardContent>
						</Card>

						<Card className="gap-4">
							<CardHeader>
								<CardTitle>Bill to</CardTitle>
								<CardDescription>
									Pick a saved client or type the buyer. Printed on the document
									as entered; the country and region decide the tax.
								</CardDescription>
								{!form.clientId && form.buyer.name.trim() !== "" ? (
									<CardAction>
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={saveAsClient}
											disabled={busy !== null}
										>
											{busy === "client" ? (
												<Loader2 className="animate-spin" />
											) : (
												<UserPlus />
											)}
											Save as client
										</Button>
									</CardAction>
								) : null}
							</CardHeader>
							<CardContent className="grid gap-4 sm:grid-cols-2">
								<div className="sm:col-span-2">
									<ClientPicker
										clientId={form.clientId}
										linkedName={form.buyer.name}
										disabled={busy !== null}
										onPick={(client) => {
											setForm((f) => applyClient(f, client));
										}}
										onClear={() =>
											setForm((f) => clearClient(f, seller.country))
										}
									/>
								</div>
								<Field
									id="buyer-name"
									label="Name"
									error={errors["buyer.name"]}
									className="sm:col-span-2"
								>
									<Input
										id="buyer-name"
										value={form.buyer.name}
										placeholder="Client or organisation"
										aria-invalid={errors["buyer.name"] ? true : undefined}
										onChange={(e) => setBuyer("name", e.target.value)}
									/>
								</Field>
								<Field
									id="buyer-address"
									label="Address (one line per row, up to 4)"
									error={
										errors["buyer.addressLines"] ??
										Object.entries(errors).find(([k]) =>
											k.startsWith("buyer.addressLines."),
										)?.[1]
									}
									className="sm:col-span-2"
								>
									<Textarea
										id="buyer-address"
										rows={2}
										value={form.buyer.addressLines}
										onChange={(e) => setBuyer("addressLines", e.target.value)}
									/>
								</Field>
								<Field
									id="buyer-city"
									label="City"
									error={errors["buyer.city"]}
								>
									<Input
										id="buyer-city"
										value={form.buyer.city}
										onChange={(e) => setBuyer("city", e.target.value)}
									/>
								</Field>
								<Field
									id="buyer-region"
									label={india ? "State code" : "State / province"}
									error={errors["buyer.region"]}
									hint={
										india
											? "2-digit GST code, e.g. 27"
											: seller.country === "CA"
												? "e.g. ON, QC, BC"
												: undefined
									}
								>
									<Input
										id="buyer-region"
										value={form.buyer.region}
										onChange={(e) => setBuyer("region", e.target.value)}
									/>
								</Field>
								<Field
									id="buyer-postal"
									label="Postal code"
									error={errors["buyer.postalCode"]}
								>
									<Input
										id="buyer-postal"
										value={form.buyer.postalCode}
										onChange={(e) => setBuyer("postalCode", e.target.value)}
									/>
								</Field>
								<Field
									id="buyer-country"
									label="Country"
									error={errors["buyer.country"]}
									hint="2-letter code, e.g. US"
								>
									<Input
										id="buyer-country"
										value={form.buyer.country}
										maxLength={2}
										aria-invalid={errors["buyer.country"] ? true : undefined}
										onChange={(e) =>
											setBuyer("country", e.target.value.toUpperCase())
										}
									/>
								</Field>
								<Field
									id="buyer-taxid"
									label="Tax ID"
									error={errors["buyer.taxId"]}
								>
									<Input
										id="buyer-taxid"
										value={form.buyer.taxId}
										placeholder={india ? "GSTIN" : "VAT / GST / EIN"}
										onChange={(e) => setBuyer("taxId", e.target.value)}
									/>
								</Field>
								<Field
									id="buyer-email"
									label="Email"
									error={errors["buyer.email"]}
								>
									<Input
										id="buyer-email"
										type="email"
										value={form.buyer.email}
										aria-invalid={errors["buyer.email"] ? true : undefined}
										onChange={(e) => setBuyer("email", e.target.value)}
									/>
								</Field>
								{india ? (
									<Field
										id="place-of-supply"
										label="Place of supply"
										error={errors.placeOfSupply}
										hint="GST state code. Leave blank to use the buyer's state."
									>
										<Input
											id="place-of-supply"
											value={form.placeOfSupply}
											placeholder={form.buyer.region || "27"}
											onChange={(e) => set("placeOfSupply", e.target.value)}
										/>
									</Field>
								) : null}
							</CardContent>
						</Card>

						<Card className="gap-4">
							<CardHeader>
								<CardTitle>Lines</CardTitle>
								<CardDescription>
									Prices are before tax. Discounts are an amount off the line.
								</CardDescription>
							</CardHeader>
							<CardContent>
								<LineItems
									lines={form.lines}
									onChange={(lines) => set("lines", lines)}
									taxOptions={taxOptions}
									defaultTaxCode={defaultTaxCode(seller.country, taxOptions)}
									sellerCountry={seller.country}
									currency={form.currency}
									errors={errors}
								/>
							</CardContent>
						</Card>

						<Card className="gap-4">
							<CardHeader>
								<CardTitle>Notes and terms</CardTitle>
							</CardHeader>
							<CardContent className="grid gap-4">
								<Field id="notes" label="Notes" error={errors.notes}>
									<Textarea
										id="notes"
										rows={2}
										value={form.notes}
										placeholder="Shown to the client, e.g. a thank-you or delivery details"
										onChange={(e) => set("notes", e.target.value)}
									/>
								</Field>
								<Field id="terms" label="Terms" error={errors.terms}>
									<Textarea
										id="terms"
										rows={2}
										value={form.terms}
										placeholder="Payment terms, bank details"
										onChange={(e) => set("terms", e.target.value)}
									/>
								</Field>
							</CardContent>
						</Card>
						{/* Lets Enter in a field submit (save) the form. */}
						<button type="submit" hidden aria-hidden tabIndex={-1} />
					</form>

					<aside className="min-w-0 space-y-2 xl:sticky xl:top-6">
						<p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
							Live preview
						</p>
						<DocumentPreview
							doc={{
								...candidate,
								status: "draft",
								number: null,
								seller,
							}}
							totals={totals}
							accentColor={accentColor}
						/>
						<div className="pt-4">
							<HistoryPanel documentId={doc.id} hideWhenQuiet />
						</div>
					</aside>
				</div>
			</PageBody>
		</>
	);
}
