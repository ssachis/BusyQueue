/**
 * Form → `DocumentDraft`, what's still invalid, and the printed-vs-computed
 * totals check. Totals always come from the tax engine (`documentTotals`);
 * printed totals are only compared with them. A mismatch is flagged for a
 * person; neither number is trusted over the other. Pure.
 */

import { documentTotals } from "#/lib/documents/totals.ts";
import { DocumentDraft } from "#/lib/documents/types.ts";
import {
	formatMoney,
	isDecimalString,
	type Money,
	subtractMoney,
	toMinor,
} from "#/lib/money/index.ts";
import {
	TaxError,
	type TaxResult,
	taxCodes,
	US_SALES,
} from "#/lib/tax/index.ts";
import {
	type DocImportForm,
	type LineField,
	linePath,
	type SellerContext,
} from "./form.ts";

const blank = (v: string) => (v.trim() === "" ? undefined : v.trim());

/** The form as a `DocumentDraft` (zod result), with line numbers assigned in order. */
export function formToDraft(form: DocImportForm) {
	const b = form.buyer;
	return DocumentDraft.safeParse({
		type: form.type,
		date: form.date.trim(),
		dueDate: blank(form.dueDate),
		currency: form.currency.trim().toUpperCase(),
		clientId: blank(form.clientId),
		buyer: {
			name: b.name.trim(),
			addressLines: b.address
				.split("\n")
				.map((l) => l.trim())
				.filter(Boolean),
			city: blank(b.city),
			region: blank(b.region)?.toUpperCase(),
			postalCode: blank(b.postalCode),
			country: b.country.trim().toUpperCase(),
			taxId: blank(b.taxId),
			email: blank(b.email),
		},
		placeOfSupply: blank(form.placeOfSupply),
		notes: blank(form.notes),
		terms: blank(form.terms),
		lines: form.lines.map((l, i) => ({
			lineNo: i + 1,
			description: l.description.trim(),
			quantity: l.quantity.trim(),
			unit: blank(l.unit),
			unitPrice: l.unitPrice.trim(),
			discount: blank(l.discount),
			taxCode: l.taxCode.trim(),
			rate: l.taxCode.trim() === US_SALES ? blank(l.rate) : undefined,
			hsnSac: blank(l.hsnSac),
		})),
	});
}

const FRIENDLY: Record<string, string> = {
	type: "Pick a document type",
	date: "Use a date like 2026-10-09",
	dueDate: "Use a date like 2026-11-08, or leave empty",
	currency: "Use a currency code like USD",
	country: "Use a 2-letter country code like US",
	email: "Use an email like name@example.org, or leave empty",
	addressLines: "Up to 4 address lines",
	description: "Description is required",
	quantity: "Use a number like 12",
	unitPrice: "Use a number like 14.50",
	discount: "Use an amount like 5.00, or leave empty",
	taxCode: "Pick a tax code",
	rate: "Use a percent like 8.25",
};

/** zod path on the draft → path on the form. */
function formPath(path: PropertyKey[]): string {
	const [head, ...rest] = path.map(String);
	if (head === "buyer" && rest[0] === "addressLines") return "buyer.address";
	if (head === "lines" && rest.length >= 2)
		return `lines.${rest[0]}.${rest[1]}`;
	return [head, ...rest].join(".");
}

/** Path → message for every field that can't be saved as it is. Empty when valid. */
export function validateForm(
	form: DocImportForm,
	seller: SellerContext,
): Record<string, string> {
	const issues: Record<string, string> = {};
	const parsed = formToDraft(form);
	if (!parsed.success) {
		for (const issue of parsed.error.issues) {
			const path = formPath(issue.path);
			const last = String(issue.path.at(-1) ?? "");
			issues[path] ??=
				FRIENDLY[last] ??
				FRIENDLY[path] ??
				(issue.path[0] === "buyer" && last === "name"
					? "Buyer name is required"
					: issue.message);
		}
	}
	if (form.lines.length === 0) issues.lines = "Add at least one line";

	const region = blank(form.buyer.region)?.toUpperCase();
	let valid: Set<string>;
	try {
		valid = new Set(
			taxCodes(
				seller.country,
				seller.country === "CA" && region && region.length === 2
					? region
					: undefined,
			).map((o) => o.code),
		);
	} catch {
		valid = new Set(taxCodes(seller.country).map((o) => o.code));
	}
	form.lines.forEach((l, i) => {
		const code = l.taxCode.trim();
		if (!valid.has(code)) {
			issues[linePath(i, "taxCode")] ??= code
				? `${code} isn't a ${seller.country} tax code`
				: "Pick a tax code";
		}
		if (code === US_SALES && !isDecimalString(l.rate.trim())) {
			issues[linePath(i, "rate")] ??= "Enter the sales-tax percent";
		}
	});

	// Only once the fields parse: the tax engine's own checks.
	if (Object.keys(issues).length === 0 && parsed.success) {
		const totals = computeTotals(parsed.data, seller);
		if (!totals.ok) issues[totals.path] = totals.error;
	}
	return issues;
}

