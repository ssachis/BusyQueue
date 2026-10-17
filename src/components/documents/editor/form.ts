/**
 * Pure editor logic: the form state the inputs bind to (all strings), its
 * mapping to and from `DocumentDraft`, line operations, and the live preview
 * totals. No React, no I/O, so it is unit-tested and runs on both sides.
 *
 * Numbers stay decimal strings end to end; totals come from `documentTotals`
 * (the tax engine), never from arithmetic here.
 */
import type { CatalogItemFields } from "#/lib/catalog/item.ts";
import {
	type ClientAddress,
	type ClientFormInput,
	clientToParty,
} from "#/lib/clients/client.ts";
import { documentTotals } from "#/lib/documents/totals.ts";
import {
	DocumentDraft,
	type DocumentType,
	type DraftLine,
	type PartySnapshot,
} from "#/lib/documents/types.ts";
import { isCurrencyCode, isDecimalString } from "#/lib/money/index.ts";
import {
	CA_PROVINCES,
	isTaxCountry,
	type TaxCodeOption,
	TaxError,
	type TaxResult,
	taxCodes,
	US_SALES,
} from "#/lib/tax/index.ts";

export interface LineForm {
	/** Stable React key; not saved. */
	key: string;
	description: string;
	quantity: string;
	unit: string;
	unitPrice: string;
	discount: string;
	taxCode: string;
	rate: string;
	hsnSac: string;
	catalogItemId?: string;
}

export interface BuyerForm {
	name: string;
	/** One address line per text line (max 4). */
	addressLines: string;
	city: string;
	region: string;
	postalCode: string;
	country: string;
	taxId: string;
	email: string;
}

export interface DraftForm {
	type: DocumentType;
	date: string;
	dueDate: string;
	currency: string;
	clientId?: string;
	buyer: BuyerForm;
	placeOfSupply: string;
	notes: string;
	terms: string;
	lines: LineForm[];
}

/** The seller fields that change what the editor shows. */
export interface SellerContext {
	country: string;
	region?: string;
	taxId?: string;
}

const blankToUndefined = (v: string): string | undefined => {
	const t = v.trim();
	return t === "" ? undefined : t;
};

const isAmount = (v: string) => isDecimalString(v) && !v.startsWith("-");

// --- DocumentDraft -> form --------------------------------------------------

export function formFromDraft(d: DocumentDraft): DraftForm {
	return {
		type: d.type,
		date: d.date,
		dueDate: d.dueDate ?? "",
		currency: d.currency,
		clientId: d.clientId,
		buyer: {
			name: d.buyer.name,
			addressLines: d.buyer.addressLines.join("\n"),
			city: d.buyer.city ?? "",
			region: d.buyer.region ?? "",
			postalCode: d.buyer.postalCode ?? "",
			country: d.buyer.country,
			taxId: d.buyer.taxId ?? "",
			email: d.buyer.email ?? "",
		},
		placeOfSupply: d.placeOfSupply ?? "",
		notes: d.notes ?? "",
		terms: d.terms ?? "",
		lines: d.lines.map((l) => ({
			key: `l${l.lineNo}`,
			description: l.description,
			quantity: l.quantity,
			unit: l.unit ?? "",
			unitPrice: l.unitPrice,
			discount: l.discount ?? "",
			taxCode: l.taxCode,
			rate: l.rate ?? "",
			hsnSac: l.hsnSac ?? "",
			catalogItemId: l.catalogItemId,
		})),
	};
}

// --- form -> DocumentDraft --------------------------------------------------

/**
 * The draft the form describes, before validation. Blank fields become
 * undefined, lines are numbered 1..n in display order, and fields that do
 * not apply to the seller country (place of supply, HSN/SAC) or tax code
 * (US rate) are dropped so stale values never reach the tax engine.
 */
export function draftCandidate(
	form: DraftForm,
	seller: Pick<SellerContext, "country">,
): DocumentDraft {
	const india = seller.country === "IN";
	return {
		type: form.type,
		date: form.date.trim(),
		dueDate: blankToUndefined(form.dueDate),
		currency: form.currency.trim().toUpperCase(),
		clientId: form.clientId,
		buyer: {
			name: form.buyer.name.trim(),
			addressLines: form.buyer.addressLines
				.split("\n")
				.map((l) => l.trim())
				.filter(Boolean),
			city: blankToUndefined(form.buyer.city),
			region: blankToUndefined(form.buyer.region)?.toUpperCase(),
			postalCode: blankToUndefined(form.buyer.postalCode),
			country: form.buyer.country.trim().toUpperCase(),
			taxId: blankToUndefined(form.buyer.taxId),
			email: blankToUndefined(form.buyer.email),
		},
		placeOfSupply: india ? blankToUndefined(form.placeOfSupply) : undefined,
		notes: blankToUndefined(form.notes),
		terms: blankToUndefined(form.terms),
		lines: form.lines.map(
			(l, i): DraftLine => ({
				lineNo: i + 1,
				description: l.description.trim(),
				quantity: l.quantity.trim(),
				unit: blankToUndefined(l.unit),
				unitPrice: l.unitPrice.trim(),
				discount: blankToUndefined(l.discount),
				taxCode: l.taxCode,
				rate: l.taxCode === US_SALES ? blankToUndefined(l.rate) : undefined,
				hsnSac: india ? blankToUndefined(l.hsnSac) : undefined,
				catalogItemId: l.catalogItemId,
			}),
		),
	};
}

