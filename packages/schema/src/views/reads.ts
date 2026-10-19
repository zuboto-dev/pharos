import type { Entity, EntityType } from '../entities.js';
import type { Board } from './board.js';
import { docLeaves, type DocBlock } from './doc.js';
import { QueryableType, type Filter } from './query.js';
import type { FilterMatcher } from './run-query.js';

/** A query a block runs: the whole filter, so tracking can tell what it really selects. */
export type ReadQuery = { type: QueryableType; filter?: Filter };

/**
 * What a page reads (R11): the queries its blocks run, the items they name by id, and whether it
 * shows the project itself or everything that happens (an activity feed). Worked out from the
 * board alone, so the server can tell which later changes touch a page.
 */
export type BoardReads = {
  /** One per query; no filter reads every item of the type. */
  queries: ReadQuery[];
  /** Items named by id (a ClaimCard's claim, a DecisionBlock's decision, StartHere evidence…). */
  ids: Set<string>;
  /** Shows the project's own details (name, stage, options). */
  project: boolean;
  /** Shows every change (an ActivityFeed): any revision in the project touches it. */
  everything: boolean;
  /** A query depends on the project's current stage ("$currentStage"). */
  currentStage?: boolean;
  /** What it shows depends on today's date ("$today", "$monthStart", "due.*", a DueTracker). */
  dates?: boolean;
};

/** Components that read every item of one type through an optional `filter` prop. */
const FILTERED: Record<string, QueryableType> = {
  GoalTree: 'goal',
  StageTracker: 'stage',
  Timeline: 'stage',
  MilestoneList: 'stage',
  KanbanBoard: 'task',
  TaskTable: 'task',
  TaskChecklist: 'task',
  DependencyGraph: 'task',
  AssigneeMatrix: 'task',
  ArtifactGallery: 'artifact',
  DecisionLog: 'decision',
  FileList: 'file',
};

const ID = /^[a-z]+_[0-9a-f]{8,}$/;
const QUERYABLE = new Set<string>(QueryableType.options);
const TIMESTAMPS = new Set(['createdAt', 'updatedAt']);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function filterOf(value: unknown): Filter | undefined {
  if (!isObject(value)) return undefined;
  const out: Filter = {};
  if (isObject(value.where)) out.where = value.where as Filter['where'];
  if (Array.isArray(value.anyOf)) out.anyOf = value.anyOf as Filter['anyOf'];
  if (Array.isArray(value.sort)) out.sort = value.sort as Filter['sort'];
  if (typeof value.onePer === 'string') out.onePer = value.onePer;
  if (typeof value.limit === 'number') out.limit = value.limit;
  return Object.keys(out).length ? out : undefined;
}

/** The field paths a filter reads (conditions, sort and onePer). */
function pathsOf(filter: Filter | undefined): string[] {
  if (!filter) return [];
  return [
    ...Object.keys(filter.where ?? {}),
    ...(filter.anyOf ?? []).flatMap((w) => Object.keys(w)),
    ...(filter.sort ?? []).map((s) => s.field),
    ...(filter.onePer ? [filter.onePer] : []),
  ];
}

/** Whether a filter's results depend on today (a relative date value, or a due date). */
function datedFilter(filter: Filter): boolean {
  if (pathsOf(filter).some((p) => p.startsWith('due.'))) return true;
  const text = JSON.stringify([filter.where ?? {}, filter.anyOf ?? []]);
  return /"\$(?!currentStage"|project")[a-zA-Z]/.test(text);
}

