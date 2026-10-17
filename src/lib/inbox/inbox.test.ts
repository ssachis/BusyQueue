import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	type ClassifyInput,
	classifyAttachment,
	matchVendor,
	parseClassificationReply,
} from "./classify.ts";
import {
	invoiceDedupeKey,
	normalizeInvoiceNumber,
	sha256Hex,
} from "./dedupe.ts";
import { buildEml } from "./eml.ts";
import { parseEmail } from "./mime.ts";
import { bodyExcerpt, emailDomain, redact } from "./redact.ts";
import { isAllowedSender } from "./senders.ts";
import { messageKind, messageStatus } from "./types.ts";

const fixture = readFileSync(
	resolve(__dirname, "fixtures/carrier-invoice.eml"),
);
const VENDORS = [
	"Coastal Carriers",
	"Ridgeline Freight Lines",
	"Summit Drayage",
];
const PNG = Uint8Array.from(
	atob(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
	),
	(c) => c.charCodeAt(0),
);

describe("parseEmail (fixture .eml)", () => {
	it("reads the envelope fields", async () => {
		const email = await parseEmail(fixture);
		expect(email.messageId).toBe(
			"<rfl-20417.20260902@mail.ridgelinefreight.com>",
		);
		expect(email.from).toEqual({
			address: "billing@ridgelinefreight.com",
			name: "Ridgeline Freight Billing",
		});
		expect(email.to).toEqual(["invoices@in.buddhsentripathi.com"]);
		expect(email.subject).toBe("Invoice RFL-20417 – PRO 7731045");
		expect(email.sentAt).toBe("2026-09-02T14:15:00.000Z");
		expect(email.text).toContain("Columbus cross-dock");
	});

	it("maps every MIME part to an attachment with a sniffed type", async () => {
		const { attachments } = await parseEmail(fixture);
		expect(attachments.map(({ bytes: _, ...rest }) => rest)).toEqual([
			{
				index: 0,
				filename: "attachment-1.png",
				declaredType: "image/png",
				detectedType: "image/png",
				inline: true,
				size: 70,
			},
			{
				index: 1,
				filename: "Invoice_RFL-20417.pdf",
				// The sender said octet-stream; the bytes say PDF.
				declaredType: "application/octet-stream",
				detectedType: "application/pdf",
				inline: false,
				size: 77,
			},
			{
				index: 2,
				filename: "delivery-notes.txt",
				declaredType: "text/plain",
				detectedType: null,
				inline: false,
				size: 31,
			},
		]);
	});

	it("round-trips a message built by buildEml", async () => {
		const raw = buildEml({
			from: "Coastal Carriers <billing@coastal.example>",
			to: "invoices@in.buddhsentripathi.com",
			subject: "Invoice CC-3301",
			text: "See attached.",
			attachments: [
				{ filename: "cc-3301.png", contentType: "image/png", bytes: PNG },
			],
			messageId: "<sim-1@example.invalid>",
			date: new Date("2026-10-17T10:00:00Z"),
		});
		const email = await parseEmail(raw);
		expect(email.messageId).toBe("<sim-1@example.invalid>");
		expect(email.from.address).toBe("billing@coastal.example");
		expect(email.sentAt).toBe("2026-10-17T10:00:00.000Z");
		expect(email.attachments).toHaveLength(1);
		expect(email.attachments[0]?.bytes).toEqual(PNG);
		expect(email.attachments[0]?.detectedType).toBe("image/png");
	});
});

const base: ClassifyInput = {
	filename: "scan.pdf",
	detectedType: "application/pdf",
	inline: false,
	size: 90_000,
	subject: "",
	text: "",
	senderAddress: "someone@example.com",
	senderName: null,
	ownDomains: ["atlas-logistics.example"],
	businessName: "Atlas Logistics Group, Inc.",
	vendors: VENDORS,
};

