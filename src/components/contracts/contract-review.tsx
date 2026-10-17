import { Link, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Check, Loader2, Play, TriangleAlert } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { PageBody, PageHeader } from "#/components/app-shell.tsx";
import { Badge } from "#/components/ui/badge.tsx";
import { Button } from "#/components/ui/button.tsx";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "#/components/ui/card.tsx";
import { Input } from "#/components/ui/input.tsx";
import { Label } from "#/components/ui/label.tsx";
import {
	type DiffRow,
	diffPriceList,
	type ExtractionFlag,
	formatPriceDelta,
	formatUnitPrice,
} from "#/lib/contracts/index.ts";
import { cn } from "#/lib/utils.ts";
import { confirmContractPrices } from "#/server/contracts.ts";
import type { ContractReview as Review } from "#/server/contracts-review.ts";
import { formatTerm } from "./format.ts";

type VendorChoice =
	| { kind: "existing"; id: string }
	| { kind: "new"; name: string };

const STATUS_BADGE: Record<
	DiffRow["status"],
	{ label: string; variant: "info" | "warning" | "outline" }
> = {
	new: { label: "New", variant: "info" },
	changed: { label: "Changed", variant: "warning" },
	unchanged: { label: "Unchanged", variant: "outline" },
};

const FIELD_LABEL: Record<string, string> = {
	"": "Reply",
	vendor: "Vendor",
	title: "Title",
	startDate: "Start date",
	endDate: "End date",
	noticeDays: "Notice period",
	autoRenew: "Auto-renew",
	currency: "Currency",
	prices: "Prices",
};

function flagLabel(path: string): string {
	const line = path.match(/^prices\.(\d+)/)?.[1];
	return line ? `Line ${line}` : (FIELD_LABEL[path] ?? path);
}

/** Flags on one contract line ("prices.3", "prices.3.unitPrice"). */
const lineFlags = (flags: ExtractionFlag[], lineNo: number) =>
	flags.filter(
		(f) =>
			f.path === `prices.${lineNo}` || f.path.startsWith(`prices.${lineNo}.`),
	);

function initialChoice(review: Review): VendorChoice {
	const { contract, match } = review;
	if (contract.vendorId) return { kind: "existing", id: contract.vendorId };
	if (match.status === "matched")
		return { kind: "existing", id: match.vendor.id };
	if (match.status === "ambiguous") return { kind: "existing", id: "" };
	return { kind: "new", name: contract.vendorName ?? "" };
}

function Term({
	label,
	children,
	flags = [],
}: {
	label: string;
	children: ReactNode;
	flags?: ExtractionFlag[];
}) {
	return (
		<div className="space-y-0.5">
			<div className="text-xs text-muted-foreground">{label}</div>
			<div className="text-sm font-medium">{children}</div>
			{flags.map((f) => (
				<p
					key={`${f.path}-${f.message}`}
					className={cn(
						"text-xs",
						f.severity === "error" ? "text-destructive" : "text-warning",
					)}
				>
					{f.message}
				</p>
			))}
		</div>
	);
}

