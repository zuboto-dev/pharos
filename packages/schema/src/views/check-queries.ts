import type { Entity, EntityType } from '../entities.js';
import { recordTypesOf, type RecordType } from '../records.js';
import type { Board } from './board.js';
import type { ViewNode } from './catalog.js';
import { isDateToken, relativeDate } from './dates.js';
import {
  optionValues,
  resolvePath,
  scopeName,
  type FieldInfo,
  type FieldScope,
  type PathResult,
} from './fields.js';
import type { Condition, Filter, Query, Scalar, Where } from './query.js';

/**
 * Query checks (R8.5–R8.9): every filter, sort, group, sum and column a page names is checked
 * against the field metadata before the page is saved. docs/reframe/r8-notes.md has the policy:
 * findings at level "reject" refuse the save, "warn" ones come back with it.
 */

export const FINDING_LEVELS = {
  'unknown-field': 'reject',
  'unknown-hop': 'reject',
  'unknown-record-type': 'reject',
  'unknown-sort-field': 'reject',
  'unknown-group-field': 'reject',
  'unknown-sum-field': 'reject',
  'sum-not-number': 'reject',
  'unknown-column': 'reject',
  'operator-mismatch': 'reject',
  'unknown-option': 'reject',
  'bad-relative-date': 'reject',
  'no-record-type': 'warn',
  'mixed-record-types': 'warn',
  'group-by-unique': 'warn',
  'sort-by-list': 'warn',
} as const;
export type FindingCode = keyof typeof FINDING_LEVELS;

export type QueryFinding = {
  level: 'reject' | 'warn';
  code: FindingCode;
  /** JSON path into the board, e.g. widgets[1].node.query.where["fields.odomter"]. */
  path: string;
  /** The widget it is in. */
  widget: string;
  message: string;
  /** What the field could be instead (paths or values), when that helps. */
  allowed?: string[];
  /** The closest allowed value to what was written. */
  suggestion?: string;
  /** The same part, corrected. */
  example?: unknown;
};

const SPECIAL = new Set(['$currentStage', '$project']);

/** Edit distance, for "did you mean". */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = row[j]!;
      row[j] = next;
    }
  }
  return row[b.length]!;
}

/** The allowed value closest to what was written, if any is close enough to be a typo. */
export function closest(written: string, allowed: string[]): string | undefined {
  const w = written.toLowerCase();
  let best: string | undefined;
  let bestD = Infinity;
  for (const option of allowed) {
    if (option.endsWith('.…')) continue;
    const d = distance(w, option.toLowerCase());
    if (d < bestD) [best, bestD] = [option, d];
  }
  const limit = Math.max(2, Math.floor(written.length / 3));
  return best !== undefined && bestD <= limit ? best : undefined;
}

function key(path: string): string {
  return /^[A-Za-z_]\w*$/.test(path) ? `.${path}` : `[${JSON.stringify(path)}]`;
}

type Ctx = {
  project: Entity<'project'> | null;
  recordTypes: RecordType[];
  widget: string;
  out: QueryFinding[];
};

function add(
  ctx: Ctx,
  code: FindingCode,
  path: string,
  message: string,
  more: Partial<QueryFinding> = {},
) {
  ctx.out.push({ level: FINDING_LEVELS[code], code, path, widget: ctx.widget, message, ...more });
}

/** The scopes a query reads: one entity type, or the record types its `recordType` names. */
function scopesOf(
  ctx: Ctx,
  type: EntityType,
  filter: Filter | undefined,
  at: string,
): FieldScope[] {
  if (type !== 'record') return [{ type }];
  const named = recordTypeNames(filter);
  if (!named) {
    add(
      ctx,
      'no-record-type',
      `${at}.where`,
      'This record query has no recordType, so it mixes every kind of record',
      {
        allowed: ctx.recordTypes.map((t) => t.key),
        example: { where: { recordType: ctx.recordTypes[0]?.key ?? 'service' } },
      },
    );
    return ctx.recordTypes.map((recordType) => ({ type, recordType }));
  }
  const scopes: FieldScope[] = [];
  for (const name of named) {
    const recordType = ctx.recordTypes.find((t) => t.key === name);
    if (recordType) scopes.push({ type, recordType });
    else {
      const allowed = ctx.recordTypes.map((t) => t.key);
      const suggestion = closest(name, allowed);
      add(
        ctx,
        'unknown-record-type',
        `${at}.where.recordType`,
        `"${name}" isn't a record type of this project (${allowed.join(', ') || 'it has none; apply a pack or add recordTypes to the project'})`,
        {
          allowed,
          ...(suggestion ? { suggestion, example: { where: { recordType: suggestion } } } : {}),
        },
      );
    }
  }
  return scopes;
}

