/**
 * Read-only page for issued and void documents. Renders only the FROZEN
 * snapshot columns (seller, buyer, tax result) written on issue, so later
 * changes to the business or tax rules never alter a document already sent.
 */
import { PageBody, PageHeader } from "#/components/app-shell.tsx";
import { IssueButton } from "#/components/documents/issue-button.tsx";
import { PaymentsPanel } from "#/components/documents/payments-panel.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import type { DocumentPageData } from "#/server/documents/drafts-store.ts";
import { DocumentPreview, type PreviewTotals } from "./document-preview.tsx";
import {
	formatDate,
	STATUS_LABEL,
	STATUS_VARIANT,
	TYPE_LABEL,
} from "./format.ts";

export function DocumentView({ data }: { data: DocumentPageData }) {
	const { document: doc, lines, seller, accentColor } = data;
	const totals: PreviewTotals = doc.taxResult
		? { ok: true, result: doc.taxResult }
		: { ok: false, message: "This document has no frozen totals." };

	return (
		<>
			<PageHeader
				title={
					<span className="flex items-center gap-3">
						{TYPE_LABEL[doc.type]} {doc.number}
						<Badge variant={STATUS_VARIANT[doc.status]}>
							{STATUS_LABEL[doc.status]}
						</Badge>
					</span>
				}
				description={
					doc.status === "void"
						? `Voided${doc.voidedAt ? ` ${formatDate(doc.voidedAt.slice(0, 10))}` : ""}${doc.voidReason ? `: ${doc.voidReason}` : ""}.`
						: `Issued${doc.issuedAt ? ` ${formatDate(doc.issuedAt.slice(0, 10))}` : ""}. Issued documents can't be edited.`
				}
			>
				<IssueButton documentId={doc.id} status={doc.status} />
			</PageHeader>
			<PageBody>
				<div className="grid items-start gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
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
					<div className="min-w-0 space-y-6">
						<PaymentsPanel documentId={doc.id} status={doc.status} />
					</div>
				</div>
			</PageBody>
		</>
	);
}
