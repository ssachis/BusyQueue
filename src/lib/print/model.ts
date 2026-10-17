/**
 * The print model (#19): one display-ready shape that all four layouts
 * render. Pure: no I/O, no clock. Built on the server and sent to the page
 * as plain JSON.
 *
 * Where the numbers come from:
 * - Issued and void documents print their FROZEN snapshot (seller, totals,
 *   tax result, number), exactly as issued, even if the business profile or
 *   the tax rules changed since.
 * - Drafts are priced live with `documentTotals` and the current business
 *   (`sellerSnapshot`) and carry a DRAFT watermark.
 * Every amount is integer minor units formatted with `formatMoney`, or a
 * decimal string the user typed; nothing is computed with floats.
 */
import type { PaymentSummary } from "#/lib/documents/status.ts";
import { documentTotals } from "#/lib/documents/totals.ts";
import type {
	DisplayStatus,
	DocumentStatus,
	DocumentType,
	DraftLine,
	PartySnapshot,
} from "#/lib/documents/types.ts";
import {
	dec,
	formatMoney,
	lineAmount,
	type Money,
	toMinor,
} from "#/lib/money/index.ts";
import {
	documentHeading,
	EXEMPT,
	isTaxCountry,
	type LineTax,
	TaxError,
	type TaxResult,
	type TaxTotal,
} from "#/lib/tax/index.ts";
import {
	buyerTaxIdLabel,
	countryName,
	formatDate,
	formatQuantity,
	formatRate,
	formatUnitAmount,
	inkOn,
	inStateLabel,
	localeFor,
	taxRowLabel,
} from "./format.ts";

// ── Layout and paper (URL search params) ─────────────────────────────────────

export const PRINT_LAYOUTS = [
	"classic",
	"modern",
	"compact",
	"minimal",
] as const;
export type PrintLayout = (typeof PRINT_LAYOUTS)[number];

export const LAYOUT_LABELS: Record<PrintLayout, string> = {
	classic: "Classic",
	modern: "Modern",
	compact: "Compact",
	minimal: "Minimal",
};

export const PAPER_SIZES = ["a4", "letter"] as const;
export type PaperSize = (typeof PAPER_SIZES)[number];

export interface PrintSearch {
	layout?: PrintLayout;
	paper?: PaperSize;
}

/** `?layout=…&paper=…`; unknown values are dropped (defaults apply). */
export function parsePrintSearch(raw: Record<string, unknown>): PrintSearch {
	const out: PrintSearch = {};
	if ((PRINT_LAYOUTS as readonly unknown[]).includes(raw.layout)) {
		out.layout = raw.layout as PrintLayout;
	}
	if ((PAPER_SIZES as readonly unknown[]).includes(raw.paper)) {
		out.paper = raw.paper as PaperSize;
	}
	return out;
}

export const DEFAULT_LAYOUT: PrintLayout = "classic";
export const DEFAULT_PAPER: PaperSize = "a4";

// ── Model ────────────────────────────────────────────────────────────────────

export type SellerSnapshot = PartySnapshot & {
	taxIds?: { type: string; value: string }[];
};

export interface PrintParty {
	name: string;
	/** Address lines, then "City, Region Postal", then the country name. */
	lines: string[];
	taxIds: { label: string; value: string }[];
	email: string | null;
}

export interface PrintLine {
	lineNo: number;
	description: string;
	hsnSac: string | null;
	quantity: string;
	unit: string | null;
	unitPrice: string;
	discount: string | null;
	/** Combined rate of the line, e.g. "18%", or "Exempt". */
	tax: string;
	/** Net amount (quantity × unit price − discount), before tax. */
	amount: string;
}

export interface PrintTaxRow {
	label: string;
	taxable: string;
	amount: string;
}

