/**
 * Print stylesheet (#19), emitted by the print route only, so its global
 * print rules (hiding the app shell) never leak into other pages.
 *
 * All four layouts share one DOM; `data-layout` on `.doc` picks the look.
 * Colours are the theme's semantic tokens plus `--doc-accent` /
 * `--doc-accent-ink`, which the page sets from the business accent colour.
 * The document itself never uses <header>, <nav> or <aside>, because those
 * are what print hides.
 */
export const PRINT_CSS = `
.doc {
	--doc-accent: var(--primary);
	--doc-accent-ink: var(--primary-foreground);
	--doc-rule: color-mix(in oklab, var(--foreground) 70%, transparent);
	--doc-tint: color-mix(in oklab, var(--doc-accent) 7%, transparent);
}
.print-stage { background: var(--muted); padding: 24px 16px 64px; overflow-x: auto; }
.print-paper {
	position: relative;
	margin: 0 auto;
	background: var(--card);
	color: var(--card-foreground);
	box-shadow: var(--shadow-lg);
	padding: 14mm 14mm 18mm;
	overflow: hidden;
}
.print-paper[data-paper="a4"] { width: 210mm; min-height: 297mm; }
.print-paper[data-paper="letter"] { width: 8.5in; min-height: 11in; }

.doc { position: relative; font-size: 9.5pt; line-height: 1.45; color: var(--foreground); }
.doc h1, .doc h2, .doc p, .doc dl, .doc dd { margin: 0; }
.doc-content { position: relative; z-index: 1; }
.doc-watermark {
	position: absolute; inset: 0; z-index: 0;
	display: flex; align-items: center; justify-content: center;
	pointer-events: none; overflow: hidden;
}
.doc-watermark span {
	font-size: 110pt; font-weight: 700; letter-spacing: 0.12em;
	color: var(--foreground); opacity: 0.07; transform: rotate(-30deg);
}
.doc-small { color: var(--muted-foreground); }
.doc-masthead { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; }
.doc-logo { display: block; max-height: 56px; max-width: 180px; object-fit: contain; margin-bottom: 8px; }
.doc-seller-name { font-size: 11pt; font-weight: 600; }
.doc-title { text-align: right; flex-shrink: 0; }
.doc-heading { font-size: 20pt; font-weight: 600; letter-spacing: -0.01em; color: var(--doc-accent); line-height: 1.15; }
.doc-meta { display: grid; grid-template-columns: auto auto; justify-content: end; gap: 2px 12px; margin-top: 8px; }
.doc-meta dt { color: var(--muted-foreground); text-align: left; }
.doc-meta dd { font-weight: 500; text-align: right; }
.doc-label {
	font-size: 7.5pt; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em;
	color: var(--muted-foreground); margin-bottom: 4px;
}
.doc-parties { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin: 24px 0; }
.doc-party-name { font-weight: 600; }

.doc-lines { width: 100%; border-collapse: collapse; }
.doc-lines th { text-align: left; font-size: 8pt; font-weight: 600; }
.doc-lines th, .doc-lines td { padding: 6px 8px; vertical-align: top; }
.doc-lines tbody tr { border-bottom: 1px solid var(--border); }
.doc .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.doc-lines .doc-desc { width: 100%; }

.doc-summary { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; margin-top: 16px; }
.doc-taxsummary { border-collapse: collapse; font-size: 8pt; }
.doc-taxsummary th { text-align: left; font-weight: 600; color: var(--muted-foreground); }
.doc-taxsummary th, .doc-taxsummary td { padding: 3px 8px; border-bottom: 1px solid var(--border); }
.doc-totals { margin-left: auto; min-width: 45%; border-collapse: collapse; }
.doc-totals td { padding: 4px 8px; }
.doc-totals .doc-grand td { font-size: 11pt; font-weight: 700; border-top: 2px solid var(--foreground); padding-top: 6px; }
.doc-totals .doc-balance td { font-weight: 600; }
.doc-notes { margin-top: 24px; display: grid; gap: 12px; }
.doc-notes p { white-space: pre-line; }
.doc-statutory { font-size: 8pt; border: 1px solid var(--border); padding: 8px 10px; }
.doc-void { margin-top: 16px; font-weight: 600; color: var(--destructive); }

/* Classic: traditional bordered table, serif, double rule. */
.doc[data-layout="classic"] { font-family: var(--font-serif); }
.doc[data-layout="classic"] .doc-masthead { border-top: 4px solid var(--doc-accent); border-bottom: 3px double var(--doc-rule); padding: 12px 0; }
.doc[data-layout="classic"] .doc-heading { color: var(--foreground); text-transform: uppercase; letter-spacing: 0.12em; font-size: 18pt; }
.doc[data-layout="classic"] .doc-parties > div { border: 1px solid var(--doc-rule); padding: 8px 10px; }
.doc[data-layout="classic"] .doc-lines th,
.doc[data-layout="classic"] .doc-lines td,
.doc[data-layout="classic"] .doc-totals td { border: 1px solid var(--doc-rule); }
.doc[data-layout="classic"] .doc-lines thead th { background: var(--muted); }
.doc[data-layout="classic"] .doc-totals .doc-grand td { border-top: 3px double var(--doc-rule); }

/* Modern: accent colour bands. */
.doc[data-layout="modern"] .doc-masthead { background: var(--doc-accent); color: var(--doc-accent-ink); padding: 18px 20px; border-radius: 6px; }
.doc[data-layout="modern"] .doc-masthead .doc-small,
.doc[data-layout="modern"] .doc-meta dt { color: inherit; opacity: 0.8; }
.doc[data-layout="modern"] .doc-heading { color: inherit; font-size: 24pt; }
.doc[data-layout="modern"] .doc-label { color: var(--doc-accent); }
.doc[data-layout="modern"] .doc-parties > div { border-left: 3px solid var(--doc-accent); padding-left: 10px; }
.doc[data-layout="modern"] .doc-lines thead th { background: var(--doc-accent); color: var(--doc-accent-ink); }
.doc[data-layout="modern"] .doc-lines tbody tr { border-bottom: 0; }
.doc[data-layout="modern"] .doc-lines tbody tr:nth-child(even) { background: var(--doc-tint); }
.doc[data-layout="modern"] .doc-totals .doc-grand td { background: var(--doc-accent); color: var(--doc-accent-ink); border-top: 0; }

/* Compact: dense, many lines per page. */
.doc[data-layout="compact"] { font-size: 8pt; line-height: 1.3; }
.doc[data-layout="compact"] .doc-heading { font-size: 14pt; }
.doc[data-layout="compact"] .doc-seller-name { font-size: 9pt; }
.doc[data-layout="compact"] .doc-logo { max-height: 32px; margin-bottom: 4px; }
.doc[data-layout="compact"] .doc-masthead { border-bottom: 1.5px solid var(--doc-accent); padding-bottom: 6px; }
.doc[data-layout="compact"] .doc-parties { margin: 10px 0; gap: 12px; }
.doc[data-layout="compact"] .doc-lines th { font-size: 7pt; border-bottom: 1px solid var(--doc-rule); }
.doc[data-layout="compact"] .doc-lines th,
.doc[data-layout="compact"] .doc-lines td { padding: 2px 4px; }
.doc[data-layout="compact"] .doc-summary { margin-top: 8px; }
.doc[data-layout="compact"] .doc-taxsummary { display: none; }
.doc[data-layout="compact"] .doc-totals td { padding: 2px 4px; }
.doc[data-layout="compact"] .doc-totals .doc-grand td { font-size: 9pt; }
.doc[data-layout="compact"] .doc-notes { margin-top: 10px; gap: 6px; }
.doc[data-layout="compact"] .doc-statutory { font-size: 7pt; padding: 4px 6px; }

/* Minimal: lots of whitespace, hairlines only. */
.doc[data-layout="minimal"] { line-height: 1.6; }
.doc[data-layout="minimal"] .doc-heading { font-size: 28pt; font-weight: 300; color: var(--foreground); letter-spacing: -0.02em; }
.doc[data-layout="minimal"] .doc-parties { margin: 48px 0 40px; gap: 48px; }
.doc[data-layout="minimal"] .doc-label { font-weight: 500; }
.doc[data-layout="minimal"] .doc-lines th { font-weight: 500; color: var(--muted-foreground); border-bottom: 1px solid var(--border); }
.doc[data-layout="minimal"] .doc-lines th,
.doc[data-layout="minimal"] .doc-lines td { padding: 10px 8px; }
.doc[data-layout="minimal"] .doc-lines tbody tr { border-bottom: 0; }
.doc[data-layout="minimal"] .doc-summary { margin-top: 32px; }
.doc[data-layout="minimal"] .doc-taxsummary { display: none; }
.doc[data-layout="minimal"] .doc-totals td { padding: 6px 8px; }
.doc[data-layout="minimal"] .doc-totals .doc-grand td { border-top: 1px solid var(--border); font-size: 14pt; font-weight: 500; color: var(--doc-accent); padding-top: 12px; }
.doc[data-layout="minimal"] .doc-notes { margin-top: 48px; gap: 20px; }
.doc[data-layout="minimal"] .doc-statutory { border: 0; padding: 0; }

@media print {
	/* Hide the app shell (sidebar, mobile bar, drawer), toasts, dev tools and
	   any other UI chrome: everything in <body> but the branch with the document. */
	aside, header, nav, [data-print-hidden], [data-sonner-toaster],
	body > :not(:has(.print-root)) { display: none !important; }
	html, body { background: var(--card) !important; }
	body > :has(.print-root), main { display: block !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; }
	.print-stage { background: none; padding: 0; overflow: visible; }
	.print-paper { width: auto !important; min-height: 0 !important; padding: 0; margin: 0; box-shadow: none; overflow: visible; }
	.doc { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
	.doc-watermark { position: fixed; }
	.doc-lines thead { display: table-header-group; }
	.doc-lines tr, .doc-totals tr, .doc-taxsummary tr { break-inside: avoid; page-break-inside: avoid; }
	.doc-masthead, .doc-parties, .doc-summary, .doc-notes > * { break-inside: avoid; page-break-inside: avoid; }
}
`;
