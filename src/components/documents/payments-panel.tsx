/**
 * Slot for payments (#17). The document page renders this; #17 replaces the
 * body with the real panel (record/void payments, balance, mark paid, void).
 * Keep the props: the page passes exactly these.
 */
export interface PaymentsPanelProps {
	documentId: string;
	status: "draft" | "issued" | "void";
}

export function PaymentsPanel(_props: PaymentsPanelProps) {
	return null;
}
