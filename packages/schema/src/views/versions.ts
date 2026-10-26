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
export function comparisonLine(c: Pick<DocComparison, 'added' | 'removed' | 'changed'>): string {
  const parts = [
    c.added && `${c.added} added`,
    c.changed && `${c.changed} changed`,
    c.removed && `${c.removed} removed`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'No change to the blocks';
}
