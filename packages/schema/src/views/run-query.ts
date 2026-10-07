import type { Entity, EntityType } from '../entities.js';
import { meaningOf, optionKeyOf, optionsFor, type OptionKey } from '../options.js';
import type { Condition, Filter, ProjectDataset, QueryableType, Scalar, Where } from './query.js';

const DATASET_KEYS = {
  goal: 'goals',
  scope_item: 'scopeItems',
  stage: 'stages',
  task: 'tasks',
  artifact: 'artifacts',
  decision: 'decisions',
} as const satisfies Record<QueryableType, keyof ProjectDataset>;

/** References a field path may follow one hop through, e.g. "stage.status" via `stageId`. */
const HOPS: Record<string, { field: string; type: EntityType }> = {
  stage: { field: 'stageId', type: 'stage' },
  assignee: { field: 'assigneeId', type: 'assignee' },
  task: { field: 'taskId', type: 'task' },
  parent: { field: 'parentId', type: 'goal' },
  project: { field: 'projectId', type: 'project' },
};

export type QueryContext = {
  /** Today as YYYY-MM-DD, for "$today" (defaults to the local date). */
  today?: string;
};

type Run = {
  data: ProjectDataset;
  byId: Map<string, Entity>;
  today: string;
};

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y!, m! - 1, d! + days));
  return t.toISOString().slice(0, 10);
}

/** "$today", "$today+7d", "$today-2w" → YYYY-MM-DD; "$currentStage", "$project" → ids. */
function resolveSpecial(value: Scalar, run: Run): Scalar | undefined {
  if (typeof value !== 'string' || !value.startsWith('$')) return value;
  if (value === '$currentStage') return run.data.project.data.currentStageId;
  if (value === '$project') return run.data.project.id;
  const relative = /^\$today(?:([+-])(\d+)([dw]))?$/.exec(value);
  if (relative) {
    const [, sign, n, unit] = relative;
    if (!sign) return run.today;
    const days = Number(n) * (unit === 'w' ? 7 : 1) * (sign === '-' ? -1 : 1);
    return addDays(run.today, days);
  }
  return value;
}

/** A field's value, following one reference hop if the path has a dot; also reports where it came from. */
function resolveField(
  entity: Entity,
  path: string,
  run: Run,
): { value: unknown; type: EntityType; field: string } {
  const dot = path.indexOf('.');
  if (dot > 0) {
    const hop = HOPS[path.slice(0, dot)];
    const rest = path.slice(dot + 1);
    if (hop) {
      const id = (entity.data as Record<string, unknown>)[hop.field];
      const target = typeof id === 'string' ? run.byId.get(id) : undefined;
      return target
        ? resolveField(target, rest, run)
        : { value: undefined, type: hop.type, field: rest };
    }
  }
  const value =
    path === 'id'
      ? entity.id
      : path === 'createdAt'
        ? entity.createdAt
        : path === 'updatedAt'
          ? entity.updatedAt
          : (entity.data as Record<string, unknown>)[path];
  return { value, type: entity.type, field: path };
}

/**
 * For option fields (statuses, priorities, …) a condition matches either the stored value or the
 * option's meaning, so `status: "in_progress"` also finds a custom "In review" status.
 */
function matchesValue(
  actual: unknown,
  expected: Scalar | Scalar[],
  run: Run,
  key: OptionKey | undefined,
): boolean {
  const options = (Array.isArray(expected) ? expected : [expected]).map((v) =>
    resolveSpecial(v, run),
  );
  const hit = (a: unknown) =>
    options.includes(a as Scalar) ||
    (key !== undefined &&
      typeof a === 'string' &&
      options.includes(meaningOf(run.data.project, key, a) as Scalar));
  return Array.isArray(actual) ? actual.some(hit) : hit(actual);
}

/** Position in the project's option list; a meaning ("high") ranks as its first option. */
function optionPosition(run: Run, key: OptionKey, value: unknown): number | undefined {
  const options = optionsFor(run.data.project, key);
  const i = options.findIndex((o) => o.value === value);
  if (i !== -1) return i;
  const j = options.findIndex((o) => o.meaning === value);
  return j === -1 ? undefined : j;
}

