/**
 * Render two of the district's own paper documents as PNGs for the
 * document-import demo (`/import-document`):
 *
 * - pta-catering-quote.png: a handwritten quote on a pre-printed catering pad
 *   for the Lincoln Elementary PTA. The handwritten total has an addition
 *   slip ($712.42 written, the lines and 8.25% tax come to $711.42), so the
 *   import flags the printed total instead of trusting it.
 * - riverside-usd-invoice.png: a typed invoice to a neighbouring district,
 *   tax exempt, with a 10% line discount that code converts to an amount.
 *
 * Each PNG is written with a `.json` beside it holding exactly what's printed,
 * so an import can be checked field by field.
 *
 *   PLAYWRIGHT=/tmp/shot/node_modules/playwright/index.mjs bun scripts/render-doc-scans.ts
 *
 * Playwright is not a project dependency; point PLAYWRIGHT at any install.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const OUT = resolve(import.meta.dirname, "../data/scans/documents");

const esc = (s: string) =>
	s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** What each document prints; the source of truth for checking an import. */
const QUOTE = {
	title: "QUOTE",
	number: "Q-0412",
	date: "10/09/2026",
	buyer: {
		name: "Lincoln Elementary PTA",
		attn: "Maria Gonzalez",
		address: "455 Lincoln Ave",
		city: "Northfield",
		region: "CA",
		postalCode: "95001",
		email: "lincolnpta@example.org",
	},
	event: "Fall Family Night, Fri Oct 24, 5:30pm, Lincoln cafeteria",
	lines: [
		{ qty: "12", unit: "", desc: 'Cheese pizza, 16"', price: "14.50", t: true, amount: "174.00" },
		{ qty: "4", unit: "trays", desc: "Garden salad tray", price: "22.00", t: true, amount: "88.00" },
		{ qty: "120", unit: "", desc: "Fruit cups", price: "1.25", t: true, amount: "150.00" },
		{ qty: "120", unit: "", desc: "Bottled water 16oz", price: "0.75", t: true, amount: "90.00" },
		{ qty: "6", unit: "hrs", desc: "Serving staff (2 x 3 hrs)", price: "28.00", t: false, amount: "168.00" },
	],
	subtotal: "670.00",
	taxRate: "8.25",
	tax: "41.42",
	/** Addition slip: 670.00 + 41.42 = 711.42. */
	total: "712.42",
	terms: "Quote valid 30 days. 50% deposit to confirm.",
	signedBy: "R. Okafor, Catering Coordinator",
};

const INVOICE = {
	title: "INVOICE",
	number: "NFS-2026-031",
	date: "October 1, 2026",
	dueDate: "October 31, 2026",
	terms: "Net 30",
	po: "RUSD-PO-55821",
	buyer: {
		name: "Riverside Unified School District",
		lines: ["Nutrition Services Department", "Attn: Accounts Payable", "88 Canal Street"],
		city: "Riverside Falls",
		region: "CA",
		postalCode: "95010",
		email: "ap@riversideusd.example.org",
	},
	lines: [
		{ desc: "Summer meal program: central kitchen lunches (weeks 1-4)", qty: "2,400", unit: "meal", price: "3.15", disc: "", amount: "7,560.00" },
		{ desc: "Breakfast packs", qty: "1,800", unit: "pack", price: "1.85", disc: "", amount: "3,330.00" },
		{ desc: "Refrigerated delivery, route charge", qty: "8", unit: "trip", price: "65.00", disc: "", amount: "520.00" },
		{ desc: "Milk, 1% half-pint (USDA Foods transfer)", qty: "40", unit: "case", price: "18.40", disc: "10%", amount: "662.40" },
	],
	subtotal: "12,072.40",
	tax: "0.00",
	total: "12,072.40",
	note: "Sales between California public school districts are not subject to sales tax.",
};

const HAND = `"Bradley Hand", "Noteworthy", "Marker Felt", "Segoe Print", cursive`;

