import {
  ENTITIES,
  UPDATE_KINDS,
  type UpdateCounts,
  type UpdateEntity,
  type UpdateField,
  type UpdateKind,
  type UpdateOption,
  type UpdateSession,
  type Updates,
  type UpdatesBucket,
} from '@pharos/schema';
import clsx from 'clsx';
import {
  Activity,
  ArrowRight,
  Bot,
  ChevronDown,
  ChevronRight,
  Eye,
  Minus,
  Pencil,
  Plus,
  Search,
  User,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { Link, NavLink, useSearchParams } from 'react-router';
import { Menu, MenuItem } from '../catalog/menu';
import { Tooltip } from '../catalog/tooltip';
import { Badge, type Tone } from '../catalog/ui';
import { getJson, useResource } from '../lib/api';
import { useRevisionEvents } from '../lib/events';
import { humanize, plural } from '../lib/format';
import { LoadError } from './onboarding';

// The Updates page (decision "Updates view: Pharos draws it", 2026-10-23): what changed, was
// added, removed and looked up, drawn by Pharos from its own history. Pictures first: four tiles
// with a week's sparkline, a timeline of when work happened, then one card per work session
// (one author in one project) whose rows open to before → after.

/** One colour per kind, the same in every chart, tile and chip (validated for colour blindness). */
export const KIND = {
  added: {
    name: 'Added',
    icon: Plus,
    fill: 'fill-emerald-500',
    bg: 'bg-emerald-500',
    text: 'text-emerald-700 dark:text-emerald-300',
  },
  changed: {
    name: 'Changed',
    icon: Pencil,
    fill: 'fill-sky-500',
    bg: 'bg-sky-500',
    text: 'text-sky-700 dark:text-sky-300',
  },
  removed: {
    name: 'Removed',
    icon: Minus,
    fill: 'fill-rose-500',
    bg: 'bg-rose-500',
    text: 'text-rose-700 dark:text-rose-300',
  },
  lookedUp: {
    name: 'Looked up',
    icon: Eye,
    fill: 'fill-violet-500',
    bg: 'bg-violet-500',
    text: 'text-violet-700 dark:text-violet-300',
  },
} satisfies Record<
  UpdateKind,
  { name: string; icon: LucideIcon; fill: string; bg: string; text: string }
>;

const OP_KIND = { create: 'added', update: 'changed', delete: 'removed' } as const;

const CONTROL =
  'inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-muted hover:bg-sunken';

const sum = (c: Partial<UpdateCounts>, kinds: readonly UpdateKind[]) =>
  kinds.reduce((n, k) => n + (c[k] ?? 0), 0);

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});
const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const hourFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  hour: 'numeric',
});

/** "Today", "Yesterday", "Mon, Oct 19". */
export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return dayFormat.format(d);
}

/** "14:05–14:40 · 35 min", or one time for a moment. */
export function span(start: string, end: string): string {
  const a = Date.parse(start);
  const b = Date.parse(end);
  const minutes = Math.round((b - a) / 60_000);
  if (minutes < 1) return timeFormat.format(a);
  const length =
    minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  return `${timeFormat.format(a)}–${timeFormat.format(b)} · ${length.replace(' 0 min', '')}`;
}

/**
 * The changed words of a text: shared start and end kept as short context, the rest marked.
 * "Plant the beans" → "Plant the peas": { lead: "Plant the ", before: "beans", after: "peas" }.
 */
export function textDiff(before: string, after: string, context = 18) {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  )
    end++;
  // Whole words: the marked part starts and ends at a space.
  const space = (c: string | undefined) => c === undefined || /\s/.test(c);
  while (start > 0 && !space(before[start - 1])) start--;
  while (end > 0 && !space(before[before.length - end]) && !space(before[before.length - end - 1]))
    end--;
  const lead = before.slice(0, start);
  const tail = before.slice(before.length - end);
  return {
    lead: lead.length > context ? `…${lead.slice(-context)}` : lead,
    before: before.slice(start, before.length - end),
    after: after.slice(start, after.length - end),
    tail: tail.length > context ? `${tail.slice(0, context)}…` : tail,
  };
}

