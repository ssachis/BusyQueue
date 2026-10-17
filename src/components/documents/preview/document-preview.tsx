/**
 * A document as it prints: heading, parties, lines with per-line tax, tax
 * totals by component and rate, and the statutory notes. Every amount comes
 * from the tax engine's `TaxResult`; this component only formats.
 *
 * Used live beside the editor (totals recomputed as the user types) and
 * read-only for issued documents (frozen snapshots).
 */
import { CircleAlert, Info } from "lucide-react";
import type { CSSProperties } from "react";
import type {
	DocumentStatus,
	DocumentType,
	DraftLine,
	PartySnapshot,
} from "#/lib/documents/types.ts";
import { formatMoney } from "#/lib/money/index.ts";
import {
	documentHeading,
	isTaxCountry,
	type LineTax,
	type TaxResult,
} from "#/lib/tax/index.ts";
import { cn } from "#/lib/utils.ts";
import {
	formatDate,
	formatDecimalMoney,
	formatQuantity,
	TYPE_LABEL,
	taxLabel,
} from "./format.ts";

export interface PreviewDocument {
	type: DocumentType;
	status: DocumentStatus;
	number: string | null;
	date: string;
	dueDate?: string | null;
	currency: string;
	seller: PartySnapshot & { taxIds?: { type: string; value: string }[] };
	buyer: PartySnapshot;
	placeOfSupply?: string | null;
	notes?: string | null;
	terms?: string | null;
	lines: DraftLine[];
}

export type PreviewTotals =
	| { ok: true; result: TaxResult; skipped?: number[] }
	| { ok: false; message: string; skipped?: number[] };

const DUE_LABEL: Partial<Record<DocumentType, string>> = {
	quote: "Valid until",
	proforma: "Due",
	invoice: "Due",
};

function heading(doc: PreviewDocument, reverseCharge: boolean): string {
	if (!isTaxCountry(doc.seller.country)) return TYPE_LABEL[doc.type];
	return documentHeading(doc.seller.country, doc.type, { reverseCharge });
}

function money(minor: number, currency: string): string {
	try {
		return formatMoney({ minor, currency });
	} catch {
		return `${minor} ${currency}`;
	}
}

function Party({
	label,
	party,
	taxIds,
}: {
	label: string;
	party: PartySnapshot;
	taxIds?: { type: string; value: string }[];
}) {
	const place = [party.city, party.region, party.postalCode]
		.filter(Boolean)
		.join(", ");
	const ids =
		taxIds && taxIds.length > 0
			? taxIds
			: party.taxId
				? [{ type: "Tax ID", value: party.taxId }]
				: [];
	return (
		<div className="min-w-0 space-y-0.5 text-sm">
			<p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
				{label}
			</p>
			<p className="font-semibold break-words">
				{party.name || (
					<span className="font-normal text-muted-foreground italic">
						No name yet
					</span>
				)}
			</p>
			{party.addressLines.map((line, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: address lines are positional
				<p key={i} className="break-words text-muted-foreground">
					{line}
				</p>
			))}
			{place ? <p className="text-muted-foreground">{place}</p> : null}
			<p className="text-muted-foreground">{party.country}</p>
			{ids.map((t) => (
				<p key={`${t.type}-${t.value}`} className="text-muted-foreground">
					{t.type}: {t.value}
				</p>
			))}
			{party.email ? (
				<p className="break-all text-muted-foreground">{party.email}</p>
			) : null}
		</div>
	);
}

