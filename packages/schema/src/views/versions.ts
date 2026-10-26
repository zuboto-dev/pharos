import { diffWords, type DiffPart } from './text-tools.js';
import type { DocBlock, ReportDoc } from './doc.js';
import type { Author } from '../revisions.js';

/**
 * A project's pages by role, and a page's versions.
 *
 * - The **main page** (`kind: "main"`, one per project) says what the project is for, the problem
 *   it started from, the plan and the anchor points it passed. It is a document, the first tab,
 *   and is revised as the project moves rather than archived.
 * - **Project-management views** (the built-in Overview, boards of tasks, stages and goals) stay
 *   out of the tabs unless the owner pins them, once a project has a page written to be read.
 * - Every change to a view is a revision, so a view's versions are its own history: who changed
 *   it, when and why, and what changed between two versions (compareDocs).
 */

type ViewLike = { data: { kind?: string | undefined; doc?: unknown; page?: unknown } };

export const isMainPage = (view: ViewLike): boolean => view.data.kind === 'main';

/** Blocks for managing the work: tasks, stages, goals, plans, who does what. */
export const PM_COMPONENTS: ReadonlySet<string> = new Set([
  'ProjectHeader',
  'ProgressRing',
  'GoalTree',
  'ScopeBoard',
  'StageTracker',
  'Map',
  'Timeline',
  'MilestoneList',
  'KanbanBoard',
  'TaskTable',
  'TaskChecklist',
  'DependencyGraph',
  'AssigneeMatrix',
  'DecisionLog',
  'ActivityFeed',
]);
const CONTAINERS = new Set(['Board', 'Grid', 'Section', 'Tabs', 'Layers']);

/** Every block component in a spec, containers left out. */
function components(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) for (const v of value) components(v, out);
  else if (value && typeof value === 'object') {
    const c = (value as { component?: unknown }).component;
    if (typeof c === 'string' && !CONTAINERS.has(c)) out.push(c);
    for (const v of Object.values(value)) if (v && typeof v === 'object') components(v, out);
  }
  return out;
}

type BoardLike = { data: ViewLike['data'] & { template?: string | undefined; spec?: unknown } };

/**
 * A page for managing the project rather than reading about it: the built-in Overview, or a
 * board made mostly of task, stage, goal and plan blocks. Boards of records (money, a car's
 * services, files) are working pages, not this. These wait under More once the project has a
 * page written to be read, unless the owner pinned them.
 */
export function isProjectManagementView(view: BoardLike): boolean {
  if (view.data.doc || view.data.page || view.data.kind === 'answer' || view.data.kind === 'main')
    return false;
  if (!view.data.spec) return !!view.data.template;
  const all = components(view.data.spec);
  return all.length > 0 && all.filter((c) => PM_COMPONENTS.has(c)).length * 2 >= all.length;
}

/** A board of widgets or the built-in template (not a document, a page, an answer or main). */
export const isBoardView = (view: ViewLike): boolean =>
  !view.data.doc && !view.data.page && view.data.kind !== 'answer' && view.data.kind !== 'main';

/** One version of a view: the revision that made it. */
export type ViewVersion = {
  revision: number;
  at: string;
  author: Author;
  message: string;
  op: 'create' | 'update' | 'delete';
  /** Undone later: this revision has a revert. */
  revertedBy?: number;
  /** What it changed in the document or board: blocks (or widgets) added, changed, removed. */
  changes?: { added: number; changed: number; removed: number; of: 'blocks' | 'widgets' };
};

export type BlockChange = 'added' | 'removed' | 'changed' | 'same';

export type ComparedBlock = {
  block: DocBlock;
  change: BlockChange;
  /** For a changed text block: its words, removed and added. */
  words?: DiffPart[];
};

export type DocComparison = {
  blocks: ComparedBlock[];
  added: number;
  removed: number;
  changed: number;
};

const TEXT = new Set(['Text', 'Markdown', 'Callout']);

/** JSON with object keys sorted, so two equal blocks give the same text whatever their key order. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

/** The prose of a text block (Text, Markdown, Callout), if it is one. */
function textOf(block: DocBlock): string | undefined {
  if (block.kind !== 'block') return undefined;
  const node = block.node as { component?: string; content?: unknown; text?: unknown };
  if (!node.component || !TEXT.has(node.component)) return undefined;
  const text = node.content ?? node.text;
  return typeof text === 'string' ? text : undefined;
}