export type TotalsOutcome =
	| { ok: true; result: TaxResult }
	| { ok: false; error: string; path: string };

/** "Line 2: discount exceeds…" → lines.1.discount; region errors → buyer.region. */
function taxErrorPath(e: TaxError): string {
	if (e.code === "missing_region") return "buyer.region";
	const m = e.message.match(/^(?:Bad line |Line )(\d+)/);
	if (m) {
		const field: LineField = /discount/.test(e.message)
			? "discount"
			: /rate/.test(e.message)
				? "rate"
				: "taxCode";
		return linePath(Number(m[1]) - 1, field);
	}
	return "lines";
}

function computeTotals(
	draft: DocumentDraft,
	seller: SellerContext,
): TotalsOutcome {
	try {
		return { ok: true, result: documentTotals(seller, draft) };
	} catch (e) {
		if (e instanceof TaxError) {
			return { ok: false, error: e.message, path: taxErrorPath(e) };
		}
		throw e;
	}
}

/** Engine totals for the form, or why they can't be computed yet. */
export function formTotals(
	form: DocImportForm,
	seller: SellerContext,
): TotalsOutcome {
	const parsed = formToDraft(form);
	if (!parsed.success) {
		return {
			ok: false,
			error: "Fix the highlighted fields to compute totals",
			path: "lines",
		};
	}
	return computeTotals(parsed.data, seller);
}

export interface TotalsCheck {
	/** Path → message, e.g. "printed.total" → "Printed $712.42, lines compute to $711.42". */
	mismatches: Record<string, string>;
	/** Printed values that were compared (minor units), for display. */
	printed: { subtotal?: Money; tax?: Money; total?: Money };
}

const toMoney = (printed: string, currency: string): Money | undefined => {
	const v = printed.trim();
	if (!isDecimalString(v)) return undefined;
	try {
		return toMinor(v, currency);
	} catch {
		return undefined;
	}
};

function describe(printed: Money, computed: Money, what: string): string {
	const off = subtractMoney(printed, computed);
	const abs = { ...off, minor: Math.abs(off.minor) };
	return `Printed ${formatMoney(printed)}, but ${what} ${formatMoney(computed)} (off by ${formatMoney(abs)})`;
}

/**
 * Compare printed amounts with the engine's. A printed line amount matches
 * if it equals the line's net or its total with tax (documents print either).
 */
export function checkTotals(
	form: DocImportForm,
	result: TaxResult,
): TotalsCheck {
	const currency = result.currency;
	const mismatches: Record<string, string> = {};
	const printed = {
		subtotal: toMoney(form.printed.subtotal, currency),
		tax: toMoney(form.printed.tax, currency),
		total: toMoney(form.printed.total, currency),
	};
	const pairs = [
		["subtotal", result.subtotalMinor, "the lines compute to"],
		["tax", result.taxMinor, "the tax engine computes"],
		["total", result.totalMinor, "the lines compute to"],
	] as const;
	for (const [field, computed, what] of pairs) {
		const p = printed[field];
		if (p && p.minor !== computed) {
			mismatches[`printed.${field}`] = describe(
				p,
				{ minor: computed, currency },
				what,
			);
		}
	}
	form.lines.forEach((l, i) => {
		const line = result.lines[i];
		const p = toMoney(l.printedAmount, currency);
		if (!line || !p) return;
		if (p.minor !== line.netMinor && p.minor !== line.totalMinor) {
			mismatches[linePath(i, "printedAmount")] = describe(
				p,
				{ minor: line.netMinor, currency },
				"quantity × unit price − discount is",
			);
		}
	});
	return { mismatches, printed };
}
