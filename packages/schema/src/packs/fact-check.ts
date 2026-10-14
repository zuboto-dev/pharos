import { z } from 'zod';
import { DUE_BANDS, Money, isMoney as isMoneyValue } from '../records.js';
import type { Board } from '../views/board.js';
import {
  categoryBreakdown,
  planBalance,
  chartBars,
  formatMoney,
  dueRows,
  statResult,
  sumRows,
  tableTotals,
  type Total,
} from '../views/blocks.js';
import type { NodeOf, ViewNode } from '../views/catalog.js';
import type { ProjectDataset } from '../views/query.js';
import { fieldReader, runQuery, type Resolved } from '../views/run-query.js';
import { findOption, optionKeyOf } from '../options.js';
import { findRecordType } from '../records.js';

/** The label an option value shows with, or undefined when the field has no options. */
function optionLabel(data: ProjectDataset, at: Resolved, value: string): string | undefined {
  if (at.type === 'record' && at.recordType) {
    const option = findRecordType(data.project, at.recordType)
      ?.fields.find((f) => `fields.${f.key}` === at.field)
      ?.options?.find((o) => o.value === value);
    if (option) return option.label;
  }
  const key = optionKeyOf(at.type, at.field);
  return key ? findOption(data.project, key, value)?.label : undefined;
}

/**
 * Fact checks (R8.3): what a pack page shows, worked out with the same functions the web app
 * renders from, compared with facts written by hand from the records. Prose with numbers that no
 * query backs is unverifiable, never passed.
 */

/** A count or plain number, or money as one amount per currency (never converted). */
export const Amount = z.union([z.number(), z.array(Money)]);
export type Amount = z.infer<typeof Amount>;

const base = { id: z.string().min(1), widget: z.string().min(1) };

export const Fact = z.discriminatedUnion('kind', [
  z.strictObject({
    ...base,
    kind: z.literal('text'),
    value: z.string().min(1).describe('Name of the Text value'),
    expect: Amount,
  }),
  z.strictObject({
    ...base,
    kind: z.literal('stat'),
    expect: Amount,
    target: Amount.optional(),
    percent: z.number().optional(),
  }),
  z.strictObject({ ...base, kind: z.literal('rows'), expect: z.number().int() }),
  z.strictObject({ ...base, kind: z.literal('total'), column: z.string(), expect: Amount }),
  z.strictObject({
    ...base,
    kind: z.literal('bar'),
    label: z.string(),
    expect: z.number(),
    currency: z.string().optional(),
  }),
  z.strictObject({
    ...base,
    kind: z.literal('due'),
    record: z.string().describe('Title of the record'),
    band: z.enum(DUE_BANDS),
    date: z.iso.date().optional(),
    meter: z.number().optional(),
  }),
  z
    .strictObject({
      ...base,
      kind: z.literal('cell'),
      row: z.number().int().min(0).describe('Row on the page, from 0, in the order shown'),
      column: z.string().describe('Field path of the column'),
      expect: z.union([z.string(), z.number()]),
    })
    .describe(
      'What one cell of a DataTable or DataList shows: a referenced record or file by its title, money formatted',
    ),
  z.strictObject({
    ...base,
    kind: z.literal('category'),
    category: z.string().describe('Its title, "Other" for spending with no category, or "Total"'),
    planned: Amount,
    spent: Amount,
    left: Money.optional().describe(
      'What "… left" (or "… over", below zero) says: the plan minus spending in its own currency (v0.2 A6)',
    ),
    notCounted: z
      .array(Money)
      .optional()
      .describe('Spending in other currencies than the plan, shown apart as not counted'),
  }),
]);
export type Fact = z.infer<typeof Fact>;

export type FactResult = { id: string; pass: boolean; expected: unknown; actual: unknown };
export type Unverifiable = { widget: string; text: string };
export type FactReport = {
  results: FactResult[];
  unverifiable: Unverifiable[];
  /** Every fact passed and no prose states a number nothing backs. */
  passed: boolean;
};

function asAmount(total: Total): Amount {
  return total.kind === 'number' ? total.value : total.amounts.map((a) => ({ ...a }));
}

