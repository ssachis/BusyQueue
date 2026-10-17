/**
 * Duplicate (#18), server-only: copy any document (draft, issued or void) as
 * a new draft of the same type, with a `duplicated` link and activity on both
 * documents, in one D1 batch. The source is never written.
 *
 * Import only from server-function handlers (duplicate.ts).
 */
import { planDuplicate } from "#/lib/documents/conversions.ts";
import {
	loadSource,
	type NewDraftResult,
	todayUtc,
	writeDraftFrom,
} from "./convert-store.ts";

export async function duplicateAsDraft(
	documentId: string,
	today: string = todayUtc(),
): Promise<NewDraftResult> {
	const { document: source, lines } = await loadSource(documentId);
	return writeDraftFrom({
		source,
		draft: planDuplicate({ ...source, lines }, today),
		linkKind: "duplicated",
		activity: "duplicated",
	});
}
