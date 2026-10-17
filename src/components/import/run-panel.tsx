import { Link } from "@tanstack/react-router";
import { ArrowRight, Loader2, Play } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "#/components/ui/card.tsx";
import type { AgentVersion } from "#/lib/busyq/types.ts";
import type { ImportRunSummary, SavedImport } from "#/lib/import/api.ts";
import { formatMoney } from "#/lib/money/index.ts";
import { runImportAgent } from "#/server/imports.ts";

const KIND_LABEL: Record<string, string> = {
	overcharge: "Overcharge",
	duplicate_line: "Duplicate line",
	wrong_total: "Wrong total",
	duplicate_payment: "Duplicate payment",
	orphan_payment: "Payment with no invoice",
};

/** After saving: run the BusyQ agent on the new invoice and show what code found. */
export function RunPanel({ saved }: { saved: SavedImport }) {
	const [running, setRunning] = useState<AgentVersion | null>(null);
	const [runs, setRuns] = useState<ImportRunSummary[]>([]);

	async function run(version: AgentVersion) {
		setRunning(version);
		try {
			const summary = await runImportAgent({
				data: { invoiceId: saved.invoiceId, version },
			});
			setRuns((r) => [summary, ...r.filter((x) => x.version !== version)]);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : "The agent run failed");
		} finally {
			setRunning(null);
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>Saved as {saved.invoiceId}</CardTitle>
				<CardDescription>
					{saved.corrected.length
						? `You corrected ${saved.corrected.length} field${saved.corrected.length === 1 ? "" : "s"}: ${saved.corrected.join(", ")}.`
						: "Saved exactly as read."}{" "}
					Now audit it: the agent checks prices, totals and payments with the
					same tools as every other invoice.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex flex-wrap gap-2">
					{(["v1", "v2"] as const).map((v) => (
						<Button
							key={v}
							variant={v === "v2" ? "default" : "outline"}
							disabled={running !== null}
							onClick={() => run(v)}
						>
							{running === v ? <Loader2 className="animate-spin" /> : <Play />}
							Run agent {v}
						</Button>
					))}
				</div>

				{runs.map((r) => (
					<div key={r.version} className="space-y-3 rounded-lg border p-4">
						<div className="flex flex-wrap items-center gap-2">
							<span className="font-medium">Agent {r.version}</span>
							{r.status === "failed" ? (
								<Badge variant="destructive">Run failed</Badge>
							) : r.totalMinor > 0 ? (
								<Badge variant="destructive">
									{formatMoney({ minor: r.totalMinor, currency: r.currency })}{" "}
									recoverable
								</Badge>
							) : r.failedTools.length > 0 ? (
								<Badge variant="warning">Price check failed</Badge>
							) : (
								<Badge variant="success">Clean</Badge>
							)}
							<span className="text-xs text-muted-foreground">
								{r.toolCalls} tool calls
								{r.failedTools.length
									? `, ${r.failedTools.length} failed (${[...new Set(r.failedTools.map((t) => t.code ?? t.name))].join(", ")})`
									: ""}
							</span>
						</div>
						{r.error ? (
							<p className="text-sm text-destructive">{r.error}</p>
						) : null}
						{r.findings.length ? (
							<ul className="space-y-1.5 text-sm">
								{r.findings.map((f) => (
									<li
										key={`${f.kind}-${f.lineNo ?? ""}-${f.paymentId ?? ""}`}
										className="flex flex-wrap items-baseline justify-between gap-2"
									>
										<span>
											<span className="font-medium">
												{KIND_LABEL[f.kind] ?? f.kind}
											</span>
											<span className="text-muted-foreground">
												{" "}
												· {f.detail}
											</span>
										</span>
										<span className="tabular-nums">
											{formatMoney({
												minor: f.impactMinor,
												currency: f.currency,
											})}
										</span>
									</li>
								))}
							</ul>
						) : null}
						<div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
							<span>PRISM trace {r.prismTraceId}</span>
							<Link
								to="/"
								search={{ v: r.version, invoice: r.invoiceId }}
								className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
							>
								Open in review
								<ArrowRight className="size-3.5" />
							</Link>
						</div>
					</div>
				))}
			</CardContent>
		</Card>
	);
}