export interface PrintModel {
	id: string;
	type: DocumentType;
	status: DocumentStatus;
	heading: string;
	number: string | null;
	date: string;
	dueDate: string | null;
	currency: string;
	/** "frozen" = the issued snapshot; "computed" = priced now (drafts). */
	source: "frozen" | "computed";
	watermark: "DRAFT" | "VOID" | null;
	seller: PrintParty;
	buyer: PrintParty;
	/** India only, e.g. "Maharashtra (27)". */
	placeOfSupply: string | null;
	columns: { hsnSac: boolean; unit: boolean; discount: boolean };
	lines: PrintLine[];
	taxRows: PrintTaxRow[];
	subtotal: string;
	/** Null when a draft can't be priced yet (see `problem`). */
	tax: string | null;
	total: string | null;
	totalLabel: string;
	payment: {
		status: DisplayStatus;
		/** Null when nothing has been paid yet. */
		paid: string | null;
		balance: string;
		overdue: boolean;
	} | null;
	/** Statutory notes from the tax result (reverse charge, export / LUT). */
	statutoryNotes: string[];
	notes: string | null;
	terms: string | null;
	voidReason: string | null;
	/** Why totals are missing or approximate, shown above the document. */
	problem: string | null;
	branding: {
		/** #rrggbb, or null to use the theme's primary colour. */
		accentColor: string | null;
		/** Readable text colour on the accent. */
		accentInk: "light" | "dark";
		logoUrl: string | null;
	};
	/** Printed in the page footer and used as the PDF title. */
	title: string;
}

/** The stored document fields print needs (a subset of the D1 row). */
export interface PrintDocumentInput {
	id: string;
	type: DocumentType;
	status: DocumentStatus;
	number: string | null;
	date: string;
	dueDate: string | null;
	currency: string;
	buyer: PartySnapshot;
	seller: SellerSnapshot | null;
	placeOfSupply: string | null;
	notes: string | null;
	terms: string | null;
	subtotalMinor: number | null;
	taxMinor: number | null;
	totalMinor: number | null;
	taxResult: TaxResult | null;
	voidReason: string | null;
}

export interface PrintInput {
	document: PrintDocumentInput;
	lines: DraftLine[];
	/** The current business as a seller; used for drafts only. Null if the profile is incomplete. */
	draftSeller: SellerSnapshot | null;
	branding: { accentColor: string | null; logoUrl: string | null };
	/** From `paymentSummary`; null for types that don't take payments. */
	payment: PaymentSummary | null;
}

/**
 * Frozen snapshot or live computation. Issued and void documents always
 * print what was frozen on issue; only drafts are priced now.
 */
export function choosePrintSource(doc: {
	status: DocumentStatus;
	seller: SellerSnapshot | null;
	taxResult: TaxResult | null;
	totalMinor: number | null;
}): "frozen" | "computed" | "missing" {
	if (doc.status === "draft") return "computed";
	if (doc.seller && doc.taxResult && doc.totalMinor !== null) return "frozen";
	return "missing";
}

/**
 * Tax totals as printed: one row per component and rate, in order of first
 * appearance (so CGST 9% sits next to SGST 9%), merging any repeats.
 */
export function groupTaxTotals(totals: readonly TaxTotal[]): TaxTotal[] {
	const out: TaxTotal[] = [];
	for (const t of totals) {
		const rate = dec(t.rate).toFixed();
		const existing = out.find((o) => o.code === t.code && o.rate === rate);
		if (existing) {
			existing.taxableMinor += t.taxableMinor;
			existing.amountMinor += t.amountMinor;
		} else {
			out.push({ ...t, rate });
		}
	}
	return out;
}

/** A line's combined rate ("18%" for CGST 9% + SGST 9%), or "Exempt". */
export function lineTaxLabel(
	line: Pick<DraftLine, "taxCode">,
	tax: Pick<LineTax, "components"> | undefined,
): string {
	if (line.taxCode === EXEMPT) return "Exempt";
	if (!tax || tax.components.length === 0) return "0%";
	const total = tax.components.reduce(
		(acc, c) => acc.plus(dec(c.rate)),
		dec("0"),
	);
	return formatRate(total.toFixed());
}