/** Zero amounts drop out, so "€0.00" and 0 are the same; currencies are compared apart. */
function normal(a: Amount): number | Money[] {
  if (typeof a === 'number') return a;
  const kept = a
    .filter((m) => m.amount !== 0)
    .sort((p, q) => p.currency.localeCompare(q.currency))
    .map(({ amount, currency }) => ({ amount, currency }));
  return kept.length ? kept : 0;
}

function sameAmount(a: Amount, b: Amount): boolean {
  return JSON.stringify(normal(a)) === JSON.stringify(normal(b));
}

/** Every leaf node on a board, by widget id (containers flattened under their widget). */
function nodesOf(board: Board): Map<string, ViewNode> {
  const out = new Map<string, ViewNode>();
  for (const w of board.widgets) out.set(w.id, w.node);
  return out;
}

function evaluate(fact: Fact, node: ViewNode | undefined, data: ProjectDataset, today: string) {
  const ctx = { today };
  const miss = (why: string) => ({ actual: why, pass: false });
  if (!node) return miss('no such widget');
  switch (fact.kind) {
    case 'text': {
      if (node.component !== 'Text') return miss(`a ${node.component}, not a Text`);
      const v = node.values?.[fact.value];
      if (!v) return miss(`no value "${fact.value}"`);
      let actual: Amount;
      if ('count' in v) actual = runQuery(data, v.count.type, v.count, ctx).length;
      else if ('sum' in v)
        actual = asAmount(
          sumRows(
            data,
            runQuery(data, v.sum.query.type, v.sum.query, ctx),
            v.sum.field,
            ctx,
            v.sum.query,
          ),
        );
      else return miss('not a count or a sum');
      return { actual, pass: sameAmount(actual, fact.expect) };
    }
    case 'stat': {
      if (node.component !== 'Stat') return miss(`a ${node.component}, not a Stat`);
      const r = statResult(data, node, ctx);
      const actual = {
        value: typeof r.value === 'number' ? r.value : asAmount(r.value),
        ...(r.target ? { target: asAmount(r.target) } : {}),
        ...(r.percent !== undefined ? { percent: r.percent } : {}),
      };
      const pass =
        sameAmount(actual.value, fact.expect) &&
        (fact.target === undefined ||
          (actual.target !== undefined && sameAmount(actual.target, fact.target))) &&
        (fact.percent === undefined || actual.percent === fact.percent);
      return { actual, pass };
    }
    case 'rows': {
      const query =
        node.component === 'DataTable' || node.component === 'DataList' ? node.query : undefined;
      const n =
        node.component === 'DueTracker'
          ? dueRows(data, node, ctx).length
          : query
            ? runQuery(data, query.type, query, ctx).length
            : undefined;
      if (n === undefined) return miss(`a ${node.component} has no rows`);
      return { actual: n, pass: n === fact.expect };
    }
    case 'total': {
      if (node.component !== 'DataTable' || !node.total)
        return miss('not a DataTable with a total row');
      const t = tableTotals(data, node, ctx)[fact.column];
      if (!t) return miss(`no total under "${fact.column}"`);
      const actual = asAmount(t);
      return { actual, pass: sameAmount(actual, fact.expect) };
    }
    case 'bar': {
      if (node.component !== 'CountChart') return miss(`a ${node.component}, not a CountChart`);
      const bar = chartBars(data, node, ctx).find(
        (b) => (b.label === fact.label || b.key === fact.label) && b.currency === fact.currency,
      );
      if (!bar) return miss(`no bar "${fact.label}"`);
      return { actual: bar.value, pass: bar.value === fact.expect };
    }
    case 'due': {
      if (node.component !== 'DueTracker') return miss(`a ${node.component}, not a DueTracker`);
      const row = dueRows(data, node, ctx).find((r) => r.record.data.title === fact.record);
      if (!row?.due) return miss(`"${fact.record}" isn't on it, or isn't due`);
      const actual = { band: row.due.band, date: row.due.date, meter: row.due.meter };
      const pass =
        actual.band === fact.band &&
        (fact.date === undefined || actual.date === fact.date) &&
        (fact.meter === undefined || actual.meter === fact.meter);
      return { actual, pass };
    }
    case 'cell': {
      const query =
        node.component === 'DataTable' || node.component === 'DataList' ? node.query : undefined;
      if (!query) return miss(`a ${node.component} has no cells`);
      const row = runQuery(data, query.type, query, ctx)[fact.row];
      if (!row) return miss(`no row ${fact.row}`);
      const actual = cellText(data, row, fact.column, today);
      return { actual, pass: actual === fact.expect };
    }
    case 'category': {
      if (node.component !== 'CategoryBreakdown')
        return miss(`a ${node.component}, not a CategoryBreakdown`);
      const b = categoryBreakdown(data, node as NodeOf<'CategoryBreakdown'>, ctx);
      const row =
        fact.category === 'Total'
          ? { planned: b.planned, spent: b.spent }
          : b.rows.find((r) => r.label === fact.category);
      if (!row) return miss(`no category "${fact.category}"`);
      // "Left" and "not counted" as the row shows them (v0.2 A6): only the plan's currency counts.
      const balance = planBalance(row.planned, row.spent);
      const actual = {
        planned: asAmount(row.planned),
        spent: asAmount(row.spent),
        ...(fact.left !== undefined ? { left: balance?.left ?? null } : {}),
        ...(fact.notCounted !== undefined ? { notCounted: balance?.notCounted ?? [] } : {}),
      };
      const pass =
        sameAmount(actual.planned, fact.planned) &&
        sameAmount(actual.spent, fact.spent) &&
        (fact.left === undefined ||
          (!!balance &&
            balance.left.amount === fact.left.amount &&
            balance.left.currency === fact.left.currency)) &&
        (fact.notCounted === undefined || sameAmount(balance?.notCounted ?? [], fact.notCounted));
      return { actual, pass };
    }
  }
}