/** Record types a filter limits itself to, or undefined when it names none. */
function recordTypeNames(filter: Filter | undefined): string[] | undefined {
  const fromWhere = (where: Where | undefined): string[] | undefined => {
    const c = where?.recordType;
    if (typeof c === 'string') return [c];
    if (Array.isArray(c)) return c.map(String);
    return undefined;
  };
  const own = fromWhere(filter?.where);
  if (own) return own;
  if (filter?.anyOf?.length) {
    const each = filter.anyOf.map(fromWhere);
    if (each.every(Boolean)) return [...new Set(each.flat() as string[])];
  }
  return undefined;
}

type Resolved = { info: FieldInfo; scope: FieldScope } | null;

/**
 * Resolves a path in every scope of the query. Unknown in all: a finding with `code`; unknown in
 * some record types: a warning. Returns the first resolution.
 */
function resolveIn(
  ctx: Ctx,
  scopes: FieldScope[],
  path: string,
  at: string,
  code: FindingCode,
  example: (fix: string) => unknown,
  what = '',
): Resolved {
  if (!scopes.length) return null;
  const results = scopes.map((s) => [s, resolvePath(ctx.project, s, path)] as const);
  const ok = results.filter(
    (r): r is readonly [FieldScope, Extract<PathResult, { ok: true }>] => r[1].ok,
  );
  if (!ok.length) {
    const first = results[0]![1] as Extract<PathResult, { ok: false }>;
    const allowed = [...new Set(results.flatMap(([, r]) => (r.ok ? [] : r.allowed)))];
    const suggestion = closest(path, allowed);
    const findingCode =
      code === 'unknown-field' && first.code === 'unknown-hop' ? 'unknown-hop' : code;
    add(
      ctx,
      findingCode,
      at,
      `${what}${first.message}${suggestion ? ` (did you mean "${suggestion}"?)` : ''}`,
      { allowed, ...(suggestion ? { suggestion, example: example(suggestion) } : {}) },
    );
    return null;
  }
  if (ok.length < results.length) {
    const missing = results.filter(([, r]) => !r.ok).map(([s]) => scopeName(s));
    add(
      ctx,
      'mixed-record-types',
      at,
      `"${path}" isn't a field of ${missing.join(', ')}; those rows show "—"`,
    );
  }
  return { info: ok[0]![1].info, scope: ok[0]![0] };
}

const TEXTUAL = new Set(['text', 'id', 'option', 'reference', 'file']);
const NUMERIC = new Set(['number', 'meter']);
const DATELIKE = new Set(['date', 'datetime']);
const DATE = /^\d{4}-\d{2}-\d{2}/;

/** Problems with one value against a field: a bad "$" value, a wrong type, an unknown option. */
function valueProblem(
  ctx: Ctx,
  info: FieldInfo,
  value: Scalar,
  at: string,
  field: string,
  allowRangeOnText = false,
): boolean {
  if (typeof value === 'string' && value.startsWith('$')) {
    if (SPECIAL.has(value)) return false;
    if (relativeDate(value, '2000-01-01') !== undefined) {
      if (DATELIKE.has(info.kind)) return false;
      add(
        ctx,
        'operator-mismatch',
        at,
        `"${field}" is ${info.kind}, so the date ${value} can't match it`,
      );
      return true;
    }
    add(
      ctx,
      'bad-relative-date',
      at,
      `${value} isn't a value Pharos understands: use "$today", "$today+7d", "$today-2w", "$monthStart", "$monthStart+1m", "$yearStart", "$currentStage" or "$project"`,
      {
        allowed: [
          '$today',
          '$today+7d',
          '$today-2w',
          '$monthStart',
          '$monthStart+1m',
          '$yearStart',
          '$currentStage',
          '$project',
        ],
        ...(isDateToken(value) ? { suggestion: '$today' } : {}),
      },
    );
    return true;
  }
  const mismatch = (why: string, more: Partial<QueryFinding> = {}) => {
    add(ctx, 'operator-mismatch', at, `"${field}" is ${info.kind}: ${why}`, more);
    return true;
  };
  if (info.kind === 'money')
    return mismatch(`compare its amount instead, "${field}.amount" (in minor units, e.g. cents)`, {
      suggestion: `${field}.amount`,
    });
  if (NUMERIC.has(info.kind) && typeof value !== 'number')
    return mismatch(`${JSON.stringify(value)} isn't a number`);
  if (DATELIKE.has(info.kind) && !(typeof value === 'string' && DATE.test(value)))
    return mismatch(`${JSON.stringify(value)} isn't a date (YYYY-MM-DD or "$today+7d")`);
  if (info.kind === 'boolean' && typeof value !== 'boolean') return mismatch(`use true or false`);
  if (info.kind === 'option' && !allowRangeOnText) {
    const values = optionValues(ctx.project, info);
    if (values.length && !values.includes(String(value))) {
      const suggestion = closest(String(value), values);
      add(
        ctx,
        'unknown-option',
        at,
        `${JSON.stringify(value)} isn't one of the values of "${field}" (${values.join(', ')})${suggestion ? `; did you mean "${suggestion}"?` : ''}`,
        { allowed: values, ...(suggestion ? { suggestion } : {}) },
      );
      return true;
    }
  }
  return false;
}

