import { Loader2, ShieldAlert, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import { writeProjectionsDigest } from "#/server/projections.ts";
import type { DigestResult } from "#/server/projections-digest.ts";

/**
 * "Write summary": the model narrates the numbers on this page. Code checks
 * every amount and percentage it quotes against the forecast; a summary with
 * an unknown figure is shown as rejected, not as fact.
 */
export function DigestCard({ asOf }: { asOf: string }) {
	const [busy, setBusy] = useState(false);
	const [result, setResult] = useState<DigestResult | null>(null);

	const write = async () => {
		setBusy(true);
		try {
			setResult(await writeProjectionsDigest({ data: { asOf } }));
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : "Could not write the summary",
			);
		} finally {
			setBusy(false);
		}
	};

	const check = result?.check;
	return (
		<Card className="gap-4">
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<Sparkles className="size-4 text-primary" />
					Summary
				</CardTitle>
				<CardDescription>
					A model puts this page's numbers into words. It gets only the forecast
					figures, and code rejects any amount it quotes that isn't in them.
				</CardDescription>
				<CardAction>
					<Button onClick={write} disabled={busy}>
						{busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
						{result ? "Write again" : "Write summary"}
					</Button>
				</CardAction>
			</CardHeader>
			{result && check ? (
				<CardContent className="space-y-3">
					{check.ok ? (
						<Badge variant="success">
							<ShieldCheck />
							{check.amounts + check.percents} figures checked against the
							forecast
						</Badge>
					) : (
						<div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
							<ShieldAlert className="mt-0.5 size-4 shrink-0" />
							<span>
								Rejected: the summary quotes figures that are not in the
								forecast (
								{[
									...check.unknownAmounts.map((a) => `$${a}`),
									...check.unknownPercents.map((p) => `${p}%`),
								].join(", ")}
								). Don't rely on it; the tables below are correct.
							</span>
						</div>
					)}
					{result.truncated ? (
						<Badge variant="warning">
							The model ran out of room; the summary may stop early
						</Badge>
					) : null}
					<p
						className={
							check.ok
								? "text-sm leading-relaxed whitespace-pre-line"
								: "text-sm leading-relaxed whitespace-pre-line text-muted-foreground line-through decoration-destructive/40"
						}
					>
						{result.text}
					</p>
					<p className="text-xs text-muted-foreground">
						Written by {result.model}
						{result.model !== result.requestedModel
							? ` (fallback from ${result.requestedModel})`
							: ""}
						{result.attempts > 1 ? ", second attempt" : ""} · as of{" "}
						{result.asOf} · PRISM trace {result.prismTraceId}
					</p>
				</CardContent>
			) : null}
		</Card>
	);
}
