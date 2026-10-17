/**
 * Seeded, deterministic synthetic data for a fictional K-12 school district's
 * food-service office (Northfield Unified School District). Re-running with the
 * same arguments gives byte-identical files.
 *
 *   bun scripts/generate-data.ts              # seed 1017, 40 invoices
 *   bun scripts/generate-data.ts 7 60         # seed 7, 60 invoices
 *
 * Writes to data/: price_list.csv, invoices/*.json, payments.csv,
 * answer_key.csv, invoice_index.csv. Everything is validated against the shared
 * zod types before it is written. All names and numbers are made up.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
	AnswerKeyRow,
	Invoice,
	type InvoiceLine,
	Payment,
	PriceRow,
} from "../src/lib/busyq/types.ts";
import { type Big, dec, toMajor, toMinor } from "../src/lib/money/index.ts";

const CURRENCY = "USD";

const SITES = [
	"Lincoln Elementary",
	"Roosevelt Middle School",
	"Washington High School",
	"Jefferson Elementary",
	"Madison Middle School",
	"Adams Academy",
];

type Vendor = { prefix: string; variants: string[] };
const VENDORS: Record<string, Vendor> = {
	"Harbor Foods": {
		prefix: "HF",
		variants: ["HARBOR FOODS INC", "Harbor Foods, Inc.", "Harbor Foods Co."],
	},
	"Valley Fresh Produce": {
		prefix: "VF",
		variants: ["VALLEY FRESH PRODUCE LLC", "Valley Fresh", "VALLEY FRESH PRODUCE"],
	},
	"Dairy Pure": {
		prefix: "DP",
		variants: ["DAIRY PURE CO", "Dairy Pure Co.", "Dairy-Pure"],
	},
};

/** Contract rows. `pack` = [packUnit, packSize]: one packUnit holds packSize `unit`s. */
type Seed = [vendor: string, item: string, unit: string, price: string, pack?: [string, string]];
const SEEDS: Seed[] = [
	["Harbor Foods", "Chicken breast", "lb", "2.10", ["case", "40"]],
	["Harbor Foods", "Ground beef 85/15", "lb", "3.45", ["case", "40"]],
	["Harbor Foods", "Brown rice", "bag", "14.20"],
	["Harbor Foods", "Pasta penne", "case", "21.75"],
	["Harbor Foods", "Canned tomatoes", "case", "18.90"],
	["Harbor Foods", "Whole grain bread", "case", "16.40"],
	["Valley Fresh Produce", "Romaine lettuce", "case", "18.50"],
	["Valley Fresh Produce", "Apples", "case", "24.00"],
	["Valley Fresh Produce", "Carrots", "lb", "0.78", ["case", "50"]],
	["Valley Fresh Produce", "Bananas", "lb", "0.62", ["case", "40"]],
	["Valley Fresh Produce", "Broccoli", "case", "22.30"],
	["Valley Fresh Produce", "Oranges", "case", "26.80"],
	["Dairy Pure", "Milk 1% half-pint", "case", "9.85"],
	["Dairy Pure", "Milk skim half-pint", "case", "9.85"],
	["Dairy Pure", "Cheddar shredded", "lb", "3.60", ["case", "20"]],
	["Dairy Pure", "Yogurt cup", "case", "17.25"],
	["Dairy Pure", "Eggs large", "case", "31.00"],
];

const PRICES = z.array(PriceRow).parse(
	SEEDS.map(([vendor, item, unit, unitPrice, pack]) => ({
		vendor,
		item,
		unit,
		unitPrice,
		currency: CURRENCY,
		...(pack ? { packUnit: pack[0], packSize: pack[1] } : {}),
	})),
);

const UNIT_ALIASES: Record<string, string[]> = {
	lb: ["LB", "lbs"],
	case: ["CS", "Case"],
	bag: ["BG", "bags"],
};

type Kind =
	| "clean"
	| "clean_unpaid"
	| "overcharge"
	| "duplicate_line"
	| "wrong_total"
	| "duplicate_payment";