function checkCondition(
  ctx: Ctx,
  info: FieldInfo,
  field: string,
  condition: Condition,
  at: string,
) {
  if (typeof condition !== 'object' || condition === null || Array.isArray(condition)) {
    const values = Array.isArray(condition) ? condition : [condition];
    values.forEach((v, i) =>
      valueProblem(ctx, info, v, Array.isArray(condition) ? `${at}[${i}]` : at, field),
    );
    return;
  }
  if ('exists' in condition) return;
  if ('not' in condition) {
    const values = Array.isArray(condition.not) ? condition.not : [condition.not];
    values.forEach((v, i) =>
      valueProblem(
        ctx,
        info,
        v,
        Array.isArray(condition.not) ? `${at}.not[${i}]` : `${at}.not`,
        field,
      ),
    );
    return;
  }
  if ('contains' in condition) {
    if (!TEXTUAL.has(info.kind) && !info.many)
      add(
        ctx,
        'operator-mismatch',
        `${at}.contains`,
        `"${field}" is ${info.kind}: contains only searches text`,
      );
    return;
  }
  // A range.
  if (info.many || info.kind === 'boolean' || info.kind === 'object') {
    add(
      ctx,
      'operator-mismatch',
      at,
      `"${field}" is ${info.many ? 'a list' : info.kind}: a range (gt, gte, lt, lte) can't compare it`,
    );
    return;
  }
  for (const op of ['gt', 'gte', 'lt', 'lte'] as const) {
    const bound = condition[op];
    if (bound === undefined) continue;
    if (info.kind === 'text' || info.kind === 'id') continue;
    if (valueProblem(ctx, info, bound, `${at}.${op}`, field)) return;
  }
}

function checkWhere(
  ctx: Ctx,
  scopes: FieldScope[],
  where: Where,
  at: string,
  wrap: (w: Where) => unknown,
) {
  for (const [field, condition] of Object.entries(where)) {
    const path = `${at}${key(field)}`;
    if (field === 'recordType' && scopes.some((s) => s.recordType)) continue; // checked in scopesOf
    const resolved = resolveIn(ctx, scopes, field, path, 'unknown-field', (fix) => {
      const copy: Where = {};
      for (const [k, v] of Object.entries(where)) copy[k === field ? fix : k] = v;
      return wrap(copy);
    });
    if (resolved) checkCondition(ctx, resolved.info, field, condition, path);
  }
}

/** A filter: where, anyOf and sort, in the given scopes. */
function checkFilter(
  ctx: Ctx,
  type: EntityType,
  filter: Filter | undefined,
  at: string,
): FieldScope[] {
  const scopes = scopesOf(ctx, type, filter, at);
  if (!filter) return scopes;
  if (filter.where)
    checkWhere(ctx, scopes, filter.where, `${at}.where`, (where) => ({ ...filter, where }));
  filter.anyOf?.forEach((w, i) =>
    checkWhere(ctx, scopes, w, `${at}.anyOf[${i}]`, (fixed) => ({
      ...filter,
      anyOf: filter.anyOf!.map((x, j) => (j === i ? fixed : x)),
    })),
  );
  if (filter.onePer) {
    const resolved = resolveIn(
      ctx,
      scopes,
      filter.onePer,
      `${at}.onePer`,
      'unknown-group-field',
      (fix) => ({ ...filter, onePer: fix }),
      'one per: ',
    );
    if (resolved?.info.unique)
      add(
        ctx,
        'group-by-unique',
        `${at}.onePer`,
        `"${filter.onePer}" is different on every row, so onePer keeps every row`,
      );
  }
  filter.sort?.forEach((s, i) => {
    const resolved = resolveIn(
      ctx,
      scopes,
      s.field,
      `${at}.sort[${i}].field`,
      'unknown-sort-field',
      (fix) => ({ sort: [{ ...s, field: fix }] }),
      'sort: ',
    );
    if (resolved?.info.many)
      add(
        ctx,
        'sort-by-list',
        `${at}.sort[${i}].field`,
        `"${s.field}" is a list; rows sorted by it come in no clear order`,
      );
  });
  return scopes;
}