function compareValues(
  a: unknown,
  b: unknown,
  run: Run,
  key: OptionKey | undefined,
): number | undefined {
  if (a === undefined || a === null || b === undefined || b === null) return undefined;
  if (key) {
    const [x, y] = [optionPosition(run, key, a), optionPosition(run, key, b)];
    return x === undefined || y === undefined ? undefined : x - y;
  }
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  // Dates are ISO strings, so text order is date order (YYYY-MM-DD vs full timestamps works too).
  const [x, y] = [String(a), String(b)];
  return x === y ? 0 : x < y ? -1 : 1;
}

function matchesCondition(
  actual: unknown,
  condition: Condition,
  run: Run,
  key: OptionKey | undefined,
): boolean {
  if (typeof condition !== 'object' || Array.isArray(condition))
    return matchesValue(actual, condition, run, key);
  if ('exists' in condition) {
    const present =
      actual !== undefined && actual !== null && !(Array.isArray(actual) && actual.length === 0);
    return present === condition.exists;
  }
  if ('not' in condition) return !matchesValue(actual, condition.not, run, key);
  if ('contains' in condition) {
    const needle = condition.contains.toLowerCase();
    const values = Array.isArray(actual) ? actual : [actual];
    return values.some((v) => typeof v === 'string' && v.toLowerCase().includes(needle));
  }
  // A range: every bound given must hold.
  const bounds: [Scalar | undefined, (c: number) => boolean][] = [
    [condition.gt, (c) => c > 0],
    [condition.gte, (c) => c >= 0],
    [condition.lt, (c) => c < 0],
    [condition.lte, (c) => c <= 0],
  ];
  return bounds.every(([bound, ok]) => {
    if (bound === undefined) return true;
    const c = compareValues(actual, resolveSpecial(bound, run), run, key);
    return c !== undefined && ok(c);
  });
}

function matches(entity: Entity, where: Where, run: Run): boolean {
  return Object.entries(where).every(([path, condition]) => {
    const { value, type, field } = resolveField(entity, path, run);
    return matchesCondition(value, condition, run, optionKeyOf(type, field));
  });
}

/**
 * Reads field paths the same way filters do (including one reference hop), for components that
 * display fields: returns the value plus the entity type and field it finally came from.
 */
export function fieldReader(data: ProjectDataset, context: QueryContext = {}) {
  const run: Run = { data, byId: index(data), today: context.today ?? localToday() };
  return (entity: Entity, path: string) => resolveField(entity, path, run);
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === undefined || a === null) return 1;
  if (b === undefined || b === null) return -1;
  return a < b ? -1 : 1;
}

function index(data: ProjectDataset): Map<string, Entity> {
  const all: Entity[] = [
    data.project,
    ...data.assignees,
    ...data.goals,
    ...data.stages,
    ...data.tasks,
  ];
  return new Map(all.map((e) => [e.id, e]));
}

export function runQuery<T extends QueryableType>(
  data: ProjectDataset,
  type: T,
  filter: Filter = {},
  context: QueryContext = {},
): Entity<T>[] {
  const run: Run = { data, byId: index(data), today: context.today ?? localToday() };
  let rows = (data[DATASET_KEYS[type]] as Entity<T>[]).filter(
    (e) =>
      (!filter.where || matches(e, filter.where, run)) &&
      (!filter.anyOf?.length || filter.anyOf.some((w) => matches(e, w, run))),
  );
  const sort = filter.sort ?? [];
  if (sort.length) {
    rows = [...rows].sort((x, y) => {
      for (const { field: path, dir } of sort) {
        const a = resolveField(x, path, run);
        const b = resolveField(y, path, run);
        // Option fields (e.g. priority) sort in the project's option order, not alphabetically.
        const key = optionKeyOf(a.type, a.field);
        const c = key
          ? (optionPosition(run, key, a.value) ?? Infinity) -
            (optionPosition(run, key, b.value) ?? Infinity)
          : compare(a.value, b.value);
        if (c) return dir === 'desc' ? -c : c;
      }
      return 0;
    });
  }
  return filter.limit ? rows.slice(0, filter.limit) : rows;
}
