/**
 * Render a few synthetic invoices as "scanned" PNGs for the AI-import demo
 * (`/import`). Each PNG prints exactly what the source JSON in data/invoices
 * says (vendor as printed, units, line amounts, stated total), so an import
 * can be checked field by field against its source.
 *
 *   bun scripts/render-scans.ts                       # needs `playwright` resolvable
 *   PLAYWRIGHT=/tmp/shot/node_modules/playwright/index.mjs bun scripts/render-scans.ts
 *
 * Playwright is not a project dependency; point PLAYWRIGHT at any install.
 * Writes data/scans/<invoice id>.png.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseInvoiceJson } from "../src/lib/busyq/dataset.ts";
import type { Invoice } from "../src/lib/busyq/types.ts";

const DATA = resolve(import.meta.dirname, "../data");
const OUT = join(DATA, "scans");

/**
 * inv-1003: canonical names, one overcharge. A coffee smudge over the due
 *   date (not used by the audit) shows the "check this field" flag.
 * inv-1004: vendor-name and unit variants (v1 fails, v2 passes), one overcharge.
 * inv-1006: lines don't add up to the stated total.
 */
const SAMPLES: { id: string; tilt: number; smudgeDueDate?: boolean }[] = [
	{ id: "inv-1003", tilt: 0.4, smudgeDueDate: true },
	{ id: "inv-1004", tilt: -0.6 },
	{ id: "inv-1006", tilt: 0.25 },
];

/** Fictional letterheads, keyed by the vendor's canonical name. */
const LETTERHEADS: Record<string, { address: string[]; phone: string }> = {
	"Valley Fresh Produce": {
		address: ["1840 Orchard Row", "Fresno, CA 93721"],
		phone: "(559) 555-0143",
	},
	"Harbor Foods": {
		address: ["22 Wharf Street, Unit 4", "Oakland, CA 94607"],
		phone: "(510) 555-0198",
	},
	"Dairy Pure": {
		address: ["900 Creamery Lane", "Modesto, CA 95354"],
		phone: "(209) 555-0110",
	},
};

const KITCHENS = [
	"Lincoln Elementary Kitchen",
	"Northfield Middle School Kitchen",
	"Westbrook High School Kitchen",
];

function letterhead(vendor: string) {
	const key = Object.keys(LETTERHEADS).find((k) =>
		vendor.toLowerCase().startsWith(k.toLowerCase()),
	);
	return key
		? LETTERHEADS[key]
		: { address: ["1 Market Street", "Sacramento, CA 95814"], phone: "" };
}

const esc = (s: string) =>
	s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** "2026-08-07" → "08/07/2026", the way a US vendor prints it. */
const usDate = (iso: string) => {
	const [y, m, d] = iso.split("-");
	return `${m}/${d}/${y}`;
};

