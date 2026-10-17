/**
 * Linked documents and the activity log for one document (#18).
 * Props: just the document id.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Badge } from "#/components/ui/badge.tsx";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "#/components/ui/card.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { getDocumentHistory } from "#/server/documents/convert.ts";
import { STATUS_LABEL, STATUS_VARIANT, TYPE_LABEL } from "../preview/format.ts";
import { describeActivity } from "./describe.ts";

export const historyKey = (documentId: string) => [
	"documents",
	documentId,
	"history",
];

const when = (iso: string) =>
	new Date(iso).toLocaleString(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	});

export function HistoryPanel({ documentId }: { documentId: string }) {
	const history = useQuery({
		queryKey: historyKey(documentId),
		queryFn: () => getDocumentHistory({ data: { documentId } }),
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle>History</CardTitle>
			</CardHeader>
			<CardContent className="space-y-5">
				{history.isPending ? (
					<Skeleton className="h-20 w-full" />
				) : history.isError ? (
					<p className="text-sm text-destructive">Could not load history.</p>
				) : (
					<>
						{history.data.related.length > 0 ? (
							<ul className="space-y-2">
								{history.data.related.map((r) => (
									<li
										key={`${r.relation}-${r.id}`}
										className="flex items-center justify-between gap-3 text-sm"
									>
										<span className="text-muted-foreground">
											{r.relation === "converted_to"
												? "Converted to"
												: "Converted from"}
										</span>
										<Link
											to="/documents/$id"
											params={{ id: r.id }}
											className="flex items-center gap-2 font-medium underline-offset-4 hover:underline"
										>
											{TYPE_LABEL[r.type]} {r.number ?? "draft"}
											<Badge variant={STATUS_VARIANT[r.status]}>
												{STATUS_LABEL[r.status]}
											</Badge>
										</Link>
									</li>
								))}
							</ul>
						) : null}
						<ol className="space-y-3 border-l pl-4">
							{history.data.activity.map((a) => (
								<li key={a.id} className="text-sm">
									<p>{describeActivity(a.kind, a.detail)}</p>
									<p className="text-xs text-muted-foreground">
										{a.actor} · {when(a.at)}
									</p>
								</li>
							))}
						</ol>
					</>
				)}
			</CardContent>
		</Card>
	);
}
