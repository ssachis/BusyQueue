/**
 * The per-document `@page` rule (#19): paper size, margins and the page
 * footer (document title on the left, "Page n of m" on the right). Pure.
 */
import type { PaperSize } from "./model.ts";

/** Page margins (top, sides, bottom). The screen preview pads by the same. */
export const PAGE_MARGINS = {
	top: "14mm",
	side: "14mm",
	bottom: "18mm",
} as const;

export const PAPER_DIMENSIONS: Record<
	PaperSize,
	{ css: string; width: string; height: string; label: string }
> = {
	a4: { css: "A4", width: "210mm", height: "297mm", label: "A4" },
	letter: { css: "letter", width: "8.5in", height: "11in", label: "Letter" },
};

/**
 * A CSS string literal for `content:`. Escapes quotes, backslashes and `<`
 * (so the text can't close the surrounding <style> element) and drops
 * control characters.
 */
export function cssString(text: string): string {
	const body = Array.from(text)
		.filter((ch) => ch >= " " && ch !== "\u007f")
		.map((ch) => {
			if (ch === "\\" || ch === '"') return `\\${ch}`;
			if (ch === "<") return "\\3c ";
			return ch;
		})
		.join("");
	return `"${body}"`;
}

export function pageCss(opts: { paper: PaperSize; footer: string }): string {
	const { top, side, bottom } = PAGE_MARGINS;
	const footerBox =
		"font-family: var(--font-sans); font-size: 7.5pt; color: var(--muted-foreground);";
	return `@page {
	size: ${PAPER_DIMENSIONS[opts.paper].css};
	margin: ${top} ${side} ${bottom};
	@bottom-left { content: ${cssString(opts.footer)}; ${footerBox} }
	@bottom-right { content: "Page " counter(page) " of " counter(pages); ${footerBox} }
}`;
}