export type ParsedDraft =
	| { ok: true; draft: DocumentDraft }
	| { ok: false; errors: Record<string, string> };

/**
 * Validate the form as a `DocumentDraft`. Errors are keyed by path, e.g.
 * `buyer.name` or `lines.0.unitPrice`, so inputs can look up their own.
 */
export function parseDraft(
	form: DraftForm,
	seller: Pick<SellerContext, "country">,
): ParsedDraft {
	const candidate = draftCandidate(form, seller);
	const errors: Record<string, string> = {};
	const parsed = DocumentDraft.safeParse(candidate);
	if (!parsed.success) {
		for (const issue of parsed.error.issues) {
			const key = issue.path.join(".");
			errors[key] ??= issue.message;
		}
	}
	candidate.lines.forEach((l, i) => {
		if (l.taxCode === US_SALES && l.rate === undefined) {
			errors[`lines.${i}.rate`] ??= "Enter the sales-tax rate";
		}
	});
	if (candidate.dueDate && candidate.dueDate < candidate.date) {
		errors.dueDate ??= "Due date is before the document date";
	}
	if (Object.keys(errors).length > 0 || !parsed.success) {
		return { ok: false, errors };
	}
	return { ok: true, draft: parsed.data };
}

// --- lines ------------------------------------------------------------------

/** A key no current line uses (deterministic, so SSR and client agree). */
export function nextLineKey(lines: readonly LineForm[]): string {
	const used = lines
		.map((l) => Number(/^l(\d+)$/.exec(l.key)?.[1] ?? 0))
		.filter(Number.isSafeInteger);
	return `l${Math.max(0, ...used) + 1}`;
}

export function blankLine(
	lines: readonly LineForm[],
	taxCode: string,
): LineForm {
	return {
		key: nextLineKey(lines),
		description: "",
		quantity: "1",
		unit: "",
		unitPrice: "",
		discount: "",
		taxCode,
		rate: "",
		hsnSac: "",
	};
}

/** Move the line at `from` to `to` (both clamped). Line numbers follow order. */
export function moveLine(
	lines: readonly LineForm[],
	from: number,
	to: number,
): LineForm[] {
	const next = [...lines];
	if (from < 0 || from >= next.length) return next;
	const target = Math.max(0, Math.min(next.length - 1, to));
	const [moved] = next.splice(from, 1);
	if (moved) next.splice(target, 0, moved);
	return next;
}

export function removeLine(
	lines: readonly LineForm[],
	index: number,
): LineForm[] {
	return lines.filter((_, i) => i !== index);
}

export function updateLine(
	lines: readonly LineForm[],
	index: number,
	patch: Partial<LineForm>,
): LineForm[] {
	return lines.map((l, i) => (i === index ? { ...l, ...patch } : l));
}

// --- tax codes --------------------------------------------------------------

/** The usual rate to start a new line on, where a country has several. */
const STANDARD_CODE: Partial<Record<string, string>> = {
	IN: "IN-GST-18",
	DE: "DE-VAT-19",
	FR: "FR-VAT-20",
	GB: "GB-VAT-20",
};

/**
 * Tax-code options for the seller country. Canada labels the combined rate
 * of the buyer's province (the engine's place of supply) when it is known.
 */
export function taxCodeOptions(
	seller: Pick<SellerContext, "country">,
	buyer: Pick<BuyerForm, "country" | "region">,
): TaxCodeOption[] {
	if (!isTaxCountry(seller.country)) return [];
	const region = buyer.region.trim().toUpperCase();
	const province =
		seller.country === "CA" &&
		buyer.country.trim().toUpperCase() === "CA" &&
		region in CA_PROVINCES
			? region
			: undefined;
	return taxCodes(seller.country, province);
}

export function defaultTaxCode(
	country: string,
	options: readonly TaxCodeOption[],
): string {
	const standard = STANDARD_CODE[country];
	if (standard && options.some((o) => o.code === standard)) return standard;
	return options[0]?.code ?? "";
}

// --- live preview -----------------------------------------------------------

export type PreviewTotals =
	| { ok: true; result: TaxResult; skipped: number[] }
	| { ok: false; message: string; skipped: number[] };

/** A line the tax engine can price: amounts are valid and US lines have a rate. */
export function lineIsComplete(l: DraftLine): boolean {
	if (!isAmount(l.quantity) || !isAmount(l.unitPrice)) return false;
	if (l.discount !== undefined && !isAmount(l.discount)) return false;
	if (l.taxCode === "") return false;
	if (l.taxCode === US_SALES) {
		return l.rate !== undefined && isAmount(l.rate);
	}
	return true;
}

