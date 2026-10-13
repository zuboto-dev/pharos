import type { Entity } from '../entities.js';
import { findOption, optionKeyOf } from '../options.js';
import { DUE_BANDS, findRecordType, isMoney, type Money } from '../records.js';
import type { NodeOf } from './catalog.js';
import { localToday } from './dates.js';
import { dateDue, fileDue, type Due } from './due.js';
import type { ProjectDataset, Query } from './query.js';
import { dueOf, fieldReader, runQuery, type QueryContext, type Resolved } from './run-query.js';

/**
 * What the record blocks (R8) show, worked out once for everyone: the web app renders it, the
 * preview describes it and the fact checker compares it with the records. A number on a page
 * comes from here or it isn't checked.
 */

/** A sum: a number (with a unit), or money with one amount per currency (never converted). */
export type Total =
  { kind: 'number'; value: number; unit?: string } | { kind: 'money'; amounts: Money[] };

/** Digits after the decimal point for a currency (2 for EUR, 0 for KRW). */
export function currencyDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/** "€1,234.50", "$12.00", "₩15,000"; an amount in minor units. */
export function formatMoney(money: Money): string {
  const digits = currencyDigits(money.currency);
  const major = money.amount / 10 ** digits;
  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency: money.currency,
      currencyDisplay: 'narrowSymbol',
    }).format(major);
  } catch {
    return `${major.toFixed(digits)} ${money.currency}`;
  }
}

export function formatNumber(value: number, unit?: string): string {
  const text = value.toLocaleString('en', { maximumFractionDigits: 2 });
  return unit ? `${text} ${unit}` : text;
}

/** "€1,200 · $300": currencies shown apart. */
export function formatTotal(total: Total): string {
  if (total.kind === 'number') return formatNumber(total.value, total.unit);
  if (!total.amounts.length) return '0';
  return total.amounts.map(formatMoney).join(' · ');
}

/** The unit of a record number or meter field, for "12,400 km". */
function unitOf(data: ProjectDataset, at: Resolved): string | undefined {
  return fieldDef(data, at)?.unit;
}

/** The record field definition a value was read from, if any. */
function fieldDef(data: ProjectDataset, at: Resolved) {
  if (at.type !== 'record' || !at.recordType || !at.field.startsWith('fields.')) return undefined;
  return findRecordType(data.project, at.recordType)?.fields.find(
    (f) => `fields.${f.key}` === at.field,
  );
}

/**
 * What a sum over no rows reads as: zero in the field's currency or unit, found from the record
 * type the query names, so an empty month says "€0.00", not "0".
 */
function zeroFor(data: ProjectDataset, query: Query | undefined, path: string): Total {
  const c = query?.type === 'record' ? query.where?.recordType : undefined;
  const key = typeof c === 'string' ? c : Array.isArray(c) ? String(c[0]) : undefined;
  const def = key
    ? findRecordType(data.project, key)?.fields.find((f) => `fields.${f.key}` === path)
    : undefined;
  if (def?.kind === 'money' && def.currency)
    return { kind: 'money', amounts: [{ amount: 0, currency: def.currency }] };
  return { kind: 'number', value: 0, ...(def?.unit ? { unit: def.unit } : {}) };
}

/**
 * Adds a field up over rows: numbers to a number, money per currency. `query` (the rows' query)
 * tells an empty sum's currency or unit.
 */
export function sumRows(
  data: ProjectDataset,
  rows: Entity[],
  path: string,
  context: QueryContext = {},
  query?: Query,
): Total {
  const read = fieldReader(data, context);
  let value = 0;
  let unit: string | undefined;
  const money = new Map<string, number>();
  let sawMoney = false;
  let sawNumber = false;
  for (const row of rows) {
    const at = read(row, path);
    if (isMoney(at.value)) {
      sawMoney = true;
      money.set(at.value.currency, (money.get(at.value.currency) ?? 0) + at.value.amount);
    } else if (typeof at.value === 'number') {
      sawNumber = true;
      value += at.value;
      unit ??= unitOf(data, at);
    }
  }
  if (!sawMoney && !sawNumber) return zeroFor(data, query, path);
  if (sawMoney)
    return {
      kind: 'money',
      amounts: [...money]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([currency, amount]) => ({
          currency,
          amount,
        })),
    };
  return { kind: 'number', value: Math.round(value * 1e6) / 1e6, ...(unit ? { unit } : {}) };
}

