import {
  ENTITIES,
  fieldReader,
  findOption,
  optionKeyOf,
  optionsFor,
  runQuery,
  type Entity,
  type EntityType,
  type NodeOf,
  type OptionColor,
  type Query,
} from '@pharos/schema';
import clsx from 'clsx';
import { useMemo, type ReactNode } from 'react';
import { formatDate, humanize } from '../../lib/format';
import { useViewData, type ViewData } from '../context';
import { Clickable, EntityRef, labelOf } from '../interactive';
import { OptionBadge } from '../options';
import { useMarkdownTerms } from '../terms';
import { DOT_TONES, Empty, Markdown, StatusBadge } from '../ui';

type Reader = ReturnType<typeof fieldReader>;

function useReader(): Reader {
  const data = useViewData();
  return useMemo(() => fieldReader(data), [data]);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T/;
const LONG_TEXT = new Set(['description', 'body', 'rationale', 'summary']);

/** "stage.name" → "Stage name", "assigneeId" → "Assignee", "dueDate" → "Due date". */
export function pathLabel(path: string): string {
  const words = path
    .split('.')
    .map((p) =>
      p
        .replace(/Id$/, '')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .toLowerCase(),
    )
    .join(' ');
  return humanize(words);
}

/** One field value, displayed the way the rest of Pharos shows it. */
function FieldValue({
  value,
  type,
  field,
}: {
  value: unknown;
  type: EntityType;
  field: string;
}): ReactNode {
  if (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && !value.length)
  ) {
    return <span className="text-neutral-300 dark:text-neutral-600">—</span>;
  }
  const optionKey = optionKeyOf(type, field);
  if (optionKey && typeof value === 'string')
    return <OptionBadge field={optionKey} value={value} />;
  if (type === 'project' && field === 'status' && typeof value === 'string')
    return <StatusBadge value={value} />;
  const ref = (ENTITIES[type].refs as Record<string, { many?: boolean } | undefined>)[field];
  if (ref) {
    const ids = Array.isArray(value) ? (value as string[]) : [value as string];
    return (
      <span className="flex flex-wrap gap-1">
        {ids.map((id) => (
          <EntityRef key={id} id={id} />
        ))}
      </span>
    );
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return <span className="tabular-nums">{value}</span>;
  if (typeof value === 'string' && DATE.test(value))
    return <span className="tabular-nums">{formatDate(value, true)}</span>;
  if (typeof value === 'string' && DATETIME.test(value))
    return <span className="tabular-nums">{formatDate(value.slice(0, 10), true)}</span>;
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (typeof value === 'string' && LONG_TEXT.has(field)) {
    return (
      <span className="line-clamp-2 text-neutral-500 dark:text-neutral-400">
        {value.replace(/[*_`#>]/g, '')}
      </span>
    );
  }
  return String(value);
}

export function DataTable({ node }: { node: NodeOf<'DataTable'> }) {
  const data = useViewData();
  const read = useReader();
  const rows = runQuery(data, node.query.type, node.query);
  if (!rows.length) return <Empty>Nothing matches</Empty>;
  const labelField = ENTITIES[node.query.type].label;
  return (
    <div className="-mx-4 -my-4 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-neutral-500 dark:text-neutral-400">
          <tr className="border-b border-neutral-100 dark:border-neutral-800">
            {node.columns.map((c) => (
              <th key={c.field} className="px-3 py-2 font-medium whitespace-nowrap first:pl-4">
                {c.label ?? pathLabel(c.field)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              onClick={(e) => {
                if (!(e.target as HTMLElement).closest('a, button'))
                  data.actions.open({ entity: row.id });
              }}
              className="cursor-pointer border-b border-neutral-100 last:border-0 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-800/40"
            >
              {node.columns.map((c) => {
                const { value, type, field } = read(row, c.field);
                return (
                  <td
                    key={c.field}
                    className={clsx('px-3 py-2 first:pl-4', field === labelField && 'font-medium')}
                  >
                    {/* The name keeps room to read; other columns (links to other items, long
                        text) shorten instead of squeezing it, so narrow tables stay balanced. */}
                    <div className={field === labelField ? 'min-w-40' : 'max-w-56'}>
                      <FieldValue value={value} type={type} field={field} />
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Bar = { key: string; label: ReactNode; count: number; color?: OptionColor; rank: number };

/** Groups rows by a field: option values keep their labels and colours, references their names. */
function groupCounts(rows: Entity[], by: string, read: Reader, data: ViewData): Bar[] {
  const bars = new Map<string, Bar>();
  for (const row of rows) {
    const { value, type, field } = read(row, by);
    const values = Array.isArray(value) ? value : [value];
    for (const v of values.length ? values : [undefined]) {
      const key = v === undefined || v === null || v === '' ? '' : String(v);
      const existing = bars.get(key);
      if (existing) {
        existing.count++;
        continue;
      }
      const optionKey = optionKeyOf(type, field);
      const option = optionKey && key ? findOption(data.project, optionKey, key) : undefined;
      const target = key ? data.entityById.get(key) : undefined;
      // Natural order: the project's option order, or the referenced item's own order.
      const rank =
        option && optionKey
          ? optionsFor(data.project, optionKey).findIndex((o) => o.value === key)
          : target
            ? ((target.data as { order?: number }).order ?? target.createdRev)
            : Infinity;
      bars.set(key, {
        key,
        label: !key
          ? 'None'
          : option
            ? option.label
            : target
              ? labelOf(target)
              : DATE.test(key)
                ? formatDate(key, true)
                : key,
        count: 1,
        color: option?.color,
        rank,
      });
    }
  }
  return [...bars.values()];
}

export function CountChart({ node }: { node: NodeOf<'CountChart'> }) {
  const data = useViewData();
  const read = useReader();
  const rows = runQuery(data, node.query.type, node.query);
  if (!rows.length) return <Empty>Nothing matches</Empty>;
  let bars = groupCounts(rows, node.by, read, data);
  bars.sort((a, b) =>
    node.sort === 'count'
      ? b.count - a.count
      : (a.key === '' ? 1 : 0) - (b.key === '' ? 1 : 0) ||
        a.rank - b.rank ||
        String(a.label).localeCompare(String(b.label)),
  );
  if (node.limit) bars = bars.slice(0, node.limit);
  const max = Math.max(...bars.map((b) => b.count));
  return (
    <ul className="space-y-2" aria-label={`Count by ${pathLabel(node.by)}`}>
      {bars.map((bar) => (
        <li
          key={bar.key}
          className="grid grid-cols-[minmax(4rem,9rem)_1fr_2rem] items-center gap-3 text-sm"
          title={`${bar.count}`}
        >
          <span className={clsx('truncate', !bar.key && 'text-neutral-400')}>{bar.label}</span>
          <span className="h-3 overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800">
            <span
              className={clsx(
                'block h-full rounded-full',
                bar.color ? DOT_TONES[bar.color] : 'bg-sky-500',
              )}
              style={{ width: `${(bar.count / max) * 100}%` }}
            />
          </span>
          <span className="text-right tabular-nums">{bar.count}</span>
        </li>
      ))}
    </ul>
  );
}

const STAT_TONES: Record<string, string> = {
  neutral: 'text-neutral-900 dark:text-neutral-100',
  good: 'text-emerald-600 dark:text-emerald-400',
  warning: 'text-amber-600 dark:text-amber-400',
  bad: 'text-rose-600 dark:text-rose-400',
};

function count(data: ViewData, query: Query): number {
  return runQuery(data, query.type, query).length;
}

function percent(data: ViewData, query: Query, of: Query): number {
  const total = count(data, of);
  return total ? Math.round((count(data, query) / total) * 100) : 0;
}

export function Stat({ node }: { node: NodeOf<'Stat'> }) {
  const data = useViewData();
  const n = count(data, node.query);
  const value = node.of ? `${percent(data, node.query, node.of)}%` : n;
  // A "bad" number that is zero is good news; don't paint it red.
  const tone = node.tone === 'bad' && n === 0 ? 'neutral' : (node.tone ?? 'neutral');
  return (
    <div className="flex h-full flex-col justify-between rounded-xl border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">{node.label}</div>
      <div className={clsx('mt-1 text-2xl font-semibold tabular-nums', STAT_TONES[tone])}>
        {value}
      </div>
      {node.caption && <div className="mt-0.5 text-xs text-neutral-400">{node.caption}</div>}
    </div>
  );
}

export function DataList({ node }: { node: NodeOf<'DataList'> }) {
  const data = useViewData();
  const read = useReader();
  const rows = runQuery(data, node.query.type, node.query);
  if (!rows.length) return <Empty>Nothing matches</Empty>;
  return (
    <ul className="-mx-2 space-y-0.5">
      {rows.map((row) => (
        <li key={row.id}>
          <Clickable
            id={row.id}
            className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
          >
            <span className="min-w-0 flex-1 truncate text-sm">{labelOf(row)}</span>
            {node.secondary?.map((path) => {
              const { value, type, field } = read(row, path);
              return (
                <span
                  key={path}
                  className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400"
                >
                  <FieldValue value={value} type={type} field={field} />
                </span>
              );
            })}
          </Clickable>
        </li>
      ))}
    </ul>
  );
}

function projectValue(
  data: ViewData,
  field: 'name' | 'summary' | 'status' | 'currentStage' | 'currentStageTarget',
): string {
  const stage = data.project.data.currentStageId
    ? data.stageById.get(data.project.data.currentStageId)
    : undefined;
  switch (field) {
    case 'name':
      return data.project.data.name;
    case 'summary':
      return data.project.data.summary ?? '';
    case 'status':
      return humanize(data.project.data.status);
    case 'currentStage':
      return stage?.data.name ?? 'no stage';
    case 'currentStageTarget':
      return stage?.data.targetDate ? formatDate(stage.data.targetDate) : 'no date';
  }
}

/** Fills ${name} placeholders from the node's values; unknown names stay visible so mistakes show. */
export function fillTemplate(node: NodeOf<'Text'>, data: ViewData): string {
  return node.content.replace(/\$\{(\w+)\}/g, (match, name: string) => {
    const v = node.values?.[name];
    if (!v) return match;
    if ('count' in v) return String(count(data, v.count));
    if ('percent' in v) return `${percent(data, v.percent.query, v.percent.of)}%`;
    return projectValue(data, v.project);
  });
}

export function TextBlock({ node }: { node: NodeOf<'Text'> }) {
  const data = useViewData();
  const terms = useMarkdownTerms(node.terms);
  return (
    <Markdown className="text-base!" {...terms}>
      {fillTemplate(node, data)}
    </Markdown>
  );
}