/**
 * Totals for the live preview, recomputed on every keystroke. Incomplete
 * lines are left out (and reported) rather than failing the whole document;
 * tax-rule errors come back as a message to show inline.
 */
export function previewTotals(
	seller: Pick<PartySnapshot, "country" | "region" | "taxId">,
	draft: DocumentDraft,
): PreviewTotals {
	const skipped = draft.lines
		.filter((l) => !lineIsComplete(l))
		.map((l) => l.lineNo);
	if (!/^[A-Z]{2}$/.test(draft.buyer.country)) {
		return {
			ok: false,
			message:
				"Enter the buyer's 2-letter country code (e.g. US) to work out tax.",
			skipped,
		};
	}
	if (!isCurrencyCode(draft.currency)) {
		return {
			ok: false,
			message: "Enter a 3-letter currency code (e.g. USD).",
			skipped,
		};
	}
	try {
		const result = documentTotals(seller, {
			...draft,
			lines: draft.lines.filter(lineIsComplete),
		});
		return { ok: true, result, skipped };
	} catch (err) {
		if (err instanceof TaxError) {
			return { ok: false, message: err.message, skipped };
		}
		return {
			ok: false,
			message: err instanceof Error ? err.message : "Could not work out tax",
			skipped,
		};
	}
}

// --- saved clients and catalog (#14) ----------------------------------------

/** A saved client as the picker receives it. */
export type PickedClient = ClientAddress & {
	id: string;
	placeOfSupply: string | null;
};

/**
 * Fill the buyer from a saved client and link it. Place of supply (IN) is
 * taken from the client when it has one, otherwise cleared so the buyer's
 * state applies. Everything stays editable afterwards.
 */
export function applyClient(form: DraftForm, client: PickedClient): DraftForm {
	const party = clientToParty(client);
	return {
		...form,
		clientId: client.id,
		buyer: {
			name: party.name,
			addressLines: party.addressLines.join("\n"),
			city: party.city ?? "",
			region: party.region ?? "",
			postalCode: party.postalCode ?? "",
			country: party.country,
			taxId: party.taxId ?? "",
			email: party.email ?? "",
		},
		placeOfSupply: client.placeOfSupply ?? "",
	};
}

/** Unlink the saved client and empty the buyer for manual entry. */
export function clearClient(form: DraftForm, country: string): DraftForm {
	return {
		...form,
		clientId: undefined,
		buyer: {
			name: "",
			addressLines: "",
			city: "",
			region: "",
			postalCode: "",
			country,
			taxId: "",
			email: "",
		},
		placeOfSupply: "",
	};
}

/**
 * The "Save as client" payload for a buyer typed by hand. Address rows 1
 * and 2 map to the client's two address lines; rows 3–4 join line 2.
 */
export function clientInputFromBuyer(
	buyer: BuyerForm,
	placeOfSupply: string,
): ClientFormInput {
	const rows = buyer.addressLines
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);
	return {
		name: buyer.name.trim(),
		addressLine1: rows[0] ?? "",
		addressLine2: rows.slice(1).join(", "),
		city: buyer.city.trim(),
		region: buyer.region.trim().toUpperCase(),
		postalCode: buyer.postalCode.trim(),
		country: buyer.country.trim().toUpperCase(),
		taxId: buyer.taxId.trim(),
		email: buyer.email.trim(),
		placeOfSupply: placeOfSupply.trim(),
	};
}

export interface CatalogFill {
	patch: Partial<LineForm>;
	/** Set when the item's tax code isn't valid here and the line kept its own. */
	taxCodeRejected?: string;
}

/**
 * Fill a line from a catalog item. Quantity and discount stay as typed. The
 * item's tax code is used only when the tax engine offers it for this
 * business; otherwise the line keeps its current code and the caller warns.
 */
export function fillFromCatalog(
	line: LineForm,
	item: Pick<
		CatalogItemFields,
		"id" | "name" | "unit" | "unitPrice" | "taxCode" | "rate" | "hsnSac"
	>,
	taxOptions: readonly TaxCodeOption[],
): CatalogFill {
	const valid = taxOptions.some((o) => o.code === item.taxCode);
	const taxCode = valid ? item.taxCode : line.taxCode;
	const rate =
		taxCode !== US_SALES ? "" : valid ? (item.rate ?? "") : line.rate;
	return {
		patch: {
			description: item.name,
			unit: item.unit ?? "",
			unitPrice: item.unitPrice,
			taxCode,
			rate,
			hsnSac: item.hsnSac ?? "",
			catalogItemId: item.id,
		},
		...(valid ? {} : { taxCodeRejected: item.taxCode }),
	};
}

// --- misc -------------------------------------------------------------------

/** Today's date in the browser's time zone, as YYYY-MM-DD. */
export function localIsoDate(now: Date = new Date()): string {
	const y = String(now.getFullYear()).padStart(4, "0");
	const m = String(now.getMonth() + 1).padStart(2, "0");
	const d = String(now.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}
