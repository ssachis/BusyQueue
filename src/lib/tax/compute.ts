import {
	type Big,
	Decimal,
	dec,
	lineAmount,
	toMajor,
	toMinor,
} from "#/lib/money/index.ts";
import { assertTaxCountry, codeMeaning, US_SALES } from "./codes.ts";
import { ROUNDING } from "./rates.ts";
import { treatmentFor } from "./treatment.ts";
import {
	type LineTax,
	type TaxComponent,
	type TaxContext,
	TaxContextSchema,
	TaxError,
	type TaxLineInput,
	TaxLineInputSchema,
	type TaxResult,
	type TaxTotal,
} from "./types.ts";

const HUNDRED = new Decimal("100");

function validate(ctx: TaxContext, lines: TaxLineInput[]): void {
	const c = TaxContextSchema.safeParse(ctx);
	if (!c.success) {
		throw new TaxError("invalid_input", `Bad tax context: ${c.error.message}`);
	}
	assertTaxCountry(ctx.seller.country);
	if (!Array.isArray(lines)) {
		throw new TaxError("invalid_input", "Lines must be an array");
	}
	const seen = new Set<number>();
	for (const line of lines) {
		const l = TaxLineInputSchema.safeParse(line);
		if (!l.success) {
			throw new TaxError(
				"invalid_input",
				`Bad line ${String(line?.lineNo)}: ${l.error.message}`,
			);
		}
		if (seen.has(line.lineNo)) {
			throw new TaxError("invalid_input", `Duplicate lineNo ${line.lineNo}`);
		}
		seen.add(line.lineNo);
		const gross = lineAmount(line.quantity, line.unitPrice);
		if (line.discount !== undefined && dec(line.discount).gt(gross)) {
			throw new TaxError(
				"invalid_input",
				`Line ${line.lineNo}: discount exceeds quantity × unit price`,
			);
		}
		if (line.rate !== undefined && line.taxCode !== US_SALES) {
			throw new TaxError(
				"invalid_input",
				`Line ${line.lineNo}: "rate" is only accepted with tax code ${US_SALES}`,
			);
		}
		if (line.taxCode === US_SALES) {
			if (line.rate === undefined) {
				throw new TaxError(
					"invalid_input",
					`Line ${line.lineNo}: ${US_SALES} needs a sales-tax rate`,
				);
			}
			if (dec(line.rate).gt(HUNDRED)) {
				throw new TaxError(
					"invalid_input",
					`Line ${line.lineNo}: rate ${line.rate}% is above 100%`,
				);
			}
		}
	}
}

/** One unrounded tax amount, before the country's rounding rule applies. */
interface Pending {
	line: number;
	code: TaxComponent["code"];
	rate: string;
	exact: Big;
}

/**
 * Per-invoice rounding: round each (code, rate) group's exact total once,
 * then allocate it to lines. Each line gets its own half-up amount and the
 * group's rounding difference (at most a few minor units) goes to the line
 * with the largest net amount (earliest line on ties), so the line amounts
 * always sum to the rounded group total.
 */
function allocateInvoiceRounding(
	pending: Pending[],
	netMinor: number[],
	currency: string,
): number[] {
	const out = new Array<number>(pending.length).fill(0);
	const groups = new Map<string, number[]>();
	pending.forEach((p, i) => {
		const key = `${p.code}|${p.rate}`;
		const members = groups.get(key) ?? [];
		members.push(i);
		groups.set(key, members);
	});
	for (const members of groups.values()) {
		const exactTotal = members.reduce(
			(acc, i) => acc.plus(pending[i].exact),
			new Decimal("0"),
		);
		const groupMinor = toMinor(exactTotal, currency).minor;
		let allocated = 0;
		let largest = members[0];
		for (const i of members) {
			out[i] = toMinor(pending[i].exact, currency).minor;
			allocated += out[i];
			if (netMinor[pending[i].line] > netMinor[pending[largest].line]) {
				largest = i;
			}
		}
		out[largest] += groupMinor - allocated;
	}
	return out;
}

/**
 * Per-line tax for a document. Amounts out are integer minor units. Totals
 * always reconcile: `totalMinor === subtotalMinor + taxMinor`, and the line
 * taxes sum to `taxMinor`. Throws `TaxError` on bad input.
 */
export function computeTax(ctx: TaxContext, lines: TaxLineInput[]): TaxResult {
	validate(ctx, lines);
	const country = ctx.seller.country;
	const { currency } = ctx;
	const treatment = treatmentFor(ctx);
	const rounding = ROUNDING[country];

	// Net per line, rounded once to minor units. Tax is computed on that net.
	const netMinor = lines.map((l) => {
		const gross = lineAmount(l.quantity, l.unitPrice);
		const net = l.discount === undefined ? gross : gross.minus(dec(l.discount));
		return toMinor(net, currency).minor;
	});

	const pending: Pending[] = [];
	lines.forEach((l, i) => {
		const meaning = codeMeaning(country, l.taxCode);
		const base = toMajor({ minor: netMinor[i], currency });
		for (const c of treatment.components(meaning, l.rate)) {
			pending.push({
				line: i,
				code: c.code,
				rate: c.rate,
				exact: base.times(dec(c.rate)).div(HUNDRED),
			});
		}
	});

	const amounts =
		rounding === "line"
			? pending.map((p) => toMinor(p.exact, currency).minor)
			: allocateInvoiceRounding(pending, netMinor, currency);

	const outLines: LineTax[] = lines.map((l, i) => ({
		lineNo: l.lineNo,
		netMinor: netMinor[i],
		components: [],
		taxMinor: 0,
		totalMinor: netMinor[i],
		...(l.hsnSac === undefined ? {} : { hsnSac: l.hsnSac }),
	}));
	pending.forEach((p, k) => {
		const line = outLines[p.line];
		line.components.push({
			code: p.code,
			rate: p.rate,
			amountMinor: amounts[k],
		});
		line.taxMinor += amounts[k];
		line.totalMinor += amounts[k];
	});

	const taxTotals: TaxTotal[] = [];
	for (const line of outLines) {
		for (const c of line.components) {
			let total = taxTotals.find((t) => t.code === c.code && t.rate === c.rate);
			if (!total) {
				total = { code: c.code, rate: c.rate, taxableMinor: 0, amountMinor: 0 };
				taxTotals.push(total);
			}
			total.taxableMinor += line.netMinor;
			total.amountMinor += c.amountMinor;
		}
	}

	const subtotalMinor = outLines.reduce((s, l) => s + l.netMinor, 0);
	const taxMinor = outLines.reduce((s, l) => s + l.taxMinor, 0);
	for (const n of [subtotalMinor, taxMinor, subtotalMinor + taxMinor]) {
		if (!Number.isSafeInteger(n)) {
			throw new TaxError("invalid_input", "Document total is out of range");
		}
	}

	return {
		currency,
		lines: outLines,
		subtotalMinor,
		taxTotals,
		taxMinor,
		totalMinor: subtotalMinor + taxMinor,
		reverseCharge: treatment.kind === "reverse_charge",
		...(treatment.supplyType === undefined
			? {}
			: { supplyType: treatment.supplyType }),
		notes: treatment.notes,
		rounding,
	};
}
