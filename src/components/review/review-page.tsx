import { getRouteApi, useRouter } from "@tanstack/react-router";
import { Check, Loader2, Play, Sparkles, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageBody } from "#/components/app-shell.tsx";
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
import { Label } from "#/components/ui/label.tsx";
import { Separator } from "#/components/ui/separator.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import type { AgentVersion } from "#/lib/busyq/types.ts";
import { formatMoney, toMinor } from "#/lib/money/index.ts";
import { cn } from "#/lib/utils.ts";
import { approve, runAgentOn, saveDraft } from "#/server/review.ts";
import type {
	InvoiceDetail,
	InvoiceRow,
	ReviewSummary,
} from "#/server/review-store.ts";
import { CashflowChart } from "./cashflow-chart.tsx";

const route = getRouteApi("/");

const KIND_LABEL: Record<string, string> = {
	overcharge: "Overcharge",
	duplicate_line: "Duplicate line",
	wrong_total: "Wrong total",
	duplicate_payment: "Duplicate payment",
	orphan_payment: "Payment with no invoice",
};

/** Same text on server and client (no time-zone-dependent rendering). */
const utc = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const money = (minor: number, currency = "USD") =>
	formatMoney({ minor, currency });

type RowStatus = {
	label: string;
	variant: "destructive" | "warning" | "success" | "info" | "outline";
};

function rowStatus(r: InvoiceRow): RowStatus {
	if (!r.run) return { label: "Not run", variant: "outline" };
	if (r.run.status === "failed")
		return { label: "Run failed", variant: "destructive" };
	if (r.run.status === "running") return { label: "Running", variant: "info" };
	if (r.run.approved) return { label: "Approved", variant: "info" };
	if (r.run.totalMinor > 0) return { label: "Flagged", variant: "destructive" };
	if (r.run.failedTools > 0)
		return { label: "Price check failed", variant: "warning" };
	if (!r.run.toolLogged)
		return { label: "Re-run for details", variant: "outline" };
	return { label: "Clean", variant: "success" };
}

