import {
  ENTITIES,
  SEARCH_LIMITS,
  searchWords,
  type Entity,
  type EntityType,
  type SearchHit,
  type SearchResult,
} from '@pharos/schema';
import type { SQLInputValue } from 'node:sqlite';
import { AgentFiles } from './store/agent-files.js';
import type { Store } from './store/store.js';

/**
 * Search everything (⌘K in the web app; `GET /api/search`). Finds projects and the items in them
 * by their words, across every project that isn't archived:
 * - every word of the query must occur in the item's title or its text (in any order);
 * - the title ranks first: the whole title, then a title starting with the query, then every
 *   word starting a word of the title, then every word somewhere in the title, then some words
 *   in the title and the rest in the text, then the text alone; newer changes break ties;
 * - a report document's text blocks count as its text; a report page's or a drawing's HTML does
 *   not, and neither does any file's contents (never read here);
 * - agents (`forAgent`) see what AgentFiles lets them: no files at all, and nothing copied from a
 *   file they can't see.
 *
 * The work is bounded for typing: SQLite narrows the rows to those whose JSON holds every word,
 * newest first, at most SCAN_ROWS, and only those are read.
 */

/** Rows read for one query at most (newest first). */
const SCAN_ROWS = 1500;
/** Characters of text read per item: enough for long descriptions and documents. */
const TEXT_CHARS = 20_000;
/** Snippet length around a match. */
const SNIPPET_CHARS = 140;

/** Text fields of each searchable type, after its title, in the order they're read. */
const TEXT_FIELDS: Partial<Record<EntityType, string[]>> = {
  project: ['summary', 'description'],
  goal: ['description', 'successCriteria'],
  scope_item: ['rationale'],
  stage: ['description'],
  task: ['description', 'reply'],
  artifact: ['description', 'tags'],
  decision: ['body'],
  view: ['description', 'question'],
  request: ['about', 'reply'],
  claim: ['detail', 'quote', 'assumption'],
  term: ['explanation', 'alsoCalled'],
  file: ['issuer', 'tags', 'notes'],
  record: ['notes', 'fields'],
};
const TYPES = Object.keys(TEXT_FIELDS) as EntityType[];

/** Keys of a report document whose strings are text the reader sees. */
const DOC_TEXT_KEYS = new Set([
  'content',
  'text',
  'title',
  'caption',
  'note',
  'summary',
  'label',
  'heading',
  'detail',
  'expect',
  'body',
  'description',
]);

export type SearchOptions = { limit?: number; forAgent?: boolean };

type Row = {
  id: string;
  type: string;
  project_id: string;
  data: string;
  created_at: string;
  updated_at: string;
  created_rev: number;
  updated_rev: number;
  project_name: string;
};

/** Markdown and whitespace out of the way, so snippets read as plain text. */
function plain(text: string): string {
  return text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\$\{\w+\}/g, '…')
    .replace(/[*_`#>|~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function strings(value: unknown, out: string[]): void {
  if (typeof value === 'string') out.push(value);
  else if (typeof value === 'number') out.push(String(value));
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value && typeof value === 'object')
    for (const v of Object.values(value as Record<string, unknown>)) strings(v, out);
}

/** The words a report document shows: its blocks' text, never a drawing's HTML or an embed. */
function docText(value: unknown, out: string[], key?: string): void {
  if (out.length > 400) return;
  if (typeof value === 'string') {
    if (key && DOC_TEXT_KEYS.has(key)) out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) docText(v, out, key);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const object = value as Record<string, unknown>;
  if (object.kind === 'drawing' || object.kind === 'embed') {
    for (const k of ['caption', 'title']) docText(object[k], out, k);
    return;
  }
  for (const [k, v] of Object.entries(object)) {
    // Queries, filters and values are how a block reads data, not words on the page.
    if (k === 'query' || k === 'filter' || k === 'values' || k === 'data' || k === 'html') continue;
    docText(v, out, k);
  }
}

/** An item's title and its other text, plain. */
function textsOf(entity: Entity): { title: string; texts: string[] } {
  const data = entity.data as Record<string, unknown>;
  const label = data[ENTITIES[entity.type].label];
  const title = typeof label === 'string' ? label : entity.id;
  const raw: string[] = [];
  for (const field of TEXT_FIELDS[entity.type] ?? []) strings(data[field], raw);
  if (entity.type === 'view' && data.doc) docText(data.doc, raw);
  const texts: string[] = [];
  let length = 0;
  for (const text of raw) {
    const clean = plain(text);
    if (!clean) continue;
    texts.push(clean.slice(0, TEXT_CHARS - length));
    length += clean.length;
    if (length >= TEXT_CHARS) break;
  }
  return { title, texts };
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Whether `word` starts a word of `text` (lowercased). */
function startsWord(text: string, word: string): boolean {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(word)}`, 'u').test(text);
}