/** The amount of one currency in a total (0 when it has none). */
export function amountIn(total: Total, currency: string): number {
  return total.kind === 'money'
    ? (total.amounts.find((a) => a.currency === currency)?.amount ?? 0)
    : 0;
}

function rows(data: ProjectDataset, query: Query, context: QueryContext): Entity[] {
  return runQuery(data, query.type, query, context);
}

// ------------------------------------------------------------------ Stat

export type StatResult = {
  /** What the big number says, e.g. "4", "25%", "€3,200". */
  text: string;
  /** The count, or the total when it sums. */
  value: number | Total;
  /** With `of` or `target`: the share, 0–100. */
  percent?: number;
  /** With `target`: the target's total. */
  target?: Total;
};

export function statResult(
  data: ProjectDataset,
  node: Pick<NodeOf<'Stat'>, 'query' | 'of' | 'sum' | 'target'>,
  context: QueryContext = {},
): StatResult {
  const matching = rows(data, node.query, context);
  if (!node.sum) {
    const n = matching.length;
    if (!node.of) return { text: String(n), value: n };
    const total = rows(data, node.of, context).length;
    const percent = total ? Math.round((n / total) * 100) : 0;
    return { text: `${percent}%`, value: n, percent };
  }
  const total = sumRows(data, matching, node.sum, context, node.query);
  const whole = node.target
    ? sumRows(data, matching, node.target, context, node.query)
    : node.of
      ? sumRows(data, rows(data, node.of, context), node.sum, context, node.of)
      : undefined;
  const percent = whole ? share(total, whole) : undefined;
  return {
    text: formatTotal(total),
    value: total,
    ...(percent !== undefined ? { percent } : {}),
    ...(node.target && whole ? { target: whole } : {}),
  };
}

/** A part as a share of a whole, 0–100; money compares like with like (the whole's currency). */
export function share(part: Total, whole: Total): number | undefined {
  if (part.kind === 'number' && whole.kind === 'number')
    return whole.value ? Math.round((part.value / whole.value) * 100) : undefined;
  if (part.kind === 'money' && whole.kind === 'money' && whole.amounts.length === 1) {
    const { currency, amount } = whole.amounts[0]!;
    return amount ? Math.round((amountIn(part, currency) / amount) * 100) : undefined;
  }
  return undefined;
}

// ------------------------------------------------------------------ DataTable total row

/** The total row: one total per number, money or meter column (others get none). */
export function tableTotals(
  data: ProjectDataset,
  node: Pick<NodeOf<'DataTable'>, 'query' | 'columns'>,
  context: QueryContext = {},
): Record<string, Total> {
  const matching = rows(data, node.query, context);
  const read = fieldReader(data, context);
  const out: Record<string, Total> = {};
  for (const { field } of node.columns) {
    const read0 = matching.map((r) => read(r, field));
    const summable = read0.some((at) => isMoney(at.value) || typeof at.value === 'number');
    // Order numbers aren't amounts, and meter readings (an odometer) add up to nothing.
    const meter = read0.some((at) => fieldDef(data, at)?.kind === 'meter');
    if (!summable || meter || field === 'order' || field.endsWith('.order')) continue;
    out[field] = sumRows(data, matching, field, context, node.query);
  }
  return out;
}

// ------------------------------------------------------------------ CountChart with sum / bucket

