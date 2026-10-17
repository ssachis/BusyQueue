/**
 * Issuing (#16). On a draft: "Issue" with a confirm step, which assigns the
 * next number, snapshots seller and totals, and locks the document. On an
 * issued or void document: the number and its status.
 * Keep the props: the document page passes exactly these.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { Loader2, Lock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { getIssueState, issueDocument } from "#/server/documents/issue.ts";

export interface IssueButtonProps {
	documentId: string;
	status: "draft" | "issued" | "void";
}

const issueStateKey = (documentId: string) => [
	"documents",
	documentId,
	"issue-state",
];

export function IssueButton({ documentId, status }: IssueButtonProps) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const [confirming, setConfirming] = useState(false);
	const [pending, setPending] = useState(false);
	// Set right after issuing, so the number shows before the page reloads.
	const [justIssued, setJustIssued] = useState<string | null>(null);

	const effective = justIssued && status === "draft" ? "issued" : status;
	const state = useQuery({
		queryKey: issueStateKey(documentId),
		queryFn: () => getIssueState({ data: { documentId } }),
		enabled: effective !== "draft" && !justIssued,
	});
	const number = justIssued ?? state.data?.number ?? null;

	async function onIssue() {
		setPending(true);
		try {
			const result = await issueDocument({ data: { documentId } });
			setJustIssued(result.number);
			setConfirming(false);
			toast.success(`Issued as ${result.number}`);
			await queryClient.invalidateQueries({
				queryKey: issueStateKey(documentId),
			});
			await router.invalidate();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Could not issue");
		} finally {
			setPending(false);
		}
	}

	if (effective !== "draft") {
		return (
			<div className="flex items-center gap-2">
				{number ? (
					<span className="font-mono text-sm font-medium">{number}</span>
				) : state.isError ? null : (
					<Skeleton className="h-5 w-24" aria-label="Loading number" />
				)}
				{effective === "void" ? (
					<Badge variant="destructive">Void</Badge>
				) : (
					<Badge variant="info">Issued</Badge>
				)}
			</div>
		);
	}

	if (!confirming) {
		return (
			<Button onClick={() => setConfirming(true)}>
				<Lock />
				Issue
			</Button>
		);
	}

	return (
		<div
			role="alertdialog"
			aria-label="Confirm issuing"
			className="flex flex-wrap items-center gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm"
		>
			<span className="text-foreground">
				This assigns the next number and locks the document.
			</span>
			<Button
				variant="outline"
				size="sm"
				onClick={() => setConfirming(false)}
				disabled={pending}
			>
				Cancel
			</Button>
			<Button size="sm" onClick={onIssue} disabled={pending} autoFocus>
				{pending ? <Loader2 className="animate-spin" /> : <Lock />}
				{pending ? "Issuing…" : "Issue now"}
			</Button>
		</div>
	);
}
