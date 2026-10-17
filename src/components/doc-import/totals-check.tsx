import { Calculator, TriangleAlert } from "lucide-react";
import { Badge } from "#/components/ui/badge.tsx";
import { Input } from "#/components/ui/input.tsx";
import type { DocImportForm, PrintedField } from "#/lib/doc-import/form.ts";
import type { TotalsOutcome } from "#/lib/doc-import/validate.ts";
import { formatMoney } from "#/lib/money/index.ts";
import { cn } from "#/lib/utils.ts";
import { type FieldState, flagClass } from "./field.tsx";

const ROWS: { field: Exclude<PrintedField, "number">; label: string }[] = [
	{ field: "subtotal", label: "Subtotal" },
	{ field: "tax", label: "Tax" },
	{ field: "total", label: "Total" },
];

/**
 * Printed totals next to the tax engine's. The printed ones are what the
 * scan says, editable in case the model misread them; the computed ones are
 * what the draft will carry. A difference is flagged, never resolved for
 * the person.
 */
export function TotalsCheck({
	form,
	totals,
	mismatches,
	state,
	onChange,
	disabled,
}: {
	form: DocImportForm;
	totals: TotalsOutcome;
	mismatches: Record<string, string>;
	state: (path: string) => FieldState;
	onChange: (form: DocImportForm, path: string) => void;
	disabled?: boolean;
}) {
	const computed = totals.ok
		? {
				subtotal: totals.result.subtotalMinor,
				tax: totals.result.taxMinor,
				total: totals.result.totalMinor,
			}
		: null;
	const currency = totals.ok ? totals.result.currency : form.currency;
	const lineMismatches = Object.entries(mismatches).filter(([p]) =>
		p.startsWith("lines."),
	);

	return (
		<div className="space-y-3">
			<h3 className="flex items-center gap-2 text-sm font-medium">
				<Calculator className="size-4 text-muted-foreground" />
				Totals check
			</h3>
			<div className="overflow-x-auto rounded-md border">
				<table className="w-full text-sm">
					<thead className="bg-muted/50 text-left text-xs text-muted-foreground">
						<tr>
							<th className="px-3 py-2 font-medium" />
							<th className="w-40 px-3 py-2 text-right font-medium">
								Printed on the document
							</th>
							<th className="w-40 px-3 py-2 text-right font-medium">
								Computed by the tax engine
							</th>
							<th className="px-3 py-2 font-medium" />
						</tr>
					</thead>
					<tbody>
						{ROWS.map(({ field, label }) => {
							const path = `printed.${field}`;
							const s = state(path);
							const mismatch = mismatches[path];
							const printed = form.printed[field].trim();
							return (
								<tr key={field} className="border-t align-middle">
									<td className="px-3 py-2 font-medium">{label}</td>
									<td className="px-2 py-1.5">
										<Input
											aria-label={`Printed ${label.toLowerCase()}`}
											value={form.printed[field]}
											placeholder="Not printed"
											disabled={disabled}
											onChange={(e) =>
												onChange(
													{
														...form,
														printed: {
															...form.printed,
															[field]: e.target.value,
														},
													},
													path,
												)
											}
											className={cn(
												"h-8 text-right tabular-nums",
												flagClass(s.flagged || Boolean(mismatch)),
											)}
										/>
									</td>
									<td className="px-3 py-2 text-right tabular-nums">
										{computed
											? formatMoney({ minor: computed[field], currency })
											: "–"}
									</td>
									<td className="px-3 py-2">
										{!computed ? null : mismatch ? (
											<Badge variant="warning">Doesn't match</Badge>
										) : printed ? (
											<Badge variant="success">Matches</Badge>
										) : (
											<Badge variant="outline">Not printed</Badge>
										)}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
			{!totals.ok ? (
				<p className="text-xs text-muted-foreground">{totals.error}</p>
			) : null}
			{Object.keys(mismatches).length ? (
				<div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
					<TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
					<div className="space-y-1">
						<p className="font-medium">
							The printed amounts don't add up. Check the lines against the
							scan: the draft carries the computed totals, not the printed ones.
						</p>
						<ul className="space-y-0.5 text-muted-foreground">
							{ROWS.filter((r) => mismatches[`printed.${r.field}`]).map((r) => (
								<li key={r.field}>
									{r.label}: {mismatches[`printed.${r.field}`]}
								</li>
							))}
							{lineMismatches.map(([path, message]) => (
								<li key={path}>
									Line {Number(path.split(".")[1]) + 1}: {message}
								</li>
							))}
						</ul>
					</div>
				</div>
			) : null}
		</div>
	);
}
