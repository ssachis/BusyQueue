/**
 * Related documents (#18), read from both ends of `document_links`:
 * "Converted from Quote QUO-0003", "Converted to Invoice INV-0012",
 * "Credited by Credit note CN-0001", "Duplicated from …". Fetches its own
 * data; renders nothing when the document has no related documents.
 */
import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, Link2 } from "lucide-react";
import { Badge } from "#/components/ui/badge.tsx";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "#/components/ui/card.tsx";
import {
	DOCUMENT_TYPE_NAMES,
	type LinkKind,
} from "#/lib/documents/conversions.ts";
import { getDocumentLinks } from "#/server/documents/convert.ts";

export interface DocumentLinksProps {
	documentId: string;
}

export const linksQueryKey = (documentId: string) => [
	"document-links",
	documentId,
];

/** How the link reads from this document's side. */
const RELATION: Record<"from" | "to", Record<LinkKind, string>> = {
	from: {
		converted: "Converted from",
		credits: "Credits",
		duplicated: "Duplicated from",
	},
	to: {
		converted: "Converted to",
		credits: "Credited by",
		duplicated: "Duplicated as",
	},
};

const STATUS_BADGE = {
	draft: { label: "Draft", variant: "secondary" },
	issued: { label: "Issued", variant: "info" },
	void: { label: "Void", variant: "destructive" },
} as const;

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type View = Awaited<ReturnType<typeof getDocumentLinks>>;

export function DocumentLinks({ documentId }: DocumentLinksProps) {
	const query = useQuery({
		queryKey: linksQueryKey(documentId),
		queryFn: () => getDocumentLinks({ data: { documentId } }),
		staleTime: 0,
	});

	if (query.isPending) return null;
	if (query.isError) {
		return (
			<p className="text-sm text-destructive">
				Could not load related documents:{" "}
				{query.error instanceof Error ? query.error.message : "unknown error"}
			</p>
		);
	}
	const rows = [
		...query.data.from.map((link) => ({ side: "from" as const, link })),
		...query.data.to.map((link) => ({ side: "to" as const, link })),
	];
	if (rows.length === 0) return null;

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<Link2 className="size-4 text-muted-foreground" />
					Related documents
				</CardTitle>
			</CardHeader>
			<CardContent>
				<ul className="divide-y rounded-md border text-sm">
					{rows.map(({ side, link }) => (
						<LinkRow key={`${side}-${link.id}`} side={side} link={link} />
					))}
				</ul>
			</CardContent>
		</Card>
	);
}

function LinkRow({
	side,
	link,
}: {
	side: "from" | "to";
	link: View["from"][number];
}) {
	const badge = STATUS_BADGE[link.status];
	const Icon = side === "from" ? ArrowDownLeft : ArrowUpRight;
	return (
		<li className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
			<div className="flex min-w-0 items-center gap-2">
				<Icon className="size-4 shrink-0 text-muted-foreground" />
				<span className="text-muted-foreground">
					{RELATION[side][link.kind]}
				</span>
				<a
					href={`/documents/${link.id}`}
					className="truncate font-medium text-primary underline-offset-4 hover:underline"
				>
					{capitalize(DOCUMENT_TYPE_NAMES[link.type])}{" "}
					<span className="font-mono">{link.number ?? "(draft)"}</span>
				</a>
			</div>
			<div className="flex items-center gap-2">
				<span className="text-xs text-muted-foreground">{link.date}</span>
				<Badge variant={badge.variant}>{badge.label}</Badge>
			</div>
		</li>
	);
}