describe("classifyAttachment", () => {
	it("ignores files the import can't read and inline logos", () => {
		expect(classifyAttachment({ ...base, detectedType: null })).toMatchObject({
			kind: "ignore",
			confidence: "high",
		});
		expect(
			classifyAttachment({
				...base,
				detectedType: "image/png",
				inline: true,
				size: 4_000,
			}),
		).toMatchObject({ kind: "ignore", confidence: "high" });
	});

	it("reads a vendor invoice from the filename or subject", () => {
		const c = classifyAttachment({
			...base,
			filename: "Invoice_RFL-20417.pdf",
			senderAddress: "billing@ridgelinefreight.com",
		});
		expect(c).toMatchObject({
			kind: "invoice_in",
			confidence: "high",
			vendor: "Ridgeline Freight Lines",
		});
		expect(
			classifyAttachment({ ...base, subject: "Fwd: Inv 20431 for load 88213" }),
		).toMatchObject({ kind: "invoice_in", confidence: "high" });
	});

	it("spots contracts and tenders", () => {
		expect(
			classifyAttachment({
				...base,
				filename: "Rate-Agreement-2026.pdf",
				subject: "Signed rate agreement",
			}),
		).toMatchObject({ kind: "contract", confidence: "high" });
	});

	it("spots our own documents sent back to us", () => {
		expect(
			classifyAttachment({
				...base,
				senderAddress: "accounts@atlas-logistics.example",
				filename: "INV-0007.pdf",
			}),
		).toMatchObject({ kind: "invoice_out", confidence: "high" });
		expect(
			classifyAttachment({
				...base,
				subject: "Invoice INV-0003 from Atlas Logistics",
			}),
		).toMatchObject({ kind: "invoice_out", confidence: "high" });
	});

	it("is unsure without wording, so the model decides", () => {
		expect(
			classifyAttachment({ ...base, senderName: "Summit Drayage" }),
		).toMatchObject({
			kind: "invoice_in",
			confidence: "low",
			vendor: "Summit Drayage",
		});
		expect(classifyAttachment(base)).toMatchObject({
			kind: "ignore",
			confidence: "low",
		});
		expect(
			classifyAttachment({ ...base, subject: "Invoice and renewal contract" }),
		).toMatchObject({ confidence: "low" });
	});
});

describe("matchVendor", () => {
	const m = (over: Partial<ClassifyInput>) =>
		matchVendor({ ...base, ...over })?.vendor ?? null;
	it("matches by display name, domain or a mention in forwarded text", () => {
		expect(m({ senderName: "RIDGELINE FREIGHT LINES INC" })).toBe(
			"Ridgeline Freight Lines",
		);
		expect(m({ senderAddress: "billing@ridgelinefreight.com" })).toBe(
			"Ridgeline Freight Lines",
		);
		expect(m({ senderAddress: "ar@coastal-carriers.net" })).toBe(
			"Coastal Carriers",
		);
		expect(
			m({
				text: "---------- Forwarded message ---------\nFrom: Summit Drayage",
			}),
		).toBe("Summit Drayage");
		expect(m({ senderAddress: "me@gmail.com" })).toBeNull();
	});
});

describe("parseClassificationReply", () => {
	it("accepts fenced JSON and rejects anything off-schema", () => {
		expect(
			parseClassificationReply(
				'```json\n{"kind":"contract","reason":"A signed rate agreement"}\n```',
			),
		).toEqual({
			ok: true,
			value: { kind: "contract", reason: "A signed rate agreement" },
		});
		expect(parseClassificationReply('{"kind":"receipt","reason":"x"}').ok).toBe(
			false,
		);
		expect(parseClassificationReply("I think it is an invoice").ok).toBe(false);
	});
});

describe("dedupe keys", () => {
	it("hashes bytes as hex SHA-256", async () => {
		expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		);
	});

	it("normalises invoice numbers", () => {
		expect(normalizeInvoiceNumber("No. rfl-20417")).toBe("RFL20417");
		expect(normalizeInvoiceNumber("#CC 3301")).toBe("CC3301");
		expect(normalizeInvoiceNumber(" - ")).toBeNull();
	});

	it("collides on vendor spelling variants, not on different vendors", () => {
		const a = invoiceDedupeKey(
			"RIDGELINE FREIGHT LINES INC",
			"RFL-20417",
			VENDORS,
		);
		expect(a).toBe("ridgeline freight lines|RFL20417");
		expect(invoiceDedupeKey("Ridgeline Freight", "rfl 20417", VENDORS)).toBe(a);
		expect(invoiceDedupeKey("Coastal Carriers", "RFL-20417", VENDORS)).not.toBe(
			a,
		);
		expect(invoiceDedupeKey("Unknown Trucking Co", "77", VENDORS)).toBe(
			"unknown trucking|77",
		);
		expect(
			invoiceDedupeKey("Ridgeline Freight Lines", null, VENDORS),
		).toBeNull();
		expect(invoiceDedupeKey("", "RFL-20417", VENDORS)).toBeNull();
	});
});

