import type { Entity, EntityType } from '../entities.js';
import { RANKED_MEANINGS, meaningOf, optionKeyOf, optionsFor, type OptionKey } from '../options.js';
import { DUE_BANDS, findRecordType, isMoney } from '../records.js';
import { localToday, relativeDate } from './dates.js';
import { computeDue, type Due } from './due.js';
import type { Condition, Filter, ProjectDataset, QueryableType, Scalar, Where } from './query.js';

const DATASET_KEYS = {
  goal: 'goals',
  scope_item: 'scopeItems',
  stage: 'stages',
  task: 'tasks',
  artifact: 'artifacts',
  decision: 'decisions',
  claim: 'claims',
  term: 'terms',
  file: 'files',
  record: 'records',
} as const satisfies Record<QueryableType, keyof ProjectDataset>;

/** References a field path may follow one hop through, e.g. "stage.status" via `stageId`. */
export const QUERY_HOPS: Record<string, { field: string; type: EntityType }> = {
  stage: { field: 'stageId', type: 'stage' },
  assignee: { field: 'assigneeId', type: 'assignee' },
  task: { field: 'taskId', type: 'task' },
  file: { field: 'fileId', type: 'file' },
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
  /** When each repeating record is due, worked out once per run. */
  due: Map<string, Due | undefined>;
};

/** "$today", "$today+7d", "$monthStart" … → YYYY-MM-DD; "$currentStage", "$project" → ids. */
function resolveSpecial(value: Scalar, run: Run): Scalar | undefined {
  if (typeof value !== 'string' || !value.startsWith('$')) return value;
  if (value === '$currentStage') return run.data.project.data.currentStageId;
  if (value === '$project') return run.data.project.id;
  return relativeDate(value, run.today) ?? value;
}

/** Where a value came from: its entity type and field, and for records the record type. */
export type Resolved = { value: unknown; type: EntityType; field: string; recordType?: string };

/** When a repeating record is due next (undefined without an interval). */
function dueOfRecord(record: Entity<'record'>, run: Run): Due | undefined {
  if (run.due.has(record.id)) return run.due.get(record.id);
  run.due.set(record.id, undefined); // a reading that points back at itself stops here
  const { interval } = record.data;
  let due: Due | undefined;
  if (interval) {
    const reading = interval.meter
      ? resolveField(record, interval.meter.from, run).value
      : undefined;
    due = computeDue(interval, run.today, typeof reading === 'number' ? reading : undefined);
  }
  run.due.set(record.id, due);
  return due;
}

/** Record paths: "fields.<key>", one hop "fields.<ref>.<path>", money ".amount", "due.<part>". */
function resolveRecordField(record: Entity<'record'>, path: string, run: Run): Resolved | null {
  const recordType = record.data.recordType;
  if (path.startsWith('due.')) {
    const due = dueOfRecord(record, run);
    const part = path.slice(4) as keyof Due;
    return { value: due?.[part], type: 'record', field: path, recordType };
  }
  if (!path.startsWith('fields.')) return null;
  const rest = path.slice(7);
  const dot = rest.indexOf('.');
  const key = dot < 0 ? rest : rest.slice(0, dot);
  const value = (record.data.fields ?? {})[key];
  if (dot < 0) return { value, type: 'record', field: `fields.${key}`, recordType };
  const tail = rest.slice(dot + 1);
  if (isMoney(value) && (tail === 'amount' || tail === 'currency'))
    return { value: value[tail], type: 'record', field: `fields.${key}.${tail}`, recordType };
  const target = typeof value === 'string' ? run.byId.get(value) : undefined;
  return target
    ? resolveField(target, tail, run)
    : { value: undefined, type: 'record', field: tail };
}

/** A field's value, following one reference hop if the path has a dot; also reports where it came from. */
function resolveField(entity: Entity, path: string, run: Run): Resolved {
  if (entity.type === 'record') {
    const resolved = resolveRecordField(entity as Entity<'record'>, path, run);
    if (resolved) return resolved;
  }
  const dot = path.indexOf('.');
  if (dot > 0) {
    const hop = QUERY_HOPS[path.slice(0, dot)];
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
  return {
    value,
    type: entity.type,
    field: path,
    ...(entity.type === 'record'
      ? { recordType: (entity as Entity<'record'>).data.recordType }
      : {}),
  };
}

/** A record option field's definition, when the value came from one. */
function recordOptionDef(run: Run, at: Resolved) {
  if (at.type !== 'record' || !at.recordType || !at.field.startsWith('fields.')) return undefined;
  const def = findRecordType(run.data.project, at.recordType)?.fields.find(
    (f) => `fields.${f.key}` === at.field,
  );
  return def?.kind === 'option' ? def : undefined;
}

/** Ranked values that aren't project options: due bands and record option fields. */
function isRanked(run: Run, at: Resolved): boolean {
  return (at.type === 'record' && at.field === 'due.band') || !!recordOptionDef(run, at);
}

function rankOf(run: Run, at: Resolved, value: unknown): number | undefined {
  const list =
    at.field === 'due.band'
      ? (DUE_BANDS as readonly string[])
      : (recordOptionDef(run, at)?.options ?? []).map((o) => o.value);
  const i = list.indexOf(value as string);
  return i === -1 ? undefined : i;
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

/**
 * Position in the project's option list; a meaning ("high") ranks as its first option. Keys with
 * a fixed strength (RANKED_MEANINGS) rank by their value's meaning instead, never list order.
 */
function optionPosition(run: Run, key: OptionKey, value: unknown): number | undefined {
  const ranked = RANKED_MEANINGS[key];
  if (ranked) {
    const meaning = typeof value === 'string' ? meaningOf(run.data.project, key, value) : undefined;
    const rank = ranked.indexOf(meaning as string);
    return rank === -1 ? undefined : rank;
  }
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
  if (isMoney(a)) return compareValues(a.amount, isMoney(b) ? b.amount : b, run, key);
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
  at?: Resolved,
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
    const target = resolveSpecial(bound, run);
    if (at && isRanked(run, at)) {
      const [x, y] = [rankOf(run, at, actual), rankOf(run, at, target)];
      return x !== undefined && y !== undefined && ok(x - y);
    }
    const c = compareValues(actual, target, run, key);
    return c !== undefined && ok(c);
  });
}

