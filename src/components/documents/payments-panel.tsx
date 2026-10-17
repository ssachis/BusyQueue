/**
 * Payments for one document (#17): total, paid, balance and the derived
 * status, the payment history (voided payments struck through), and the
 * actions: record a payment, mark as paid, void a payment, void the document.
 *
 * Every amount shown comes from the server (pure `paymentSummary`); this
 * component only formats it. The document page renders this with exactly
 * these props.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { Ban, CheckCircle2, Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
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
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import { Separator } from "#/components/ui/separator.tsx";
import { Textarea } from "#/components/ui/textarea.tsx";
import {
	PAYMENT_METHOD_LABELS,
	PAYMENT_METHODS,
	type PaymentMethod,
} from "#/lib/documents/status.ts";
import type { DisplayStatus } from "#/lib/documents/types.ts";
import { formatMoney } from "#/lib/money/index.ts";
import {
	getDocumentPayments,
	markDocumentPaid,
	recordDocumentPayment,
	voidDocumentPayment,
	voidIssuedDocument,
} from "#/server/documents/payments.ts";
import { historyKey } from "./history/history-panel.tsx";

export interface PaymentsPanelProps {
	documentId: string;
	status: "draft" | "issued" | "void";
}

type View = Awaited<ReturnType<typeof getDocumentPayments>>;

const STATUS_BADGE: Record<
	DisplayStatus,
	{
		label: string;
		variant: "secondary" | "info" | "warning" | "success" | "destructive";
	}
> = {
	draft: { label: "Draft", variant: "secondary" },
	issued: { label: "Issued", variant: "info" },
	partially_paid: { label: "Partially paid", variant: "warning" },
	paid: { label: "Paid", variant: "success" },
	overdue: { label: "Overdue", variant: "destructive" },
	void: { label: "Void", variant: "secondary" },
};

const selectClass =
	"h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

/** The viewer's calendar date (YYYY-MM-DD), so "overdue" matches their day. */
function localToday(): string {
	const d = new Date();
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const errorMessage = (err: unknown) =>
	err instanceof Error ? err.message : "Something went wrong";

/** Shared with the document header so its status badge follows payments. */
export const paymentsQueryKey = (
	documentId: string,
	status: PaymentsPanelProps["status"],
) => ["document-payments", documentId, status];

export const paymentsQueryFn = (documentId: string) => () =>
	getDocumentPayments({ data: { documentId, today: localToday() } });

export function PaymentsPanel({ documentId, status }: PaymentsPanelProps) {
	const query = useQuery({
		queryKey: paymentsQueryKey(documentId, status),
		queryFn: paymentsQueryFn(documentId),
		enabled: status !== "draft",
		staleTime: 0,
	});
	const queryClient = useQueryClient();
	const router = useRouter();

	async function refresh() {
		await Promise.all([
			queryClient.invalidateQueries({
				queryKey: ["document-payments", documentId],
			}),
			queryClient.invalidateQueries({ queryKey: historyKey(documentId) }),
		]);
		await router.invalidate();
	}

	if (status === "draft") return null;

	if (query.isPending) {
		return (
			<Card>
				<CardContent className="text-sm text-muted-foreground">
					Loading payments…
				</CardContent>
			</Card>
		);
	}
	if (query.isError) {
		return (
			<Card>
				<CardContent className="text-sm text-destructive">
					Could not load payments: {errorMessage(query.error)}
				</CardContent>
			</Card>
		);
	}

	const view = query.data;
	if (view.document.status === "void") {
		return <VoidNote view={view} />;
	}
	return <IssuedPanel view={view} onChanged={refresh} />;
}

function VoidNote({ view }: { view: View }) {
	return (
		<div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
			<Ban className="mt-0.5 size-4 shrink-0" />
			<p>
				<span className="font-medium">Void</span>
				{view.document.voidReason ? ` — ${view.document.voidReason}` : null}
				{view.document.number ? (
					<span className="text-muted-foreground">
						{" "}
						(number {view.document.number} stays reserved)
					</span>
				) : null}
			</p>
		</div>
	);
}

function IssuedPanel({
	view,
	onChanged,
}: {
	view: View;
	onChanged: () => Promise<void>;
}) {
	const { document: doc, summary } = view;
	const money = (minor: number) =>
		formatMoney({ minor, currency: doc.currency });
	const badge = STATUS_BADGE[summary.displayStatus];
	const activePayments = view.payments.filter((p) => !p.voidedAt);
	const owed = view.takesPayments && summary.balanceMinor > 0;

	return (
		<Card>
			<CardHeader>
				<CardTitle>{view.takesPayments ? "Payments" : "Document"}</CardTitle>
				<CardDescription>
					{view.takesPayments
						? doc.dueDate
							? `Due ${doc.dueDate}`
							: "No due date"
						: "This document type doesn't take payments."}
				</CardDescription>
				<CardAction>
					<Badge variant={badge.variant}>{badge.label}</Badge>
				</CardAction>
			</CardHeader>

			<CardContent className="space-y-6">
				{view.takesPayments ? (
					<>
						<dl className="grid grid-cols-3 gap-4 text-sm">
							<Amount label="Total" value={money(doc.totalMinor ?? 0)} />
							<Amount label="Paid" value={money(summary.paidMinor)} />
							<Amount
								label="Balance"
								value={money(Math.max(summary.balanceMinor, 0))}
								tone={
									summary.overdue
										? "text-destructive"
										: summary.balanceMinor > 0
											? "text-foreground"
											: "text-success"
								}
							/>
						</dl>

						<PaymentList view={view} money={money} onChanged={onChanged} />

						{owed ? (
							<>
								<Separator />
								<RecordPaymentForm view={view} onChanged={onChanged} />
							</>
						) : null}
					</>
				) : null}

				<Separator />
				<VoidDocumentControl
					documentId={doc.id}
					blocked={activePayments.length > 0}
					onChanged={onChanged}
				/>
			</CardContent>
		</Card>
	);
}

function Amount({
	label,
	value,
	tone = "text-foreground",
}: {
	label: string;
	value: string;
	tone?: string;
}) {
	return (
		<div>
			<dt className="text-xs text-muted-foreground">{label}</dt>
			<dd className={`mt-1 font-semibold tabular-nums ${tone}`}>{value}</dd>
		</div>
	);
}

function PaymentList({
	view,
	money,
	onChanged,
}: {
	view: View;
	money: (minor: number) => string;
	onChanged: () => Promise<void>;
}) {
	const [confirming, setConfirming] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	if (view.payments.length === 0) {
		return <p className="text-sm text-muted-foreground">No payments yet.</p>;
	}

	async function onVoid(paymentId: string) {
		setBusy(true);
		try {
			await voidDocumentPayment({
				data: { documentId: view.document.id, paymentId },
			});
			setConfirming(null);
			await onChanged();
			toast.success("Payment voided");
		} catch (err) {
			toast.error(errorMessage(err));
		} finally {
			setBusy(false);
		}
	}

	return (
		<ul className="divide-y rounded-md border text-sm">
			{view.payments.map((p) => {
				const voided = Boolean(p.voidedAt);
				return (
					<li
						key={p.id}
						className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
					>
						<div
							className={
								voided ? "text-muted-foreground line-through" : undefined
							}
						>
							<span className="font-medium tabular-nums">
								{money(p.amountMinor)}
							</span>
							<span className="text-muted-foreground">
								{" "}
								· {p.receivedOn}
								{p.method
									? ` · ${PAYMENT_METHOD_LABELS[p.method as PaymentMethod] ?? p.method}`
									: ""}
								{p.reference ? ` · Ref ${p.reference}` : ""}
							</span>
							{p.note ? (
								<p className="text-xs text-muted-foreground">{p.note}</p>
							) : null}
						</div>
						{voided ? (
							<span className="text-xs text-muted-foreground">Voided</span>
						) : confirming === p.id ? (
							<div className="flex gap-1">
								<Button
									size="xs"
									variant="destructive"
									disabled={busy}
									onClick={() => onVoid(p.id)}
								>
									{busy ? "Voiding…" : "Confirm void"}
								</Button>
								<Button
									size="xs"
									variant="ghost"
									disabled={busy}
									onClick={() => setConfirming(null)}
								>
									Cancel
								</Button>
							</div>
						) : (
							<Button
								size="xs"
								variant="ghost"
								onClick={() => setConfirming(p.id)}
							>
								Void payment
							</Button>
						)}
					</li>
				);
			})}
		</ul>
	);
}

function RecordPaymentForm({
	view,
	onChanged,
}: {
	view: View;
	onChanged: () => Promise<void>;
}) {
	const doc = view.document;
	const [amount, setAmount] = useState("");
	const [receivedOn, setReceivedOn] = useState(localToday);
	const [method, setMethod] = useState<PaymentMethod | "">("");
	const [reference, setReference] = useState("");
	const [note, setNote] = useState("");
	const [busy, setBusy] = useState<"record" | "mark" | null>(null);

	const details = () => ({
		documentId: doc.id,
		receivedOn,
		method: method || undefined,
		reference,
		note,
	});

	async function onRecord(e: FormEvent) {
		e.preventDefault();
		setBusy("record");
		try {
			await recordDocumentPayment({
				data: { ...details(), amount, currency: doc.currency },
			});
			setAmount("");
			setReference("");
			setNote("");
			await onChanged();
			toast.success("Payment recorded");
		} catch (err) {
			toast.error(errorMessage(err));
		} finally {
			setBusy(null);
		}
	}

	async function onMarkPaid() {
		setBusy("mark");
		try {
			const { amountMinor } = await markDocumentPaid({ data: details() });
			setAmount("");
			setReference("");
			setNote("");
			await onChanged();
			toast.success(
				`Marked as paid (${formatMoney({ minor: amountMinor, currency: doc.currency })})`,
			);
		} catch (err) {
			toast.error(errorMessage(err));
		} finally {
			setBusy(null);
		}
	}

	return (
		<form onSubmit={onRecord} className="space-y-4">
			<p className="text-sm font-medium">Record payment</p>
			<div className="grid gap-4 sm:grid-cols-2">
				<div className="space-y-1.5">
					<Label htmlFor="payment-amount">Amount ({doc.currency})</Label>
					<Input
						id="payment-amount"
						inputMode="decimal"
						placeholder="0.00"
						value={amount}
						onChange={(e) => setAmount(e.target.value)}
					/>
				</div>
				<div className="space-y-1.5">
					<Label htmlFor="payment-date">Received on</Label>
					<Input
						id="payment-date"
						type="date"
						value={receivedOn}
						onChange={(e) => setReceivedOn(e.target.value)}
					/>
				</div>
				<div className="space-y-1.5">
					<Label htmlFor="payment-method">Method</Label>
					<select
						id="payment-method"
						value={method}
						onChange={(e) => setMethod(e.target.value as PaymentMethod | "")}
						className={selectClass}
					>
						<option value="">Not specified</option>
						{PAYMENT_METHODS.map((m) => (
							<option key={m} value={m}>
								{PAYMENT_METHOD_LABELS[m]}
							</option>
						))}
					</select>
				</div>
				<div className="space-y-1.5">
					<Label htmlFor="payment-reference">Reference</Label>
					<Input
						id="payment-reference"
						placeholder="Check no., transfer ID…"
						maxLength={100}
						value={reference}
						onChange={(e) => setReference(e.target.value)}
					/>
				</div>
				<div className="space-y-1.5 sm:col-span-2">
					<Label htmlFor="payment-note">Note</Label>
					<Textarea
						id="payment-note"
						maxLength={500}
						value={note}
						onChange={(e) => setNote(e.target.value)}
					/>
				</div>
			</div>
			<div className="flex flex-wrap justify-end gap-2">
				<Button
					type="button"
					variant="outline"
					disabled={busy !== null}
					onClick={onMarkPaid}
				>
					<CheckCircle2 />
					{busy === "mark" ? "Saving…" : "Mark as paid"}
				</Button>
				<Button type="submit" disabled={busy !== null || amount.trim() === ""}>
					<Plus />
					{busy === "record" ? "Saving…" : "Record payment"}
				</Button>
			</div>
		</form>
	);
}

function VoidDocumentControl({
	documentId,
	blocked,
	onChanged,
}: {
	documentId: string;
	blocked: boolean;
	onChanged: () => Promise<void>;
}) {
	const [open, setOpen] = useState(false);
	const [reason, setReason] = useState("");
	const [busy, setBusy] = useState(false);

	async function onConfirm() {
		setBusy(true);
		try {
			await voidIssuedDocument({ data: { documentId, reason } });
			setOpen(false);
			setReason("");
			await onChanged();
			toast.success("Document voided");
		} catch (err) {
			toast.error(errorMessage(err));
		} finally {
			setBusy(false);
		}
	}

	if (!open) {
		return (
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p className="text-xs text-muted-foreground">
					{blocked
						? "Void the payments first to void this document."
						: "Voiding keeps the number; it can't be undone."}
				</p>
				<Button
					variant="outline"
					size="sm"
					disabled={blocked}
					onClick={() => setOpen(true)}
				>
					<Ban />
					Void document
				</Button>
			</div>
		);
	}

	return (
		<div className="space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
			<div className="space-y-1.5">
				<Label htmlFor="void-reason">Reason for voiding</Label>
				<Textarea
					id="void-reason"
					maxLength={500}
					placeholder="e.g. Issued to the wrong client"
					value={reason}
					onChange={(e) => setReason(e.target.value)}
				/>
			</div>
			<p className="text-xs text-muted-foreground">
				The document stays on record with its number, marked Void. This can't be
				undone.
			</p>
			<div className="flex justify-end gap-2">
				<Button
					variant="ghost"
					size="sm"
					disabled={busy}
					onClick={() => setOpen(false)}
				>
					Cancel
				</Button>
				<Button
					variant="destructive"
					size="sm"
					disabled={busy || reason.trim() === ""}
					onClick={onConfirm}
				>
					{busy ? "Voiding…" : "Confirm void"}
				</Button>
			</div>
		</div>
	);
}