export function ReviewPage() {
	const { summary, detail, invoiceId } = route.useLoaderData();
	const v = route.useSearch().v ?? "v1";
	const navigate = route.useNavigate();
	const { totals, currency } = summary;

	const setVersion = (next: AgentVersion) =>
		navigate({ search: (s) => ({ ...s, v: next }) });
	const select = (id: string) =>
		navigate({ search: (s) => ({ ...s, invoice: id }) });

	return (
		<>
			<PageBody className="space-y-8">
				<header className="grid items-center gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
					<div className="space-y-5">
						<div className="flex flex-wrap items-center justify-between gap-3">
							<p className="text-sm text-muted-foreground">
								Northfield Unified School District · {totals.run} of{" "}
								{totals.invoices} invoices checked
							</p>
							<fieldset className="flex items-center gap-1 rounded-full border bg-card p-1">
								<legend className="sr-only">Agent version</legend>
								{(["v1", "v2"] as const).map((ver) => (
									<Button
										key={ver}
										size="sm"
										variant={v === ver ? "default" : "ghost"}
										className="rounded-full"
										onClick={() => setVersion(ver)}
									>
										Agent {ver}
									</Button>
								))}
							</fieldset>
						</div>
						<div>
							<div className="text-6xl font-semibold tracking-tighter tabular-nums sm:text-7xl">
								{money(totals.recoverableMinor + totals.orphanMinor, currency)}
							</div>
							<p className="mt-2 text-lg text-muted-foreground">
								lost to billing mistakes. Ready to recover.
							</p>
						</div>
						<p className="text-sm text-muted-foreground">
							{plural(totals.flagged, "invoice")} flagged
							{totals.orphanMinor > 0
								? `, plus ${money(totals.orphanMinor, currency)} paid with no invoice`
								: ""}
							.{" "}
							{totals.failedRuns > 0
								? `${plural(totals.failedRuns, "run")} could not check every line.`
								: "Every line was checked."}
						</p>
					</div>
					<div className="rounded-3xl bg-gradient-to-br from-chart-1 to-chart-5 p-6 text-primary-foreground shadow-lg">
						<div className="flex items-baseline justify-between gap-3">
							<h2 className="text-base font-semibold">Cash flow</h2>
							<ul className="flex gap-4 text-xs text-primary-foreground/80">
								<li className="flex items-center gap-1.5">
									<span
										aria-hidden
										className="size-2 rounded-full bg-primary-foreground"
									/>
									Bills in
								</li>
								<li className="flex items-center gap-1.5">
									<span
										aria-hidden
										className="size-2 rounded-full bg-primary-foreground/50"
									/>
									Paid out
								</li>
							</ul>
						</div>
						<div className="mt-3">
							<CashflowChart data={summary.cashflow} />
						</div>
					</div>
				</header>

				<FailuresPanel summary={summary} />

				<div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
					<Card className="gap-4">
						<CardHeader>
							<CardTitle>Invoices</CardTitle>
							<CardDescription>
								All amounts come from code, never from the model.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<ul className="max-h-[34rem] divide-y overflow-y-auto rounded-md border">
								{summary.invoices.map((r) => {
									const st = rowStatus(r);
									return (
										<li key={r.id}>
											<button
												type="button"
												onClick={() => select(r.id)}
												className={cn(
													"flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
													invoiceId === r.id && "bg-accent",
												)}
											>
												<span className="min-w-0">
													<span className="block truncate font-medium">
														{r.invoiceNumber}
													</span>
													<span className="block truncate text-xs text-muted-foreground">
														{r.vendor}
													</span>
												</span>
												<span className="flex shrink-0 items-center gap-2">
													{(r.run?.totalMinor ?? 0) > 0 ? (
														<span className="text-xs font-medium">
															{money(r.run?.totalMinor ?? 0, currency)}
														</span>
													) : null}
													<Badge variant={st.variant}>{st.label}</Badge>
												</span>
											</button>
										</li>
									);
								})}
							</ul>
						</CardContent>
					</Card>

					{detail ? (
						<InvoicePanel
							key={`${detail.invoice.id}-${v}-${detail.run?.id ?? "none"}`}
							detail={detail}
							version={v}
						/>
					) : null}
				</div>

				{summary.orphans.length > 0 ? (
					<Card className="gap-4">
						<CardHeader>
							<CardTitle>Payments with no invoice</CardTitle>
							<CardDescription>
								Money that left with no matching invoice on file. Found by code
								across all payments.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<ul className="divide-y rounded-md border text-sm">
								{summary.orphans.map((f) => (
									<li
										key={f.paymentId}
										className="flex items-start justify-between gap-4 px-3 py-2"
									>
										<span>{f.detail}</span>
										<span className="shrink-0 font-medium">
											{money(f.impactMinor, f.currency)}
										</span>
									</li>
								))}
							</ul>
						</CardContent>
					</Card>
				) : null}
			</PageBody>
		</>
	);
}