function matches(entity: Entity, where: Where, run: Run): boolean {
  return Object.entries(where).every(([path, condition]) => {
    const at = resolveField(entity, path, run);
    return matchesCondition(at.value, condition, run, optionKeyOf(at.type, at.field), at);
  });
}

/**
 * Reads field paths the same way filters do (including one reference hop), for components that
 * display fields: returns the value plus the entity type and field it finally came from.
 */
export function fieldReader(data: ProjectDataset, context: QueryContext = {}) {
  const run = newRun(data, context);
  return (entity: Entity, path: string) => resolveField(entity, path, run);
}

/**
 * Whether one entity passes a filter's `where` and `anyOf` (not its sort or limit), following
 * references through `data` (R11: which changes touch what a block shows). The entity may be an
 * earlier version of one in `data`.
 */
export function filterMatcher(data: ProjectDataset, context: QueryContext = {}) {
  const run = newRun(data, context);
  return (entity: Entity, filter: Pick<Filter, 'where' | 'anyOf'> = {}): boolean => {
    // An earlier version of a record may be due on another date: work it out again.
    run.due.clear();
    return (
      (!filter.where || matches(entity, filter.where, run)) &&
      (!filter.anyOf?.length || filter.anyOf.some((w) => matches(entity, w, run)))
    );
  };
}

/** When a repeating record is due next, as DueTracker and the "due.*" paths see it. */
export function dueOf(
  data: ProjectDataset,
  record: Entity<'record'>,
  context: QueryContext = {},
): Due | undefined {
  return dueOfRecord(record, newRun(data, context));
}

function newRun(data: ProjectDataset, context: QueryContext): Run {
  return { data, byId: index(data), today: context.today ?? localToday(), due: new Map() };
}

function compare(a: unknown, b: unknown): number {
  if (isMoney(a) && isMoney(b)) return compare(a.amount, b.amount);
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
    // Older datasets (and test fixtures) may come without files or records.
    ...(data.files ?? []),
    ...(data.records ?? []),
  ];
  return new Map(all.map((e) => [e.id, e]));
}

const isMissing = (value: unknown) =>
  value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length);

export function runQuery<T extends QueryableType>(
  data: ProjectDataset,
  type: T,
  filter: Filter = {},
  context: QueryContext = {},
): Entity<T>[] {
  const run = newRun(data, context);
  let rows = ((data[DATASET_KEYS[type]] ?? []) as Entity<T>[]).filter(
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
        // Rows without a value come last either way (v0.2 review, gap 11): an undated row is
        // never the newest.
        const aMissing = isMissing(a.value);
        if (aMissing !== isMissing(b.value)) return aMissing ? 1 : -1;
        if (aMissing) continue;
        // Option fields (e.g. priority) sort in the project's option order, not alphabetically.
        const key = optionKeyOf(a.type, a.field);
        const c = key
          ? (optionPosition(run, key, a.value) ?? Infinity) -
            (optionPosition(run, key, b.value) ?? Infinity)
          : isRanked(run, a)
            ? (rankOf(run, a, a.value) ?? -1) - (rankOf(run, b, b.value) ?? -1)
            : compare(a.value, b.value);
        if (c) return dir === 'desc' ? -c : c;
      }
      return 0;
    });
  }
  if (filter.onePer) {
    // One row per value (R9): the first after sorting, e.g. the latest mix of each song. Rows
    // without a value are kept, each on its own.
    const seen = new Set<string>();
    rows = rows.filter((row) => {
      const value = resolveField(row, filter.onePer!, run).value;
      if (value === undefined || value === null || value === '') return true;
      const key = JSON.stringify(value);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  return filter.limit ? rows.slice(0, filter.limit) : rows;
}
