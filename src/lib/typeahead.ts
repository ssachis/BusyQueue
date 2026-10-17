/**
 * Type-ahead ranking shared by the clients and catalog pickers. Pure: the
 * server loads candidates, this orders them. Best match first: exact, then
 * prefix, then word-prefix, then substring. Ties sort by the first key.
 */
export function matchScore(query: string, value: string): number {
	const q = query.trim().toLowerCase();
	const v = value.trim().toLowerCase();
	if (q === "" || v === "") return 0;
	if (v === q) return 4;
	if (v.startsWith(q)) return 3;
	if (v.split(/[\s\-_/.,]+/).some((w) => w.startsWith(q))) return 2;
	if (v.includes(q)) return 1;
	return 0;
}

export function rankMatches<T>(
	query: string,
	items: readonly T[],
	keys: readonly ((item: T) => string | null | undefined)[],
	limit = 8,
): T[] {
	if (query.trim() === "") return items.slice(0, limit);
	return items
		.map((item, i) => ({
			item,
			i,
			score: Math.max(...keys.map((k) => matchScore(query, k(item) ?? ""))),
		}))
		.filter((r) => r.score > 0)
		.sort((a, b) => b.score - a.score || a.i - b.i)
		.slice(0, limit)
		.map((r) => r.item);
}