function quoteHtml(): string {
	const q = QUOTE;
	const ink = (s: string, r = 0) =>
		`<span class="ink" style="transform: rotate(${r}deg)">${esc(s)}</span>`;
	const rows = q.lines
		.map(
			(l, i) => `<tr>
				<td class="c">${ink(`${l.qty}${l.unit ? ` ${l.unit}` : ""}`, (i % 3) - 1)}</td>
				<td>${ink(l.desc, (i % 2) * 0.6 - 0.3)}</td>
				<td class="n">${ink(l.price, 0.5)}</td>
				<td class="c">${l.t ? ink("T", -2) : ""}</td>
				<td class="n">${ink(l.amount, -0.4)}</td>
			</tr>`,
		)
		.join("");
	const blank = `<tr><td></td><td></td><td></td><td></td><td></td></tr>`;
	return `<!doctype html><html><head><meta charset="utf-8"><style>
		body { margin: 0; padding: 1px 0; background: #cfcac0; font-family: "Helvetica Neue", Arial, sans-serif; color: #2b3a55; }
		.page { width: 700px; margin: 28px auto; background: #fffdf4; padding: 34px 40px 44px;
			box-shadow: 0 2px 12px rgba(0,0,0,.3); transform: rotate(-0.7deg);
			background-image: linear-gradient(transparent 0, transparent 100%); }
		.pad { border-bottom: 3px double #2b3a55; padding-bottom: 10px; display: flex; justify-content: space-between; }
		.org { font-weight: 800; font-size: 17px; letter-spacing: .5px; }
		.small { font-size: 11.5px; line-height: 1.5; color: #4a5875; }
		.kind { font-size: 34px; font-weight: 300; letter-spacing: 8px; }
		.field { display: flex; align-items: baseline; gap: 8px; margin: 12px 0 0; font-size: 12px; color: #4a5875; }
		.field .line { flex: 1; border-bottom: 1px solid #9aa4b8; min-height: 26px; }
		.ink { font-family: ${HAND}; color: #1c3f94; font-size: 21px; display: inline-block; line-height: 1.1; }
		.two { display: flex; gap: 22px; } .two > div { flex: 1; }
		table { width: 100%; border-collapse: collapse; margin-top: 18px; font-size: 11px; }
		th { background: #2b3a55; color: #fffdf4; padding: 5px 6px; letter-spacing: 1px; font-weight: 600; }
		td { border: 1px solid #b8bfcc; height: 34px; padding: 0 8px; }
		.n { text-align: right; } .c { text-align: center; }
		.sum { margin-left: auto; width: 290px; margin-top: 8px; font-size: 12px; }
		.sum div { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid #b8bfcc; padding: 4px 6px; }
		.sum .grand { border-bottom: 3px double #2b3a55; font-weight: 700; }
		.legend { font-size: 10.5px; color: #4a5875; margin-top: 6px; }
		.sig { margin-top: 22px; }
	</style></head><body><div class="page">
		<div class="pad">
			<div>
				<div class="org">NORTHFIELD UNIFIED SCHOOL DISTRICT</div>
				<div class="small">Food Services · Catering<br>1200 District Way, Northfield, CA 95001 · (555) 010-4400</div>
			</div>
			<div style="text-align:right">
				<div class="kind">${q.title}</div>
				<div class="field" style="justify-content:flex-end">No. <span class="line" style="max-width:150px">${ink(q.number, -1)}</span></div>
			</div>
		</div>
		<div class="two">
			<div class="field">Date <span class="line">${ink(q.date, 0.8)}</span></div>
			<div class="field">Event <span class="line">${ink("Fall Family Night, Fri Oct 24", -0.5)}</span></div>
		</div>
		<div class="field">Quote for <span class="line">${ink(`${q.buyer.name}, attn ${q.buyer.attn}`, -0.6)}</span></div>
		<div class="field">Address <span class="line">${ink(`${q.buyer.address}, ${q.buyer.city} ${q.buyer.region} ${q.buyer.postalCode}`, 0.4)}</span></div>
		<div class="two">
			<div class="field">Email <span class="line">${ink(q.buyer.email, 0.3)}</span></div>
			<div class="field">Deliver to <span class="line">${ink("Lincoln cafeteria by 5:30pm", -0.7)}</span></div>
		</div>
		<table>
			<thead><tr><th style="width:80px">QTY</th><th>DESCRIPTION</th><th style="width:90px">UNIT PRICE</th><th style="width:28px">T</th><th style="width:100px">AMOUNT</th></tr></thead>
			<tbody>${rows}${blank}${blank}</tbody>
		</table>
		<div class="legend">T = taxable item. Sales tax applies to taxable items only.</div>
		<div class="sum">
			<div><span>SUBTOTAL</span>${ink(q.subtotal, -0.4)}</div>
			<div><span>SALES TAX ${ink(`${q.taxRate}%`, 1)}</span>${ink(q.tax, 0.6)}</div>
			<div class="grand"><span>TOTAL</span>${ink(`$${q.total}`, -1.2)}</div>
		</div>
		<div class="field">Terms <span class="line">${ink(q.terms, 0.4)}</span></div>
		<div class="field sig">Prepared by <span class="line">${ink(q.signedBy, -0.8)}</span></div>
	</div></body></html>`;
}

