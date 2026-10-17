/**
 * Plain-language lines for the activity timeline. Pure: turns one activity
 * entry (as returned by `getDocumentHistory`) into a title, an optional
 * detail line and a tone. Amounts are formatted from the exact minor units
 * the log recorded; nothing is computed here.
 */
import { DOCUMENT_TYPE_NAMES } from "#/lib/documents/conversions.ts";
import {
	PAYMENT_METHOD_LABELS,
	type PaymentMethod,
} from "#/lib/documents/status.ts";
import { DOCUMENT_TYPES, type DocumentType } from "#/lib/documents/types.ts";
import { formatMoney, isCurrencyCode } from "#/lib/money/index.ts";

type DetailValue = string | number | boolean | null;

export interface ActivityLike {
	kind: string;
	detail: Record<string, DetailValue> | null;
	related: {
		id: string;
		type: DocumentType;
		number: string | null;
		status: "draft" | "issued" | "void";
	} | null;
}

export type ActivityTone =
	| "muted"
	| "info"
	| "success"
	| "warning"
	| "destructive";

export interface ActivityLine {
	title: string;
	detail?: string;
	tone: ActivityTone;
	/** The other document the entry points at, to link to. */
	link?: { documentId: string; label: string };
}

const str = (v: DetailValue | undefined) =>
	typeof v === "string" && v.trim() ? v.trim() : undefined;

function money(detail: Record<string, DetailValue> | null): string | undefined {
	const minor = detail?.amountMinor ?? detail?.totalMinor;
	const currency = detail?.currency;
	if (
		typeof minor !== "number" ||
		!Number.isSafeInteger(minor) ||
		typeof currency !== "string" ||
		!isCurrencyCode(currency)
	) {
		return undefined;
	}
	return formatMoney({ minor, currency });
}

function typeName(value: DetailValue | undefined): string {
	return typeof value === "string" &&
		(DOCUMENT_TYPES as readonly string[]).includes(value)
		? DOCUMENT_TYPE_NAMES[value as DocumentType]
		: "document";
}

/** "invoice INV-0012", "invoice (draft)" or "invoice (deleted draft)". */
function relatedLabel(entry: ActivityLike): string {
	const r = entry.related;
	if (!r) return `${typeName(entry.detail?.type)} (deleted draft)`;
	const name = DOCUMENT_TYPE_NAMES[r.type];
	if (r.number)
		return `${name} ${r.number}${r.status === "void" ? " (void)" : ""}`;
	return `${name} (draft)`;
}

function relatedLink(entry: ActivityLike): ActivityLine["link"] {
	const r = entry.related;
	return r ? { documentId: r.id, label: relatedLabel(entry) } : undefined;
}

const joinParts = (parts: (string | undefined)[]) =>
	parts.filter(Boolean).join(" · ") || undefined;

export function describeActivity(entry: ActivityLike): ActivityLine {
	const d = entry.detail;
	switch (entry.kind) {
		case "created":
			return { title: "Created as a draft", tone: "muted" };
		case "edited":
			return { title: "Draft edited", tone: "muted" };
		case "issued":
			return {
				title: str(d?.number) ? `Issued as ${str(d?.number)}` : "Issued",
				detail: money(d) ? `Total ${money(d)}` : undefined,
				tone: "info",
			};
		case "payment_recorded":
		case "marked_paid": {
			const method = str(d?.method);
			return {
				title: `${entry.kind === "marked_paid" ? "Marked as paid" : "Payment recorded"}${money(d) ? `: ${money(d)}` : ""}`,
				detail: joinParts([
					str(d?.receivedOn) ? `Received ${str(d?.receivedOn)}` : undefined,
					method
						? (PAYMENT_METHOD_LABELS[method as PaymentMethod] ?? method)
						: undefined,
					str(d?.reference) ? `Ref ${str(d?.reference)}` : undefined,
				]),
				tone: "success",
			};
		}
		case "payment_voided":
			return {
				title: `Payment voided${money(d) ? `: ${money(d)}` : ""}`,
				detail: str(d?.reason),
				tone: "warning",
			};
		case "voided":
			return {
				title: "Voided",
				detail: str(d?.reason) ? `Reason: ${str(d?.reason)}` : undefined,
				tone: "destructive",
			};
		case "converted": {
			const credits = d?.linkKind === "credits";
			const outgoing = d?.direction === "to";
			const label = relatedLabel(entry);
			const title = outgoing
				? credits
					? `Credited by ${label}`
					: `Converted to ${label}`
				: credits
					? `Created as a credit against ${label}`
					: `Converted from ${label}`;
			return { title, tone: "info", link: relatedLink(entry) };
		}
		case "duplicated": {
			const outgoing = d?.direction === "to";
			return {
				title: outgoing
					? `Duplicated as ${relatedLabel(entry)}`
					: `Duplicated from ${relatedLabel(entry)}`,
				tone: "muted",
				link: relatedLink(entry),
			};
		}
		default:
			return {
				title: entry.kind
					.replaceAll("_", " ")
					.replace(/^./, (c) => c.toUpperCase()),
				tone: "muted",
			};
	}
}