export function boardReads(board: Board): BoardReads {
  const reads: BoardReads = { queries: [], ids: new Set(), project: false, everything: false };
  const add = (type: QueryableType, value?: unknown) => {
    const filter = filterOf(value);
    reads.queries.push({ type, ...(filter ? { filter } : {}) });
    if (filter && JSON.stringify(filter).includes('"$currentStage"')) reads.currentStage = true;
    if (filter && datedFilter(filter)) reads.dates = true;
  };

  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      if (ID.test(value)) reads.ids.add(value);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isObject(value)) return;
    // A query anywhere in a block: {type, where?, anyOf?, …}.
    if (typeof value.type === 'string' && QUERYABLE.has(value.type))
      add(value.type as QueryableType, value);
    const component = typeof value.component === 'string' ? value.component : undefined;
    if (component) {
      const type = FILTERED[component];
      if (type) add(type, value.filter);
      switch (component) {
        case 'ProjectHeader':
          reads.project = true;
          add('stage');
          add('task');
          break;
        case 'ScopeBoard':
          add('scope_item');
          break;
        case 'ProgressRing':
          add('task', { where: value.where });
          break;
        case 'Gallery':
          if (value.artifacts) add('artifact', value.artifacts);
          if (value.files) add('file', value.files);
          break;
        case 'ActivityFeed':
          reads.everything = true;
          break;
        case 'DueTracker':
          reads.dates = true;
          break;
        case 'Layers':
          for (const layer of Array.isArray(value.layers) ? value.layers : []) {
            if (!isObject(layer)) continue;
            if (layer.items) add('claim', layer.items);
            if (layer.progress) add('task', { where: layer.progress });
          }
          break;
        case 'FindingChart':
          if (value.bars) add('claim', value.bars);
          break;
      }
    }
    for (const [k, v] of Object.entries(value)) {
      // Filters were read above; their values are field conditions, not ids to watch.
      if (k === 'filter' || k === 'where' || k === 'anyOf') continue;
      if (component === 'Gallery' && (k === 'artifacts' || k === 'files')) continue;
      visit(v);
    }
  };
  for (const widget of board.widgets) visit(widget.node);
  return reads;
}

/**
 * What a report page reads (R13): the queries in its named reads (`page.data`). The HTML itself
 * is not read for ids: what the page shows live comes only through those reads.
 */
export function pageReads(page: { data?: Record<string, ReadQuery> }): BoardReads {
  const reads: BoardReads = { queries: [], ids: new Set(), project: false, everything: false };
  for (const read of Object.values(page.data ?? {})) {
    reads.queries.push({ type: read.type, ...(read.filter ? { filter: read.filter } : {}) });
    const text = read.filter ? JSON.stringify(read.filter) : '';
    if (text.includes('"$currentStage"')) reads.currentStage = true;
    if (read.filter && datedFilter(read.filter)) reads.dates = true;
  }
  return reads;
}

/**
 * What a report document reads (R14): its components' queries (as a board of them would) plus
 * the named reads its drawings get.
 */
export function docReads(doc: {
  blocks: DocBlock[];
  data?: Record<string, ReadQuery>;
}): BoardReads {
  const widgets = docLeaves(doc.blocks).flatMap((b, i) =>
    b.kind === 'block' ? [{ id: `d${i}`, node: b.node }] : [],
  );
  return mergeReads(boardReads({ component: 'Board', widgets }), pageReads(doc));
}

/** Whether a page reads nothing from the project's data (only what its agent wrote). */
export function readsNothing(reads: BoardReads): boolean {
  return !reads.queries.length && !reads.ids.size && !reads.project && !reads.everything;
}

/** Two boards' reads together (what a page read when it was written, and what it reads now). */
export function mergeReads(a: BoardReads, b: BoardReads): BoardReads {
  return {
    queries: [...a.queries, ...b.queries],
    ids: new Set([...a.ids, ...b.ids]),
    project: a.project || b.project,
    everything: a.everything || b.everything,
    currentStage: !!(a.currentStage || b.currentStage),
    dates: !!(a.dates || b.dates),
  };
}

/** One entity change, as the store records it. */
export type ChangeLike = {
  type: EntityType;
  id: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  /** When the change was made (its revision's time): the after version's `updatedAt`. */
  at?: string;
};

