/** Contract term as text, e.g. "2026-07-01 → 2027-06-30 · auto-renews · 60 days' notice". */
export function formatTerm(c: {
	startDate: string | null;
	endDate: string | null;
	autoRenew: boolean | null;
	noticeDays: number | null;
}): string {
	const parts: string[] = [];
	if (c.startDate || c.endDate) {
		parts.push(`${c.startDate ?? "?"} → ${c.endDate ?? "?"}`);
	}
	if (c.autoRenew === true) parts.push("auto-renews");
	if (c.autoRenew === false) parts.push("no auto-renew");
	if (c.noticeDays !== null) parts.push(`${c.noticeDays} days' notice`);
	return parts.join(" · ") || "—";
}