/**
 * What changed between two versions of a document, block by block, in the newer version's order:
 * blocks only in the newer one are added; blocks only in the older one are removed and shown
 * where they were (after the block that came before them); blocks with the same id and different
 * content are changed, with a word diff when both are text. Blocks are matched by id.
 */
export function compareDocs(before: ReportDoc | undefined, after: ReportDoc): DocComparison {
  const old = before?.blocks ?? [];
  const oldById = new Map(old.map((b) => [b.id, b]));
  const newIds = new Set(after.blocks.map((b) => b.id));
  const out: ComparedBlock[] = after.blocks.map((block) => {
    const was = oldById.get(block.id);
    if (!was) return { block, change: 'added' };
    if (stable(was) === stable(block)) return { block, change: 'same' };
    const a = textOf(was);
    const b = textOf(block);
    return {
      block,
      change: 'changed',
      ...(a !== undefined && b !== undefined ? { words: diffWords(a, b) } : {}),
    };
  });
  // Removed blocks go back where they were: after the nearest earlier block still there.
  old.forEach((block, i) => {
    if (newIds.has(block.id)) return;
    let at = 0;
    for (let k = i - 1; k >= 0; k--) {
      const index = out.findIndex((c) => c.block.id === old[k]!.id);
      if (index >= 0) {
        at = index + 1;
        break;
      }
    }
    out.splice(at, 0, { block, change: 'removed' });
  });
  const count = (c: BlockChange) => out.filter((b) => b.change === c).length;
  return {
    blocks: out,
    added: count('added'),
    removed: count('removed'),
    changed: count('changed'),
  };
}

/** "2 added · 1 changed" — what a comparison found, or "No change to the blocks". */
export function comparisonLine(
  c: Pick<DocComparison, 'added' | 'removed' | 'changed'>,
  of: 'blocks' | 'widgets' = 'blocks',
): string {
  const parts = [
    c.added && `${c.added} added`,
    c.changed && `${c.changed} changed`,
    c.removed && `${c.removed} removed`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : `No change to the ${of}`;
}

/** Words a main page may show before its folded details (owner, 2026-10-26: "full of words"). */
export const MAIN_PAGE_WORDS = 200;

/** Words in a text block's prose and titles. */
function blockWords(block: DocBlock): number {
  if (block.kind !== 'block') return 0;
  const node = block.node as Record<string, unknown>;
  return ['content', 'text', 'body', 'title']
    .map((k) => node[k])
    .filter((v): v is string => typeof v === 'string')
    .join(' ')
    .replace(/[-#>*_`|]+/g, ' ')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/**
 * The words a reader sees on a document without opening anything: text blocks at the top level
 * and in columns; details and sheets are folded and don't count.
 */
export function visibleWords(doc: ReportDoc): number {
  const count = (blocks: DocBlock[]): number =>
    blocks.reduce((n, b) => {
      if (b.kind === 'columns') return n + b.columns.reduce((m, col) => m + count(col), 0);
      return n + blockWords(b);
    }, 0);
  return count(doc.blocks);
}

/** The warning for a main page that shows too many words, if it does. */
export function mainPageWordsWarning(doc: ReportDoc): string | undefined {
  const n = visibleWords(doc);
  return n > MAIN_PAGE_WORDS
    ? `The main page shows ${n} words before any details (keep it under ${MAIN_PAGE_WORDS}): show it with a drawing, Stat or StatCards, figures or a short table, and fold the rest into details blocks`
    : undefined;
}

/** What a version changed between the view before and after it: blocks, or a board's widgets. */
export function versionChanges(
  before: { doc?: ReportDoc | undefined; spec?: unknown } | null,
  after: { doc?: ReportDoc | undefined; spec?: unknown } | null,
): ViewVersion['changes'] {
  if (after?.doc) {
    const c = compareDocs(before?.doc, after.doc);
    return { added: c.added, changed: c.changed, removed: c.removed, of: 'blocks' };
  }
  const widgets = (v: { spec?: unknown } | null) => {
    const list = (v?.spec as { widgets?: { id: string }[] } | undefined)?.widgets ?? [];
    return new Map(list.map((w) => [w.id, stable(w)]));
  };
  if (!after?.spec) return undefined;
  const a = widgets(before);
  const b = widgets(after);
  return {
    added: [...b.keys()].filter((id) => !a.has(id)).length,
    changed: [...b.keys()].filter((id) => a.has(id) && a.get(id) !== b.get(id)).length,
    removed: [...a.keys()].filter((id) => !b.has(id)).length,
    of: 'widgets',
  };
}