function FailuresPanel({ summary }: { summary: ReviewSummary }) {
	const { failures, version } = summary;
	if (failures.failedRuns === 0) return null;
	return (
		<Card className="gap-4 border-warning/40">
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<TriangleAlert className="size-4 text-warning" />
					Why {version} runs fail
				</CardTitle>
				<CardDescription>
					{failures.failedRuns} of {failures.runs} runs had failed tool calls.
					Grouped by code from the stored tool calls; the same failures show in
					PRISM.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4 text-sm">
				{failures.cause ? (
					<p className="font-medium">{failures.cause}</p>
				) : null}
				<ul className="divide-y rounded-md border">
					{failures.groups.map((g) => (
						<li
							key={`${g.tool}:${g.code}`}
							className="flex items-start justify-between gap-4 px-3 py-2"
						>
							<span className="min-w-0 space-y-1">
								<span className="block font-mono text-xs">
									{g.tool} · {g.code}
								</span>
								{g.example ? (
									<span className="block text-muted-foreground">
										{g.example}
									</span>
								) : null}
							</span>
							<Badge variant="warning">{plural(g.runs, "run")}</Badge>
						</li>
					))}
				</ul>
				<div className="grid gap-4 md:grid-cols-2">
					{failures.vendorVariants.length > 0 ? (
						<section className="space-y-2">
							<h3 className="font-medium">Vendor names on the invoice</h3>
							<ul className="space-y-1">
								{failures.vendorVariants.map((vv) => (
									<li key={vv.printed} className="flex justify-between gap-2">
										<span>
											“{vv.printed}”
											{vv.canonical ? (
												<span className="text-muted-foreground">
													{" "}
													→ {vv.canonical}
												</span>
											) : null}
										</span>
										<span className="text-muted-foreground">
											{plural(vv.invoiceIds.length, "invoice")}
										</span>
									</li>
								))}
							</ul>
						</section>
					) : null}
					{failures.unitVariants.length > 0 ? (
						<section className="space-y-2">
							<h3 className="font-medium">Units billed vs the contract</h3>
							<ul className="space-y-1">
								{failures.unitVariants.map((u) => (
									<li
										key={`${u.item}|${u.billedUnit}`}
										className="flex justify-between gap-2"
									>
										<span>
											{u.item}: “{u.billedUnit}”
											<span className="text-muted-foreground">
												{" "}
												vs {u.contractUnits.join(" / ")}
											</span>
										</span>
										<span className="text-muted-foreground">
											{plural(u.invoiceIds.length, "invoice")}
										</span>
									</li>
								))}
							</ul>
						</section>
					) : null}
				</div>
			</CardContent>
		</Card>
	);
}

function InvoicePanel({
	detail,
	version,
}: {
	detail: InvoiceDetail;
	version: AgentVersion;
}) {
	const router = useRouter();
	const { invoice, run, draft, approval } = detail;
	const [running, setRunning] = useState(false);

	async function runNow() {
		setRunning(true);
		try {
			const res = await runAgentOn({
				data: { invoiceId: invoice.id, version },
			});
			if (res.status === "failed")
				toast.error(`Run failed: ${res.error ?? "unknown error"}`);
			else toast.success(`Agent ${version} finished`);
			await router.invalidate();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "Run failed");
		} finally {
			setRunning(false);
		}
	}

	const total = run?.findings.reduce((n, f) => n + f.impactMinor, 0) ?? 0;

	return (
		<Card className="gap-4">
			<CardHeader>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="space-y-1.5">
						<CardTitle>{invoice.invoiceNumber}</CardTitle>
						<CardDescription>
							{invoice.vendor} · issued {invoice.issueDate} · stated total{" "}
							{money(
								toMinor(invoice.statedTotal, invoice.currency).minor,
								invoice.currency,
							)}
						</CardDescription>
					</div>
					<Button onClick={runNow} disabled={running}>
						{running ? <Loader2 className="animate-spin" /> : <Play />}
						{running ? "Running… (~10 s)" : `Run agent ${version}`}
					</Button>
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				{!run ? (
					<p className="text-sm text-muted-foreground">
						No {version} run for this invoice yet.
					</p>
				) : (
					<>
						<div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
							<span>{run.model ?? "model unknown"}</span>
							<span>{run.toolCalls} tool calls</span>
							<span>{utc(run.startedAt)}</span>
							{run.prismTraceId ? (
								<span>
									PRISM trace{" "}
									<code className="font-mono">
										{run.prismTraceId.slice(0, 8)}
									</code>{" "}
									· session{" "}
									<code className="font-mono">{run.id.slice(0, 8)}</code>
								</span>
							) : null}
						</div>
						<div className="flex flex-wrap gap-1.5">
							{run.toolLog.map((t, i) => (
								<Badge
									// biome-ignore lint/suspicious/noArrayIndexKey: tool calls are ordered and may repeat
									key={i}
									variant={t.status === "ok" ? "outline" : "warning"}
									title={t.errorMessage ?? undefined}
									className="font-mono"
								>
									{t.name}
									{t.status === "error" ? ` · ${t.errorCode}` : ""}
								</Badge>
							))}
						</div>
						{run.error ? (
							<p className="text-sm text-destructive">{run.error}</p>
						) : null}

						{run.findings.length > 0 ? (
							<section className="space-y-2">
								<h3 className="text-sm font-medium">Findings (code)</h3>
								<ul className="divide-y rounded-md border text-sm">
									{run.findings.map((f) => (
										<li
											key={`${f.kind}-${f.lineNo ?? "x"}-${f.paymentId ?? "x"}`}
											className="flex items-start justify-between gap-4 px-3 py-2"
										>
											<span className="space-y-1">
												<Badge variant="destructive">
													{KIND_LABEL[f.kind] ?? f.kind}
												</Badge>
												<span className="block text-muted-foreground">
													{f.detail}
												</span>
											</span>
											<span className="shrink-0 font-medium">
												{money(f.impactMinor, f.currency)}
											</span>
										</li>
									))}
								</ul>
								<div className="flex justify-between text-sm font-medium">
									<span>Recoverable on this invoice</span>
									<span>{money(total, invoice.currency)}</span>
								</div>
							</section>
						) : null}

						{run.explanation ? (
							<section className="space-y-2">
								<h3 className="flex items-center gap-1.5 text-sm font-medium">
									<Sparkles className="size-4 text-info" /> Agent's explanation
								</h3>
								<p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
									{run.explanation}
								</p>
							</section>
						) : null}

						{draft ? <DraftEditor draft={draft} approval={approval} /> : null}
					</>
				)}
			</CardContent>
		</Card>
	);
}

