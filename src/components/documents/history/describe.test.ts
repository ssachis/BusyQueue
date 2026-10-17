import { describe, expect, it } from "vitest";
import { type ActivityLike, describeActivity } from "./describe.ts";

const entry = (
	kind: string,
	detail: ActivityLike["detail"] = null,
	related: ActivityLike["related"] = null,
): ActivityLike => ({ kind, detail, related });

describe("describeActivity", () => {
	it("issued: number and frozen total", () => {
		expect(
			describeActivity(
				entry("issued", {
					number: "INV-0012",
					totalMinor: 123456,
					currency: "USD",
				}),
			),
		).toEqual({
			title: "Issued as INV-0012",
			detail: "Total $1,234.56",
			tone: "info",
		});
	});

	it("payments: amount, date, method and reference", () => {
		expect(
			describeActivity(
				entry("payment_recorded", {
					amountMinor: 12000,
					currency: "USD",
					receivedOn: "2026-10-02",
					method: "check",
					reference: "4471",
				}),
			),
		).toEqual({
			title: "Payment recorded: $120.00",
			detail: "Received 2026-10-02 · Check · Ref 4471",
			tone: "success",
		});
		expect(
			describeActivity(
				entry("marked_paid", { amountMinor: 500, currency: "EUR" }),
			).title,
		).toBe("Marked as paid: €5.00");
		expect(
			describeActivity(
				entry("payment_voided", {
					amountMinor: 500,
					currency: "USD",
					reason: "Bounced",
				}),
			),
		).toEqual({
			title: "Payment voided: $5.00",
			detail: "Bounced",
			tone: "warning",
		});
	});

	it("never shows an amount it can't format exactly", () => {
		expect(
			describeActivity(
				entry("payment_recorded", { amountMinor: 1.5, currency: "USD" }),
			).title,
		).toBe("Payment recorded");
	});

	it("voided with its reason", () => {
		expect(
			describeActivity(
				entry("voided", { reason: "Wrong school", number: "INV-1" }),
			),
		).toEqual({
			title: "Voided",
			detail: "Reason: Wrong school",
			tone: "destructive",
		});
	});

	it("converted, both directions, with a link to the other document", () => {
		const invoice = {
			id: "doc-inv",
			type: "invoice" as const,
			number: null,
			status: "draft" as const,
		};
		expect(
			describeActivity(
				entry("converted", { direction: "to", linkKind: "converted" }, invoice),
			),
		).toEqual({
			title: "Converted to invoice (draft)",
			tone: "info",
			link: { documentId: "doc-inv", label: "invoice (draft)" },
		});
		const quote = {
			id: "doc-q",
			type: "quote" as const,
			number: "QUO-0003",
			status: "issued" as const,
		};
		expect(
			describeActivity(
				entry("converted", { direction: "from", linkKind: "converted" }, quote),
			).title,
		).toBe("Converted from quote QUO-0003");
	});

	it("credit notes read as credits", () => {
		const cn = {
			id: "doc-cn",
			type: "credit_note" as const,
			number: "CN-0001",
			status: "issued" as const,
		};
		expect(
			describeActivity(
				entry("converted", { direction: "to", linkKind: "credits" }, cn),
			).title,
		).toBe("Credited by credit note CN-0001");
	});

	it("duplicates, and a deleted draft on the other end", () => {
		expect(
			describeActivity(
				entry("duplicated", { direction: "to", type: "invoice" }, null),
			),
		).toEqual({
			title: "Duplicated as invoice (deleted draft)",
			tone: "muted",
			link: undefined,
		});
	});

	it("unknown kinds still read", () => {
		expect(describeActivity(entry("sent_by_email")).title).toBe(
			"Sent by email",
		);
	});
});
