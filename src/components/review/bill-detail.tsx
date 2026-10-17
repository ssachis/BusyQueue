import { useRouter } from "@tanstack/react-router";
import {
	Check,
	CircleCheck,
	Loader2,
	Play,
	RotateCw,
	Sparkles,
	TriangleAlert,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { formatDate } from "#/components/documents/preview/format.ts";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import { toMinor } from "#/lib/money/index.ts";
import { cn } from "#/lib/utils.ts";
import { approve, runAgentOn, saveDraft } from "#/server/review.ts";
import type { InvoiceDetail } from "#/server/review-store.ts";
import { KIND_LABEL, money, utc } from "./format.ts";
import { type ReviewStatus, STATUS_LABEL, STATUS_VARIANT } from "./order.ts";
import { REVIEW_VERSION } from "./version.ts";

/** Status of the open bill, from the same rules as the list. */
function detailStatus(detail: InvoiceDetail): ReviewStatus {
	const { run, draft } = detail;
	if (!run) return "not_run";
	if (run.status === "failed") return "failed";
	if (run.status === "running") return "running";
	if (draft?.status === "approved") return "approved";
	if (run.findings.reduce((n, f) => n + f.impactMinor, 0) > 0) return "flagged";
	if (run.toolLog.some((t) => t.status === "error")) return "unchecked";
	return "clean";
}

/** One numbered step of the review: findings → explanation → email → approval. */
function Step({
	n,
	title,
	aside,
	children,
	muted,
}: {
	n: number;
	title: string;
	aside?: ReactNode;
	children: ReactNode;
	muted?: boolean;
}) {
	return (
		<section className="relative border-t px-5 py-5 first:border-t-0">
			<div className="mb-3 flex items-center justify-between gap-3">
				<h3 className="flex items-center gap-2.5 text-sm font-semibold">
					<span
						aria-hidden
						className={cn(
							"flex size-6 items-center justify-center rounded-full text-xs tabular-nums",
							muted
								? "bg-muted text-muted-foreground"
								: "bg-primary/10 text-primary",
						)}
					>
						{n}
					</span>
					{title}
				</h3>
				{aside}
			</div>
			<div className="pl-[34px]">{children}</div>
		</section>
	);
}

export function BillDetail({ detail }: { detail: InvoiceDetail }) {
	const router = useRouter();
	const { invoice, run, draft, approval } = detail;
	const [running, setRunning] = useState(false);
	const status = detailStatus(detail);
	const failedTools = run?.toolLog.filter((t) => t.status === "error") ?? [];
	const total = run?.findings.reduce((n, f) => n + f.impactMinor, 0) ?? 0;

	async function runNow() {
		setRunning(true);
		try {
			const res = await runAgentOn({
				data: { invoiceId: invoice.id, version: REVIEW_VERSION },
			});
			if (res.status === "failed")
				toast.error(`Analysis failed: ${res.error ?? "unknown error"}`);
			else toast.success("Analysis finished");
			await router.invalidate();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "Analysis failed");
		} finally {
			setRunning(false);
		}
	}

	return (
		<article
			id="bill-detail"
			aria-label={`Bill ${invoice.invoiceNumber}`}
			className="scroll-mt-20 overflow-hidden rounded-xl border bg-card shadow-sm"
		>
			<header className="flex flex-wrap items-start justify-between gap-4 border-b bg-muted/30 px-5 py-4">
				<div className="min-w-0 space-y-1">
					<div className="flex flex-wrap items-center gap-2">
						<h2 className="text-lg font-semibold">{invoice.invoiceNumber}</h2>
						<Badge variant={STATUS_VARIANT[status]}>
							{STATUS_LABEL[status]}
						</Badge>
					</div>
					<p className="text-sm text-muted-foreground">
						{invoice.vendor} · {formatDate(invoice.issueDate)} · billed{" "}
						<span className="font-medium text-foreground tabular-nums">
							{money(
								toMinor(invoice.statedTotal, invoice.currency).minor,
								invoice.currency,
							)}
						</span>
					</p>
				</div>
				<Button
					onClick={runNow}
					disabled={running}
					variant={run ? "outline" : "default"}
				>
					{running ? (
						<Loader2 className="animate-spin" />
					) : run ? (
						<RotateCw />
					) : (
						<Play />
					)}
					{running ? "Checking… (~10 s)" : run ? "Check again" : "Check bill"}
				</Button>
			</header>

			{!run ? (
				<p className="px-5 py-8 text-sm text-muted-foreground">
					This bill hasn't been checked yet. "Check bill" compares every line
					with the agreed prices and the payments on file.
				</p>
			) : (
				<>
					{run.error ? (
						<p className="border-b bg-destructive/5 px-5 py-3 text-sm text-destructive">
							{run.error}
						</p>
					) : null}
					{failedTools.length > 0 ? (
						<div className="flex gap-3 border-b bg-warning/10 px-5 py-3 text-sm">
							<TriangleAlert
								aria-hidden
								className="mt-0.5 size-4 shrink-0 text-warning"
							/>
							<div className="space-y-1">
								<p className="font-medium">Couldn't fully check this bill</p>
								<ul className="space-y-0.5 text-muted-foreground">
									{failedTools.map((t, i) => (
										<li
											// biome-ignore lint/suspicious/noArrayIndexKey: tool calls are ordered and may repeat
											key={i}
										>
											{t.errorMessage ?? t.errorCode ?? t.name}
										</li>
									))}
								</ul>
							</div>
						</div>
					) : null}

					<Step
						n={1}
						title="What we found"
						aside={
							total > 0 ? (
								<span className="text-sm font-semibold tabular-nums">
									{money(total, invoice.currency)}
								</span>
							) : null
						}
					>
						{run.findings.length > 0 ? (
							<ul className="divide-y rounded-lg border text-sm">
								{run.findings.map((f) => (
									<li
										key={`${f.kind}-${f.lineNo ?? "x"}-${f.paymentId ?? "x"}`}
										className="flex items-start justify-between gap-4 px-3 py-2.5"
									>
										<span className="min-w-0 space-y-1">
											<Badge variant="destructive">
												{KIND_LABEL[f.kind] ?? f.kind}
											</Badge>
											<span className="block text-muted-foreground">
												{f.detail}
											</span>
										</span>
										<span className="shrink-0 font-medium tabular-nums">
											{money(f.impactMinor, f.currency)}
										</span>
									</li>
								))}
								<li className="flex justify-between gap-4 bg-muted/40 px-3 py-2 font-medium">
									<span>To recover</span>
									<span className="tabular-nums">
										{money(total, invoice.currency)}
									</span>
								</li>
							</ul>
						) : (
							<p className="flex items-center gap-2 text-sm text-muted-foreground">
								<CircleCheck className="size-4 text-success" />
								{failedTools.length > 0
									? "No mistakes in the lines that could be checked."
									: "No billing mistakes: every line matches the agreed price."}
							</p>
						)}
					</Step>

					<Step n={2} title="Why" muted={!run.explanation}>
						{run.explanation ? (
							<div className="space-y-1.5 text-sm">
								<p className="leading-relaxed">{run.explanation}</p>
								<p className="flex items-center gap-1.5 text-xs text-muted-foreground">
									<Sparkles className="size-3.5 text-info" />
									Written by the agent. Every amount above comes from code.
								</p>
							</div>
						) : (
							<p className="text-sm text-muted-foreground">
								No explanation for this bill.
							</p>
						)}
					</Step>

					{draft ? (
						<DraftSteps key={draft.id} draft={draft} approval={approval} />
					) : (
						<Step n={3} title="Dispute email" muted>
							<p className="text-sm text-muted-foreground">
								{total > 0
									? "No dispute email was drafted for this analysis. Check the bill again to draft one."
									: "Nothing to dispute."}
							</p>
						</Step>
					)}

					<details className="border-t px-5 py-3 text-xs text-muted-foreground">
						<summary className="cursor-pointer hover:text-foreground">
							Analysis details
						</summary>
						<div className="mt-2 space-y-2">
							<div className="flex flex-wrap gap-x-4 gap-y-1">
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
						</div>
					</details>
				</>
			)}
		</article>
	);
}

