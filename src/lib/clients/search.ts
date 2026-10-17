/** Type-ahead search helpers shared by the client and catalog lookups. */
import { z } from "zod";

/** Results returned by a type-ahead lookup. */
export const TYPEAHEAD_LIMIT = 10;

export const ARCHIVE_FILTERS = ["active", "archived", "all"] as const;
export type ArchiveFilter = (typeof ARCHIVE_FILTERS)[number];

export const ListQuery = z.object({
	query: z.string().trim().max(100).default(""),
	archived: z.enum(ARCHIVE_FILTERS).default("active"),
});
export type ListQuery = z.output<typeof ListQuery>;

export const SearchQuery = z.object({
	query: z.string().trim().max(100).default(""),
});

/**
 * A case-insensitive SQL LIKE pattern matching `query` anywhere, with `%`,
 * `_` and the escape character itself escaped (use with `ESCAPE '\'`).
 * Returns null for a blank query (match everything).
 */
export function containsPattern(query: string): string | null {
	const q = query.trim().toLowerCase();
	if (q === "") return null;
	return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
