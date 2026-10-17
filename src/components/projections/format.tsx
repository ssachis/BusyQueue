import { ChevronRight } from "lucide-react";
import type { AmountRange } from "#/lib/forecast/index.ts";
import { formatMoney, toMajor } from "#/lib/money/index.ts";
import { formatPercent } from "#/lib/projections/format.ts";

const MONTHS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

/** "2026-10-21" → "21 Oct 2026". Pure string work: same on server and client. */
export function formatDate(iso: string, withYear = true): string {
	const [y, m, d] = iso.split("-");
	const month = MONTHS[Number(m) - 1] ?? m;
	return withYear ? `${Number(d)} ${month} ${y}` : `${Number(d)} ${month}`;
}

/** "2026-09" → "Sep 2026". */
export function formatMonth(month: string): string {
	const [y, m] = month.split("-");
	return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
}

export const money = (minor: number, currency: string | null) =>
	formatMoney({ minor, currency: currency ?? "USD" });

/** Short label for charts, e.g. "$18K". Formats the exact decimal string. */
export function compactMoney(minor: number, currency: string | null): string {
	const c = currency ?? "USD";
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: c,
		notation: "compact",
		maximumFractionDigits: 1,
	}).format(toMajor({ minor, currency: c }).toFixed() as unknown as number);
}

/** Signed change, e.g. "+$1,200.00" / "−$300.00". */
export function signedMoney(minor: number, currency: string | null): string {
	if (minor === 0) return money(0, currency);
	return `${minor > 0 ? "+" : "−"}${money(Math.abs(minor), currency)}`;
}

/** Signed ratio as a percentage, e.g. "0.1218" → "+12.18%". */
export function signedPercent(ratio: string | null): string {
	if (ratio === null) return "n/a";
	const p = formatPercent(ratio);
	return p.startsWith("-") ? `−${p.slice(1)}` : `+${p}`;
}

/** Expected amount with its low–high range underneath. */
export function RangeCell({
	range,
	currency,
}: {
	range: AmountRange;
	currency: string | null;
}) {
	const flat =
		range.lowMinor === range.expectedMinor &&
		range.highMinor === range.expectedMinor;
	return (
		<div className="tabular-nums">
			<div className="font-medium">{money(range.expectedMinor, currency)}</div>
			<div className="text-xs text-muted-foreground">
				{flat
					? "no range"
					: `${money(range.lowMinor, currency)} – ${money(range.highMinor, currency)}`}
			</div>
		</div>
	);
}

/** "How this was calculated" expander for a `*_METHOD` string. */
export function MethodNote({
	method,
	title = "How this was calculated",
}: {
	method: string;
	title?: string;
}) {
	return (
		<details className="group rounded-md border bg-muted/30 px-3 py-2 text-sm">
			<summary className="flex cursor-pointer list-none items-center gap-1.5 text-muted-foreground select-none [&::-webkit-details-marker]:hidden">
				<ChevronRight className="size-4 transition-transform group-open:rotate-90" />
				{title}
			</summary>
			<p className="mt-2 leading-relaxed text-foreground/80">{method}</p>
		</details>
	);
}