/** Thousands separators on a decimal string, without touching its digits. */
const money = (v: string) => {
	const [whole, frac] = v.split(".");
	return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${frac ? `.${frac}` : ""}`;
};

function html(
	inv: Invoice,
	tilt: number,
	kitchen: string,
	smudgeDueDate = false,
): string {
	const due = inv.dueDate
		? smudgeDueDate
			? `<span class="smudge">${usDate(inv.dueDate)}</span>`
			: usDate(inv.dueDate)
		: "";
	const lh = letterhead(inv.vendor);
	const rows = inv.lines
		.map(
			(l) => `<tr>
				<td>${l.lineNo}</td><td>${esc(l.item)}</td>
				<td class="n">${l.quantity}</td><td>${esc(l.unit)}</td>
				<td class="n">$${money(l.unitPrice)}</td><td class="n">$${money(l.amount)}</td>
			</tr>`,
		)
		.join("");
	return `<!doctype html><html><head><meta charset="utf-8"><style>
		body { margin: 0; background: #d9d6cf; font-family: "Helvetica Neue", Arial, sans-serif; color: #1d1d1b; }
		.page { width: 740px; margin: 30px auto; background: #fbfaf6; padding: 44px 48px 56px;
			box-shadow: 0 2px 10px rgba(0,0,0,.25); transform: rotate(${tilt}deg); }
		.top { display: flex; justify-content: space-between; align-items: flex-start; }
		.vendor { font-size: 24px; font-weight: 800; letter-spacing: .5px; }
		.small { font-size: 12.5px; line-height: 1.5; color: #444; }
		.title { font-size: 30px; font-weight: 300; letter-spacing: 6px; text-align: right; }
		.meta { margin-top: 8px; font-size: 13px; border-collapse: collapse; margin-left: auto; }
		.meta td { padding: 2px 0 2px 14px; } .meta td:first-child { color: #555; }
		.parties { display: flex; gap: 48px; margin: 30px 0 22px; font-size: 13px; line-height: 1.5; }
		.parties b { display: block; font-size: 11px; letter-spacing: 1.5px; color: #666; margin-bottom: 2px; }
		table.lines { width: 100%; border-collapse: collapse; font-size: 13.5px; }
		.lines th { text-align: left; border-bottom: 2px solid #1d1d1b; padding: 6px 6px; font-size: 11.5px; letter-spacing: 1px; }
		.lines td { padding: 8px 6px; border-bottom: 1px solid #ddd8cc; }
		.lines th.n { text-align: right; }
		body { padding: 1px 0; }
		.n { text-align: right; font-variant-numeric: tabular-nums; }
		.total { display: flex; justify-content: flex-end; margin-top: 18px; font-size: 16px; }
		.total div { border-top: 2px solid #1d1d1b; padding: 8px 6px; min-width: 260px; display: flex; justify-content: space-between; font-weight: 700; }
		.foot { margin-top: 40px; font-size: 11.5px; color: #666; line-height: 1.6; }
		.smudge { position: relative; display: inline-block; filter: blur(1.4px); }
		.smudge::after { content: ""; position: absolute; inset: -9px -14px -7px -6px; border-radius: 50%;
			background: radial-gradient(ellipse at 45% 55%, rgba(120,72,30,.55), rgba(120,72,30,.32) 45%, rgba(120,72,30,0) 72%); }
	</style></head><body><div class="page">
		<div class="top">
			<div>
				<div class="vendor">${esc(inv.vendor)}</div>
				<div class="small">${lh.address.map(esc).join("<br>")}${lh.phone ? `<br>Tel ${lh.phone}` : ""}</div>
			</div>
			<div>
				<div class="title">INVOICE</div>
				<table class="meta">
					<tr><td>Invoice No.</td><td><b>${esc(inv.invoiceNumber)}</b></td></tr>
					<tr><td>Invoice Date</td><td>${usDate(inv.issueDate)}</td></tr>
					${inv.dueDate ? `<tr><td>Due Date</td><td>${due}</td></tr>` : ""}
					<tr><td>Terms</td><td>Net 30</td></tr>
				</table>
			</div>
		</div>
		<div class="parties">
			<div><b>BILL TO</b>Northfield Unified School District<br>Food &amp; Nutrition Services<br>400 School Way, Northfield, CA 95600</div>
			<div><b>SHIP TO</b>${esc(kitchen)}<br>Receiving dock, before 7:00 AM</div>
		</div>
		<table class="lines">
			<thead><tr><th>#</th><th>DESCRIPTION</th><th class="n">QTY</th><th>UNIT</th><th class="n">UNIT PRICE</th><th class="n">AMOUNT</th></tr></thead>
			<tbody>${rows}</tbody>
		</table>
		<div class="total"><div><span>TOTAL DUE (${esc(inv.currency)})</span><span>$${money(inv.statedTotal)}</span></div></div>
		<div class="foot">Please reference the invoice number on your remittance. Thank you for your business.</div>
	</div></body></html>`;
}

interface Browser {
	newPage(o: {
		viewport: { width: number; height: number };
	}): Promise<{
		setContent(html: string): Promise<void>;
		screenshot(o: { path: string; fullPage: boolean }): Promise<void>;
		close(): Promise<void>;
	}>;
	close(): Promise<void>;
}

const { chromium } = (await import(process.env.PLAYWRIGHT ?? "playwright")) as {
	chromium: { launch(): Promise<Browser> };
};

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
try {
	for (const [i, { id, tilt, smudgeDueDate }] of SAMPLES.entries()) {
		const inv = parseInvoiceJson(
			readFileSync(join(DATA, "invoices", `${id}.json`), "utf8"),
		);
		const page = await browser.newPage({ viewport: { width: 860, height: 400 } });
		await page.setContent(
			html(inv, tilt, KITCHENS[i % KITCHENS.length], smudgeDueDate),
		);
		const path = join(OUT, `${id}.png`);
		await page.screenshot({ path, fullPage: true });
		await page.close();
		console.log(`wrote ${path}`);
	}
} finally {
	await browser.close();
}
