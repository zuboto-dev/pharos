import {
  DUE_BAND_LABELS,
  amountIn,
  categoryBreakdown,
  dueOf,
  dueRows,
  dueUnit,
  fieldReader,
  findRecordType,
  formatMoney,
  formatNumber,
  formatTotal,
  isMoney,
  share,
  type Due,
  type DueBand,
  type Entity,
  type NodeOf,
  type Resolved,
  type Total,
} from '@pharos/schema';
import clsx from 'clsx';
import { useMemo, type ReactNode } from 'react';
import { PlayButton, isAudio } from '../../files/audio';
import { formatDate, plural } from '../../lib/format';
import { CHART } from '../chart';
import { useViewData, type ViewData } from '../context';
import { Clickable, EntityRef } from '../interactive';
import { RowAction } from './action';
import { Badge, Dot, Empty, type Tone } from '../ui';

/**
 * Blocks for a project's own records (R8): what's due, and planned against spent. Their numbers
 * come from @pharos/schema's block functions, the same ones the fact checker runs.
 */

export const BAND_TONES: Record<DueBand, Tone> = {
  past_due: 'red',
  very_urgent: 'amber',
  urgent: 'blue',
  not_urgent: 'muted',
};

/** A record field's value as people read it: money in its currency, km, option labels, links. */
export function RecordValue({ at, data }: { at: Resolved; data: ViewData }): ReactNode {
  const { value } = at;
  if (value === undefined || value === null || value === '')
    return <span className="text-faint">—</span>;
  if (isMoney(value))
    return <span className="whitespace-nowrap tabular-nums">{formatMoney(value)}</span>;
  if (at.field === 'due.band' && typeof value === 'string')
    return <Badge tone={BAND_TONES[value as DueBand]}>{DUE_BAND_LABELS[value as DueBand]}</Badge>;
  const def = at.recordType
    ? findRecordType(data.project, at.recordType)?.fields.find(
        (f) => `fields.${f.key}` === at.field,
      )
    : undefined;
  if (def?.kind === 'option') {
    const option = def.options?.find((o) => o.value === value);
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
        <Dot tone={option?.color ?? 'neutral'} />
        {option?.label ?? String(value)}
      </span>
    );
  }
  if (def?.kind === 'file' && typeof value === 'string') {
    const file = data.entityById.get(value) as Entity<'file'> | undefined;
    if (!file) return <span>—</span>;
    // A mix next to its song (R9): play it right here, the name opens the file.
    if (isAudio(file.data.path))
      return (
        <span className="inline-flex max-w-full min-w-0 items-center gap-1.5">
          <PlayButton fileId={file.id} title={file.data.title} />
          <EntityRef id={value} />
        </span>
      );
    return <EntityRef id={value} />;
  }
  if (def?.kind === 'reference' && typeof value === 'string')
    return data.entityById.has(value) ? <EntityRef id={value} /> : <span>—</span>;
  if (typeof value === 'number')
    return <span className="whitespace-nowrap tabular-nums">{formatNumber(value, def?.unit)}</span>;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))
    return <span className="whitespace-nowrap tabular-nums">{formatDate(value, true)}</span>;
  return String(value);
}

/** "Due 18 Oct · in 5 days", "35 days late", "550 km left". */
export function dueText(due: Due, unit?: string): string[] {
  const parts: string[] = [];
  if (due.date !== undefined && due.days !== undefined) {
    const when =
      due.days < 0
        ? `${plural(-due.days, 'day')} late`
        : due.days === 0
          ? 'today'
          : `in ${plural(due.days, 'day')}`;
    parts.push(`${formatDate(due.date, true)} · ${when}`);
  }
  if (due.left !== undefined) {
    parts.push(
      due.left < 0
        ? `${formatNumber(-due.left, unit)} over`
        : `${formatNumber(due.left, unit)} left`,
    );
  } else if (due.meter !== undefined) parts.push(`at ${formatNumber(due.meter, unit)}`);
  return parts;
}

