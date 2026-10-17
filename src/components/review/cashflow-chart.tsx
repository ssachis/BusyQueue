import { formatMoney } from "#/lib/money/index.ts";
import type { CashflowMonth } from "./review.ts";

const compact = (minor: number) => {
	const dollars = minor / 100;
	return dollars >= 1000
		? `$${(dollars / 1000).toFixed(dollars >= 10000 ? 0 : 1)}k`
		: `$${Math.round(dollars)}`;
};

/**
 * Bills in versus money paid out, by month. Plain SVG so it adds no
 * dependency. Bars use the chart tokens (solid = bills in, faded = paid out).
 */
export function CashflowChart({ data }: { data: CashflowMonth[] }) {
	const width = 320;
	const height = 150;
	const top = 14;
	const bottom = 22;
	const max = Math.max(1, ...data.flatMap((d) => [d.billedMinor, d.paidMinor]));
	const plot = height - top - bottom;
	const group = width / Math.max(1, data.length);
	const bar = Math.min(34, group / 3);
	const y = (v: number) => top + plot - (v / max) * plot;
	const summary = data
		.map(
			(d) =>
				`${d.label}: bills in ${formatMoney({ minor: d.billedMinor, currency: "USD" })}, paid out ${formatMoney({ minor: d.paidMinor, currency: "USD" })}`,
		)
		.join("; ");

	return (
		<svg
			viewBox={`0 0 ${width} ${height}`}
			role="img"
			aria-label={`Bills in versus paid out by month. ${summary}`}
			className="h-auto w-full"
		>
			<line
				x1={0}
				x2={width}
				y1={top + plot}
				y2={top + plot}
				className="stroke-current opacity-20"
			/>
			{data.map((d, i) => {
				const cx = group * i + group / 2;
				return (
					<g key={d.month}>
						<rect
							x={cx - bar - 1.5}
							y={y(d.billedMinor)}
							width={bar}
							height={top + plot - y(d.billedMinor)}
							rx={3}
							className="fill-primary-foreground"
						/>
						<rect
							x={cx + 1.5}
							y={y(d.paidMinor)}
							width={bar}
							height={top + plot - y(d.paidMinor)}
							rx={3}
							className="fill-primary-foreground/50"
						/>
						<text
							x={cx - bar / 2 - 1.5}
							y={y(d.billedMinor) - 4}
							textAnchor="middle"
							className="fill-current text-[9px] opacity-80"
						>
							{compact(d.billedMinor)}
						</text>
						<text
							x={cx + bar / 2 + 1.5}
							y={y(d.paidMinor) - 4}
							textAnchor="middle"
							className="fill-current text-[9px] opacity-80"
						>
							{compact(d.paidMinor)}
						</text>
						<text
							x={cx}
							y={height - 6}
							textAnchor="middle"
							className="fill-current text-[10px] opacity-60"
						>
							{d.label}
						</text>
					</g>
				);
			})}
		</svg>
	);
}
