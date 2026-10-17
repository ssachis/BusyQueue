/**
 * Read-only page for issued and void documents. Renders only the FROZEN
 * snapshot columns (seller, buyer, tax result) written on issue, so later
 * changes to the business or tax rules never alter a document already sent.
 *
 * Layout: the document on the left; actions, payments and history on the
 * right. Narrow screens stack actions, the document, then payments and
 * history.
 */
import { useQuery } from "@tanstack/react-query";
import { PageBody, PageHeader } from "#/components/app-shell.tsx";
import { ConvertMenu } from "#/components/documents/convert-menu.tsx";
import { HistoryPanel } from "#/components/documents/history/history-panel.tsx";
import {
	PaymentsPanel,
	paymentsQueryFn,
	paymentsQueryKey,
} from "#/components/documents/payments-panel.tsx";
import { PrintButton } from "#/components/print/print-button.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "#/components/ui/card.tsx";
import { conversionTargets } from "#/lib/documents/conversion.ts";
import type { DisplayStatus } from "#/lib/documents/types.ts";
import type { DocumentPageData } from "#/server/documents/drafts-store.ts";
import { DocumentPreview, type PreviewTotals } from "./document-preview.tsx";
import {
	DISPLAY_STATUS_LABEL,
	DISPLAY_STATUS_VARIANT,
	formatDate,
	TYPE_LABEL,
} from "./format.ts";

export function DocumentView({ data }: { data: DocumentPageData }) {
	const { document: doc, lines, seller, accentColor } = data;
	const totals: PreviewTotals = doc.taxResult
		? { ok: true, result: doc.taxResult }
		: { ok: false, message: "This document has no frozen totals." };
	const status = doc.status === "void" ? "void" : "issued";
	// Same query as the payments panel, so the badge follows payments live.
	const payments = useQuery({
		queryKey: paymentsQueryKey(doc.id, status),
		queryFn: paymentsQueryFn(doc.id),
		staleTime: 0,
	});
	const display: DisplayStatus =
		payments.data?.summary.displayStatus ?? doc.status;
	const canConvert = conversionTargets(doc.type, doc.status).length > 0;

	const actions = (
		<Card className="gap-4">
			<CardHeader>
				<CardTitle>Actions</CardTitle>
			</CardHeader>
			<CardContent className="space-y-3">
				<div className="flex flex-wrap gap-2">
					<PrintButton documentId={doc.id} />
					<ConvertMenu
						documentId={doc.id}
						type={doc.type}
						status={doc.status}
					/>
				</div>
				<p className="text-xs text-muted-foreground">
					{doc.status === "void"
						? "A void document keeps its number. Duplicate it to start a new draft."
						: canConvert
							? "Converting or duplicating opens a new draft; this document stays as issued."
							: "Duplicating opens a new draft; this document stays as issued."}
				</p>
			</CardContent>
		</Card>
	);

	return (
		<>
			<PageHeader
				title={
					<span className="flex flex-wrap items-center gap-3">
						{TYPE_LABEL[doc.type]} {doc.number}
						<Badge variant={DISPLAY_STATUS_VARIANT[display]}>
							{DISPLAY_STATUS_LABEL[display]}
						</Badge>
					</span>
				}
				description={
					doc.status === "void"
						? `Voided${doc.voidedAt ? ` ${formatDate(doc.voidedAt.slice(0, 10))}` : ""}${doc.voidReason ? `: ${doc.voidReason}` : ""}.`
						: `Issued${doc.issuedAt ? ` ${formatDate(doc.issuedAt.slice(0, 10))}` : ""}${doc.dueDate ? `, due ${formatDate(doc.dueDate)}` : ""}. Issued documents can't be edited.`
				}
			/>
			<PageBody>
				<div className="grid items-start gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
					{/* Narrow screens: actions, then the document, then payments and history. */}
					<div className="min-w-0 space-y-6">
						<div className="xl:hidden">{actions}</div>
						<DocumentPreview
							doc={{
								type: doc.type,
								status: doc.status,
								number: doc.number,
								date: doc.date,
								dueDate: doc.dueDate,
								currency: doc.currency,
								seller,
								buyer: doc.buyer,
								placeOfSupply: doc.placeOfSupply,
								notes: doc.notes,
								terms: doc.terms,
								lines,
							}}
							totals={totals}
							accentColor={accentColor}
						/>
					</div>
					<div className="min-w-0 space-y-6">
						<div className="hidden xl:block">{actions}</div>
						<PaymentsPanel documentId={doc.id} status={doc.status} />
						<HistoryPanel documentId={doc.id} />
					</div>
				</div>
			</PageBody>
		</>
	);
}
