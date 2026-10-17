/**
 * The document's activity log as a readable timeline (#18): created, issued
 * as INV-0012, payment recorded $120.00, voided with its reason, converted to
 * / from another document (linked). Fetches its own data; the document page
 * mounts it with just the id.
 */
import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "#/components/ui/card.tsx";
import { Skeleton } from "#/components/ui/skeleton.tsx";
import { cn } from "#/lib/utils.ts";
import { getDocumentHistory } from "#/server/documents/convert.ts";
import { type ActivityTone, describeActivity } from "./describe.ts";

export interface ActivityHistoryProps {
	documentId: string;
}

export const historyQueryKey = (documentId: string) => [
	"document-history",
	documentId,
];

const DOT: Record<ActivityTone, string> = {
	muted: "bg-muted-foreground/50",
	info: "bg-info",
	success: "bg-success",
	warning: "bg-warning",
	destructive: "bg-destructive",
};

const when = new Intl.DateTimeFormat(undefined, {
	dateStyle: "medium",
	timeStyle: "short",
});

function formatAt(at: string): string {
	const ms = Date.parse(at);
	return Number.isNaN(ms) ? at : when.format(ms);
}

export function ActivityHistory({ documentId }: ActivityHistoryProps) {
	const query = useQuery({
		queryKey: historyQueryKey(documentId),
		queryFn: () => getDocumentHistory({ data: { documentId } }),
		staleTime: 0,
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<History className="size-4 text-muted-foreground" />
					History
				</CardTitle>
				<CardDescription>
					Everything that happened to this document.
				</CardDescription>
			</CardHeader>
			<CardContent>
				{query.isPending ? (
					<div className="space-y-3" role="status" aria-label="Loading history">
						<Skeleton className="h-4 w-2/3" />
						<Skeleton className="h-4 w-1/2" />
					</div>
				) : query.isError ? (
					<p className="text-sm text-destructive">
						Could not load the history:{" "}
						{query.error instanceof Error
							? query.error.message
							: "unknown error"}
					</p>
				) : query.data.length === 0 ? (
					<p className="text-sm text-muted-foreground">No activity yet.</p>
				) : (
					<ol className="relative space-y-4 border-l border-border pl-5">
						{query.data.map((entry) => {
							const line = describeActivity(entry);
							return (
								<li key={entry.id} className="relative">
									<span
										aria-hidden
										className={cn(
											"absolute top-1.5 -left-[25px] size-2.5 rounded-full ring-4 ring-card",
											DOT[line.tone],
										)}
									/>
									<p className="text-sm font-medium text-foreground">
										{line.link ? (
											<LinkedTitle title={line.title} link={line.link} />
										) : (
											line.title
										)}
									</p>
									{line.detail ? (
										<p className="text-sm text-muted-foreground">
											{line.detail}
										</p>
									) : null}
									<p className="mt-0.5 text-xs text-muted-foreground">
										<time dateTime={entry.at}>{formatAt(entry.at)}</time> ·{" "}
										{entry.actor}
									</p>
								</li>
							);
						})}
					</ol>
				)}
			</CardContent>
		</Card>
	);
}

/** The title with the related document's label turned into a link. */
function LinkedTitle({
	title,
	link,
}: {
	title: string;
	link: { documentId: string; label: string };
}) {
	const at = title.lastIndexOf(link.label);
	if (at < 0) return <>{title}</>;
	return (
		<>
			{title.slice(0, at)}
			<a
				href={`/documents/${link.documentId}`}
				className="text-primary underline-offset-4 hover:underline"
			>
				{link.label}
			</a>
			{title.slice(at + link.label.length)}
		</>
	);
}
