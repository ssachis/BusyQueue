/** Plain-language lines for the activity log. Pure, so it is easy to test. */
import type { ActivityKind } from "#/lib/documents/types.ts";
import { TYPE_LABEL } from "../preview/format.ts";

type Detail = Record<string, unknown> | null;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const label = (type: unknown) =>
	typeof type === "string" && type in TYPE_LABEL
		? TYPE_LABEL[type as keyof typeof TYPE_LABEL].toLowerCase()
		: "document";

export function describeActivity(kind: string, detail: Detail): string {
	const d = detail ?? {};
	switch (kind as ActivityKind) {
		case "created": {
			if (str(d.convertedFrom)) {
				const from = str(d.number);
				return from ? `Created from ${from}` : "Created from another document";
			}
			if (str(d.duplicatedFrom)) {
				const from = str(d.number);
				return from ? `Copied from ${from}` : "Copied from another document";
			}
			return "Draft created";
		}
		case "edited":
			return "Draft edited";
		case "issued":
			return str(d.number) ? `Issued as ${str(d.number)}` : "Issued";
		case "payment_recorded":
			return "Payment recorded";
		case "payment_voided":
			return "Payment voided";
		case "marked_paid":
			return "Marked as paid";
		case "voided":
			return "Voided";
		case "converted":
			return `Converted to ${label(d.to)}`;
		case "duplicated":
			return "Duplicated";
		default:
			return kind;
	}
}
