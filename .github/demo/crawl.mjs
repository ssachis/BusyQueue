// Crawls the running app (BASE) and writes a static, script-free copy to OUT.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.env.OUT ?? "demo";
const MAX = Number(process.env.MAX ?? 220);
const SKIP = [/^\/api\//, /^\/print\//, /\/new$/, /^\/cdn-cgi/, /^\/_/];
const fileFor = (u) => {
	const url = new URL(u, BASE);
	let p = url.pathname.replace(/^\/|\/$/g, "") || "index";
	p = p.replace(/\//g, "--");
	const q = [...url.searchParams.entries()].map(([k, v]) => `${k}-${v}`).join("_");
	return `${p}${q ? `__${q}` : ""}`.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120) + ".html";
};
const key = (u) => { const x = new URL(u, BASE); x.hash = ""; return x.pathname + x.search; };
const seeds = ["/", "/review", "/documents", "/clients", "/catalog", "/contracts", "/inbox", "/projections", "/reminders", "/import", "/import-document", "/settings/business"];
const assets = new Map();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const seen = new Set(); const queue = [...seeds]; const pages = new Map();
while (queue.length && pages.size < MAX) {
	const path = queue.shift(); const k = key(path);
	if (seen.has(k)) continue; seen.add(k);
	try {
		const res = await page.goto(BASE + k, { waitUntil: "load", timeout: 120000 });
		if (!res || res.status() >= 400) { console.log("skip", res?.status(), k); continue; }
		await page.waitForLoadState("domcontentloaded"); await page.waitForTimeout(pages.size === 0 ? 8000 : 2500);
		const links = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")));
		for (const h of links) {
			if (!h || h.startsWith("http") || h.startsWith("mailto") || h.startsWith("#") || h.startsWith("//")) continue;
			const kk = key(h); const pathname = new URL(kk, BASE).pathname;
			if (SKIP.some((r) => r.test(pathname))) continue;
			if (!seen.has(kk)) queue.push(kk);
		}
		const html = await page.evaluate(() => {
			document.querySelectorAll("script, link[rel=modulepreload], link[rel=preload]").forEach((s) => s.remove());
			document.querySelectorAll("[data-tanstack-router-devtools], .tsqd-parent-container, [class*=devtools]").forEach((s) => s.remove());
			return "<!doctype html>\n" + document.documentElement.outerHTML;
		});
		pages.set(k, html); console.log("ok", k);
	} catch (e) { console.log("fail", k, String(e).split("\n")[0]); }
}
const banner = `<div style="position:fixed;bottom:12px;left:50%;transform:translateX(-50%);z-index:99999;background:#111;color:#fff;font:500 12px/1.4 system-ui,sans-serif;padding:8px 14px;border-radius:999px;box-shadow:0 4px 18px rgba(0,0,0,.25)">Static demo with sample data (a fictional school district). Buttons and forms are disabled. <a href="https://github.com/ssachis/BusyQueue" style="color:#9cf">Code on GitHub</a></div>`;
async function asset(p) {
	if (assets.has(p)) return assets.get(p);
	const local = "_assets/" + p.replace(/^\//, "").replace(/[?#].*$/, "").replace(/[^a-zA-Z0-9._/-]/g, "-");
	assets.set(p, local);
	try { const r = await page.request.get(BASE + p); if (r.ok()) { const f = join(OUT, local); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, await r.body()); } } catch {}
	return local;
}
mkdirSync(OUT, { recursive: true });
for (const [k, html0] of pages) {
	let html = html0;
	html = html.replace(/(<a\b[^>]*?\bhref=")([^"]*)(")/g, (m, a, h, z) => {
		if (!h || h.startsWith("http") || h.startsWith("mailto") || h.startsWith("#") || h.startsWith("//")) return m;
		const kk = key(h.replace(/&amp;/g, "&"));
		return pages.has(kk) ? a + fileFor(kk) + z : a + "#" + z;
	});
	const refs = new Set();
	for (const m of html.matchAll(/(?:src|href)="(\/(?!\/)[^"]+)"/g)) refs.add(m[1]);
	for (const m of html.matchAll(/url\((['"]?)(\/(?!\/)[^)'"]+)\1\)/g)) refs.add(m[2]);
	for (const r of refs) { const l = await asset(r.replace(/&amp;/g, "&")); html = html.split(`"${r}"`).join(`"${l}"`).split(`(${r})`).join(`(${l})`).split(`('${r}')`).join(`('${l}')`); }
	html = html.replace(/<form\b/g, '<form onsubmit="return false"').replace("</body>", banner + "</body>");
	writeFileSync(join(OUT, fileFor(k)), html);
}
writeFileSync(join(OUT, ".nojekyll"), "");
console.log("pages", pages.size, "assets", assets.size);
await browser.close();