function partyLines(p: PartySnapshot, sellerCountry: string): string[] {
	const region =
		p.region && p.country === "IN" && sellerCountry === "IN"
			? inStateLabel(p.region)
			: p.region;
	const place = [p.city, [region, p.postalCode].filter(Boolean).join(" ")]
		.filter(Boolean)
		.join(", ");
	return [...p.addressLines, place, countryName(p.country)].filter(
		(l): l is string => Boolean(l?.trim()),
	);
}

function sellerParty(s: SellerSnapshot): PrintParty {
	const taxIds = s.taxIds?.length
		? s.taxIds.map((t) => ({ label: t.type, value: t.value }))
		: s.taxId
			? [{ label: buyerTaxIdLabel(s.country), value: s.taxId }]
			: [];
	return {
		name: s.name,
		lines: partyLines(s, s.country),
		taxIds,
		email: s.email ?? null,
	};
}

function buyerParty(b: PartySnapshot, sellerCountry: string): PrintParty {
	return {
		name: b.name,
		lines: partyLines(b, sellerCountry),
		taxIds: b.taxId?.trim()
			? [{ label: buyerTaxIdLabel(b.country), value: b.taxId }]
			: [],
		email: b.email ?? null,
	};
}

const TYPE_NAMES: Record<DocumentType, string> = {
	invoice: "Invoice",
	quote: "Quote",
	proforma: "Pro Forma Invoice",
	credit_note: "Credit Note",
	receipt: "Receipt",
	delivery_note: "Delivery Note",
};

function headingFor(
	country: string,
	type: DocumentType,
	reverseCharge: boolean,
): string {
	if (!isTaxCountry(country)) return TYPE_NAMES[type];
	return documentHeading(country, type, { reverseCharge });
}

/** Net of one line in minor units, for a draft the tax engine rejected. */
function netMinorOf(line: DraftLine, currency: string): number | null {
	try {
		const gross = lineAmount(line.quantity, line.unitPrice);
		const net = line.discount ? gross.minus(dec(line.discount)) : gross;
		return toMinor(net, currency).minor;
	} catch {
		return null;
	}
}

function placeOfSupplyLabel(
	seller: SellerSnapshot,
	doc: PrintDocumentInput,
	result: TaxResult | null,
): string | null {
	if (seller.country !== "IN") return null;
	if (result?.supplyType === "export" || doc.buyer.country !== "IN") {
		return `Outside India (${countryName(doc.buyer.country)})`;
	}
	const code = doc.placeOfSupply ?? doc.buyer.region;
	return code ? inStateLabel(code) : null;
}