function DraftSteps({
	draft,
	approval,
}: {
	draft: NonNullable<InvoiceDetail["draft"]>;
	approval: InvoiceDetail["approval"];
}) {
	const router = useRouter();
	const [subject, setSubject] = useState(draft.subject);
	const [body, setBody] = useState(draft.body);
	const [approvedBy, setApprovedBy] = useState("Accounts payable");
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
			<Step
				n={3}
				title="Dispute email"
				aside={
					locked ? (
						<Badge variant="outline">Read-only</Badge>
					) : dirty ? (
						<Badge variant="warning">Unsaved edits</Badge>
					) : null
				}
			>
				<div className="space-y-3">
					<div className="space-y-1.5">
						<Label htmlFor="subject">Subject</Label>
						<Input
							id="subject"
							value={subject}
							onChange={(e) => setSubject(e.target.value)}
							readOnly={locked}
						/>
					</div>
					<div className="space-y-1.5">
						<Label htmlFor="email-body">Message</Label>
						<Textarea
							id="email-body"
							value={body}
							onChange={(e) => setBody(e.target.value)}
							readOnly={locked}
							rows={12}
							className="text-sm"
						/>
					</div>
					{!locked ? (
						<Button
							variant="outline"
							size="sm"
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
					) : null}
				</div>
			</Step>

			<Step n={4} title="Approval" muted={locked}>
				{locked && approval ? (
					<div className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2.5 text-sm">
						<Check className="mt-0.5 size-4 shrink-0 text-success" />
						<span>
							Approved by{" "}
							<span className="font-medium">{approval.approvedBy}</span> ·{" "}
							{utc(approval.approvedAt)} ·{" "}
							<span className="tabular-nums">
								{money(approval.totalImpactMinor, approval.currency)}
							</span>
							<span className="block text-xs text-muted-foreground">
								Logged permanently. The email can no longer be edited.
							</span>
						</span>
					</div>
				) : (
					<div className="space-y-3">
						<p className="text-sm text-muted-foreground">
							Nothing is sent to the vendor until you approve. Your approval is
							written to a permanent log with your name, the time and the
							amount.
						</p>
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
								disabled={busy || dirty || !approvedBy.trim()}
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
					</div>
				)}
			</Step>
		</>
	);
}
