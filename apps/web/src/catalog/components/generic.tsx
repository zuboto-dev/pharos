import {
  ENTITIES,
  chartBars,
  fieldReader,
  formatBar,
  formatTotal,
  statResult,
  sumRows,
  tableTotals,
  type Resolved,
  findOption,
  findRecordType,
  optionKeyOf,
  optionsFor,
  runQuery,
  stripWorkCode,
  type Entity,
  type EntityType,
  type NodeOf,
  type OptionColor,
  type Query,
} from '@pharos/schema';
import clsx from 'clsx';
import { FileText } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import type { Components } from 'react-markdown';
import { glanceName } from '../../files/files';
import { formatDate, humanize } from '../../lib/format';
import { useViewData, type ViewData } from '../context';
import { Clickable, EntityRef, labelOf } from '../interactive';
import { OptionBadge } from '../options';
import { firstUses, TermText, useMarkdownTerms, useTermMatcher } from '../terms';
import { useOpenItem } from '../open-item';
import { NothingMatches } from '../empty-state';
import { ScrollX } from '../scroll-x';
import { DOT_TONES, ProgressBar, isHttp, Markdown, StatusBadge, Uri } from '../ui';
import { linkedFileOf } from '../source-file';
import { FileTypeIcon } from './file-list';
import { Bar, CHART } from '../chart';
import { MiniBar } from './overview';
import { RecordValue } from './records';

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
        .replace(/Ids$/, 's')
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
  ownerId,
  at,
}: {
  value: unknown;
  type: EntityType;
  field: string;
  /** The item the value belongs to, when it is the row itself (an artifact's `uri` opens it). */
  ownerId?: string;
  /** Where the value was read (records format their fields from the record type, R8). */
  at?: Resolved;
}): ReactNode {
  const data = useViewData();
  if (type === 'record' && at) return <RecordValue at={at} data={data} />;
  if (
    value === undefined ||
    value === null ||
    value === '' ||
    (Array.isArray(value) && !value.length)
  ) {
    return <span className="text-faint">—</span>;
  }
  const optionKey = optionKeyOf(type, field);
  if (optionKey && typeof value === 'string')
    return <OptionBadge field={optionKey} value={value} />;
  if (type === 'project' && field === 'status' && typeof value === 'string')
    return <StatusBadge value={value} />;
  // An artifact's address opens like the artifact (R7.12): a web page in a new tab, a document
  // in the FileView or drawer, or the panel saying which folder it needs.
  // At a glance (v0.2 B2): the document's icon and name, never its folders or host.
  if (type === 'artifact' && field === 'uri' && typeof value === 'string')
    return ownerId && !isHttp(value) ? (
      <UriButton id={ownerId} uri={value} />
    ) : (
      <Uri uri={value} className="max-w-[9rem] sm:max-w-[18rem]" />
    );
  // A file's path is where it is on disk: the name is enough here, the rest is in its details.
  if (type === 'file' && field === 'path' && typeof value === 'string')
    return (
      <span className="inline-flex max-w-[9rem] min-w-0 items-center gap-1 sm:max-w-[18rem]">
        <FileTypeIcon path={value} className="size-3.5 text-neutral-400" />
        <span className="truncate">{glanceName(value)}</span>
      </span>
    );
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
    return <span className="line-clamp-2 text-muted">{value.replace(/[*_`#>]/g, '')}</span>;
  }
  return String(value);
}

/**
 * A local document that opens like its artifact, at a glance (v0.2 B2): the project file's icon
 * and title when the source is one, else the file name. Where it is shows in its details.
 */
function UriButton({ id, uri }: { id: string; uri: string }) {
  const open = useOpenItem();
  const { entityById } = useViewData();
  const artifact = entityById.get(id) as Entity<'artifact'> | undefined;
  const fileId = artifact ? linkedFileOf(entityById, artifact) : undefined;
  const file = fileId ? (entityById.get(fileId) as Entity<'file'>) : undefined;
  const name = file?.data.title ?? glanceName(uri);
  return (
    <button
      type="button"
      title={`Open “${name}”`}
      onClick={(e) => {
        e.stopPropagation();
        open(id);
      }}
      className="inline-flex max-w-[9rem] min-w-0 items-center gap-1 text-left text-xs text-accent-strong hover:underline focus-visible:outline-2 focus-visible:outline-sky-400 sm:max-w-[18rem]"
    >
      {file ? (
        <FileTypeIcon path={file.data.path} className="size-3" />
      ) : (
        <FileText className="size-3 shrink-0" aria-hidden />
      )}
      <span className="truncate">{name}</span>
    </button>
  );
}

export function DataTable({ node }: { node: NodeOf<'DataTable'> }) {
  const data = useViewData();
  const read = useReader();
  const openItem = useOpenItem();
  const rows = runQuery(data, node.query.type, node.query);
  if (!rows.length) return <NothingMatches type={node.query.type} />;
  const labelField = ENTITIES[node.query.type].label;
  // A ledger (R8): totals under number, money and meter columns, money per currency.
  const totals = node.total ? tableTotals(data, node) : undefined;
  return (
    <ScrollX label={node.title ?? 'Table'} className="-mx-4 -my-4">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-muted">
          <tr className="border-b border-line-soft">
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
                if (!(e.target as HTMLElement).closest('a, button')) openItem(row.id);
              }}
              className="cursor-pointer border-b border-line-soft last:border-0 hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
            >
              {node.columns.map((c) => {
                const at = read(row, c.field);
                const { value, type, field } = at;
                return (
                  <td
                    key={c.field}
                    className={clsx('px-3 py-2 first:pl-4', field === labelField && 'font-medium')}
                  >
                    {/* The name keeps room to read; other columns (links to other items, long
                        text) shorten instead of squeezing it, so narrow tables stay balanced. */}
                    <div className={field === labelField ? 'min-w-40' : 'max-w-56'}>
                      <FieldValue
                        value={value}
                        type={type}
                        field={field}
                        at={at}
                        ownerId={c.field.includes('.') ? undefined : row.id}
                      />
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        {totals && (
          <tfoot>
            <tr className="border-t border-line-strong font-medium">
              {node.columns.map((c, i) => (
                <td key={c.field} className="px-3 py-2 tabular-nums first:pl-4">
                  {totals[c.field] ? formatTotal(totals[c.field]!) : i === 0 ? 'Total' : ''}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </ScrollX>
  );
}

type Bar = { key: string; label: ReactNode; count: number; color?: OptionColor; rank: number };

/** Groups rows by a field: option values keep their labels and colours, references their names. */
function groupCounts(rows: Entity[], by: string, read: Reader, data: ViewData): Bar[] {
  const bars = new Map<string, Bar>();
  for (const row of rows) {
    const { value, type, field, recordType } = read(row, by);
    // A record's own option field (R9: songs by stage) keeps its labels, colours and order.
    const recordOptions =
      type === 'record' && recordType
        ? findRecordType(data.project, recordType)?.fields.find((f) => `fields.${f.key}` === field)
            ?.options
        : undefined;
    const values = Array.isArray(value) ? value : [value];
    for (const v of values.length ? values : [undefined]) {
      const key = v === undefined || v === null || v === '' ? '' : String(v);
      const existing = bars.get(key);
      if (existing) {
        existing.count++;
        continue;
      }
      const optionKey = optionKeyOf(type, field);
      const recordIndex = recordOptions ? recordOptions.findIndex((o) => o.value === key) : -1;
      const option =
        recordIndex >= 0
          ? recordOptions![recordIndex]
          : optionKey && key
            ? findOption(data.project, optionKey, key)
            : undefined;
      const target = key ? data.entityById.get(key) : undefined;
      // Natural order: the project's option order, or the referenced item's own order.
      const rank =
        recordIndex >= 0
          ? recordIndex
          : option && optionKey
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

/** CountChart adding up a field (`sum`) or by month or year (`bucket`), R8. */
function SumChart({ node }: { node: NodeOf<'CountChart'> }) {
  const data = useViewData();
  const bars = chartBars(data, node);
  if (!bars.length) return <NothingMatches type={node.query.type} />;
  const max = Math.max(...bars.map((b) => Math.abs(b.value)), 1);
  return (
    <ul
      className="space-y-2"
      aria-label={`${node.sum ? 'Total' : 'Count'} by ${pathLabel(node.by)}`}
    >
      {bars.map((bar) => (
        <li
          key={`${bar.key}|${bar.currency ?? ''}`}
          className="grid grid-cols-[minmax(3rem,7rem)_1fr_auto] items-center gap-3 text-sm"
        >
          <span className={clsx('truncate', !bar.key && 'text-neutral-400')}>{bar.label}</span>
          <span className="h-3 overflow-hidden rounded-full bg-subtle">
            <span
              className="block h-full rounded-full bg-sky-500"
              style={{ width: `${(Math.abs(bar.value) / max) * 100}%` }}
            />
          </span>
          <span className="text-right tabular-nums">{formatBar(bar)}</span>
        </li>
      ))}
    </ul>
  );
}

export function CountChart({ node }: { node: NodeOf<'CountChart'> }) {
  const data = useViewData();
  const read = useReader();
  const rows = runQuery(data, node.query.type, node.query);
  if (node.sum || node.bucket) return <SumChart node={node} />;
  if (!rows.length) return <NothingMatches type={node.query.type} />;
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
          <span className={clsx('truncate', bar.key ? CHART.label.plain : 'text-sm text-faint')}>
            {bar.label}
          </span>
          <Bar
            size="count"
            share={bar.count / max}
            fill={bar.color ? DOT_TONES[bar.color] : undefined}
          />
          <span className={clsx('text-right', CHART.value.plain)}>{bar.count}</span>
        </li>
      ))}
    </ul>
  );
}

const STAT_TONES: Record<string, string> = {
  neutral: 'text-ink',
  good: 'text-ok',
  warning: 'text-warn',
  bad: 'text-danger',
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
  // Counts, shares and sums (R8: money per currency, a target with a bar) come from one place.
  const r = statResult(data, node);
  const n = typeof r.value === 'number' ? r.value : 1;
  // A "bad" number that is zero is good news; don't paint it red.
  const tone = node.tone === 'bad' && n === 0 ? 'neutral' : (node.tone ?? 'neutral');
  return (
    <div className="flex h-full flex-col justify-between rounded-block border border-line bg-surface px-4 py-3">
      <div className={CHART.figureLabel}>{node.label}</div>
      <div className={clsx('mt-1', CHART.figure, STAT_TONES[tone])}>{r.text}</div>
      {r.target && (
        <div className="mt-1 space-y-1">
          <div className={clsx('text-xs', CHART.value.rest)}>
            of {formatTotal(r.target)}
            {r.percent !== undefined ? ` · ${r.percent}%` : ''}
          </div>
          <ProgressBar value={r.percent ?? 0} />
        </div>
      )}
      {node.caption && <div className="mt-0.5 text-xs text-faint">{node.caption}</div>}
    </div>
  );
}

export function DataList({ node }: { node: NodeOf<'DataList'> }) {
  const data = useViewData();
  const read = useReader();
  const rows = runQuery(data, node.query.type, node.query);
  // F6: labels without their work codes when asked; terms in rows only when asked.
  const labels = rows.map((row) => (node.hideCodes ? stripWorkCode(labelOf(row)) : labelOf(row)));
  const termRanges = firstUses(labels, useTermMatcher(node.terms ?? false));
  if (!rows.length) return <NothingMatches type={node.query.type} />;
  return (
    <ul className="-mx-2 space-y-0.5">
      {rows.map((row, i) => (
        <li key={row.id}>
          <Clickable
            id={row.id}
            className="flex items-center gap-3 rounded-control px-2 py-1.5 hover:bg-sunken"
          >
            <span className="min-w-0 flex-1 truncate text-sm">
              <TermText text={labels[i]!} ranges={termRanges[i]} />
            </span>
            {node.secondary?.map((path) => {
              const at = read(row, path);
              const { value, type, field } = at;
              return (
                <span key={path} className="shrink-0 text-xs text-muted">
                  <FieldValue
                    value={value}
                    type={type}
                    field={field}
                    at={at}
                    ownerId={path.includes('.') ? undefined : row.id}
                  />
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

/**
 * A `{bar}` value goes into the Markdown as a link to this fragment, e.g. `[2 of 9](#pharos-bar-2-9)`,
 * which `TextBlock` draws as a word-sized bar beside its "2 of 9".
 */
const BAR_HREF = /^#pharos-bar-(\d+)-(\d+)$/;

/** Fills ${name} placeholders from the node's values; unknown names stay visible so mistakes show. */
export function fillTemplate(node: NodeOf<'Text'>, data: ViewData): string {
  return node.content.replace(/\$\{(\w+)\}/g, (match, name: string) => {
    const v = node.values?.[name];
    if (!v) return match;
    if ('count' in v) return String(count(data, v.count));
    if ('percent' in v) return `${percent(data, v.percent.query, v.percent.of)}%`;
    if ('bar' in v) {
      const [n, total] = [count(data, v.bar.query), count(data, v.bar.of)];
      return `[${n} of ${total}](#pharos-bar-${n}-${total})`;
    }
    if ('sum' in v) {
      const rows = runQuery(data, v.sum.query.type, v.sum.query);
      return formatTotal(sumRows(data, rows, v.sum.field, {}, v.sum.query));
    }
    return projectValue(data, v.project);
  });
}

/** "2 of 9" with a word-sized bar before it; the words are the bar's text equivalent. */
function InlineBar({ value, total }: { value: number; total: number }) {
  return (
    <span data-inline-bar="" className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <MiniBar value={value} total={total} className="w-10 sm:w-12" />
      <span className="tabular-nums">
        {value} of {total}
      </span>
    </span>
  );
}

const TEXT_COMPONENTS: Components = {
  a: ({ href, title, children }) => {
    const bar = href ? BAR_HREF.exec(href) : null;
    if (bar) return <InlineBar value={Number(bar[1])} total={Number(bar[2])} />;
    return (
      <a href={href} title={title}>
        {children}
      </a>
    );
  },
};

export function TextBlock({ node }: { node: NodeOf<'Text'> }) {
  const data = useViewData();
  const terms = useMarkdownTerms(node.terms);
  const components = useMemo(() => ({ ...terms.components, ...TEXT_COMPONENTS }), [terms]);
  return (
    <Markdown className="text-base!" remarkPlugins={terms.remarkPlugins} components={components}>
      {fillTemplate(node, data)}
    </Markdown>
  );
}