function DraftEditor({
	draft,
	approval,
}: {
	draft: NonNullable<InvoiceDetail["draft"]>;
	approval: InvoiceDetail["approval"];
}) {
	const router = useRouter();
	const [subject, setSubject] = useState(draft.subject);
	const [body, setBody] = useState(draft.body);
	const [approvedBy, setApprovedBy] = useState("Food Services Director");
	const [busy, setBusy] = useState(false);
	const locked = draft.status === "approved";
	const dirty = subject !== draft.subject || body !== draft.body;

	async function act(fn: () => Promise<unknown>, ok: string) {
		setBusy(true);
		try {
			await fn();
			toast.success(ok);
			await router.invalidate();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "Something went wrong");
		} finally {
			setBusy(false);
		}
	}

	return (
		<>
			<Separator />
			<section className="space-y-3">
				<div>
					<h3 className="text-sm font-medium">
						Dispute email (written by the agent)
					</h3>
					<p className="text-xs text-muted-foreground">
						Amounts were checked against the code's findings before the draft
						was saved. Nothing is sent without Approve.
					</p>
				</div>
				<div className="space-y-1.5">
					<Label htmlFor="subject">Subject</Label>
					<Input
						id="subject"
						value={subject}
						onChange={(e) => setSubject(e.target.value)}
						readOnly={locked}
					/>
				</div>
				<Textarea
					aria-label="Email body"
					value={body}
					onChange={(e) => setBody(e.target.value)}
					readOnly={locked}
					rows={12}
					className="text-sm"
				/>
				{locked && approval ? (
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<Check className="size-4 text-success" />
						Approved by {approval.approvedBy} on {utc(approval.approvedAt)} for{" "}
						{money(approval.totalImpactMinor, approval.currency)}. Logged; the
						draft is read-only.
					</div>
				) : (
					<div className="flex flex-wrap items-end gap-2">
						<div className="space-y-1.5">
							<Label htmlFor="approvedBy">Approved by</Label>
							<Input
								id="approvedBy"
								value={approvedBy}
								onChange={(e) => setApprovedBy(e.target.value)}
								className="w-56"
							/>
						</div>
						<Button
							variant="outline"
							disabled={busy || !dirty}
							onClick={() =>
								act(
									() =>
										saveDraft({ data: { draftId: draft.id, subject, body } }),
									"Draft saved",
								)
							}
						>
							Save edits
						</Button>
						<Button
							disabled={busy || dirty}
							title={dirty ? "Save your edits first" : undefined}
							onClick={() =>
								act(
									() => approve({ data: { draftId: draft.id, approvedBy } }),
									"Approved and logged",
								)
							}
						>
							Approve {money(draft.totalImpactMinor, draft.currency)} dispute
						</Button>
					</div>
				)}
			</section>
		</>
	);
}
