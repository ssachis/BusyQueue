import type { CalendarWeek } from "#/lib/forecast/index.ts";
import { compactMoney, formatDate, money } from "./format.tsx";

/**
 * Expected cash per week (bars) with the low–high range (whiskers). Plain
 * SVG, chart tokens only. Bars: cash in = chart-2, cash out = chart-1.
 * Bar labels are compact (display-only rounding of code-computed totals).
 */
export function WeeklyChart({
	weeks,
	currency,
	showIn,
	showOut,
}: {
	weeks: CalendarWeek[];
	currency: string | null;
	showIn: boolean;
	showOut: boolean;
}) {
	const width = 640;
	const height = 190;
	const top = 18;
	const bottom = 26;
	const plot = height - top - bottom;
	const series = [
		...(showIn ? [{ key: "in" as const, className: "fill-chart-2" }] : []),
		...(showOut ? [{ key: "out" as const, className: "fill-chart-1" }] : []),
	];
	const max = Math.max(
		1,
		...weeks.flatMap((w) => series.map((s) => w[s.key].highMinor)),
	);
	const group = width / Math.max(1, weeks.length);
	const bar = Math.min(18, (group - 8) / Math.max(1, series.length));
	const y = (v: number) => top + plot - (Math.max(0, v) / max) * plot;
	const summary = weeks
		.map(
			(w) =>
				`week of ${formatDate(w.startDate)}: ${series
					.map(
						(s) =>
							`${s.key === "in" ? "in" : "out"} ${money(w[s.key].expectedMinor, currency)} (${money(w[s.key].lowMinor, currency)} to ${money(w[s.key].highMinor, currency)})`,
					)
					.join(", ")}`,
		)
		.join("; ");

	return (
		<svg
			viewBox={`0 0 ${width} ${height}`}
			role="img"
			aria-label={`Expected cash per week with low to high range. ${summary}`}
			className="h-auto w-full"
		>
			<line
				x1={0}
				x2={width}
				y1={top + plot}
				y2={top + plot}
				className="stroke-current opacity-20"
			/>
			{weeks.map((w, i) => {
				const left = group * i + (group - bar * series.length) / 2;
				return (
					<g key={w.startDate}>
						{series.map((s, k) => {
							const r = w[s.key];
							const x = left + k * bar;
							const cx = x + bar / 2;
							return (
								<g key={s.key}>
									<rect
										x={x + 1}
										y={y(r.expectedMinor)}
										width={bar - 2}
										height={top + plot - y(r.expectedMinor)}
										rx={2}
										className={s.className}
									/>
									{r.highMinor !== r.lowMinor ? (
										<g className="stroke-foreground/60">
											<line
												x1={cx}
												x2={cx}
												y1={y(r.highMinor)}
												y2={y(r.lowMinor)}
											/>
											<line
												x1={cx - 3}
												x2={cx + 3}
												y1={y(r.highMinor)}
												y2={y(r.highMinor)}
											/>
										</g>
									) : null}
									{r.expectedMinor > 0 ? (
										<text
											x={cx}
											y={y(r.highMinor) - 4}
											textAnchor="middle"
											className="fill-current text-[9px] opacity-70"
										>
											{compactMoney(r.expectedMinor, currency)}
										</text>
									) : null}
								</g>
							);
						})}
						{i % 2 === 0 ? (
							<text
								x={group * i + group / 2}
								y={height - 8}
								textAnchor="middle"
								className="fill-current text-[10px] opacity-60"
							>
								{formatDate(w.startDate, false)}
							</text>
						) : null}
					</g>
				);
			})}
		</svg>
	);
}