/** A value as one short line. */
export function valueText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.length ? value.map(valueText).join(', ') : '—';
  const summary = value as { $summary?: string; size?: number };
  if (summary.$summary === 'list') return plural(summary.size ?? 0, 'item');
  if (summary.$summary) return 'details';
  return JSON.stringify(value);
}

/** "dueDate" → "Due date". */
export const fieldName = (field: string) =>
  humanize(field.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());

/** Fields not worth a row: bookkeeping the owner never set. */
const QUIET_FIELDS = new Set(['order', 'evidenceRevision', 'projectId']);
const FIELDS_SHOWN = 3;

// ------------------------------------------------------------------ small pictures

/** Seven small bars, today's the strongest. */
function Sparkline({ days, kind }: { days: UpdatesBucket[]; kind: UpdateKind }) {
  const max = Math.max(1, ...days.map((d) => d[kind]));
  const w = 8;
  const gap = 3;
  return (
    <svg
      viewBox={`0 0 ${days.length * (w + gap) - gap} 24`}
      className="h-6 w-20"
      role="img"
      aria-label={`${KIND[kind].name} per day: ${days.map((d) => d[kind]).join(', ')}`}
    >
      {days.map((d, i) => {
        const h = d[kind] ? Math.max(2, (d[kind] / max) * 24) : 1;
        return (
          <rect
            key={d.at}
            x={i * (w + gap)}
            y={24 - h}
            width={w}
            height={h}
            rx={1.5}
            className={clsx(
              d[kind] ? KIND[kind].fill : 'fill-chart-track',
              i < days.length - 1 && d[kind] && 'opacity-55',
            )}
          >
            <title>{`${weekdayFormat.format(new Date(d.at))}: ${d[kind]}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

function Tiles({ data, kinds }: { data: Updates; kinds: readonly UpdateKind[] }) {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Last 24 hours">
      {UPDATE_KINDS.map((kind) => {
        const Icon = KIND[kind].icon;
        const week = data.days.reduce((n, d) => n + d[kind], 0);
        return (
          <li
            key={kind}
            data-tile={kind}
            className={clsx(
              'rounded-block border border-line bg-surface px-3 py-2.5 transition',
              !kinds.includes(kind) && 'opacity-40',
            )}
          >
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <span className={clsx('size-2 rounded-full', KIND[kind].bg)} aria-hidden />
              <Icon aria-hidden className="size-3" />
              {KIND[kind].name}
            </div>
            <div className="mt-1 flex items-end justify-between gap-2">
              <Tooltip label={`${data.last24h[kind]} in 24 h`} detail={`${week} this week`}>
                <span
                  tabIndex={0}
                  className="text-2xl leading-none font-semibold text-ink tabular-nums"
                >
                  {data.last24h[kind]}
                </span>
              </Tooltip>
              <Sparkline days={data.days} kind={kind} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Wider than a phone: the timeline has room for an hour per bar. */
function useWide(): boolean {
  const query = '(min-width: 640px)';
  const [wide, setWide] = useState(() => window.matchMedia?.(query).matches ?? true);
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return;
    const change = () => setWide(list.matches);
    list.addEventListener('change', change);
    return () => list.removeEventListener('change', change);
  }, []);
  return wide;
}

/** Hours merged into bins of `size` (the last bin may be shorter). */
export function binHours(hours: UpdatesBucket[], size: number): UpdatesBucket[] {
  const out: UpdatesBucket[] = [];
  for (let i = 0; i < hours.length; i += size) {
    const part = hours.slice(i, i + size);
    const bin: UpdatesBucket = { at: part[0]!.at, added: 0, changed: 0, removed: 0, lookedUp: 0 };
    for (const h of part) for (const k of UPDATE_KINDS) bin[k] += h[k];
    out.push(bin);
  }
  return out;
}

/** When work happened over the week: stacked bars by kind, a tooltip per bar. */
function Timeline({ data, kinds }: { data: Updates; kinds: readonly UpdateKind[] }) {
  const wide = useWide();
  const size = wide ? 2 : 6;
  const bins = useMemo(() => binHours(data.hours, size), [data.hours, size]);
  const [hover, setHover] = useState<number | null>(null);
  const H = 88;
  const bw = 10;
  const gap = wide ? 2 : 3;
  const W = bins.length * (bw + gap);
  const max = Math.max(1, ...bins.map((b) => sum(b, kinds)));
  const dayStarts = bins
    .map((b, i) => ({ i, d: new Date(b.at) }))
    .filter(({ d }, idx) => idx === 0 || d.getHours() < size);
  const shown = hover !== null ? bins[hover] : null;
  return (
    <section aria-label="When work happened" className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">This week</h2>
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted" aria-label="Legend">
          {kinds.map((k) => (
            <li key={k} className="flex items-center gap-1">
              <span aria-hidden className={clsx('size-2 rounded-sm', KIND[k].bg)} />
              {KIND[k].name}
            </li>
          ))}
        </ul>
        <span className="ml-auto min-h-4 text-xs text-ink-soft tabular-nums" aria-live="polite">
          {shown &&
            `${hourFormat.format(new Date(shown.at))}: ${
              kinds
                .filter((k) => shown[k])
                .map((k) => `${shown[k]} ${KIND[k].name.toLowerCase()}`)
                .join(' · ') || 'nothing'
            }`}
        </span>
      </div>
      <div className="rounded-block border border-line bg-surface px-3 pt-3 pb-1">
        <svg
          viewBox={`0 0 ${W} ${H + 16}`}
          preserveAspectRatio="none"
          className="h-28 w-full"
          role="img"
          aria-label={`Work per ${size} hours over the last week`}
          onMouseLeave={() => setHover(null)}
        >
          <line x1={0} x2={W} y1={H + 0.5} y2={H + 0.5} className="stroke-chart-axis" />
          {dayStarts.map(({ i }) => (
            <g key={i}>
              {i > 0 && (
                <line
                  x1={i * (bw + gap) - gap / 2}
                  x2={i * (bw + gap) - gap / 2}
                  y1={0}
                  y2={H}
                  className="stroke-chart-grid"
                  strokeDasharray="2 3"
                />
              )}
            </g>
          ))}
          {bins.map((b, i) => {
            let y = H;
            const total = sum(b, kinds);
            return (
              <g
                key={b.at}
                data-bin={b.at}
                onMouseEnter={() => setHover(i)}
                onClick={() => setHover(i)}
              >
                <rect
                  x={i * (bw + gap) - gap / 2}
                  y={0}
                  width={bw + gap}
                  height={H}
                  fill="transparent"
                />
                {kinds.map((k) => {
                  if (!b[k]) return null;
                  const h = Math.max(2, (b[k] / max) * (H - 4));
                  y -= h;
                  const top = y;
                  y -= 1; // a hairline of surface between stacked parts
                  return (
                    <rect
                      key={k}
                      x={i * (bw + gap)}
                      y={top}
                      width={bw}
                      height={h}
                      rx={1}
                      className={clsx(KIND[k].fill, hover !== null && hover !== i && 'opacity-50')}
                    />
                  );
                })}
                {total === 0 && hover === i && (
                  <rect
                    x={i * (bw + gap)}
                    y={H - 2}
                    width={bw}
                    height={2}
                    className="fill-chart-rest"
                  />
                )}
              </g>
            );
          })}
        </svg>
        <div className="relative h-4 text-[10px] text-chart-label">
          {dayStarts.map(({ i, d }) => (
            <span
              key={i}
              className="absolute top-0 -translate-x-0"
              style={{ left: `${(i / bins.length) * 100}%` }}
            >
              {weekdayFormat.format(d)}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------ sessions

const TONES: Record<string, Tone> = {
  neutral: 'neutral',
  blue: 'blue',
  green: 'green',
  amber: 'amber',
  red: 'red',
  violet: 'violet',
  muted: 'muted',
};

function Pill({ option }: { option: UpdateOption | null }) {
  if (!option) return <span className="text-xs text-faint">—</span>;
  return <Badge tone={TONES[option.color] ?? 'neutral'}>{option.label}</Badge>;
}

/** One field: pill → pill, a text's changed part, or value → value. */
function FieldChange({ field, op }: { field: UpdateField; op: UpdateEntity['op'] }) {
  const name = fieldName(field.field);
  let body: ReactNode;
  if (field.option) {
    body =
      op === 'update' ? (
        <>
          <Pill option={field.option.before} />
          <ArrowRight aria-label="to" className="size-3 shrink-0 text-faint" />
          <Pill option={field.option.after} />
        </>
      ) : (
        <Pill option={op === 'delete' ? field.option.before : field.option.after} />
      );
  } else if (
    op === 'update' &&
    typeof field.before === 'string' &&
    typeof field.after === 'string'
  ) {
    const d = textDiff(field.before, field.after);
    body = (
      <span className="min-w-0 truncate">
        <span className="text-muted">{d.lead}</span>
        {d.before && (
          <del className="rounded-sm bg-rose-50 text-rose-800 decoration-rose-400 dark:bg-rose-950 dark:text-rose-200">
            {d.before}
          </del>
        )}
        {d.after && (
          <ins className="ml-0.5 rounded-sm bg-emerald-50 text-emerald-800 no-underline dark:bg-emerald-950 dark:text-emerald-200">
            {d.after}
          </ins>
        )}
        <span className="text-muted">{d.tail}</span>
      </span>
    );
  } else if (op === 'update') {
    body = (
      <span className="min-w-0 truncate">
        <span className="text-muted line-through">{valueText(field.before)}</span>{' '}
        <ArrowRight aria-label="to" className="inline size-3 text-faint" />{' '}
        <span className="text-ink">{valueText(field.after)}</span>
      </span>
    );
  } else {
    body = (
      <span className="min-w-0 truncate text-ink-soft">
        {valueText(op === 'delete' ? field.before : field.after)}
      </span>
    );
  }
  return (
    <span data-field={field.field} className="flex min-w-0 items-center gap-1.5 text-xs">
      <span className="shrink-0 text-faint">{name}</span>
      {body}
    </span>
  );
}

function entityHref(session: UpdateSession, e: UpdateEntity): string | null {
  if (e.op === 'delete' || !session.projectId) return null;
  if (e.type === 'project') return `/projects/${e.id}`;
  if (e.type === 'view') return `/projects/${session.projectId}/views/${e.id}`;
  return `/projects/${session.projectId}?entity=${encodeURIComponent(e.id)}`;
}

/** What a create or delete is worth showing: the few fields that say what it is. */
function fieldsFor(e: UpdateEntity): UpdateField[] {
  const fields = e.fields.filter((f) => !QUIET_FIELDS.has(f.field));
  if (e.op === 'update') return fields;
  // A new or removed thing: the few fields that say what it is, leaving out defaults.
  const defaults = (ENTITIES[e.type]?.defaults ?? {}) as Record<string, unknown>;
  return fields.filter(
    (f) =>
      (f.option || f.field === 'dueDate' || f.field === 'kind') &&
      defaults[f.field] !== (e.op === 'delete' ? f.before : f.after),
  );
}

function EntityRow({ session, entity }: { session: UpdateSession; entity: UpdateEntity }) {
  const kind = OP_KIND[entity.op];
  const Icon = KIND[kind].icon;
  const fields = fieldsFor(entity);
  const href = entityHref(session, entity);
  const title = entity.label ?? entity.id;
  return (
    <li data-entity={entity.id} className="space-y-1 py-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <Tooltip label={`${KIND[kind].name} ${humanize(entity.type).toLowerCase()}`}>
          <span tabIndex={0} className={clsx('flex shrink-0', KIND[kind].text)}>
            <Icon aria-label={KIND[kind].name} className="size-3.5" />
          </span>
        </Tooltip>
        <span className="shrink-0 rounded-sm bg-subtle px-1 text-[10px] tracking-wide text-muted uppercase">
          {humanize(entity.type)}
        </span>
        {href ? (
          <Link to={href} className={clsx('min-w-0 truncate text-sm text-ink hover:underline')}>
            {title}
          </Link>
        ) : (
          <span
            className={clsx(
              'min-w-0 truncate text-sm text-ink-soft',
              entity.op === 'delete' && 'line-through',
            )}
          >
            {title}
          </span>
        )}
      </div>
      {(fields.length > 0 || entity.pictures) && (
        <div className="space-y-1 pl-6">
          {fields.slice(0, FIELDS_SHOWN).map((f) => (
            <FieldChange key={f.field} field={f} op={entity.op} />
          ))}
          {fields.length > FIELDS_SHOWN && (
            <Tooltip
              label={`${fields.length - FIELDS_SHOWN} more`}
              detail={fields
                .slice(FIELDS_SHOWN)
                .map((f) => fieldName(f.field))
                .join(', ')}
            >
              <span tabIndex={0} className="text-xs text-faint">
                +{fields.length - FIELDS_SHOWN} more
              </span>
            </Tooltip>
          )}
          {entity.pictures && (
            <div className="flex flex-wrap items-center gap-2">
              {entity.pictures.map((p, i) => (
                <span key={i} className="flex items-center gap-1.5">
                  {p.before && (
                    <img
                      src={p.before}
                      alt={`${title} before`}
                      loading="lazy"
                      className="h-14 w-20 rounded-control border border-line object-cover opacity-70"
                    />
                  )}
                  {p.before && p.after && (
                    <ArrowRight aria-label="to" className="size-3 text-faint" />
                  )}
                  {p.after && (
                    <img
                      src={p.after}
                      alt={p.before ? `${title} after` : title}
                      loading="lazy"
                      className="h-14 w-20 rounded-control border border-line object-cover"
                    />
                  )}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function Chips({ counts, kinds }: { counts: UpdateCounts; kinds: readonly UpdateKind[] }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {kinds
        .filter((k) => counts[k] > 0)
        .map((k) => {
          const Icon = KIND[k].icon;
          return (
            <Tooltip key={k} label={`${counts[k]} ${KIND[k].name.toLowerCase()}`}>
              <span
                tabIndex={0}
                data-chip={k}
                className={clsx(
                  'inline-flex items-center gap-0.5 rounded-full bg-subtle px-1.5 py-0.5 text-xs font-medium tabular-nums',
                  KIND[k].text,
                )}
              >
                <Icon aria-hidden className="size-3" />
                {counts[k]}
              </span>
            </Tooltip>
          );
        })}
    </span>
  );
}

/** A stacked bar of the session's kinds: its shape at a glance. */
function Mix({ counts, kinds }: { counts: UpdateCounts; kinds: readonly UpdateKind[] }) {
  const total = sum(counts, kinds);
  if (!total) return null;
  return (
    <span aria-hidden className="flex h-1 w-full gap-px overflow-hidden rounded-full">
      {kinds.map((k) =>
        counts[k] ? <span key={k} className={KIND[k].bg} style={{ flexGrow: counts[k] }} /> : null,
      )}
    </span>
  );
}

function SessionCard({
  session,
  kinds,
  expanded,
  onToggle,
}: {
  session: UpdateSession;
  kinds: readonly UpdateKind[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const Who = session.author.kind === 'human' ? User : Bot;
  const latest = session.revisions[0];
  const entities = session.entities.filter((e) => kinds.includes(OP_KIND[e.op]));
  const lookups = kinds.includes('lookedUp') ? session.lookups : [];
  const headline = latest?.message ?? (lookups.length ? 'Looked around' : '');
  const panelId = `session-${session.id.replace(/[^A-Za-z0-9_-]/g, '_')}`;
  return (
    <li
      data-session={session.id}
      className="overflow-hidden rounded-block border border-line bg-surface"
    >
      <Mix counts={session.counts} kinds={kinds} />
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
        className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left hover:bg-sunken"
      >
        {expanded ? (
          <ChevronDown aria-hidden className="size-3.5 shrink-0 text-faint" />
        ) : (
          <ChevronRight aria-hidden className="size-3.5 shrink-0 text-faint" />
        )}
        <Who
          aria-label={session.author.kind === 'human' ? 'person' : 'agent'}
          className={clsx(
            'size-3.5 shrink-0',
            session.author.kind === 'human' ? 'text-ink-soft' : 'text-presence-ink',
          )}
        />
        <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-center sm:gap-2">
          <span className="flex min-w-0 items-center gap-1.5 text-sm">
            <span className="shrink-0 font-medium text-ink">{session.author.name}</span>
            {session.project && (
              <span className="min-w-0 truncate text-muted">· {session.project}</span>
            )}
          </span>
          <span
            className="min-w-0 truncate text-xs text-muted sm:text-sm sm:text-ink-soft"
            title={headline}
          >
            {headline}
          </span>
        </span>
        <Chips counts={session.counts} kinds={kinds} />
        <span className="hidden w-48 shrink-0 text-right text-xs whitespace-nowrap text-faint tabular-nums md:block">
          {span(session.start, session.end)}
        </span>
      </button>
      {expanded && (
        <div id={panelId} className="space-y-2 border-t border-line-soft px-3 py-2">
          <p className="text-xs text-faint tabular-nums md:hidden">
            {span(session.start, session.end)}
          </p>
          {session.revisions.length > 1 && (
            <ol className="space-y-0.5" aria-label="Revisions">
              {session.revisions.map((r) => (
                <li key={r.id} className="flex min-w-0 items-center gap-2 text-xs">
                  <span className="w-16 shrink-0 whitespace-nowrap text-faint tabular-nums">
                    {timeFormat.format(Date.parse(r.at))}
                  </span>
                  <span className="min-w-0 truncate text-ink-soft" title={r.message}>
                    {r.message}
                  </span>
                  {r.revertedBy && <Badge tone="muted">undone</Badge>}
                </li>
              ))}
            </ol>
          )}
          {entities.length > 0 && (
            <ul className="divide-y divide-line-soft" aria-label="What changed">
              {entities.map((e) => (
                <EntityRow key={e.id} session={session} entity={e} />
              ))}
            </ul>
          )}
          {session.moreEntities > 0 && (
            <p className="text-xs text-faint">and {plural(session.moreEntities, 'more thing')}</p>
          )}
          {lookups.length > 0 && (
            <div className="space-y-1">
              <h3
                className={clsx('flex items-center gap-1 text-xs font-medium', KIND.lookedUp.text)}
              >
                <Eye aria-hidden className="size-3" /> Looked up
              </h3>
              <ul className="flex flex-wrap gap-1" aria-label="Looked up">
                {lookups.map((l) => (
                  <li key={`${l.tool}:${l.targetId ?? l.targetType ?? ''}`}>
                    <Tooltip
                      label={l.label ?? (l.targetType ? humanize(l.targetType) : humanize(l.tool))}
                      detail={`${l.tool}${l.count > 1 ? ` · ${l.count} times` : ''} · ${timeFormat.format(Date.parse(l.at))}`}
                    >
                      <span
                        tabIndex={0}
                        data-lookup={l.tool}
                        className="inline-flex max-w-56 items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs text-ink-soft"
                      >
                        <span className="truncate">
                          {l.label ??
                            (l.targetType ? `${humanize(l.targetType)} list` : humanize(l.tool))}
                        </span>
                        {l.count > 1 && <span className="text-faint tabular-nums">×{l.count}</span>}
                      </span>
                    </Tooltip>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

// ------------------------------------------------------------------ filters

/** Whether a session shows under the chosen kinds and search words. */
export function matchesSession(
  session: UpdateSession,
  kinds: readonly UpdateKind[],
  search: string,
): boolean {
  if (!kinds.some((k) => session.counts[k] > 0)) return false;
  const words = search.trim().toLowerCase();
  if (!words) return true;
  const hay = [
    session.author.name,
    session.project ?? '',
    ...session.revisions.map((r) => r.message),
    ...session.entities.map((e) => e.label ?? ''),
    ...session.lookups.map((l) => l.label ?? ''),
  ]
    .join('\n')
    .toLowerCase();
  return words.split(/\s+/).every((w) => hay.includes(w));
}

function FilterMenu({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | null;
  options: { id: string; name: string }[];
  onChange: (id: string | null) => void;
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const chosen = options.find((o) => o.id === value);
  return (
    <>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        aria-label={`${label}: ${chosen?.name ?? 'all'}`}
        onClick={(e: MouseEvent<HTMLButtonElement>) =>
          setAnchor(anchor ? null : e.currentTarget.getBoundingClientRect())
        }
        className={clsx(CONTROL, chosen && 'border-accent text-ink')}
      >
        <span className="max-w-36 truncate">
          {chosen ? chosen.name : `All ${label.toLowerCase()}s`}
        </span>
        <ChevronDown aria-hidden className="size-3" />
      </button>
      {anchor && (
        <Menu anchor={anchor} label={label} onClose={() => setAnchor(null)}>
          <MenuItem
            plain
            current={!chosen}
            onClick={() => {
              setAnchor(null);
              onChange(null);
            }}
          >
            All {label.toLowerCase()}s
          </MenuItem>
          {options.map((o) => (
            <MenuItem
              plain
              key={o.id}
              current={o.id === value}
              onClick={() => {
                setAnchor(null);
                onChange(o.id);
              }}
            >
              {o.name}
            </MenuItem>
          ))}
        </Menu>
      )}
    </>
  );
}

// ------------------------------------------------------------------ the page

export function UpdatesPage() {
  const [params, setParams] = useSearchParams();
  const projectId = params.get('project');
  const author = params.get('agent');
  const kinds = useMemo<UpdateKind[]>(() => {
    const raw = params.get('kind');
    const picked = raw ? (raw.split(',').filter((k) => k in KIND) as UpdateKind[]) : [];
    return picked.length ? UPDATE_KINDS.filter((k) => picked.includes(k)) : [...UPDATE_KINDS];
  }, [params]);
  const [search, setSearch] = useState('');
  const query = new URLSearchParams();
  if (projectId) query.set('projectId', projectId);
  if (author) query.set('author', author);
  const path = `/api/updates${query.size ? `?${query}` : ''}`;
  const updates = useResource<Updates>(path);
  const { reload } = updates;
  useRevisionEvents(() => reload());
  // Lookups aren't revisions: look again each minute.
  useEffect(() => {
    const timer = setInterval(reload, 60_000);
    return () => clearInterval(timer);
  }, [reload]);
  const [older, setOlder] = useState<{ path: string; pages: Updates[] }>({ path, pages: [] });
  const pages = useMemo(() => (older.path === path ? older.pages : []), [older, path]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // Sessions the reader opened or closed; the rest follow the default below.
  const [toggled, setToggled] = useState<Map<string, boolean>>(new Map());

  const data = updates.data;
  const sessions = useMemo(
    () => [...(data?.sessions ?? []), ...pages.flatMap((p) => p.sessions)],
    [data, pages],
  );
  const shown = sessions.filter((s) => matchesSession(s, kinds, search));
  // The newest session with changes starts open, so the page shows a before → after without
  // a click.
  const firstOpen = (shown.find((s) => s.revisions.length) ?? shown[0])?.id;
  const isOpen = (id: string) => toggled.get(id) ?? id === firstOpen;

  useEffect(() => {
    const before = document.title;
    document.title = 'Updates · Pharos';
    return () => {
      document.title = before;
    };
  }, []);

  if (updates.status === 'error') return <LoadError notFound={false} what="Updates" />;

  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const toggleKind = (kind: UpdateKind) => {
    const next = kinds.includes(kind) ? kinds.filter((k) => k !== kind) : [...kinds, kind];
    set('kind', next.length && next.length < UPDATE_KINDS.length ? next.join(',') : null);
  };
  const nextBefore = pages.length ? pages[pages.length - 1]!.nextBefore : data?.nextBefore;
  const loadOlder = async () => {
    if (!nextBefore) return;
    setLoadingOlder(true);
    try {
      const q = new URLSearchParams(query);
      q.set('before', nextBefore);
      const page = await getJson<Updates>(`/api/updates?${q}`);
      setOlder({ path, pages: [...pages, page] });
    } finally {
      setLoadingOlder(false);
    }
  };

  // Sessions under day headings.
  const groups: { day: string; sessions: UpdateSession[] }[] = [];
  for (const s of shown) {
    const day = dayLabel(s.end);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.sessions.push(s);
    else groups.push({ day, sessions: [s] });
  }
  const authors = (data?.authors ?? []).map((a) => ({ id: a.name, name: a.name }));
  const projects = data?.projects ?? [];

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-8">
      <header className="space-y-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Updates</h1>
          <span className="text-sm text-muted">last 24 h · 7 days</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Filters" role="group">
          <FilterMenu
            label="Project"
            value={projectId}
            options={projects}
            onChange={(id) => set('project', id)}
          />
          <FilterMenu
            label="Agent"
            value={author}
            options={authors}
            onChange={(id) => set('agent', id)}
          />
          {UPDATE_KINDS.map((k) => {
            const on = kinds.includes(k);
            const Icon = KIND[k].icon;
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                onClick={() => toggleKind(k)}
                className={clsx(CONTROL, on ? 'text-ink' : 'opacity-60')}
              >
                <span
                  aria-hidden
                  className={clsx('size-2 rounded-full', on ? KIND[k].bg : 'bg-chart-rest')}
                />
                <Icon aria-hidden className="size-3" />
                <span className="hidden sm:inline">{KIND[k].name}</span>
                <span className="sr-only sm:hidden">{KIND[k].name}</span>
              </button>
            );
          })}
          <label className="relative ml-auto flex min-w-40 flex-1 items-center sm:max-w-56">
            <Search
              aria-hidden
              className="pointer-events-none absolute left-2 size-3.5 text-faint"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search messages and titles"
              aria-label="Search messages and titles"
              className="w-full rounded-full border border-line bg-surface py-1 pr-7 pl-7 text-xs text-ink placeholder:text-faint"
            />
            {search && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearch('')}
                className="absolute right-2 text-faint hover:text-ink"
              >
                <X aria-hidden className="size-3" />
              </button>
            )}
          </label>
        </div>
      </header>

      {data ? (
        <>
          <Tiles data={data} kinds={kinds} />
          <Timeline data={data} kinds={kinds} />
        </>
      ) : (
        <div className="h-48 animate-pulse rounded-block bg-sunken" />
      )}

      {data && (
        <section aria-label="Work sessions" className="space-y-4">
          {groups.map((g) => (
            <div key={g.day} className="space-y-1.5">
              <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">
                {g.day} <span className="text-faint tabular-nums">{g.sessions.length}</span>
              </h2>
              <ul className="space-y-1.5">
                {g.sessions.map((s) => (
                  <SessionCard
                    key={s.id}
                    session={s}
                    kinds={kinds}
                    expanded={isOpen(s.id)}
                    onToggle={() => setToggled((prev) => new Map(prev).set(s.id, !isOpen(s.id)))}
                  />
                ))}
              </ul>
            </div>
          ))}
          {!shown.length && (
            <p className="rounded-block border border-dashed border-line px-3 py-6 text-center text-sm text-muted">
              {sessions.length ? 'Nothing matches these filters.' : 'Nothing happened this week.'}
            </p>
          )}
          {nextBefore && (
            <button
              type="button"
              disabled={loadingOlder}
              onClick={() => void loadOlder()}
              className={CONTROL}
            >
              Older
            </button>
          )}
        </section>
      )}
    </div>
  );
}

/** The sidebar link, under the desk's. */
export function UpdatesLink() {
  return (
    <NavLink
      to="/updates"
      className={({ isActive }) =>
        clsx(
          'flex w-full items-center gap-1.5 rounded-control px-2 py-1.5 text-sm',
          isActive ? 'bg-subtle font-medium text-ink' : 'text-ink-soft hover:bg-sunken',
        )
      }
    >
      <Activity aria-hidden className="size-3.5" /> Updates
    </NavLink>
  );
}