export function ContractReview({ review }: { review: Review }) {
	const router = useRouter();
	const { contract, vendors, pricesByVendor, match } = review;
	const confirmed = contract.status === "confirmed";
	const currency = contract.currency;

	const [choice, setChoice] = useState<VendorChoice>(() =>
		initialChoice(review),
	);
	const [exclude, setExclude] = useState<Set<number>>(() => new Set());
	const [confirmedBy, setConfirmedBy] = useState("");
	const [saving, setSaving] = useState(false);

	const current =
		choice.kind === "existing" ? (pricesByVendor[choice.id] ?? []) : [];
	// Same pure diff the server recomputes on confirm.
	const diff = diffPriceList(current, contract.prices, currency, exclude);
	const diffByLine = new Map(diff.rows.map((r) => [r.lineNo, r]));
	const termFlags = (field: string) =>
		contract.flags.filter((f) => f.path === field);
	const vendorReady =
		choice.kind === "existing"
			? Boolean(choice.id)
			: Boolean(choice.name.trim());
	const vendorName =
		choice.kind === "existing"
			? vendors.find((v) => v.id === choice.id)?.name
			: choice.name.trim();

	async function onConfirm() {
		setSaving(true);
		try {
			const result = await confirmContractPrices({
				data: {
					contractId: contract.id,
					vendor: choice,
					exclude: [...exclude],
					confirmedBy,
				},
			});
			toast.success(
				`${result.vendor.name} price list updated: ${result.counts.changed} changed, ${result.counts.new} new`,
			);
			await router.invalidate();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Could not confirm");
		} finally {
			setSaving(false);
		}
	}

	return (
		<>
			<PageHeader
				title={contract.title ?? "Untitled contract"}
				description={
					confirmed
						? `Confirmed by ${contract.confirmedBy} on ${contract.confirmedAt?.slice(0, 10)}. These prices are now on the price list.`
						: "Check what was read, then confirm to update the vendor's price list. Nothing changes until you confirm."
				}
			>
				<Button asChild variant="outline" size="sm">
					<Link to="/contracts">
						<ArrowLeft />
						Contracts
					</Link>
				</Button>
				{confirmed ? (
					<Button asChild size="sm">
						<Link to="/review">
							<Play />
							Audit invoices
						</Link>
					</Button>
				) : null}
			</PageHeader>
			<PageBody className="max-w-6xl space-y-6">
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							Terms
							{confirmed ? (
								<Badge variant="success">Confirmed</Badge>
							) : (
								<Badge variant="info">Needs review</Badge>
							)}
						</CardTitle>
						<CardDescription>
							Read by {contract.model ?? "the model"}
							{contract.sourceName ? ` from ${contract.sourceName}` : ""}.
							{contract.prismTraceId ? (
								<>
									{" "}
									PRISM trace{" "}
									<code className="font-mono text-xs">
										{contract.prismTraceId}
									</code>
									.
								</>
							) : null}
						</CardDescription>
					</CardHeader>
					<CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
						<Term label="Vendor (as printed)" flags={termFlags("vendor")}>
							{contract.vendorName ?? "—"}
						</Term>
						<Term
							label="Term"
							flags={[...termFlags("startDate"), ...termFlags("endDate")]}
						>
							{contract.startDate ?? "?"} → {contract.endDate ?? "?"}
						</Term>
						<Term
							label="Renewal"
							flags={[...termFlags("autoRenew"), ...termFlags("noticeDays")]}
						>
							{formatTerm({
								startDate: null,
								endDate: null,
								autoRenew: contract.autoRenew,
								noticeDays: contract.noticeDays,
							})}
						</Term>
						<Term label="Currency" flags={termFlags("currency")}>
							{currency}
						</Term>
					</CardContent>
				</Card>

				{!confirmed ? (
					<Card>
						<CardHeader>
							<CardTitle>Vendor</CardTitle>
							<CardDescription>
								{match.status === "matched"
									? `"${contract.vendorName}" matched ${match.vendor.name} on the price list.`
									: match.status === "ambiguous"
										? `"${contract.vendorName}" could be more than one vendor. Pick one.`
										: match.status === "unknown"
											? `"${contract.vendorName}" is not on the price list yet. Create it, or pick the right vendor.`
											: "The contract doesn't name a vendor. Pick or create one."}
							</CardDescription>
						</CardHeader>
						<CardContent className="grid gap-4 sm:grid-cols-2">
							<fieldset className="space-y-2">
								<label className="flex items-center gap-2 text-sm">
									<input
										type="radio"
										name="vendor-kind"
										checked={choice.kind === "existing"}
										onChange={() =>
											setChoice({
												kind: "existing",
												id:
													match.status === "matched"
														? match.vendor.id
														: (vendors[0]?.id ?? ""),
											})
										}
									/>
									Existing vendor
								</label>
								<select
									aria-label="Existing vendor"
									disabled={choice.kind !== "existing"}
									value={choice.kind === "existing" ? choice.id : ""}
									onChange={(e) =>
										setChoice({ kind: "existing", id: e.target.value })
									}
									className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30"
								>
									<option value="" disabled>
										Pick a vendor…
									</option>
									{(match.status === "ambiguous"
										? match.candidates
										: vendors
									).map((v) => (
										<option key={v.id} value={v.id}>
											{v.name}
										</option>
									))}
								</select>
							</fieldset>
							<fieldset className="space-y-2">
								<label className="flex items-center gap-2 text-sm">
									<input
										type="radio"
										name="vendor-kind"
										checked={choice.kind === "new"}
										onChange={() =>
											setChoice({
												kind: "new",
												name: contract.vendorName ?? "",
											})
										}
									/>
									New vendor
								</label>
								<Input
									aria-label="New vendor name"
									disabled={choice.kind !== "new"}
									value={choice.kind === "new" ? choice.name : ""}
									onChange={(e) =>
										setChoice({ kind: "new", name: e.target.value })
									}
									placeholder="Vendor name as it should appear on the price list"
								/>
							</fieldset>
						</CardContent>
					</Card>
				) : null}

				{confirmed ? (
					<AppliedPrices applied={review.applied} currency={currency} />
				) : (
					<Card>
						<CardHeader>
							<CardTitle>Price changes</CardTitle>
							<CardDescription>
								{vendorName
									? `Against the current price list for ${vendorName}: `
									: "Pick a vendor to compare. "}
								{diff.counts.changed} changed · {diff.counts.new} new ·{" "}
								{diff.counts.unchanged} unchanged
								{diff.skipped.length
									? ` · ${diff.skipped.length} left out`
									: ""}
								. Untick a line to leave it out.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<div className="overflow-x-auto rounded-md border">
								<table className="w-full text-sm">
									<thead className="bg-muted/40 text-left text-muted-foreground">
										<tr>
											<th className="w-10 px-3 py-2 font-medium">
												<span className="sr-only">Include</span>
											</th>
											<th className="px-3 py-2 font-medium">Item</th>
											<th className="px-3 py-2 font-medium">Unit</th>
											<th className="px-3 py-2 text-right font-medium">
												Current
											</th>
											<th className="px-3 py-2 text-right font-medium">
												Contract
											</th>
											<th className="px-3 py-2 text-right font-medium">
												Change
											</th>
											<th className="px-3 py-2 font-medium">Pack</th>
											<th className="px-3 py-2 font-medium">Status</th>
										</tr>
									</thead>
									<tbody className="divide-y">
										{contract.prices.map((p) => {
											const row = diffByLine.get(p.lineNo);
											const flags = lineFlags(contract.flags, p.lineNo);
											const excluded = exclude.has(p.lineNo);
											const badge = row ? STATUS_BADGE[row.status] : null;
											return (
												<tr
													key={p.lineNo}
													className={cn(
														(p.blocked || excluded) && "text-muted-foreground",
														row?.status === "changed" && "bg-warning/5",
													)}
												>
													<td className="px-3 py-2 align-top">
														<input
															type="checkbox"
															aria-label={`Include line ${p.lineNo}`}
															disabled={p.blocked}
															checked={!p.blocked && !excluded}
															onChange={(e) => {
																const next = new Set(exclude);
																if (e.target.checked) next.delete(p.lineNo);
																else next.add(p.lineNo);
																setExclude(next);
															}}
														/>
													</td>
													<td className="px-3 py-2 align-top">
														<div className="font-medium">
															{row?.item ?? (p.item || "—")}
														</div>
														{flags.map((f) => (
															<p
																key={`${f.path}-${f.message}`}
																className={cn(
																	"text-xs",
																	f.severity === "error"
																		? "text-destructive"
																		: "text-warning",
																)}
															>
																{f.message}
															</p>
														))}
													</td>
													<td className="px-3 py-2 align-top">
														{row?.unit ?? (p.unit || "—")}
													</td>
													<td className="px-3 py-2 text-right align-top tabular-nums">
														{row?.oldUnitPrice
															? formatUnitPrice(row.oldUnitPrice, currency)
															: "—"}
													</td>
													<td className="px-3 py-2 text-right align-top font-medium tabular-nums">
														{p.unitPrice
															? formatUnitPrice(p.unitPrice, currency)
															: "—"}
													</td>
													<td
														className={cn(
															"px-3 py-2 text-right align-top tabular-nums",
															row?.changes.includes("price") &&
																"font-medium text-warning",
														)}
													>
														{row?.delta
															? formatPriceDelta(row.delta, currency)
															: "—"}
													</td>
													<td className="px-3 py-2 align-top">
														{row?.changes.includes("pack")
															? `${row.oldPack ?? "none"} → ${row.newPack ?? "none"}`
															: (row?.newPack ?? "—")}
													</td>
													<td className="px-3 py-2 align-top">
														{p.blocked ? (
															<Badge variant="destructive">Blocked</Badge>
														) : excluded ? (
															<Badge variant="outline">Left out</Badge>
														) : badge ? (
															<Badge variant={badge.variant}>
																{badge.label}
															</Badge>
														) : null}
													</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							</div>

							{diff.notInContract.length > 0 ? (
								<div className="mt-4 space-y-2">
									<p className="text-sm text-muted-foreground">
										On the price list for {vendorName} but not in this contract
										(kept as they are):
									</p>
									<ul className="divide-y rounded-md border text-sm">
										{diff.notInContract.map((c) => (
											<li
												key={`${c.item}|${c.unit}`}
												className="flex justify-between px-3 py-1.5"
											>
												<span>
													{c.item}{" "}
													<span className="text-muted-foreground">
														per {c.unit}
													</span>
												</span>
												<span className="tabular-nums">
													{formatUnitPrice(c.unitPrice, c.currency)}
												</span>
											</li>
										))}
									</ul>
								</div>
							) : null}
						</CardContent>
					</Card>
				)}

				{contract.flags.some((f) => !f.path.startsWith("prices.")) &&
				!confirmed ? (
					<Card className="border-warning/40">
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<TriangleAlert className="size-4 text-warning" />
								Check before confirming
							</CardTitle>
						</CardHeader>
						<CardContent>
							<ul className="space-y-1 text-sm">
								{contract.flags
									.filter((f) => !f.path.startsWith("prices."))
									.map((f) => (
										<li key={`${f.path}-${f.message}`} className="flex gap-2">
											<Badge
												variant={
													f.severity === "error" ? "destructive" : "warning"
												}
											>
												{flagLabel(f.path)}
											</Badge>
											<span>
												{f.message}
												{f.source === "model" ? (
													<span className="text-muted-foreground">
														{" "}
														(model)
													</span>
												) : null}
											</span>
										</li>
									))}
							</ul>
						</CardContent>
					</Card>
				) : null}

				{!confirmed ? (
					<Card>
						<CardHeader>
							<CardTitle>Confirm</CardTitle>
							<CardDescription>
								Writes {diff.rows.length} price
								{diff.rows.length === 1 ? "" : "s"} to the price list for{" "}
								{vendorName || "the vendor"} in one step. The next audit uses
								them.
							</CardDescription>
						</CardHeader>
						<CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
							<div className="flex-1 space-y-1.5">
								<Label htmlFor="confirmed-by">Confirmed by</Label>
								<Input
									id="confirmed-by"
									value={confirmedBy}
									onChange={(e) => setConfirmedBy(e.target.value)}
									placeholder="Your name"
								/>
							</div>
							<Button
								onClick={onConfirm}
								disabled={
									saving ||
									!vendorReady ||
									diff.rows.length === 0 ||
									!confirmedBy.trim()
								}
							>
								{saving ? <Loader2 className="animate-spin" /> : <Check />}
								Confirm and update price list
							</Button>
						</CardContent>
					</Card>
				) : null}

				<details className="rounded-md border px-3 py-2 text-sm">
					<summary className="cursor-pointer text-muted-foreground">
						Contract text
					</summary>
					<pre className="mt-2 max-h-96 overflow-auto font-mono text-xs whitespace-pre-wrap">
						{contract.sourceText}
					</pre>
				</details>
			</PageBody>
		</>
	);
}

function AppliedPrices({
	applied,
	currency,
}: {
	applied: Review["applied"];
	currency: string;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Applied to the price list</CardTitle>
				<CardDescription>
					What this contract wrote, with the price it replaced.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="overflow-x-auto rounded-md border">
					<table className="w-full text-sm">
						<thead className="bg-muted/40 text-left text-muted-foreground">
							<tr>
								<th className="px-3 py-2 font-medium">Item</th>
								<th className="px-3 py-2 font-medium">Unit</th>
								<th className="px-3 py-2 text-right font-medium">Before</th>
								<th className="px-3 py-2 text-right font-medium">Now</th>
								<th className="px-3 py-2 font-medium">Pack</th>
								<th className="px-3 py-2 font-medium">Status</th>
							</tr>
						</thead>
						<tbody className="divide-y">
							{applied.map((a) => (
								<tr key={a.lineNo}>
									<td className="px-3 py-2 font-medium">{a.item}</td>
									<td className="px-3 py-2">{a.unit}</td>
									<td className="px-3 py-2 text-right tabular-nums">
										{a.previousUnitPrice
											? formatUnitPrice(a.previousUnitPrice, currency)
											: "—"}
									</td>
									<td className="px-3 py-2 text-right font-medium tabular-nums">
										{formatUnitPrice(a.unitPrice, a.currency)}
									</td>
									<td className="px-3 py-2">
										{a.packUnit && a.packSize
											? `${a.packUnit} of ${a.packSize}`
											: "—"}
									</td>
									<td className="px-3 py-2">
										<Badge variant={STATUS_BADGE[a.change].variant}>
											{STATUS_BADGE[a.change].label}
										</Badge>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</CardContent>
		</Card>
	);
}
