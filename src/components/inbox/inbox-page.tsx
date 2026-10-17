import { Link, useRouter } from "@tanstack/react-router";
import {
	Bot,
	Check,
	Copy,
	FileText,
	Inbox,
	Loader2,
	Mail,
	Paperclip,
} from "lucide-react";
import { useEffect, useState } from "react";
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
import { IN_PROGRESS } from "#/lib/inbox/types.ts";
import type {
	InboxAttachmentView,
	InboxMessageView,
} from "#/server/inbox/store.ts";
import {
	ATTACHMENT_STATUS,
	formatBytes,
	formatReceived,
	KIND_LABELS,
	MESSAGE_STATUS,
} from "./labels.ts";
import { SimulateForm } from "./simulate-form.tsx";

const POLL_MS = 2000;

export function InboxPage({
	address,
	messages,
}: {
	address: string;
	messages: InboxMessageView[];
}) {
	const router = useRouter();
	const busy = messages.some((m) => IN_PROGRESS.includes(m.status));

	// Classification and reading run in the background: refresh until done.
	useEffect(() => {
		if (!busy) return;
		const t = setInterval(() => void router.invalidate(), POLL_MS);
		return () => clearInterval(t);
	}, [busy, router]);

	return (
		<>
			<PageHeader
				title="Inbox"
				description="Forward vendor and carrier invoices to your inbox address. BusyQ files each email, reads the invoices through Nicrron and queues them for your review. Nothing is saved until you confirm it."
			/>
			<PageBody className="space-y-6">
				<div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
					<AddressCard address={address} />
					<SimulateForm
						address={address}
						onSent={() => void router.invalidate()}
					/>
				</div>

				<section className="space-y-3">
					<div className="flex items-center gap-2">
						<h2 className="text-base font-semibold">Received</h2>
						{busy ? (
							<Badge variant="info">
								<Loader2 className="animate-spin" />
								Processing
							</Badge>
						) : null}
					</div>
					{messages.length === 0 ? (
						<Card>
							<CardContent className="flex flex-col items-center gap-3 py-10 text-center">
								<Inbox className="size-8 text-muted-foreground" />
								<p className="max-w-md text-sm text-muted-foreground">
									Nothing yet. Forward a vendor invoice to {address}, or
									simulate one above.
								</p>
							</CardContent>
						</Card>
					) : (
						<div className="space-y-3">
							{messages.map((m) => (
								<MessageCard key={m.id} message={m} />
							))}
						</div>
					)}
				</section>
			</PageBody>
		</>
	);
}

function AddressCard({ address }: { address: string }) {
	const [copied, setCopied] = useState(false);
	async function copy() {
		try {
			await navigator.clipboard.writeText(address);
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		} catch {
			toast.error("Could not copy; select the address instead");
		}
	}
	return (
		<Card className="h-fit">
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<Mail className="size-4" />
					Your inbox address
				</CardTitle>
				<CardDescription>
					Forward vendor and carrier invoices here, or ask vendors to send their
					bills to it directly.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
					<code className="min-w-0 flex-1 truncate text-sm font-medium">
						{address}
					</code>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Copy the inbox address"
						onClick={copy}
					>
						{copied ? <Check /> : <Copy />}
					</Button>
				</div>
				<ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
					<li>Attach the invoice as a PDF or a photo (PNG, JPEG, WebP).</li>
					<li>
						Vendor invoices are read and wait for you on the review screen.
					</li>
					<li>
						Contracts and our own documents are kept here for you to file.
					</li>
					<li>The same file or invoice number twice is marked duplicate.</li>
				</ul>
			</CardContent>
		</Card>
	);
}

function MessageCard({ message: m }: { message: InboxMessageView }) {
	const status = MESSAGE_STATUS[m.status];
	return (
		<Card className="gap-3 py-4">
			<CardHeader className="px-4">
				<div className="flex flex-wrap items-start justify-between gap-2">
					<div className="min-w-0 space-y-1">
						<CardTitle className="truncate text-sm">
							{m.subject || "(no subject)"}
						</CardTitle>
						<CardDescription className="text-xs">
							From {m.fromDomain ?? "unknown sender"} ·{" "}
							{formatReceived(m.receivedAt)} · {formatBytes(m.sizeBytes)}
							{m.source === "simulated" ? " · simulated" : ""}
						</CardDescription>
					</div>
					<div className="flex flex-wrap gap-1">
						{m.classification ? (
							<Badge variant="outline">{KIND_LABELS[m.classification]}</Badge>
						) : null}
						<Badge variant={status.tone}>
							{IN_PROGRESS.includes(m.status) ? (
								<Loader2 className="animate-spin" />
							) : null}
							{status.label}
						</Badge>
					</div>
				</div>
				{m.reason || m.error ? (
					<p
						className={
							m.error
								? "text-xs text-destructive"
								: "text-xs text-muted-foreground"
						}
					>
						{m.error ?? m.reason}
					</p>
				) : null}
			</CardHeader>
			{m.attachments.length > 0 ? (
				<CardContent className="px-4">
					<ul className="divide-y rounded-md border">
						{m.attachments.map((a) => (
							<AttachmentRow key={a.id} attachment={a} />
						))}
					</ul>
				</CardContent>
			) : null}
		</Card>
	);
}

function AttachmentRow({ attachment: a }: { attachment: InboxAttachmentView }) {
	const status = ATTACHMENT_STATUS[a.status];
	return (
		<li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
			<Paperclip className="size-4 shrink-0 text-muted-foreground" />
			<div className="min-w-0 flex-1">
				<div className="truncate font-medium">{a.filename}</div>
				<div className="text-xs text-muted-foreground">
					{formatBytes(a.sizeBytes)}
					{a.vendor || a.invoiceNumber
						? ` · ${[a.vendor, a.invoiceNumber].filter(Boolean).join(" ")}`
						: ""}
					{a.error ? (
						<span className="text-destructive"> · {a.error}</span>
					) : a.reason ? (
						` · ${a.reason}`
					) : null}
				</div>
			</div>
			<div className="flex flex-wrap items-center gap-1">
				<Badge variant="outline">
					{a.classifiedBy === "model" ? <Bot /> : null}
					{KIND_LABELS[a.classification]}
				</Badge>
				<Badge variant={status.tone}>{status.label}</Badge>
				<AttachmentAction attachment={a} />
			</div>
		</li>
	);
}

function AttachmentAction({
	attachment: a,
}: {
	attachment: InboxAttachmentView;
}) {
	if (a.classification === "invoice_in" && a.importId) {
		const label =
			a.status === "duplicate"
				? "Open original"
				: a.status === "failed"
					? "Open"
					: "Review";
		return (
			<Button
				asChild
				size="xs"
				variant={a.status === "ready_for_review" ? "default" : "outline"}
			>
				<Link to="/import" search={{ id: a.importId }}>
					<FileText />
					{label}
				</Link>
			</Button>
		);
	}
	if (a.status !== "needs_manual") return null;
	if (a.classification === "contract") {
		return (
			<Button asChild size="xs" variant="outline">
				<Link to="/contracts/new">Add contract</Link>
			</Button>
		);
	}
	// Our own documents: filed through the paper-document import.
	return (
		<Button asChild size="xs" variant="outline">
			<Link to="/import-document">Import document</Link>
		</Button>
	);
}