export function DocumentPreview({
	doc,
	totals,
	accentColor,
	className,
}: {
	doc: PreviewDocument;
	totals: PreviewTotals;
	accentColor: string | null;
	className?: string;
}) {
	const result = totals.ok ? totals.result : null;
	const byLine = new Map<number, LineTax>(
		(result?.lines ?? []).map((l) => [l.lineNo, l]),
	);
	const skipped = new Set(totals.skipped ?? []);
	const india = doc.seller.country === "IN";
	const showTax = doc.type !== "delivery_note" || (result?.taxMinor ?? 0) > 0;
	const dueLabel = DUE_LABEL[doc.type];
	const style = {
		"--doc-accent": accentColor ?? "var(--primary)",
	} as CSSProperties;

	return (
		<article
			style={style}
			className={cn(
				"relative overflow-hidden rounded-xl border border-t-4 border-t-[var(--doc-accent)] bg-card text-card-foreground shadow-sm",
				className,
			)}
			aria-label="Document preview"
		>
			{doc.status === "void" ? (
				<div
					aria-hidden
					className="pointer-events-none absolute inset-0 flex items-center justify-center"
				>
					<span className="-rotate-12 rounded-lg border-4 border-destructive/40 px-6 py-2 text-5xl font-black tracking-widest text-destructive/40">
						VOID
					</span>
				</div>
			) : null}

			<div className="space-y-8 p-6 sm:p-8">
				<header className="flex flex-wrap items-start justify-between gap-4">
					<div>
						<h2 className="text-2xl font-semibold tracking-tight text-[var(--doc-accent)]">
							{heading(doc, result?.reverseCharge ?? false)}
						</h2>
						<p className="mt-1 text-sm text-muted-foreground">
							{doc.number ? (
								<span className="font-medium text-foreground">
									No. {doc.number}
								</span>
							) : (
								<span className="italic">Draft · numbered on issue</span>
							)}
						</p>
					</div>
					<dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 text-right text-sm">
						<dt className="text-muted-foreground">Date</dt>
						<dd className="tabular-nums">{formatDate(doc.date)}</dd>
						{doc.dueDate && dueLabel ? (
							<>
								<dt className="text-muted-foreground">{dueLabel}</dt>
								<dd className="tabular-nums">{formatDate(doc.dueDate)}</dd>
							</>
						) : null}
						{india && (doc.placeOfSupply || doc.buyer.region) ? (
							<>
								<dt className="text-muted-foreground">Place of supply</dt>
								<dd className="tabular-nums">
									{doc.placeOfSupply || doc.buyer.region}
								</dd>
							</>
						) : null}
						<dt className="text-muted-foreground">Currency</dt>
						<dd>{doc.currency}</dd>
					</dl>
				</header>

				<div className="grid gap-6 sm:grid-cols-2">
					<Party label="From" party={doc.seller} taxIds={doc.seller.taxIds} />
					<Party label="Bill to" party={doc.buyer} />
				</div>

				<div className="-mx-6 overflow-x-auto px-6 sm:-mx-8 sm:px-8">
					<table className="w-full min-w-[480px] text-[13px]">
						<thead>
							<tr className="border-b-2 border-[var(--doc-accent)] text-left text-xs tracking-wide text-muted-foreground uppercase">
								<th className="py-2 pr-2 font-medium">#</th>
								<th className="py-2 pr-2 font-medium">Description</th>
								<th className="py-2 pr-2 text-right font-medium">Qty</th>
								<th className="py-2 pr-2 text-right font-medium">Price</th>
								<th className="py-2 pr-2 text-right font-medium">Net</th>
								{showTax ? (
									<th className="py-2 pr-2 text-right font-medium">Tax</th>
								) : null}
								<th className="py-2 text-right font-medium">Total</th>
							</tr>
						</thead>
						<tbody>
							{doc.lines.length === 0 ? (
								<tr>
									<td
										colSpan={7}
										className="py-6 text-center text-muted-foreground italic"
									>
										No lines yet
									</td>
								</tr>
							) : null}
							{doc.lines.map((l) => {
								const tax = byLine.get(l.lineNo);
								const incomplete = skipped.has(l.lineNo);
								return (
									<tr key={l.lineNo} className="border-b align-top">
										<td className="py-2 pr-2 text-muted-foreground tabular-nums">
											{l.lineNo}
										</td>
										<td className="py-2 pr-2">
											<p className="break-words">
												{l.description || (
													<span className="text-muted-foreground italic">
														No description
													</span>
												)}
											</p>
											{l.hsnSac ? (
												<p className="text-xs text-muted-foreground">
													HSN/SAC {l.hsnSac}
												</p>
											) : null}
											{l.discount ? (
												<p className="text-xs text-muted-foreground">
													Discount −
													{formatDecimalMoney(l.discount, doc.currency)}
												</p>
											) : null}
											{tax && tax.components.length > 0 ? (
												<p className="text-xs text-muted-foreground">
													{tax.components
														.map((c) => taxLabel(c.code, c.rate))
														.join(" + ")}
												</p>
											) : null}
											{incomplete ? (
												<p className="text-xs text-warning">
													Incomplete: not counted yet
												</p>
											) : null}
										</td>
										<td className="py-2 pr-2 text-right tabular-nums">
											{formatQuantity(l.quantity)}
											{l.unit ? (
												<span className="text-muted-foreground"> {l.unit}</span>
											) : null}
										</td>
										<td className="py-2 pr-2 text-right tabular-nums">
											{formatDecimalMoney(l.unitPrice, doc.currency)}
										</td>
										<td className="py-2 pr-2 text-right tabular-nums">
											{tax ? money(tax.netMinor, doc.currency) : "—"}
										</td>
										{showTax ? (
											<td className="py-2 pr-2 text-right tabular-nums">
												{tax ? money(tax.taxMinor, doc.currency) : "—"}
											</td>
										) : null}
										<td className="py-2 text-right font-medium tabular-nums">
											{tax ? money(tax.totalMinor, doc.currency) : "—"}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>

				{totals.ok ? null : (
					<div
						role="alert"
						className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
					>
						<CircleAlert className="mt-0.5 size-4 shrink-0" />
						<p>
							<span className="font-medium">Can't work out tax yet. </span>
							{totals.message}
						</p>
					</div>
				)}

				{result ? (
					<div className="flex justify-end">
						<dl className="grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-sm">
							<dt className="text-muted-foreground">Subtotal</dt>
							<dd className="text-right tabular-nums">
								{money(result.subtotalMinor, result.currency)}
							</dd>
							{result.taxTotals.map((t) => (
								<TaxRow
									key={`${t.code}-${t.rate}`}
									label={taxLabel(t.code, t.rate)}
									taxable={money(t.taxableMinor, result.currency)}
									amount={money(t.amountMinor, result.currency)}
								/>
							))}
							{result.taxTotals.length > 1 ? (
								<>
									<dt className="text-muted-foreground">Total tax</dt>
									<dd className="text-right tabular-nums">
										{money(result.taxMinor, result.currency)}
									</dd>
								</>
							) : null}
							<div
								aria-hidden
								className="col-span-2 mt-1 border-t-2 border-[var(--doc-accent)]"
							/>
							<dt className="font-semibold">Total</dt>
							<dd className="text-right text-base font-semibold tabular-nums">
								{money(result.totalMinor, result.currency)}
							</dd>
						</dl>
					</div>
				) : null}

				{result && result.notes.length > 0 ? (
					<ul className="space-y-1 rounded-lg bg-muted p-3 text-xs">
						{result.notes.map((n) => (
							<li key={n} className="flex gap-2">
								<Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
								<span>{n}</span>
							</li>
						))}
					</ul>
				) : null}

				{doc.notes || doc.terms ? (
					<footer className="grid gap-4 border-t pt-4 text-sm sm:grid-cols-2">
						{doc.notes ? (
							<div>
								<p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
									Notes
								</p>
								<p className="mt-1 whitespace-pre-line">{doc.notes}</p>
							</div>
						) : null}
						{doc.terms ? (
							<div>
								<p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
									Terms
								</p>
								<p className="mt-1 whitespace-pre-line">{doc.terms}</p>
							</div>
						) : null}
					</footer>
				) : null}
			</div>
		</article>
	);
}

function TaxRow({
	label,
	taxable,
	amount,
}: {
	label: string;
	taxable: string;
	amount: string;
}) {
	return (
		<>
			<dt className="text-muted-foreground">
				{label}
				<span className="block text-xs">on {taxable}</span>
			</dt>
			<dd className="text-right tabular-nums">{amount}</dd>
		</>
	);
}