/** Build the display model. Throws only on programmer error. */
export function buildPrintModel(input: PrintInput): PrintModel {
	const { document: doc, lines } = input;
	const source = choosePrintSource(doc);
	let problem: string | null = null;

	let seller: SellerSnapshot | null;
	let result: TaxResult | null = null;
	if (source === "frozen") {
		seller = doc.seller;
		result = doc.taxResult;
	} else {
		seller = source === "computed" ? input.draftSeller : doc.seller;
		if (source === "missing") {
			problem =
				"This document has no frozen totals; the figures below are recalculated with today's rules.";
		}
		if (!seller) {
			problem =
				"Complete the business profile (Settings) to print the seller details.";
		} else {
			try {
				result = documentTotals(seller, {
					buyer: doc.buyer,
					currency: doc.currency,
					placeOfSupply: doc.placeOfSupply ?? undefined,
					lines,
				});
			} catch (err) {
				if (!(err instanceof TaxError)) throw err;
				problem = `Totals can't be calculated yet: ${err.message}`;
			}
		}
	}

	const sellerOrBlank: SellerSnapshot = seller ?? {
		name: "Your business",
		addressLines: [],
		country: doc.buyer.country,
	};
	const country = sellerOrBlank.country;
	const locale = localeFor(country);
	const money = (minor: number) =>
		formatMoney({ minor, currency: doc.currency } satisfies Money, locale);

	const taxByLine = new Map(result?.lines.map((l) => [l.lineNo, l]) ?? []);
	let fallbackSubtotal = 0;
	const printLines: PrintLine[] = lines.map((l) => {
		const tax = taxByLine.get(l.lineNo);
		const net = tax ? tax.netMinor : netMinorOf(l, doc.currency);
		if (net !== null) fallbackSubtotal += net;
		return {
			lineNo: l.lineNo,
			description: l.description,
			hsnSac: l.hsnSac ?? null,
			quantity: formatQuantity(l.quantity, locale),
			unit: l.unit ?? null,
			unitPrice: formatUnitAmount(l.unitPrice, doc.currency, locale),
			discount:
				l.discount && !dec(l.discount).eq(dec("0"))
					? formatUnitAmount(l.discount, doc.currency, locale)
					: null,
			tax: result ? lineTaxLabel(l, tax) : "—",
			amount: net === null ? "—" : money(net),
		};
	});

	const taxRows: PrintTaxRow[] = result
		? groupTaxTotals(result.taxTotals).map((t) => ({
				label: taxRowLabel(t.code, t.rate),
				taxable: money(t.taxableMinor),
				amount: money(t.amountMinor),
			}))
		: [];

	// Frozen columns win for issued documents (they are what was issued).
	const subtotalMinor =
		source === "frozen"
			? (doc.subtotalMinor ?? result?.subtotalMinor ?? 0)
			: (result?.subtotalMinor ?? fallbackSubtotal);
	const taxMinor =
		source === "frozen"
			? (doc.taxMinor ?? result?.taxMinor ?? null)
			: (result?.taxMinor ?? null);
	const totalMinor =
		source === "frozen" ? doc.totalMinor : (result?.totalMinor ?? null);

	const payment =
		input.payment && doc.status === "issued"
			? {
					status: input.payment.displayStatus,
					paid:
						input.payment.paidMinor > 0 ? money(input.payment.paidMinor) : null,
					balance: money(Math.max(input.payment.balanceMinor, 0)),
					overdue: input.payment.overdue,
				}
			: null;

	const heading = headingFor(country, doc.type, result?.reverseCharge ?? false);
	const accent =
		input.branding.accentColor &&
		/^#[0-9a-f]{6}$/i.test(input.branding.accentColor)
			? input.branding.accentColor.toLowerCase()
			: null;

	return {
		id: doc.id,
		type: doc.type,
		status: doc.status,
		heading,
		number: doc.number,
		date: formatDate(doc.date),
		dueDate: doc.dueDate ? formatDate(doc.dueDate) : null,
		currency: doc.currency,
		source: source === "frozen" ? "frozen" : "computed",
		watermark:
			doc.status === "draft" ? "DRAFT" : doc.status === "void" ? "VOID" : null,
		seller: sellerParty(sellerOrBlank),
		buyer: buyerParty(doc.buyer, country),
		placeOfSupply: placeOfSupplyLabel(sellerOrBlank, doc, result),
		columns: {
			hsnSac: country === "IN" || lines.some((l) => Boolean(l.hsnSac)),
			unit: lines.some((l) => Boolean(l.unit)),
			discount: printLines.some((l) => l.discount !== null),
		},
		lines: printLines,
		taxRows,
		subtotal: money(subtotalMinor),
		tax: taxMinor === null ? null : money(taxMinor),
		total: totalMinor === null ? null : money(totalMinor),
		totalLabel: doc.type === "credit_note" ? "Total credit" : "Total",
		payment,
		statutoryNotes: result?.notes ?? [],
		notes: doc.notes?.trim() || null,
		terms: doc.terms?.trim() || null,
		voidReason: doc.status === "void" ? (doc.voidReason ?? null) : null,
		problem,
		branding: {
			accentColor: accent,
			accentInk: accent ? inkOn(accent) : "light",
			logoUrl: input.branding.logoUrl,
		},
		title: [heading, doc.number ?? "(draft)"].join(" "),
	};
}
