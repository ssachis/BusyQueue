import {
	Check,
	CircleCheck,
	FilePlus2,
	Loader2,
	RotateCcw,
	TriangleAlert,
	UserRound,
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
	CreatedDraft,
	DocImportErrorResponse,
	DocImportResponse,
} from "#/lib/doc-import/api.ts";
import { label as typeLabel } from "#/lib/doc-import/classify.ts";
import { type DocImportForm, pathsWithoutLine } from "#/lib/doc-import/form.ts";
import {
	checkTotals,
	formTotals,
	validateForm,
} from "#/lib/doc-import/validate.ts";
import type { DocumentType } from "#/lib/documents/types.ts";
import { createImportedDraft } from "#/server/doc-import/functions.ts";
import { DocumentFields } from "./document-fields.tsx";
import type { FieldState } from "./field.tsx";
import { LinesTable } from "./lines-table.tsx";
import { TotalsCheck } from "./totals-check.tsx";
import { DocUploadPanel } from "./upload-panel.tsx";

interface Preview {
	url: string;
	type: string;
	name: string;
}

export function DocImportPage() {
	const [reading, setReading] = useState(false);
	const [error, setError] = useState<DocImportErrorResponse | null>(null);
	const [preview, setPreview] = useState<Preview | null>(null);
	const [result, setResult] = useState<DocImportResponse | null>(null);
	const [form, setForm] = useState<DocImportForm | null>(null);
	const [uncertain, setUncertain] = useState<Set<string>>(new Set());
	const [creating, setCreating] = useState(false);
	const [created, setCreated] = useState<CreatedDraft | null>(null);

	useEffect(
		() => () => (preview ? URL.revokeObjectURL(preview.url) : undefined),
		[preview],
	);

	const seller = result?.seller;
	const issues = useMemo(
		() => (form && seller ? validateForm(form, seller) : {}),
		[form, seller],
	);
	const totals = useMemo(
		() => (form && seller ? formTotals(form, seller) : null),
		[form, seller],
	);
	const mismatches = useMemo(
		() =>
			form && totals?.ok ? checkTotals(form, totals.result).mismatches : {},
		[form, totals],
	);
	const issueCount = Object.keys(issues).length;
	const toCheck = [...uncertain].filter(
		(p) => !issues[p] && !mismatches[p],
	).length;
	const mismatchCount = Object.keys(mismatches).length;

	const state = (path: string): FieldState => ({
		flagged: uncertain.has(path) || Boolean(mismatches[path]),
		issue: issues[path],
		reason: mismatches[path] ?? result?.reasons[path],
	});

	function reset() {
		setError(null);
		setResult(null);
		setForm(null);
		setUncertain(new Set());
		setCreated(null);
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
			const res = await fetch("/api/document-imports", {
				method: "POST",
				body,
			});
			const json = (await res.json().catch(() => ({
				error: `Upload failed (${res.status})`,
			}))) as DocImportResponse | DocImportErrorResponse;
			if (!res.ok || "error" in json) {
				setError(json as DocImportErrorResponse);
				return;
			}
			setResult(json);
			setForm(json.form);
			setUncertain(new Set(json.uncertain));
		} catch (e) {
			setError({ error: e instanceof Error ? e.message : "Upload failed" });
		} finally {
			setReading(false);
		}
	}

	function edit(next: DocImportForm, path: string) {
		setForm(next);
		if (uncertain.has(path)) {
			setUncertain((u) => new Set([...u].filter((p) => p !== path)));
		}
	}

	function removeLine(index: number) {
		if (!form) return;
		setForm({ ...form, lines: form.lines.filter((_, i) => i !== index) });
		setUncertain((u) => new Set(pathsWithoutLine(u, index)));
	}

	async function create() {
		if (!result || !form || issueCount > 0) return;
		setCreating(true);
		try {
			const out = await createImportedDraft({
				data: { importId: result.importId, form },
			});
			setCreated(out);
			setUncertain(new Set());
			toast.success(
				out.existing ? "This import already has a draft" : "Draft created",
			);
		} catch (e) {
			toast.error(
				e instanceof Error ? e.message : "Could not create the draft",
			);
		} finally {
			setCreating(false);
		}
	}

	const locked = creating || created !== null;

	return (
		<>
			<PageHeader
				title="Import a paper document"
				description="Photograph a quote, invoice or receipt you wrote by hand or printed. A vision model reads it through Nicrron and copies what's written; code maps the tax codes and computes the totals, and flags anything that doesn't add up. You check it and create an editable draft."
			>
				{result || error ? (
					<Button
						variant="outline"
						onClick={reset}
						disabled={reading || creating}
					>
						<RotateCcw />
						Start over
					</Button>
				) : null}
			</PageHeader>
			<PageBody className="space-y-6">
				{!result ? <DocUploadPanel busy={reading} onFile={upload} /> : null}

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

				{result && form && seller ? (
					<div className="grid gap-6 xl:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
						<Card className="h-fit gap-3 py-4 xl:sticky xl:top-4">
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
											alt={`Uploaded document ${preview.name}`}
											className="w-full rounded-md border"
										/>
									)
								) : null}
							</CardContent>
						</Card>

						<div className="space-y-6">
							{created ? (
								<Card className="border-success/40">
									<CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
										<span className="flex items-center gap-2">
											<CircleCheck className="size-4 text-success" />
											<span>
												Draft{" "}
												{typeLabel(form.type as DocumentType).toLowerCase()}{" "}
												created
												{created.corrected.length
													? ` with ${created.corrected.length} correction${created.corrected.length === 1 ? "" : "s"}`
													: ""}
												. It has no number until it's issued.
											</span>
										</span>
										<Button asChild>
											<a href={`/documents/${created.documentId}`}>
												Open in the editor
											</a>
										</Button>
									</CardContent>
								</Card>
							) : null}

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
											{mismatchCount > 0 ? (
												<Badge variant="warning">Totals don't add up</Badge>
											) : totals?.ok ? (
												<Badge variant="success">Totals add up</Badge>
											) : null}
											{issueCount > 0 ? (
												<Badge variant="destructive">
													{issueCount} to fix before creating
												</Badge>
											) : null}
										</span>
										{result.client ? (
											<span className="flex items-center gap-1.5">
												<UserRound className="size-3.5" />
												Matched saved client {result.client.name}
											</span>
										) : null}
										{result.legibility ? (
											<span className="block">
												Model note: {result.legibility}
											</span>
										) : null}
									</CardDescription>
								</CardHeader>
								<CardContent className="space-y-8">
									<DocumentFields
										form={form}
										seller={seller}
										state={state}
										onChange={edit}
										disabled={locked}
									/>
									<LinesTable
										form={form}
										seller={seller}
										totals={totals?.ok ? totals.result : null}
										state={state}
										onChange={edit}
										onRemoveLine={removeLine}
										disabled={locked}
									/>
									{totals ? (
										<TotalsCheck
											form={form}
											totals={totals}
											mismatches={mismatches}
											state={state}
											onChange={edit}
											disabled={locked}
										/>
									) : null}
									<div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
										<p className="text-xs text-muted-foreground">
											PRISM session {result.importId}
										</p>
										<div className="flex flex-wrap gap-2">
											{toCheck > 0 && !created ? (
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
												onClick={create}
												disabled={locked || issueCount > 0}
											>
												{creating ? (
													<Loader2 className="animate-spin" />
												) : (
													<FilePlus2 />
												)}
												{created ? "Draft created" : "Create draft"}
											</Button>
										</div>
									</div>
								</CardContent>
							</Card>
						</div>
					</div>
				) : null}
			</PageBody>
		</>
	);
}