/** Small seeded PRNG (mulberry32). */
function rng(seed: number) {
	let a = seed >>> 0;
	const next = () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
	const pick = <T>(xs: readonly T[]): T => xs[Math.floor(next() * xs.length)] as T;
	const shuffle = <T>(xs: readonly T[]): T[] => {
		const out = [...xs];
		for (let i = out.length - 1; i > 0; i--) {
			const j = Math.floor(next() * (i + 1));
			[out[i], out[j]] = [out[j] as T, out[i] as T];
		}
		return out;
	};
	return { next, int, pick, shuffle };
}

const addDays = (iso: string, days: number): string => {
	const d = new Date(`${iso}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + days);
	return d.toISOString().slice(0, 10);
};

const money = (minor: number) => toMajor({ minor, currency: CURRENCY }).toFixed(2);
const roundAmount = (qty: Big, price: Big) => toMinor(qty.times(price), CURRENCY).minor;
const fixed2 = (d: Big): string => {
	const places = (d.toString().split(".")[1] ?? "").length;
	return d.toFixed(Math.max(2, places));
};

export type IndexRow = {
	invoiceId: string;
	vendor: string;
	kind: Kind;
	nameVariant: boolean;
	unitVariant: boolean;
	paid: boolean;
};

export function generate(seed = 1017, count = 40) {
	const r = rng(seed);
	const vendorNames = Object.keys(VENDORS);

	const plan: Kind[] = [
		...Array<Kind>(16).fill("clean"),
		...Array<Kind>(8).fill("overcharge"),
		...Array<Kind>(4).fill("duplicate_line"),
		...Array<Kind>(3).fill("wrong_total"),
		...Array<Kind>(3).fill("duplicate_payment"),
		...Array<Kind>(3).fill("clean_unpaid"),
	];
	while (plan.length < count) plan.push("clean");
	const kinds = r.shuffle(plan).slice(0, count);

	// 14 variant invoices; at least half of the overcharge invoices are forced in
	// so the naive lookup misses real money.
	const variantSlots = new Set<number>(
		r
			.shuffle(kinds.flatMap((k, i) => (k === "overcharge" ? [i] : [])))
			.slice(0, 4),
	);
	for (const i of r.shuffle([...kinds.keys()])) {
		if (variantSlots.size >= 14) break;
		variantSlots.add(i);
	}

	const invoices: Invoice[] = [];
	const payments: Payment[] = [];
	const answerKey: AnswerKeyRow[] = [];
	const index: IndexRow[] = [];
	const start = "2026-08-03";
	let payN = 5000;

	kinds.forEach((kind, n) => {
		const vendor = r.pick(vendorNames);
		const v = VENDORS[vendor] as Vendor;
		const id = `inv-${1001 + n}`;
		const invoiceNumber = `${v.prefix}-${1001 + n}`;
		const issueDate = addDays(start, n * 2 + r.int(0, 1));
		const rows = r
			.shuffle(PRICES.filter((p) => p.vendor === vendor))
			.slice(0, r.int(3, 5));

		let nameVariant = false;
		let unitVariant = false;
		if (variantSlots.has(n)) {
			nameVariant = r.next() < 0.7;
			unitVariant = r.next() < 0.7;
			if (!nameVariant && !unitVariant) nameVariant = true;
		}

		type W = { row: PriceRow; item: string; unit: string; qty: Big; price: Big; agreed: Big; amountMinor: number };
		const pendingKeys = new Map<W, Omit<AnswerKeyRow, "lineNo">>();
		const work: W[] = rows.map((row) => {
			let unit = row.unit;
			let agreed = dec(row.unitPrice);
			let qty = dec(
				String(
					row.unit === "bag"
						? r.int(4, 12)
						: row.unit === "lb"
							? r.pick([100, 150, 200, 250, 400, 600, 800, 1200])
							: r.pick([10, 12, 15, 20, 24, 30, 40, 60]),
				),
			);
			if (unitVariant) {
				if (row.packUnit && row.packSize && r.next() < 0.6) {
					// Bill by the pack: 30 cases at 84.00 instead of 1,200 lb at 2.10.
					unit = row.packUnit;
					qty = qty.div(dec(row.packSize)).round(0);
					if (qty.lt(dec("1"))) qty = dec("1");
					agreed = agreed.times(dec(row.packSize));
				} else {
					unit = r.pick(UNIT_ALIASES[row.unit] ?? [row.unit]);
				}
			}
			return { row, item: row.item, unit, qty, price: agreed, agreed, amountMinor: roundAmount(qty, agreed) };
		});

		const keyRows: AnswerKeyRow[] = [];

		if (kind === "overcharge") {
			for (const w of r.shuffle(work).slice(0, r.pick([1, 1, 2]))) {
				const perWeight = /^(lb|lbs)$/i.test(w.unit);
				const bump = dec(
					r.pick(perWeight ? ["0.04", "0.06", "0.08", "0.15"] : ["0.25", "0.50", "0.75", "1.20", "2.00"]),
				);
				w.price = w.agreed.plus(bump);
				w.amountMinor = roundAmount(w.qty, w.price);
				pendingKeys.set(w, {
					kind: "overcharge",
					invoiceId: id,
					paymentId: null,
					expectedImpactMinor: toMinor(bump.times(w.qty), CURRENCY).minor,
					currency: CURRENCY,
				});
			}
		}

		const lines: InvoiceLine[] = work.map((w, i) => {
			const pending = pendingKeys.get(w);
			if (pending) keyRows.push({ ...pending, lineNo: i + 1 });
			return {
				lineNo: i + 1,
				item: w.item,
				quantity: w.qty.toString(),
				unit: w.unit,
				unitPrice: fixed2(w.price),
				amount: money(w.amountMinor),
			};
		});

		if (kind === "duplicate_line") {
			const dupe = r.pick(lines);
			const copy = { ...dupe, lineNo: lines.length + 1 };
			lines.push(copy);
			keyRows.push({
				kind: "duplicate_line",
				invoiceId: id,
				lineNo: copy.lineNo,
				paymentId: null,
				expectedImpactMinor: toMinor(copy.amount, CURRENCY).minor,
				currency: CURRENCY,
			});
		}

		const linesMinor = lines.reduce((a, l) => a + toMinor(l.amount, CURRENCY).minor, 0);
		let statedMinor = linesMinor;
		if (kind === "wrong_total") {
			const delta = r.pick([1250, 4000, 7500, 12000]);
			statedMinor += delta;
			keyRows.push({
				kind: "wrong_total",
				invoiceId: id,
				lineNo: null,
				paymentId: null,
				expectedImpactMinor: delta,
				currency: CURRENCY,
			});
		}

		invoices.push(
			Invoice.parse({
				id,
				vendor: nameVariant ? r.pick(v.variants) : vendor,
				invoiceNumber,
				issueDate,
				dueDate: addDays(issueDate, 30),
				currency: CURRENCY,
				lines,
				statedTotal: money(statedMinor),
			}),
		);

		const paid = kind !== "clean_unpaid";
		if (paid) {
			payN += 1;
			const paidOn = addDays(issueDate, r.int(14, 30));
			payments.push(
				Payment.parse({
					id: `pay-${payN}`,
					vendor,
					invoiceNumber,
					amount: money(statedMinor),
					currency: CURRENCY,
					paidOn,
					reference: `ACH-${payN}`,
				}),
			);
			if (kind === "duplicate_payment") {
				payN += 1;
				const second = Payment.parse({
					id: `pay-${payN}`,
					vendor,
					invoiceNumber,
					amount: money(statedMinor),
					currency: CURRENCY,
					paidOn: addDays(paidOn, r.int(3, 9)),
					reference: `ACH-${payN}`,
				});
				payments.push(second);
				keyRows.push({
					kind: "duplicate_payment",
					invoiceId: id,
					lineNo: null,
					paymentId: second.id,
					expectedImpactMinor: statedMinor,
					currency: CURRENCY,
				});
			}
		}

		answerKey.push(...keyRows.map((k) => AnswerKeyRow.parse(k)));
		index.push({ invoiceId: id, vendor, kind, nameVariant, unitVariant, paid });
	});

	// Orphan payments: money out that matches no invoice.
	[
		{ invoiceNumber: null, amountMinor: 84210 },
		{ invoiceNumber: "HF-9100", amountMinor: 131055 },
	].forEach((o, k) => {
		payN += 1;
		const p = Payment.parse({
			id: `pay-${payN}`,
			vendor: r.pick(vendorNames),
			invoiceNumber: o.invoiceNumber,
			amount: money(o.amountMinor),
			currency: CURRENCY,
			paidOn: addDays(start, 70 + k),
			reference: `CHK-${200 + k}`,
		});
		payments.push(p);
		answerKey.push(
			AnswerKeyRow.parse({
				kind: "orphan_payment",
				invoiceId: null,
				lineNo: null,
				paymentId: p.id,
				expectedImpactMinor: o.amountMinor,
				currency: CURRENCY,
			}),
		);
	});

	return { prices: PRICES, invoices, payments, answerKey, index };
}

// ── Output ───────────────────────────────────────────────────────────

const csv = (rows: (string | number | null | undefined)[][]): string =>
	`${rows
		.map((row) =>
			row
				.map((c) => {
					const s = c === null || c === undefined ? "" : String(c);
					return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
				})
				.join(","),
		)
		.join("\n")}\n`;

function main() {
	const root = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
	const seed = Number(process.argv[2] ?? 1017);
	const count = Number(process.argv[3] ?? 40);
	const data = generate(seed, count);

	rmSync(join(root, "invoices"), { recursive: true, force: true });
	mkdirSync(join(root, "invoices"), { recursive: true });
	for (const inv of data.invoices) {
		writeFileSync(join(root, "invoices", `${inv.id}.json`), `${JSON.stringify(inv, null, 2)}\n`);
	}
	writeFileSync(
		join(root, "price_list.csv"),
		csv([
			["vendor", "item", "unit", "unit_price", "currency", "pack_unit", "pack_size"],
			...data.prices.map((p) => [p.vendor, p.item, p.unit, p.unitPrice, p.currency, p.packUnit, p.packSize]),
		]),
	);
	writeFileSync(
		join(root, "payments.csv"),
		csv([
			["id", "vendor", "invoice_number", "amount", "currency", "paid_on", "reference"],
			...data.payments.map((p) => [p.id, p.vendor, p.invoiceNumber, p.amount, p.currency, p.paidOn, p.reference]),
		]),
	);
	writeFileSync(
		join(root, "answer_key.csv"),
		csv([
			["kind", "invoice_id", "line_no", "payment_id", "expected_impact_minor", "currency"],
			...data.answerKey.map((a) => [a.kind, a.invoiceId, a.lineNo, a.paymentId, a.expectedImpactMinor, a.currency]),
		]),
	);
	writeFileSync(
		join(root, "invoice_index.csv"),
		csv([
			["invoice_id", "vendor", "planted_kind", "name_variant", "unit_variant", "paid"],
			...data.index.map((i) => [i.invoiceId, i.vendor, i.kind, Number(i.nameVariant), Number(i.unitVariant), Number(i.paid)]),
		]),
	);

	const total = data.answerKey.reduce((a, k) => a + k.expectedImpactMinor, 0);
	console.log(
		`seed ${seed}: ${data.invoices.length} invoices at ${SITES.length} sites' worth of kitchens, ` +
			`${data.payments.length} payments, ${data.answerKey.length} planted problems (${CURRENCY} ${money(total)}) -> ${root}`,
	);
}

if (process.argv[1]?.endsWith("generate-data.ts")) main();
