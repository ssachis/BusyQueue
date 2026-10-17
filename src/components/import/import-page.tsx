import {
	Check,
	CopyPlus,
	Loader2,
	RotateCcw,
	Save,
	TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import type {
	ExistingInvoice,
	ImportErrorResponse,
	ImportResponse,
	SavedImport,
	StoredImport,
} from "#/lib/import/api.ts";
import {
	type ImportDraft,
	pathsWithoutLine,
	validateDraft,
} from "#/lib/import/extraction.ts";
import { saveImport } from "#/server/imports.ts";
import { DraftForm } from "./draft-form.tsx";
import { RunPanel } from "./run-panel.tsx";
import { UploadPanel } from "./upload-panel.tsx";

interface Preview {
	url: string;
	type: string;
	name: string;
}

export function ImportPage({ stored }: { stored?: StoredImport | null }) {
	const [reading, setReading] = useState(false);
	const [error, setError] = useState<ImportErrorResponse | null>(() =>
		stored && !stored.result
			? {
					error: stored.error ?? "This document has not been read yet.",
					importId: stored.importId,
				}
			: null,
	);
	const [preview, setPreview] = useState<Preview | null>(() =>
		stored?.result
			? {
					url: stored.fileUrl,
					type: stored.result.contentType,
					name: stored.result.filename,
				}
			: null,
	);
	const [result, setResult] = useState<ImportResponse | null>(
		stored?.result ?? null,
	);
	const [draft, setDraft] = useState<ImportDraft | null>(
		stored?.result?.draft ?? null,
	);
	const [uncertain, setUncertain] = useState<Set<string>>(
		() => new Set(stored?.saved ? [] : (stored?.result?.uncertain ?? [])),
	);
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState<SavedImport | null>(stored?.saved ?? null);
	/** Set when the server refused the save: same vendor and number on file. */
	const [refused, setRefused] = useState<ExistingInvoice[] | null>(null);

	useEffect(
		() => () =>
			preview?.url.startsWith("blob:")
				? URL.revokeObjectURL(preview.url)
				: undefined,
		[preview],
	);

	const issues = useMemo(() => (draft ? validateDraft(draft) : {}), [draft]);
	const issueCount = Object.keys(issues).length;

	function reset() {
		setError(null);
		setResult(null);
		setDraft(null);
		setUncertain(new Set());
		setSaved(null);
		setRefused(null);
		setPreview(null);
	}

	async function upload(file: File) {
		reset();
		setPreview({
			url: URL.createObjectURL(file),
			type: file.type,
			name: file.name,
		});
		setReading(true);
		try {
			const body = new FormData();
			body.set("file", file);
			const res = await fetch("/api/imports", { method: "POST", body });
			const json = (await res.json().catch(() => ({
				error: `Upload failed (${res.status})`,
			}))) as ImportResponse | ImportErrorResponse;
			if (!res.ok || "error" in json) {
				setError(json as ImportErrorResponse);
				return;
			}
			setResult(json);
			setDraft(json.draft);
			setUncertain(new Set(json.uncertain));
		} catch (e) {
			setError({ error: e instanceof Error ? e.message : "Upload failed" });
		} finally {
			setReading(false);
		}
	}

	function edit(next: ImportDraft, path: string) {
		setDraft(next);
		// A new vendor or number needs a fresh duplicate check on save.
		if (path === "vendor" || path === "invoiceNumber") setRefused(null);
		if (uncertain.has(path)) {
			setUncertain((u) => new Set([...u].filter((p) => p !== path)));
		}
	}

	function removeLine(index: number) {
		if (!draft) return;
		setDraft({ ...draft, lines: draft.lines.filter((_, i) => i !== index) });
		setUncertain((u) => new Set(pathsWithoutLine(u, index)));
	}

	async function save(allowDuplicate = false) {
		if (!result || !draft || issueCount > 0) return;
		setSaving(true);
		try {
			const out = await saveImport({
				data: { importId: result.importId, draft, allowDuplicate },
			});
			if (out.status === "duplicate") {
				setRefused(out.existing);
				toast.error(
					"Not saved: this vendor and invoice number are already on file",
				);
				return;
			}
			setSaved(out);
			setRefused(null);
			setUncertain(new Set());
			toast.success(`Saved as ${out.invoiceId}`);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "Could not save");
		} finally {
			setSaving(false);
		}
	}

	const toCheck = [...uncertain].filter((p) => !issues[p]).length;
	const duplicates = refused ?? result?.existing ?? [];

	return (
		<>
			<PageHeader
				title="Import a vendor invoice"
				description="Upload a photo or PDF. A vision model reads it through Nicrron and copies every printed value; nothing is calculated or corrected. You check the flagged fields, save, and let the agent audit it."
			>
				{result || error ? (
					<Button
						variant="outline"
						onClick={reset}
						disabled={reading || saving}
					>
						<RotateCcw />
						Start over
					</Button>
				) : null}
			</PageHeader>
			<PageBody className="space-y-6">
				{!result ? <UploadPanel busy={reading} onFile={upload} /> : null}

				{error ? (
					<Card className="border-destructive/40">
						<CardContent className="flex items-start gap-3 text-sm">
							<TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
							<div className="space-y-1">
								<p className="font-medium text-destructive">{error.error}</p>
								{error.prismTraceId ? (
									<p className="text-muted-foreground">
										PRISM trace {error.prismTraceId}
									</p>
								) : null}
							</div>
						</CardContent>
					</Card>
				) : null}

				{result && draft ? (
					<div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
						<Card className="h-fit gap-3 py-4 lg:sticky lg:top-4">
							<CardHeader className="px-4">
								<CardTitle className="truncate text-sm">
									{result.filename}
								</CardTitle>
							</CardHeader>
							<CardContent className="px-4">
								{preview ? (
									result.contentType === "application/pdf" ? (
										<iframe
											src={preview.url}
											title={`Uploaded document ${preview.name}`}
											className="h-[70vh] w-full rounded-md border"
										/>
									) : (
										<img
											src={preview.url}
											alt={`Uploaded invoice ${preview.name}`}
											className="w-full rounded-md border"
										/>
									)
								) : null}
							</CardContent>
						</Card>

						<div className="space-y-6">
							<Card>
								<CardHeader>
									<CardTitle>Check what was read</CardTitle>
									<CardDescription className="space-y-2">
										<span className="flex flex-wrap items-center gap-2">
											<Badge variant="outline">Read by {result.model}</Badge>
											{result.fallbackUsed ? (
												<Badge variant="info">
													Nicrron fell back from {result.requestedModel}
												</Badge>
											) : null}
											{toCheck > 0 ? (
												<Badge variant="warning">
													{toCheck} field{toCheck === 1 ? "" : "s"} to check
												</Badge>
											) : null}
											{issueCount > 0 ? (
												<Badge variant="destructive">
													{issueCount} to fix before saving
												</Badge>
											) : null}
										</span>
										{result.notes ? (
											<span className="block">Model note: {result.notes}</span>
										) : null}
									</CardDescription>
								</CardHeader>
								<CardContent className="space-y-6">
									{duplicates.length && !saved ? (
										<div
											role={refused ? "alert" : undefined}
											className={
												refused
													? "space-y-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
													: "space-y-3 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm"
											}
										>
											<div className="flex items-start gap-2">
												<TriangleAlert
													className={
														refused
															? "mt-0.5 size-4 shrink-0 text-destructive"
															: "mt-0.5 size-4 shrink-0 text-warning"
													}
												/>
												<span>
													{refused ? (
														<span className="font-medium">Not saved. </span>
													) : null}
													{draft.vendor || "This vendor"} invoice{" "}
													{draft.invoiceNumber} is already on file as{" "}
													{duplicates.map((e, i) => (
														<span key={e.id}>
															{i > 0 ? ", " : ""}
															<a
																href={`/review?invoice=${encodeURIComponent(e.id)}`}
																className="font-medium underline underline-offset-4"
															>
																{e.id}
															</a>{" "}
															({e.vendor} {e.invoiceNumber})
														</span>
													))}
													. Saving it again would count the same bill twice, so
													saving is refused. If this really is a different bill,
													save it as a separate copy.
												</span>
											</div>
											<div className="flex justify-end">
												<Button
													variant="outline"
													size="sm"
													onClick={() => save(true)}
													disabled={saving || issueCount > 0}
												>
													<CopyPlus />
													Save anyway as a separate copy
												</Button>
											</div>
										</div>
									) : null}
									<DraftForm
										draft={draft}
										onChange={edit}
										onRemoveLine={removeLine}
										uncertain={uncertain}
										issues={issues}
										disabled={saving || saved !== null}
									/>
									<div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
										<p className="text-xs text-muted-foreground">
											PRISM session {result.importId}
										</p>
										<div className="flex flex-wrap gap-2">
											{toCheck > 0 && !saved ? (
												<Button
													variant="outline"
													onClick={() =>
														setUncertain(
															new Set([...uncertain].filter((p) => issues[p])),
														)
													}
												>
													<Check />
													All checked
												</Button>
											) : null}
											<Button
												onClick={() => save()}
												disabled={saving || saved !== null || issueCount > 0}
											>
												{saving ? (
													<Loader2 className="animate-spin" />
												) : (
													<Save />
												)}
												{saved ? "Saved" : "Save invoice"}
											</Button>
										</div>
									</div>
								</CardContent>
							</Card>

							{saved ? <RunPanel saved={saved} /> : null}
						</div>
					</div>
				) : null}
			</PageBody>
		</>
	);
}