export function DueTracker({ node }: { node: NodeOf<'DueTracker'> }) {
  const data = useViewData();
  const rows = useMemo(() => dueRows(data, node), [data, node]);
  const read = useMemo(() => fieldReader(data), [data]);
  if (!rows.length) return <Empty>Nothing is due</Empty>;
  return (
    <ul className="-mx-2 divide-y divide-line-soft">
      {rows.map(({ record, due, unit }) => {
        const file = record.type === 'file';
        return (
          <li key={record.id} className="flex items-center gap-2">
            <Clickable
              id={record.id}
              className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 rounded-control px-2 py-2 hover:bg-sunken"
            >
              <span className="w-24 shrink-0">
                {due ? (
                  <Badge tone={BAND_TONES[due.band]}>{DUE_BAND_LABELS[due.band]}</Badge>
                ) : (
                  <span className="text-xs text-faint">
                    {file ? 'No expiry date' : 'No schedule'}
                  </span>
                )}
              </span>
              <span className="min-w-[9rem] flex-1 truncate text-sm font-medium">
                {record.data.title}
              </span>
              {due && (
                <span
                  className={clsx(
                    'text-xs tabular-nums',
                    due.band === 'past_due' ? 'text-danger' : 'text-muted',
                  )}
                >
                  {file && due.date !== undefined && (due.days ?? 0) >= 0 ? 'Expires ' : ''}
                  {file && (due.days ?? 0) < 0 ? 'Expired ' : ''}
                  {dueText(due, unit).join(' · ')}
                </span>
              )}
              {node.show?.map((path) => (
                <span key={path} className="text-xs text-ink-soft">
                  <RecordValue at={read(record, path)} data={data} />
                </span>
              ))}
            </Clickable>
            {node.action && record.type === 'record' && (
              <RowAction actionId={node.action} recordId={record.id} title={record.data.title} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** A record in the detail drawer: its fields as its type names them, and when it's due. */
export function RecordDetails({
  record,
  history,
}: {
  record: Entity<'record'>;
  history: ReactNode;
}) {
  const data = useViewData();
  const read = useMemo(() => fieldReader(data), [data]);
  const type = findRecordType(data.project, record.data.recordType);
  const due = record.data.interval ? dueOf(data, record) : undefined;
  const unit = dueUnit(data.project, record);
  const every = record.data.interval?.every;
  const meter = record.data.interval?.meter;
  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs text-muted">{type?.name ?? record.data.recordType}</div>
        <h2 className="text-lg font-semibold">{record.data.title}</h2>
      </div>
      {due && (
        <div className="space-y-1 rounded-tile border border-line p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={BAND_TONES[due.band]}>{DUE_BAND_LABELS[due.band]}</Badge>
            <span className="tabular-nums">{dueText(due, unit).join(' · ')}</span>
          </div>
          <div className="text-xs text-muted">
            Every{' '}
            {[
              every && plural(every.n, every.unit.replace(/s$/, '')),
              meter && formatNumber(meter.n, unit),
            ]
              .filter(Boolean)
              .join(' or ')}
            {every && meter ? ', whichever comes first' : ''}
            {record.data.interval?.lastDate
              ? ` · last done ${formatDate(record.data.interval.lastDate, true)}`
              : ''}
          </div>
        </div>
      )}
      <dl className="divide-y divide-line-soft">
        {(type?.fields ?? []).map((f) => (
          <div key={f.key} className="grid grid-cols-[7rem_1fr] items-start gap-3 py-1.5 text-sm">
            <dt className="text-muted">{f.label}</dt>
            <dd className="min-w-0">
              <RecordValue at={read(record, `fields.${f.key}`)} data={data} />
            </dd>
          </div>
        ))}
      </dl>
      {record.data.notes && <p className="text-sm whitespace-pre-wrap">{record.data.notes}</p>}
      <section>
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">History</h3>
        {history}
      </section>
    </div>
  );
}

/** "€237.75 of €400.00", currencies apart: "$25.00 of €100.00". */
function amounts(total: Total): string {
  return formatTotal(total);
}

export function CategoryBreakdown({ node }: { node: NodeOf<'CategoryBreakdown'> }) {
  const data = useViewData();
  const b = useMemo(() => categoryBreakdown(data, node), [data, node]);
  if (!b.rows.length) return <Empty>No categories yet</Empty>;
  return (
    <div className="space-y-3">
      <ul className="space-y-2.5">
        {b.rows.map((row) => {
          const pct = share(row.spent, row.planned);
          // A target (R9, e.g. study hours) is reached, not overspent: past it is good news.
          const target = node.aim === 'target';
          const over = !target && pct !== undefined && pct > 100;
          const reached = target && pct !== undefined && pct >= 100;
          const togo =
            target && row.id && row.planned.kind === 'number' && row.spent.kind === 'number'
              ? row.planned.value - row.spent.value
              : undefined;
          const currency =
            row.planned.kind === 'money' ? row.planned.amounts[0]?.currency : undefined;
          const left =
            currency && row.planned.kind === 'money'
              ? row.planned.amounts[0]!.amount - amountIn(row.spent, currency)
              : undefined;
          const label = row.id ? (
            <Clickable id={row.id} className="truncate rounded-sm hover:underline">
              {row.label}
            </Clickable>
          ) : (
            <span className="truncate text-muted">{row.label}</span>
          );
          return (
            <li key={row.id || 'other'} className="text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 font-medium">{label}</span>
                <span className="shrink-0 text-xs text-ink-soft tabular-nums">
                  {amounts(row.spent)}
                  {row.id ? <span className="text-faint"> of {amounts(row.planned)}</span> : null}
                </span>
              </div>
              <div
                className={clsx('mt-1 h-2 overflow-hidden rounded-full', CHART.track)}
                role="meter"
                aria-label={`${row.label}: ${amounts(row.spent)} of ${amounts(row.planned)}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.min(100, pct ?? 0)}
              >
                <div
                  className={clsx(
                    'h-full rounded-full',
                    CHART.fill[over ? 'bad' : reached ? 'ok' : row.id ? 'highlight' : 'rest'],
                  )}
                  style={{ width: `${Math.min(100, pct ?? (row.id ? 0 : 100))}%` }}
                />
              </div>
              {togo !== undefined && row.planned.kind === 'number' && (
                <div
                  className={clsx(
                    'mt-0.5 text-xs tabular-nums',
                    reached ? 'text-ok' : 'text-faint',
                  )}
                >
                  {togo <= 0 ? 'Target reached' : `${formatNumber(togo, row.planned.unit)} to go`}
                </div>
              )}
              {!target && left !== undefined && currency && (
                <div
                  className={clsx(
                    'mt-0.5 text-xs tabular-nums',
                    left < 0 ? 'text-danger' : 'text-faint',
                  )}
                >
                  {left < 0
                    ? `${formatMoney({ amount: -left, currency })} over`
                    : `${formatMoney({ amount: left, currency })} left`}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex items-baseline justify-between border-t border-line-soft pt-2 text-sm">
        <span className="font-medium">Total</span>
        <span className="tabular-nums">
          {amounts(b.spent)} <span className="text-faint">of {amounts(b.planned)}</span>
        </span>
      </div>
    </div>
  );
}