describe("redact", () => {
	it("removes email addresses, phone numbers and street addresses", () => {
		expect(
			redact(
				"Call Dana at (555) 201-3344 or +44 20 7946 0958, mail dana.ortiz@ridgelinefreight.com.",
			),
		).toBe("Call Dana at [phone] or [phone], mail [email].");
		expect(
			redact("Ridgeline Freight Lines, 4100 Rail Yard Road, Suite 4, Joliet"),
		).toBe("Ridgeline Freight Lines, [address], Joliet");
		expect(redact("Ship to 1200 Dock Street; PO Box 77")).toBe(
			"Ship to [address]; [address]",
		);
		expect(redact("<mailto:ap@x.com> tel:+15552013344")).toBe(
			"<[email]> [phone]",
		);
	});

	it("keeps invoice numbers, dates, amounts and quantities", () => {
		const text =
			"Invoice RFL-20417 dated 2026-09-02, PRO 7731045, 6 pallets at $1,240.00, total 1,786.80 (+12.50 fee)";
		expect(redact(text)).toBe(text);
	});

	it("keeps only the body above the signature for the model", () => {
		const text =
			"Hi,\n\nFreight charges for load 88213 attached.\n---------- Forwarded message ---------\nFrom: Dana Ortiz <dana@ridgelinefreight.com>\nTo: ap@atlas-logistics.example\n\nThanks,\nDana Ortiz, Billing\n(815) 555-0187\n4100 Rail Yard Road";
		const excerpt = bodyExcerpt(text);
		expect(excerpt).toBe(
			"Hi,\n\nFreight charges for load 88213 attached.\n---------- Forwarded message ---------\nFrom: [contact]\nTo: [contact]",
		);
		expect(bodyExcerpt("Invoice attached, call 555-201-3344", 20)).toBe(
			"Invoice attached, ca",
		);
	});

	it("is idempotent", () => {
		const once = redact("a@b.co 555-201-3344");
		expect(redact(once)).toBe(once);
	});

	it("extracts the sender domain only", () => {
		expect(emailDomain("AP@RidgelineFreight.com")).toBe("ridgelinefreight.com");
		expect(emailDomain("nobody")).toBeNull();
	});
});

describe("isAllowedSender", () => {
	const list = [
		"ap@ridgelinefreight.com",
		"@coastal-carriers.net",
		"summitdrayage.com",
	];
	it("allows exact addresses and whole domains, including subdomains", () => {
		expect(isAllowedSender("ap@ridgelinefreight.com", list)).toBe(true);
		expect(isAllowedSender("other@ridgelinefreight.com", list)).toBe(false);
		expect(isAllowedSender("x@coastal-carriers.net", list)).toBe(true);
		expect(isAllowedSender("x@mail.summitdrayage.com", list)).toBe(true);
		expect(isAllowedSender("x@evil-summitdrayage.com", list)).toBe(false);
		expect(isAllowedSender(null, list)).toBe(false);
	});
	it("allows everyone when the list is empty", () => {
		expect(isAllowedSender("anyone@anywhere.org", [])).toBe(true);
	});
});

describe("message roll-up", () => {
	it("takes the most actionable kind and status", () => {
		expect(messageKind(["ignore", "contract", "invoice_in"])).toBe(
			"invoice_in",
		);
		expect(messageKind([])).toBe("ignore");
		expect(messageStatus(["ignored", "duplicate", "ready_for_review"])).toBe(
			"ready_for_review",
		);
		expect(messageStatus(["ignored", "duplicate"])).toBe("duplicate");
		expect(messageStatus(["ignored"])).toBe("ignored");
		expect(messageStatus(["failed", "needs_manual"])).toBe("needs_manual");
	});
});
