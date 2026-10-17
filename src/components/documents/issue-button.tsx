/**
 * Slot for issuing (#16). The document page renders this; #16 replaces the
 * body with the real Issue button (assigns the number, snapshots, locks).
 * Keep the props: the page passes exactly these.
 */
export interface IssueButtonProps {
	documentId: string;
	status: "draft" | "issued" | "void";
}

export function IssueButton(_props: IssueButtonProps) {
	return null;
}