export type ChartBar = { key: string; label: string; value: number; currency?: string };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A bar's label: an option's label, a referenced item's name, a month or year, or the value. */
function barLabel(data: ProjectDataset, at: Resolved, key: string, bucket?: string): string {
  if (!key) return 'None';
  if (bucket === 'year') return key;
  if (bucket === 'month') return `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
  const optionKey = optionKeyOf(at.type, at.field);
  if (optionKey) return findOption(data.project, optionKey, key)?.label ?? key;
  if (at.type === 'record' && at.recordType) {
    const def = findRecordType(data.project, at.recordType)?.fields.find(
      (f) => `fields.${f.key}` === at.field,
    );
    const option = def?.options?.find((o) => o.value === key);
    if (option) return option.label;
  }
  const target = [...(data.records ?? []), ...data.stages, ...data.tasks, ...data.assignees].find(
    (e) => e.id === key,
  );
  if (target)
    return String(
      (target.data as Record<string, unknown>).title ??
        (target.data as Record<string, unknown>).name ??
        key,
    );
  return key;
}

/**
 * Bars for a CountChart that sums (`sum`) or buckets dates (`bucket`): one bar per group, and per
 * currency when money comes in several. Plain counting charts keep their own renderer.
 */
export function chartBars(
  data: ProjectDataset,
  node: Pick<NodeOf<'CountChart'>, 'query' | 'by' | 'sum' | 'bucket' | 'sort' | 'limit'>,
  context: QueryContext = {},
): ChartBar[] {
  const matching = rows(data, node.query, context);
  const read = fieldReader(data, context);
  const bars = new Map<string, ChartBar>();
  for (const row of matching) {
    const at = read(row, node.by);
    let key = at.value === undefined || at.value === null ? '' : String(at.value);
    if (key && node.bucket) key = node.bucket === 'year' ? key.slice(0, 4) : key.slice(0, 7);
    const amount = node.sum ? read(row, node.sum).value : 1;
    const currency = isMoney(amount) ? amount.currency : undefined;
    const value = isMoney(amount) ? amount.amount : typeof amount === 'number' ? amount : 0;
    const id = currency ? `${key}|${currency}` : key;
    const bar = bars.get(id);
    if (bar) bar.value += value;
    else
      bars.set(id, {
        key,
        label: barLabel(data, at, key, node.bucket),
        value,
        ...(currency ? { currency } : {}),
      });
  }
  let out = [...bars.values()];
  if (node.sort === 'count') out.sort((a, b) => b.value - a.value);
  else if (node.bucket)
    out.sort(
      (a, b) => (a.key === '' ? 1 : 0) - (b.key === '' ? 1 : 0) || a.key.localeCompare(b.key),
    );
  if (node.limit) out = out.slice(0, node.limit);
  // Money bars carry their currency in the label when there is more than one.
  const currencies = new Set(out.map((b) => b.currency).filter(Boolean));
  return out.map((bar) =>
    currencies.size > 1 && bar.currency ? { ...bar, label: `${bar.label} (${bar.currency})` } : bar,
  );
}

/** How a bar's value reads: money formatted in its currency, numbers with the field's unit. */
export function formatBar(bar: ChartBar, unit?: string): string {
  return bar.currency
    ? formatMoney({ amount: bar.value, currency: bar.currency })
    : formatNumber(bar.value, unit);
}

// ------------------------------------------------------------------ DueTracker

/**
 * One row of a DueTracker: a repeating record, or a file with an expiry date (R7.15), with when
 * it's due and the unit of the reading it counts ("km").
 */
export type DueRow = {
  record: Entity<'record'> | Entity<'file'>;
  due: Due | undefined;
  unit?: string;
};

/** The unit of the reading a repeating record counts, e.g. "km" (its meter field's unit). */
export function dueUnit(
  project: Entity<'project'> | null | undefined,
  record: Entity<'record'>,
): string | undefined {
  const path = record.data.interval?.meter?.from;
  if (!path) return undefined;
  const [, ref, , key] = path.split('.');
  const own = findRecordType(project, record.data.recordType);
  const via = own?.fields.find((f) => f.key === ref);
  const target = via?.kind === 'reference' && via.to ? findRecordType(project, via.to) : own;
  return target?.fields.find((f) => f.key === (key ?? ref))?.unit;
}

/**
 * Repeating records and expiring files, most urgent first (past due, very urgent, urgent, not
 * urgent), then by date.
 */
export function dueRows(
  data: ProjectDataset,
  node: Pick<NodeOf<'DueTracker'>, 'query' | 'bands' | 'limit' | 'date'>,
  context: QueryContext = {},
): DueRow[] {
  const today = context.today ?? localToday();
  const read = node.date ? fieldReader(data, context) : undefined;
  let out: DueRow[] = rows(data, node.query, context).flatMap((e): DueRow[] => {
    if (read && node.date && (e.type === 'record' || e.type === 'file')) {
      // A one-off date (R9), e.g. an exam: due on that day, in the bands repeating records use.
      const value = read(e, node.date).value;
      return [
        {
          record: e as Entity<'record'> | Entity<'file'>,
          due: typeof value === 'string' ? dateDue(value, today) : undefined,
        },
      ];
    }
    if (e.type === 'file') {
      const file = e as Entity<'file'>;
      return [{ record: file, due: fileDue(file.data.expiryDate, today) }];
    }
    if (e.type !== 'record') return [];
    const record = e as Entity<'record'>;
    const unit = dueUnit(data.project, record);
    return [{ record, due: dueOf(data, record, context), ...(unit ? { unit } : {}) }];
  });
  if (node.bands) out = out.filter((r) => r.due && node.bands!.includes(r.due.band));
  const rank = (r: DueRow) => (r.due ? DUE_BANDS.indexOf(r.due.band) : -1);
  out.sort(
    (a, b) =>
      rank(b) - rank(a) ||
      (a.due?.days ?? Infinity) - (b.due?.days ?? Infinity) ||
      (a.due?.left ?? Infinity) - (b.due?.left ?? Infinity),
  );
  return node.limit ? out.slice(0, node.limit) : out;
}

// ------------------------------------------------------------------ CategoryBreakdown

export type CategoryRow = {
  /** The category's id, or "" for spending without a category on the page. */
  id: string;
  label: string;
  planned: Total;
  spent: Total;
};

export type Breakdown = { rows: CategoryRow[]; planned: Total; spent: Total };

/** Planned against spent for each category, plus spending that fits none, and the totals. */
export function categoryBreakdown(
  data: ProjectDataset,
  node: Pick<NodeOf<'CategoryBreakdown'>, 'categories' | 'planned' | 'spent'>,
  context: QueryContext = {},
): Breakdown {
  const categories = rows(data, node.categories, context);
  const spending = rows(data, node.spent.query, context);
  const read = fieldReader(data, context);
  const byCategory = new Map<string, Entity[]>();
  for (const row of spending) {
    const value = read(row, node.spent.by).value;
    const key = typeof value === 'string' ? value : '';
    byCategory.set(key, [...(byCategory.get(key) ?? []), row]);
  }
  const out: CategoryRow[] = categories.map((c) => ({
    id: c.id,
    label: String((c.data as Record<string, unknown>).title ?? c.id),
    planned: sumRows(data, [c], node.planned, context, node.categories),
    spent: sumRows(data, byCategory.get(c.id) ?? [], node.spent.sum, context, node.spent.query),
  }));
  const known = new Set(categories.map((c) => c.id));
  const other = spending.filter((r) => {
    const v = read(r, node.spent.by).value;
    return !(typeof v === 'string' && known.has(v));
  });
  if (other.length)
    out.push({
      id: '',
      label: 'Other',
      planned: { kind: 'number', value: 0 },
      spent: sumRows(data, other, node.spent.sum, context, node.spent.query),
    });
  return {
    rows: out,
    planned: sumRows(data, categories, node.planned, context, node.categories),
    spent: sumRows(data, spending, node.spent.sum, context, node.spent.query),
  };
}
