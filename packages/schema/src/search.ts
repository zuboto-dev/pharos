import type { EntityType } from './entities.js';

/**
 * Search everything (⌘K): `GET /api/search?q=…&limit=…` finds projects and the items in them by
 * their words, across every project that isn't archived. Files' contents are never searched.
 */
export const SEARCH_LIMITS = {
  /** Longest query read; the rest is ignored. */
  queryChars: 200,
  /** Words of a query that count; the rest are ignored. */
  words: 8,
  /** Results when the request names no limit, and the most it may ask for. */
  defaultHits: 30,
  maxHits: 50,
} as const;

/** One result: what it is, where it lives, and the page that opens it. */
export type SearchHit = {
  id: string;
  type: EntityType;
  title: string;
  projectId: string;
  project: string;
  /** Around the first match outside the title, when the title doesn't hold every word. */
  snippet?: string;
  /** Where the web app opens it: a project, a view, or an item's details on its project. */
  href: string;
  updatedAt: string;
};

export type SearchResult = { query: string; hits: SearchHit[] };

/** The words of a query, lowercased: what every result must contain (in any order). */
export function searchWords(query: string): string[] {
  const words = query.slice(0, SEARCH_LIMITS.queryChars).toLowerCase().split(/\s+/).filter(Boolean);
  return [...new Set(words)].slice(0, SEARCH_LIMITS.words);
}

/**
 * Where `words` occur in `text` (case-insensitive), merged and in order, for highlighting:
 * `[start, end)` pairs.
 */
export function matchRanges(text: string, words: string[]): [number, number][] {
  const lower = text.toLowerCase();
  const ranges: [number, number][] = [];
  for (const word of words) {
    if (!word) continue;
    for (let at = lower.indexOf(word); at !== -1; at = lower.indexOf(word, at + word.length))
      ranges.push([at, at + word.length]);
  }
  ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: [number, number][] = [];
  for (const [start, end] of ranges) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}