function checkQuery(ctx: Ctx, query: Query | undefined, at: string): FieldScope[] {
  if (!query) return [];
  return checkFilter(ctx, query.type, query, at);
}

function checkGroup(ctx: Ctx, scopes: FieldScope[], by: string | undefined, at: string) {
  if (!by) return;
  const resolved = resolveIn(
    ctx,
    scopes,
    by,
    at,
    'unknown-group-field',
    (fix) => ({ by: fix }),
    'group by: ',
  );
  if (resolved?.info.unique)
    add(ctx, 'group-by-unique', at, `"${by}" is different on every row, so each bar would count 1`);
}

function checkSum(ctx: Ctx, scopes: FieldScope[], field: string | undefined, at: string) {
  if (!field) return;
  const resolved = resolveIn(ctx, scopes, field, at, 'unknown-sum-field', (fix) => fix, 'sum: ');
  if (resolved && !['number', 'meter', 'money'].includes(resolved.info.kind))
    add(
      ctx,
      'sum-not-number',
      at,
      `"${field}" is ${resolved.info.kind}, which can't be added up; sum a number, money or meter field`,
      {
        allowed: scopes.flatMap((s) => numericPaths(ctx, s)),
      },
    );
}

function numericPaths(ctx: Ctx, scope: FieldScope): string[] {
  if (!scope.recordType) return [];
  return scope.recordType.fields
    .filter((f) => ['number', 'meter', 'money'].includes(f.kind))
    .map((f) => `fields.${f.key}`);
}

function checkColumn(ctx: Ctx, scopes: FieldScope[], field: string, at: string) {
  resolveIn(ctx, scopes, field, at, 'unknown-column', (fix) => ({ field: fix }));
}