/** A cell as the reader reads it: a referenced record or file by its title, money formatted. */
export function cellText(
  data: ProjectDataset,
  row: { id: string; type: string; data: unknown },
  path: string,
  today: string,
): string | number | null {
  const at = fieldReader(data, { today })(row as never, path);
  const { value } = at;
  if (value === undefined || value === null) return null;
  if (isMoneyValue(value)) return formatMoney(value);
  if (typeof value === 'string') {
    // An option shows its label (v0.2 review, gap 10), as the page does.
    const label = optionLabel(data, at, value);
    if (label !== undefined) return label;
    const target = [...(data.records ?? []), ...data.files].find((e) => e.id === value);
    if (target) return target.data.title;
  }
  return typeof value === 'number' ? value : String(value);
}

/** Text a reader sees that no query backs: digits there can't be checked. */
function proseNumbers(board: Board): Unverifiable[] {
  const out: Unverifiable[] = [];
  const visit = (widget: string, node: ViewNode) => {
    const texts: string[] = [];
    if (node.component === 'Text') texts.push(node.content.replace(/\$\{\w+\}/g, ''));
    if (node.component === 'Markdown' && node.content) texts.push(node.content);
    if (node.component === 'Callout') texts.push(node.body);
    if (node.component === 'StartHere')
      texts.push(node.headline ?? '', node.why ?? '', node.yourPart ?? '');
    for (const text of texts) if (/\d/.test(text)) out.push({ widget, text });
    if (node.component === 'Grid' || node.component === 'Section')
      node.children.forEach((c) => visit(widget, c));
    if (node.component === 'Tabs')
      node.tabs.forEach((t) => t.children.forEach((c) => visit(widget, c)));
  };
  for (const w of board.widgets) visit(w.id, w.node);
  return out;
}

/** Checks every fact against what the page's blocks show for these records on `today`. */
export function checkFacts(
  board: Board,
  data: ProjectDataset,
  facts: Fact[],
  today: string,
): FactReport {
  const nodes = nodesOf(board);
  const results = facts.map((fact) => {
    const { actual, pass } = evaluate(fact, nodes.get(fact.widget), data, today);
    const expected: Record<string, unknown> = { ...fact };
    for (const key of ['id', 'widget', 'kind']) delete expected[key];
    return { id: fact.id, pass, expected, actual };
  });
  const unverifiable = proseNumbers(board);
  return { results, unverifiable, passed: results.every((r) => r.pass) && !unverifiable.length };
}
