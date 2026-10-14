import type { Entity, EntityType } from '../entities.js';
import type { Board } from './board.js';
import { QueryableType, type Filter } from './query.js';

/**
 * What a page reads (R11): the queries its blocks run, the items they name by id, and whether it
 * shows the project itself or everything that happens (an activity feed). Worked out from the
 * board alone, so the server can tell which later changes touch a page.
 */
export type BoardReads = {
  /** One per query; no filter reads every item of the type. */
  queries: { type: QueryableType; filter?: Pick<Filter, 'where' | 'anyOf'> }[];
  /** Items named by id (a ClaimCard's claim, a DecisionBlock's decision, StartHere evidence…). */
  ids: Set<string>;
  /** Shows the project's own details (name, stage, options). */
  project: boolean;
  /** Shows every change (an ActivityFeed): any revision in the project touches it. */
  everything: boolean;
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function filterOf(value: unknown): Pick<Filter, 'where' | 'anyOf'> | undefined {
  if (!isObject(value)) return undefined;
  const out: Pick<Filter, 'where' | 'anyOf'> = {};
  if (isObject(value.where)) out.where = value.where as Filter['where'];
  if (Array.isArray(value.anyOf)) out.anyOf = value.anyOf as Filter['anyOf'];
  return out.where || out.anyOf ? out : undefined;
}

export function boardReads(board: Board): BoardReads {
  const reads: BoardReads = { queries: [], ids: new Set(), project: false, everything: false };
  const add = (type: QueryableType, filter?: unknown) =>
    reads.queries.push({ type, ...(filterOf(filter) ? { filter: filterOf(filter) } : {}) });

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

/** One entity change, as the store records it. */
export type ChangeLike = {
  type: EntityType;
  id: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

function asEntity(change: ChangeLike, data: Record<string, unknown>): Entity {
  return {
    id: change.id,
    type: change.type,
    data,
    createdAt: '',
    updatedAt: '',
    createdRev: 0,
    updatedRev: 0,
  } as Entity;
}

/**
 * Whether a change touches what a page reads: an item it names, the project when it shows it, or
 * an item that matched one of its queries before or after the change. `matches` evaluates a filter
 * (see `filterMatcher`). Views and requests are pages and questions, not data, so they never count
 * here; a page's own change is counted separately.
 */
export function changeTouches(
  reads: BoardReads,
  change: ChangeLike,
  matches: (entity: Entity, filter?: Pick<Filter, 'where' | 'anyOf'>) => boolean,
  options: { everything?: boolean } = {},
): boolean {
  if (change.type === 'view' || change.type === 'request') return false;
  if (options.everything !== false && reads.everything) return true;
  if (reads.ids.has(change.id)) return true;
  if (change.type === 'project') return reads.project;
  for (const query of reads.queries) {
    if (query.type !== change.type) continue;
    if (!query.filter) return true;
    for (const version of [change.before, change.after])
      if (version && matches(asEntity(change, version), query.filter)) return true;
  }
  return false;
}