function checkNode(ctx: Ctx, node: ViewNode, at: string): void {
  switch (node.component) {
    case 'Grid':
    case 'Section':
      node.children.forEach((c, i) => checkNode(ctx, c, `${at}.children[${i}]`));
      return;
    case 'Tabs':
      node.tabs.forEach((t, i) =>
        t.children.forEach((c, j) => checkNode(ctx, c, `${at}.tabs[${i}].children[${j}]`)),
      );
      return;
    case 'StatCards':
      node.stats.forEach((s, i) => {
        checkQuery(ctx, s.query, `${at}.stats[${i}].query`);
        checkQuery(ctx, s.of, `${at}.stats[${i}].of`);
      });
      return;
    case 'ProgressRing':
      if (node.where)
        checkWhere(ctx, [{ type: 'task' }], node.where, `${at}.where`, (where) => ({ where }));
      return;
    case 'GoalTree':
      checkFilter(ctx, 'goal', node.filter, `${at}.filter`);
      return;
    case 'StageTracker':
    case 'Timeline':
    case 'MilestoneList':
      checkFilter(ctx, 'stage', node.filter, `${at}.filter`);
      return;
    case 'KanbanBoard':
    case 'TaskTable':
    case 'TaskChecklist':
    case 'DependencyGraph':
    case 'AssigneeMatrix':
      checkFilter(ctx, 'task', node.filter, `${at}.filter`);
      return;
    case 'ArtifactGallery':
      checkFilter(ctx, 'artifact', node.filter, `${at}.filter`);
      return;
    case 'DecisionLog':
      checkFilter(ctx, 'decision', node.filter, `${at}.filter`);
      return;
    case 'FileList':
      checkFilter(ctx, 'file', node.filter, `${at}.filter`);
      return;
    case 'Gallery':
      if (node.artifacts) checkFilter(ctx, 'artifact', node.artifacts, `${at}.artifacts`);
      if (node.files) checkFilter(ctx, 'file', node.files, `${at}.files`);
      return;
    case 'DataTable': {
      const scopes = checkQuery(ctx, node.query, `${at}.query`);
      node.columns.forEach((c, i) =>
        checkColumn(ctx, scopes, c.field, `${at}.columns[${i}].field`),
      );
      return;
    }
    case 'CountChart': {
      const scopes = checkQuery(ctx, node.query, `${at}.query`);
      checkGroup(ctx, scopes, node.by, `${at}.by`);
      checkSum(ctx, scopes, node.sum, `${at}.sum`);
      return;
    }
    case 'Stat': {
      const scopes = checkQuery(ctx, node.query, `${at}.query`);
      const ofScopes = checkQuery(ctx, node.of, `${at}.of`);
      checkSum(ctx, scopes, node.sum, `${at}.sum`);
      checkSum(ctx, scopes, node.target, `${at}.target`);
      if (node.of && node.sum) checkSum(ctx, ofScopes, node.sum, `${at}.sum`);
      return;
    }
    case 'DataList': {
      const scopes = checkQuery(ctx, node.query, `${at}.query`);
      node.secondary?.forEach((f, i) => checkColumn(ctx, scopes, f, `${at}.secondary[${i}]`));
      return;
    }
    case 'Text':
      for (const [name, v] of Object.entries(node.values ?? {})) {
        const p = `${at}.values${key(name)}`;
        if ('count' in v) checkQuery(ctx, v.count, `${p}.count`);
        if ('percent' in v) {
          checkQuery(ctx, v.percent.query, `${p}.percent.query`);
          checkQuery(ctx, v.percent.of, `${p}.percent.of`);
        }
        if ('bar' in v) {
          checkQuery(ctx, v.bar.query, `${p}.bar.query`);
          checkQuery(ctx, v.bar.of, `${p}.bar.of`);
        }
        if ('sum' in v) {
          const scopes = checkQuery(ctx, v.sum.query, `${p}.sum.query`);
          checkSum(ctx, scopes, v.sum.field, `${p}.sum.field`);
        }
      }
      return;
    case 'Layers':
      node.layers.forEach((l, i) => {
        if (l.items) checkFilter(ctx, 'claim', l.items, `${at}.layers[${i}].items`);
        if (l.progress)
          checkWhere(
            ctx,
            [{ type: 'task' }],
            l.progress,
            `${at}.layers[${i}].progress`,
            (where) => where,
          );
      });
      return;
    case 'FindingChart':
      if (node.bars) checkFilter(ctx, 'claim', node.bars, `${at}.bars`);
      if (node.count) {
        const scopes = checkQuery(ctx, node.count.query, `${at}.count.query`);
        checkGroup(ctx, scopes, node.count.by, `${at}.count.by`);
      }
      return;
    case 'DueTracker': {
      const scopes = checkQuery(ctx, node.query, `${at}.query`);
      node.show?.forEach((f, i) => checkColumn(ctx, scopes, f, `${at}.show[${i}]`));
      if (node.date) {
        const resolved = resolveIn(
          ctx,
          scopes,
          node.date,
          `${at}.date`,
          'unknown-field',
          (fix) => ({
            date: fix,
          }),
        );
        if (resolved && resolved.info.kind !== 'date')
          add(
            ctx,
            'operator-mismatch',
            `${at}.date`,
            `"${node.date}" is ${resolved.info.kind}: date needs a date field`,
          );
      }
      return;
    }
    case 'CategoryBreakdown': {
      const categories = checkQuery(ctx, node.categories, `${at}.categories`);
      checkSum(ctx, categories, node.planned, `${at}.planned`);
      const spent = checkQuery(ctx, node.spent.query, `${at}.spent.query`);
      resolveIn(
        ctx,
        spent,
        node.spent.by,
        `${at}.spent.by`,
        'unknown-group-field',
        (fix) => ({ by: fix }),
        'group by: ',
      );
      checkSum(ctx, spent, node.spent.sum, `${at}.spent.sum`);
      return;
    }
    default:
      return;
  }
}

/** Every query finding on a board, for a project (its options and record types). */
export function checkBoardQueries(board: Board, project: Entity<'project'> | null): QueryFinding[] {
  const out: QueryFinding[] = [];
  board.widgets.forEach((w, i) => {
    const ctx: Ctx = { project, recordTypes: recordTypesOf(project), widget: w.id, out };
    checkNode(ctx, w.node, `widgets[${i}].node`);
  });
  return out;
}

/** One finding as a line an agent can act on: path, message, allowed values and an example. */
export function formatFinding(f: QueryFinding): string {
  const allowed = f.allowed?.length
    ? ` Allowed: ${f.allowed.slice(0, 25).join(', ')}${f.allowed.length > 25 ? ', …' : ''}.`
    : '';
  const example = f.example !== undefined ? ` Example: ${JSON.stringify(f.example)}` : '';
  return `${f.path} (widget "${f.widget}"): ${f.message}.${allowed}${example}`;
}

/** A finding's identity, so an edit is refused only for findings it adds (not old ones). */
export function findingKey(f: QueryFinding): string {
  return `${f.widget}|${f.code}|${f.message}`;
}
