/**
 * Forecast report on the generated data set (vendor bills = money out).
 *
 *   bun scripts/forecast-report.ts                      # as of the day after the last invoice
 *   bun scripts/forecast-report.ts --as-of 2026-10-01
 *   bun scripts/forecast-report.ts --json               # the digest input, as JSON
 *
 * Vendor names are resolved to their canonical spelling (the v2 alias rules);
 * an invoice's paid date is its first payment. Everything is computed from
 * what was known on the as-of date, so later payments count as still open.
 */
import type { Invoice, Payment } from "../src/lib/busyq/types.ts";
import {
	buildDigestInput,
	buildForecast,
	type CashItem,
	type FlowRange,
	type LineObservation,
	type TrendSeries,
} from "../src/lib/forecast/index.ts";
import { formatMoney } from "../src/lib/money/index.ts";
import { resolveVendor } from "../src/lib/rules/aliases.ts";
import { loadDataset } from "./lib/dataset.ts";

function arg(name: string): string | undefined {
	const i = process.argv.indexOf(name);
	return i >= 0 ? process.argv[i + 1] : undefined;
}

function canonicalVendor(printed: string, canonical: string[]): string {
	const r = resolveVendor(printed, canonical);
	return r.ok ? r.vendor : printed;
}

function firstPaidOn(invoice: Invoice, payments: Payment[]): string | null {
	const dates = payments
		.filter((p) => p.invoiceNumber === invoice.invoiceNumber)
		.map((p) => p.paidOn)
		.sort();
	return dates[0] ?? null;
}

const data = loadDataset();
const vendors = [
	...new Set([
		...data.priceList.map((p) => p.vendor),
		...data.payments.map((p) => p.vendor),
	]),
].sort();

const items: CashItem[] = data.invoices.map((inv) => ({
	id: inv.id,
	direction: "out",
	counterparty: canonicalVendor(inv.vendor, vendors),
	currency: inv.currency,
	amount: inv.statedTotal,
	issueDate: inv.issueDate,
	dueDate: inv.dueDate ?? null,
	paidOn: firstPaidOn(inv, data.payments),
}));

const lines: LineObservation[] = data.invoices.flatMap((inv) =>
	inv.lines.map((l) => ({
		vendor: canonicalVendor(inv.vendor, vendors),
		item: l.item,
		unit: l.unit,
		unitPrice: l.unitPrice,
		date: inv.issueDate,
		currency: inv.currency,
		ref: `${inv.id}#${l.lineNo}`,
	})),
);

const lastIssue = items.map((i) => i.issueDate).sort()[items.length - 1];
const nextDay = (iso: string) => {
	const d = new Date(`${iso}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() + 1);
	return d.toISOString().slice(0, 10);
};
const asOf = arg("--as-of") ?? (lastIssue ? nextDay(lastIssue) : "2026-01-01");

const forecast = buildForecast(items, { asOf, lines });

if (process.argv.includes("--json")) {
	console.log(JSON.stringify(buildDigestInput(forecast), null, 2));
	process.exit(0);
}

const currency = forecast.currency ?? "USD";
const fmt = (minor: number) => formatMoney({ minor, currency });
const range = (r: FlowRange["out"]) =>
	`${fmt(r.expectedMinor).padStart(11)}  (${fmt(r.lowMinor)} – ${fmt(r.highMinor)})`;

console.log(`BusyQ forecast as of ${asOf} (${currency})`);
console.log(
	`${items.length} bills, ${forecast.calendar.items.length} open on the as-of date\n`,
);

console.log("Payment behaviour (days paid after due date)");
for (const b of forecast.behaviour.counterparties) {
	const own = b.own
		? `n=${b.own.sampleSize}`.padEnd(5)
		: "n=0".padEnd(5);
	console.log(
		`  ${b.counterparty.padEnd(22)} ${own} median ${String(b.expected.medianDays).padStart(3)}  p25–p75 ${b.expected.p25Days} to ${b.expected.p75Days}  [${b.basis}]`,
	);
}
const all = forecast.behaviour.overall.out;
if (all) {
	console.log(
		`  ${"All vendors".padEnd(22)} n=${String(all.sampleSize).padEnd(3)} median ${String(all.medianDays).padStart(3)}  p25–p75 ${all.p25Days} to ${all.p75Days}`,
	);
}

console.log("\nCash calendar: expected cash out  (low – high)");
for (const h of forecast.calendar.horizons) {
	console.log(`  next ${h.days} days (to ${h.lastDate})  ${range(h.out)}`);
}
console.log(
	`  after ${forecast.calendar.beyond.firstDate}           ${range(forecast.calendar.beyond.out)}`,
);
console.log("\n  Per week");
for (const w of forecast.calendar.weeks) {
	if (w.out.highMinor === 0) continue;
	console.log(`  ${w.startDate} – ${w.endDate}  ${range(w.out)}`);
}
console.log("\n  Open bills");
for (const i of forecast.calendar.items) {
	console.log(
		`  ${i.id}  ${i.counterparty.padEnd(22)} ${fmt(i.amountMinor).padStart(10)}  due ${i.dueDate}${i.pastDue ? " (past due)" : "           "}  expected ${i.expectedDate}  (${i.earliestDate} – ${i.latestDate})`,
	);
}

const trend = forecast.trend;
console.log(
	`\nTrend (spend by issue month): ${trend.status}  complete months: ${trend.completeMonths.join(", ") || "none"}`,
);
const printSeries = (s: TrendSeries) => {
	const months = s.months.map((m) => `${m.month} ${fmt(m.totalMinor)}`).join("  ");
	console.log(`  ${s.key.padEnd(22)} ${months}`);
	if (s.summary) {
		const t = s.summary.trailing;
		console.log(
			`  ${"".padEnd(22)} MoM ${fmt(s.summary.momChangeMinor)} (${s.summary.momChangeRatio ?? "n/a"})  3-mo avg ${fmt(t.averageMinor)} band ${fmt(t.lowMinor)} – ${fmt(t.highMinor)}`,
		);
	}
};
printSeries(trend.spend.overall);
for (const s of trend.spend.byCounterparty) printSeries(s);
if (trend.status === "not_enough_data") {
	console.log(
		`  Not enough data: ${trend.completeMonths.length} complete month(s), ${trend.requiredMonths} needed. No trend numbers shown.`,
	);
}

console.log(
	`\nSpend drift: ${forecast.spendDrift.status} (needs ${forecast.spendDrift.requiredMonths} complete months)`,
);
for (const a of forecast.spendDrift.alerts) {
	console.log(
		`  ${a.counterparty} ${a.month}: ${fmt(a.actualMinor)} vs avg ${fmt(a.baselineMinor)} (${a.changeRatio ?? "new"})`,
	);
}

console.log(`\nPrice rises: ${forecast.priceRises.length}`);
for (const a of forecast.priceRises) {
	console.log(
		`  ${a.date}  ${a.vendor.padEnd(22)} ${a.item} per ${a.unit}: ${a.previousPrice} (${a.previousDate}) → ${a.newPrice}  +${a.changeRatio}  [${a.ref}]`,
	);
}