/** A version of the changed item as an entity, with its real timestamps where they are known. */
function asEntity(
  change: ChangeLike,
  data: Record<string, unknown>,
  known: Entity | undefined,
  side: 'before' | 'after',
): Entity {
  return {
    id: change.id,
    type: change.type,
    data,
    createdAt: known?.createdAt ?? (change.before ? '' : (change.at ?? '')),
    updatedAt: (side === 'after' ? change.at : undefined) ?? known?.updatedAt ?? '',
    createdRev: known?.createdRev ?? 0,
    updatedRev: known?.updatedRev ?? 0,
  } as Entity;
}

/** A plain matcher still works; tracking through links and whole queries needs a `filterMatcher`. */
type Matches = ((entity: Entity, filter?: Pick<Filter, 'where' | 'anyOf'>) => boolean) &
  Partial<Pick<FilterMatcher, 'lookup' | 'referrers' | 'withVersion' | 'selects'>>;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A change to the project: its settings decide which items blocks select and how they read. */
function projectTouches(reads: BoardReads, change: ChangeLike): boolean {
  if (reads.project) return true;
  const shows = reads.queries.length > 0 || reads.ids.size > 0;
  if (!change.before || !change.after) return shows;
  const changed = (key: string) => !same(change.before![key], change.after![key]);
  // "$currentStage" queries select by it; stage lists mark the current one.
  if (
    changed('currentStageId') &&
    (reads.currentStage || reads.queries.some((q) => q.type === 'stage'))
  )
    return true;
  // Option labels and record field definitions (labels, units, kinds) change how items read.
  if (changed('options') && shows) return true;
  if (
    changed('recordTypes') &&
    (reads.ids.size > 0 || reads.queries.some((q) => q.type === 'record'))
  )
    return true;
  return false;
}

/**
 * Whether a change touches what a page reads: an item it names (or one such an item links to,
 * like a claim's file), the project settings its blocks use, an item one of its queries selects
 * before or after the change, or an item linked from one it selects (a task's stage shown in a
 * column or used in a filter, a service's vehicle). `matches` evaluates a filter: pass a
 * `filterMatcher`, whose dataset the links and whole-query selections (sort, onePer, limit) are
 * worked out from; with a plain function only the filters count. Views and requests are pages and
 * questions, not data, so they never count here; a page's own change is counted separately.
 *
 * Errs toward counting: a spare dot is better than a missed change.
 */
export function changeTouches(
  reads: BoardReads,
  change: ChangeLike,
  matches: Matches,
  options: { everything?: boolean } = {},
): boolean {
  if (change.type === 'view' || change.type === 'request') return false;
  if (options.everything !== false && reads.everything) return true;
  if (reads.ids.has(change.id)) return true;
  if (change.type === 'project') return projectTouches(reads, change);
  const referrers = matches.referrers?.(change.id) ?? [];
  // An item the page names links to the changed one (a claim card shows its files).
  if (referrers.some((r) => reads.ids.has(r.id))) return true;
  const known = matches.lookup?.(change.id);
  const versions = (['before', 'after'] as const).flatMap((side) =>
    change[side] ? [asEntity(change, change[side]!, known, side)] : [],
  );
  // Sorted and cut (limit, one per value): an item counts only when the page shows it.
  const shown = (query: ReadQuery, id: string, version: Entity) =>
    !(query.filter?.limit || query.filter?.onePer) ||
    !matches.selects ||
    matches.selects(query.type, query.filter, id, { type: change.type, id: change.id, version });
  for (const query of reads.queries) {
    if (query.type === change.type) {
      // Every edit moves updatedAt: a query on timestamps may gain or lose the item.
      if (pathsOf(query.filter).some((p) => TIMESTAMPS.has(p))) return true;
      for (const version of versions)
        if (matches(version, query.filter) && shown(query, change.id, version)) return true;
    }
    // Items the query selects that link to the changed one and read through that link (a filter
    // on "stage.status", a "stage.name" column, a record field naming another record).
    for (const item of referrers) {
      if (item.type !== query.type) continue;
      for (const version of versions) {
        const run = () => matches(item, query.filter) && shown(query, item.id, version);
        if (matches.withVersion ? matches.withVersion(change.id, version, run) : run()) return true;
      }
    }
  }
  return false;
}
