/**
 * One printed document (#19). All four layouts render this same markup from
 * the same `PrintModel`; `data-layout` selects the look in print-styles.ts.
 * Every amount arrives pre-formatted from exact minor units; nothing here
 * calculates.
 */
import type { CSSProperties } from "react";
import type { PrintLayout, PrintModel, PrintParty } from "#/lib/print/model.ts";

function Party({ label, party }: { label: string; party: PrintParty }) {
	return (
		<div>
			<p className="doc-label">{label}</p>
			<p className="doc-party-name">{party.name}</p>
			{party.lines.map((line) => (
				<p key={line}>{line}</p>
			))}
			{party.taxIds.map((t) => (
				<p key={`${t.label}:${t.value}`}>
					<span className="doc-small">{t.label}:</span> {t.value}
				</p>
			))}
			{party.email ? <p>{party.email}</p> : null}
		</div>
	);
}

export function PrintDocument({
	model: m,
	layout,
}: {
	model: PrintModel;
	layout: PrintLayout;
}) {
	const style = {
		...(m.branding.accentColor
			? {
					"--doc-accent": m.branding.accentColor,
					"--doc-accent-ink":
						m.branding.accentInk === "light"
							? "var(--primary-foreground)"
							: "var(--foreground)",
				}
			: {}),
	} as CSSProperties;
	const { columns } = m;

	return (
		<article
			className="doc"
			data-layout={layout}
			data-status={m.status}
			style={style}
		>
			{m.watermark ? (
				<div className="doc-watermark" aria-hidden="true">
					<span>{m.watermark}</span>
				</div>
			) : null}

			<div className="doc-content">
				<div className="doc-masthead">
					<div>
						{m.branding.logoUrl ? (
							<img
								className="doc-logo"
								src={m.branding.logoUrl}
								alt={`${m.seller.name} logo`}
							/>
						) : null}
						<p className="doc-seller-name">{m.seller.name}</p>
						<div className="doc-small">
							{m.seller.lines.map((line) => (
								<p key={line}>{line}</p>
							))}
							{m.seller.taxIds.map((t) => (
								<p key={`${t.label}:${t.value}`}>
									{t.label}: {t.value}
								</p>
							))}
							{m.seller.email ? <p>{m.seller.email}</p> : null}
						</div>
					</div>
					<div className="doc-title">
						<h1 className="doc-heading">{m.heading}</h1>
						<dl className="doc-meta">
							<dt>Number</dt>
							<dd>{m.number ?? "Not issued"}</dd>
							<dt>Date</dt>
							<dd>{m.date}</dd>
							{m.dueDate ? (
								<>
									<dt>Due</dt>
									<dd>{m.dueDate}</dd>
								</>
							) : null}
							<dt>Currency</dt>
							<dd>{m.currency}</dd>
						</dl>
					</div>
				</div>

				<div className="doc-parties">
					<Party label="Bill to" party={m.buyer} />
					{m.placeOfSupply ? (
						<div>
							<p className="doc-label">Place of supply</p>
							<p>{m.placeOfSupply}</p>
						</div>
					) : null}
				</div>

				<table className="doc-lines">
					<thead>
						<tr>
							<th className="num">#</th>
							<th className="doc-desc">Description</th>
							{columns.hsnSac ? <th>HSN/SAC</th> : null}
							<th className="num">Qty</th>
							{columns.unit ? <th>Unit</th> : null}
							<th className="num">Unit price</th>
							{columns.discount ? <th className="num">Discount</th> : null}
							<th className="num">Tax</th>
							<th className="num">Amount</th>
						</tr>
					</thead>
					<tbody>
						{m.lines.map((l) => (
							<tr key={l.lineNo}>
								<td className="num">{l.lineNo}</td>
								<td className="doc-desc">{l.description}</td>
								{columns.hsnSac ? <td>{l.hsnSac ?? ""}</td> : null}
								<td className="num">{l.quantity}</td>
								{columns.unit ? <td>{l.unit ?? ""}</td> : null}
								<td className="num">{l.unitPrice}</td>
								{columns.discount ? (
									<td className="num">{l.discount ?? ""}</td>
								) : null}
								<td className="num">{l.tax}</td>
								<td className="num">{l.amount}</td>
							</tr>
						))}
					</tbody>
				</table>

				<div className="doc-summary">
					{m.taxRows.length > 0 ? (
						<table className="doc-taxsummary">
							<thead>
								<tr>
									<th>Tax</th>
									<th className="num">Taxable</th>
									<th className="num">Amount</th>
								</tr>
							</thead>
							<tbody>
								{m.taxRows.map((r) => (
									<tr key={r.label}>
										<td>{r.label}</td>
										<td className="num">{r.taxable}</td>
										<td className="num">{r.amount}</td>
									</tr>
								))}
							</tbody>
						</table>
					) : null}
					<table className="doc-totals">
						<tbody>
							<tr>
								<td>Subtotal</td>
								<td className="num">{m.subtotal}</td>
							</tr>
							{m.taxRows.map((r) => (
								<tr key={r.label}>
									<td>{r.label}</td>
									<td className="num">{r.amount}</td>
								</tr>
							))}
							{m.taxRows.length === 0 && m.tax !== null ? (
								<tr>
									<td>Tax</td>
									<td className="num">{m.tax}</td>
								</tr>
							) : null}
							<tr className="doc-grand">
								<td>{m.totalLabel}</td>
								<td className="num">{m.total ?? "—"}</td>
							</tr>
							{m.payment ? (
								<>
									{m.payment.paid ? (
										<tr>
											<td>Amount paid</td>
											<td className="num">{m.payment.paid}</td>
										</tr>
									) : null}
									<tr className="doc-balance">
										<td>
											{m.payment.overdue ? "Balance overdue" : "Balance due"}
										</td>
										<td className="num">{m.payment.balance}</td>
									</tr>
								</>
							) : null}
						</tbody>
					</table>
				</div>

				{m.statutoryNotes.length > 0 || m.notes || m.terms ? (
					<div className="doc-notes">
						{m.statutoryNotes.map((note) => (
							<p key={note} className="doc-statutory">
								{note}
							</p>
						))}
						{m.notes ? (
							<div>
								<p className="doc-label">Notes</p>
								<p>{m.notes}</p>
							</div>
						) : null}
						{m.terms ? (
							<div>
								<p className="doc-label">Terms</p>
								<p>{m.terms}</p>
							</div>
						) : null}
					</div>
				) : null}

				{m.status === "void" ? (
					<p className="doc-void">
						Void{m.voidReason ? `: ${m.voidReason}` : ""}
					</p>
				) : null}
			</div>
		</article>
	);
}