function invoiceHtml(): string {
	const v = INVOICE;
	const rows = v.lines
		.map(
			(l, i) => `<tr>
				<td>${i + 1}</td><td>${esc(l.desc)}</td>
				<td class="n">${l.qty}</td><td>${l.unit}</td>
				<td class="n">${l.price}</td><td class="n">${l.disc || "&mdash;"}</td>
				<td class="n">${l.amount}</td>
			</tr>`,
		)
		.join("");
	return `<!doctype html><html><head><meta charset="utf-8"><style>
		body { margin: 0; padding: 1px 0; background: #d6d4cf; font-family: "Helvetica Neue", Arial, sans-serif; color: #1f2328; }
		.page { width: 760px; margin: 28px auto; background: #fdfdfb; padding: 44px 48px 52px;
			box-shadow: 0 2px 10px rgba(0,0,0,.25); transform: rotate(0.3deg); }
		.top { display: flex; justify-content: space-between; }
		.org { font-size: 19px; font-weight: 800; color: #1d4e89; }
		.small { font-size: 12px; line-height: 1.55; color: #50565e; }
		.title { font-size: 30px; letter-spacing: 6px; font-weight: 300; text-align: right; color: #1d4e89; }
		.meta { font-size: 12.5px; border-collapse: collapse; margin-left: auto; margin-top: 6px; }
		.meta td { padding: 2px 0 2px 14px; } .meta td:first-child { color: #50565e; }
		.bill { margin: 26px 0 20px; font-size: 13px; line-height: 1.5; }
		.bill b { display: block; font-size: 11px; letter-spacing: 1.5px; color: #50565e; }
		table.lines { width: 100%; border-collapse: collapse; font-size: 12.5px; }
		.lines th { text-align: left; border-bottom: 2px solid #1d4e89; padding: 6px; font-size: 11px; letter-spacing: 1px; color: #1d4e89; }
		.lines td { padding: 8px 6px; border-bottom: 1px solid #e1e3e6; }
		.lines th.n, .n { text-align: right; font-variant-numeric: tabular-nums; }
		.sum { width: 300px; margin: 14px 0 0 auto; font-size: 13px; }
		.sum div { display: flex; justify-content: space-between; padding: 4px 6px; }
		.sum .grand { border-top: 2px solid #1d4e89; font-weight: 700; font-size: 15px; padding-top: 8px; margin-top: 4px; }
		.foot { margin-top: 34px; font-size: 11.5px; color: #50565e; line-height: 1.6; }
	</style></head><body><div class="page">
		<div class="top">
			<div>
				<div class="org">Northfield Unified School District</div>
				<div class="small">Food &amp; Nutrition Services<br>1200 District Way, Northfield, CA 95001<br>EIN 00-0000000 · (555) 010-4400</div>
			</div>
			<div>
				<div class="title">${v.title}</div>
				<table class="meta">
					<tr><td>Invoice No.</td><td><b>${v.number}</b></td></tr>
					<tr><td>Invoice Date</td><td>${v.date}</td></tr>
					<tr><td>Due Date</td><td>${v.dueDate}</td></tr>
					<tr><td>Terms</td><td>${v.terms}</td></tr>
					<tr><td>Customer PO</td><td>${v.po}</td></tr>
				</table>
			</div>
		</div>
		<div class="bill"><b>BILL TO</b>${esc(v.buyer.name)}<br>${v.buyer.lines.map(esc).join("<br>")}<br>${esc(`${v.buyer.city}, ${v.buyer.region} ${v.buyer.postalCode}`)}<br>${esc(v.buyer.email)}</div>
		<table class="lines">
			<thead><tr><th>#</th><th>DESCRIPTION</th><th class="n">QTY</th><th>UNIT</th><th class="n">UNIT PRICE</th><th class="n">DISC.</th><th class="n">AMOUNT</th></tr></thead>
			<tbody>${rows}</tbody>
		</table>
		<div class="sum">
			<div><span>Subtotal</span><span>$${v.subtotal}</span></div>
			<div><span>Sales tax (exempt, public agency)</span><span>$${v.tax}</span></div>
			<div class="grand"><span>TOTAL DUE (USD)</span><span>$${v.total}</span></div>
		</div>
		<div class="foot">${esc(v.note)}<br>Please reference the invoice number on your remittance. Payable to Northfield USD Food &amp; Nutrition Services.</div>
	</div></body></html>`;
}

interface Browser {
	newPage(o: { viewport: { width: number; height: number } }): Promise<{
		setContent(html: string): Promise<void>;
		screenshot(o: { path: string; fullPage: boolean }): Promise<void>;
		close(): Promise<void>;
	}>;
	close(): Promise<void>;
}

const { chromium } = (await import(process.env.PLAYWRIGHT ?? "playwright")) as {
	chromium: { launch(): Promise<Browser> };
};

const DOCS = [
	{ name: "pta-catering-quote", html: quoteHtml(), source: QUOTE },
	{ name: "riverside-usd-invoice", html: invoiceHtml(), source: INVOICE },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
try {
	for (const doc of DOCS) {
		const page = await browser.newPage({ viewport: { width: 860, height: 400 } });
		await page.setContent(doc.html);
		const path = join(OUT, `${doc.name}.png`);
		await page.screenshot({ path, fullPage: true });
		await page.close();
		writeFileSync(
			join(OUT, `${doc.name}.json`),
			`${JSON.stringify(doc.source, null, "\t")}\n`,
		);
		console.log(`wrote ${path}`);
	}
} finally {
	await browser.close();
}