/** A rank for an item, or null when some word is missing. Higher is better. */
export function scoreOf(title: string, texts: string[], words: string[]): number | null {
  if (!words.length) return null;
  const t = title.toLowerCase();
  const body = texts.join('\n').toLowerCase();
  if (!words.every((w) => t.includes(w) || body.includes(w))) return null;
  const phrase = words.join(' ');
  if (t === phrase) return 1000;
  if (t.startsWith(phrase)) return 800;
  const inTitle = words.filter((w) => t.includes(w));
  if (inTitle.length === words.length) return words.every((w) => startsWord(t, w)) ? 600 : 450;
  const wordStarts = words.every((w) => startsWord(t, w) || startsWord(body, w)) ? 20 : 0;
  return 100 + Math.round((300 * inTitle.length) / words.length) + wordStarts;
}

/** Around the first word of the query the title lacks, in the first text holding it. */
export function snippetOf(title: string, texts: string[], words: string[]): string | undefined {
  const t = title.toLowerCase();
  const word = words.find((w) => !t.includes(w));
  if (!word) return undefined;
  for (const text of texts) {
    const at = text.toLowerCase().indexOf(word);
    if (at === -1) continue;
    if (text.length <= SNIPPET_CHARS) return text;
    let start = Math.max(0, at - Math.floor(SNIPPET_CHARS / 3));
    // Start at a word, not in the middle of one.
    if (start > 0) {
      const space = text.lastIndexOf(' ', start);
      start = space !== -1 && at - space < SNIPPET_CHARS / 2 ? space + 1 : start;
    }
    let end = Math.min(text.length, start + SNIPPET_CHARS);
    if (end < text.length) {
      const space = text.lastIndexOf(' ', end);
      if (space > at + word.length) end = space;
    }
    return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
  }
  return undefined;
}

/** Where the web app opens an item. */
export function hrefOf(type: EntityType, id: string, projectId: string): string {
  const project = `/projects/${encodeURIComponent(projectId)}`;
  if (type === 'project') return project;
  if (type === 'view') return `${project}/views/${encodeURIComponent(id)}`;
  return `${project}?entity=${encodeURIComponent(id)}`;
}

/** LIKE pattern for a word as it appears in the stored JSON, or null when it can't be narrowed. */
function likeOf(word: string): string | null {
  // JSON escapes quotes, backslashes and control characters; LIKE folds ASCII case only.
  if (/["\\\p{Cc}]/u.test(word)) return null;
  if (/[^\p{ASCII}]/u.test(word) && word.toUpperCase() !== word) return null;
  return `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function search(store: Store, query: string, options: SearchOptions = {}): SearchResult {
  const words = searchWords(query);
  const limit = Math.max(
    1,
    Math.min(SEARCH_LIMITS.maxHits, options.limit ?? SEARCH_LIMITS.defaultHits),
  );
  if (!words.length) return { query, hits: [] };
  const types = options.forAgent ? TYPES.filter((t) => t !== 'file') : TYPES;
  const clauses = [
    `e.type IN (${types.map(() => '?').join(', ')})`,
    "json_extract(p.data, '$.status') IS NOT 'archived'",
  ];
  const params: SQLInputValue[] = [...types];
  for (const word of words) {
    const like = likeOf(word);
    if (!like) continue;
    clauses.push("e.data LIKE ? ESCAPE '\\'");
    params.push(like);
  }
  const rows = store.database
    .prepare(
      `SELECT e.*, json_extract(p.data, '$.name') AS project_name
       FROM entities e JOIN entities p ON p.id = e.project_id AND p.type = 'project'
       WHERE ${clauses.join(' AND ')}
       ORDER BY e.updated_rev DESC, e.rowid DESC LIMIT ${SCAN_ROWS}`,
    )
    .all(...params) as Row[];
  const agentFiles = options.forAgent ? new AgentFiles(store) : null;
  const scored: { hit: SearchHit; score: number; rev: number }[] = [];
  for (const row of rows) {
    const stored: Entity = {
      id: row.id,
      type: row.type as EntityType,
      data: JSON.parse(row.data),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      createdRev: row.created_rev,
      updatedRev: row.updated_rev,
    };
    const entity = agentFiles ? agentFiles.entity(stored) : stored;
    if (!entity) continue;
    const { title, texts } = textsOf(entity);
    const score = scoreOf(title, texts, words);
    if (score === null) continue;
    const snippet = score < 450 ? snippetOf(title, texts, words) : undefined;
    scored.push({
      score,
      rev: row.updated_rev,
      hit: {
        id: entity.id,
        type: entity.type,
        title,
        projectId: row.project_id,
        project: row.project_name,
        ...(snippet ? { snippet } : {}),
        href: hrefOf(entity.type, entity.id, row.project_id),
        updatedAt: entity.updatedAt,
      },
    });
  }
  scored.sort((a, b) => b.score - a.score || b.rev - a.rev);
  return { query, hits: scored.slice(0, limit).map((s) => s.hit) };
}
