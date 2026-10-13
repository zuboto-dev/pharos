import {
  fieldReader,
  findOption,
  optionKeyOf,
  optionsFor,
  runQuery,
  type Entity,
  type NodeOf,
} from '@pharos/schema';
import clsx from 'clsx';
import { FileText } from 'lucide-react';
import { useId, useState, type KeyboardEvent } from 'react';
import { formatDate } from '../../lib/format';
import { useViewData, type ViewData } from '../context';
import { labelOf } from '../interactive';
import { Empty, isHttp, Uri } from '../ui';
import { CertaintyMark, ClaimBasis } from './knowledge';

/**
 * FindingChart (docs/reframe/r4-plan.md block 4): a finding as a picture. The title is the stored
 * claim that states it, with its certainty mark (a title that states the finding, Kong et al.);
 * horizontal bars carry their own labels and values, so there is no axis or legend; one bar is in
 * the accent colour and the rest are grey (direct attention, Knaflic). Bars come from claims'
 * figures, each opening to its claim, quote, locator and source, or from a project query counted
 * by a field, labelled the way CountChart labels it. With `max`, each bar sits on a faint track
 * for that whole (7 of 7 tools, 100%), so a share reads as a share.
 */

type Claim = Entity<'claim'>;
type Artifact = Entity<'artifact'>;
type Node = NodeOf<'FindingChart'>;

type Bar = {
  key: string;
  label: string;
  value: number;
  unit?: string;
  claim?: Claim;
  /** Natural order for counted groups: the option order or the referenced item's order. */
  rank?: number;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function claimBars(data: ViewData, filter: NonNullable<Node['bars']>): Bar[] {
  return runQuery(data, 'claim', { sort: [{ field: 'order' }], ...filter }).flatMap((c) =>
    c.data.figure ? [{ key: c.id, ...c.data.figure, claim: c }] : [],
  );
}

/** Rows grouped by a field: option values by their labels, references by their names. */
function countBars(data: ViewData, count: NonNullable<Node['count']>): Bar[] {
  const read = fieldReader(data);
  const groups = new Map<string, Bar>();
  for (const row of runQuery(data, count.query.type, count.query)) {
    const { value, type, field } = read(row, count.by);
    const values = Array.isArray(value) ? value : [value];
    for (const v of values.length ? values : [undefined]) {
      const key = v === undefined || v === null || v === '' ? '' : String(v);
      const existing = groups.get(key);
      if (existing) {
        existing.value++;
        continue;
      }
      const optionKey = optionKeyOf(type, field);
      const option = optionKey && key ? findOption(data.project, optionKey, key) : undefined;
      const target = key ? data.entityById.get(key) : undefined;
      groups.set(key, {
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
        value: 1,
        rank:
          option && optionKey
            ? optionsFor(data.project, optionKey).findIndex((o) => o.value === key)
            : target
              ? ((target.data as { order?: number }).order ?? target.createdRev)
              : Infinity,
      });
    }
  }
  const bars = [...groups.values()].sort((a, b) =>
    count.sort === 'count'
      ? b.value - a.value
      : (a.key === '' ? 1 : 0) - (b.key === '' ? 1 : 0) ||
        a.rank! - b.rank! ||
        a.label.localeCompare(b.label),
  );
  return bars.slice(0, count.limit);
}

/** Bars from claims when `bars` is set (it wins over `count`), else counted groups. */
function barsOf(data: ViewData, node: Node): Bar[] {
  if (node.bars) return claimBars(data, node.bars);
  return node.count ? countBars(data, node.count) : [];
}

/** The highlighted bar: a claim id, or a group's value or label; the first bar otherwise. */
function highlightOf(bars: readonly Bar[], highlight: string | undefined): string | undefined {
  const wanted = highlight?.trim().toLowerCase();
  const match =
    wanted &&
    (bars.find((b) => b.key === highlight) ??
      bars.find((b) => b.key.toLowerCase() === wanted || b.label.toLowerCase() === wanted));
  return (match || bars[0])?.key;
}

/** "4,800 tokens", "82.8%". */
function formatValue(value: number, unit?: string): string {
  const n = value.toLocaleString();
  if (!unit) return n;
  return /^[%‰°]/.test(unit) ? `${n}${unit}` : `${n} ${unit}`;
}

function artifactOf(data: ViewData, id: string | undefined): Artifact | undefined {
  const e = id ? data.entityById.get(id) : undefined;
  return e?.type === 'artifact' ? (e as Artifact) : undefined;
}

/** The source the claim's quote comes from: `quoteSourceId`, else its first source. */
function quoteSourceOf(data: ViewData, claim: Claim): Artifact | undefined {
  return (
    artifactOf(data, claim.data.quoteSourceId) ??
    claim.data.sourceIds.map((id) => artifactOf(data, id)).find(Boolean)
  );
}

/** A web source opens in a new tab; a local file opens in the drawer, where its path is. */
function SourceLine({ source }: { source: Artifact }) {
  const { actions } = useViewData();
  if (isHttp(source.data.uri)) return <Uri uri={source.data.uri}>{source.data.title}</Uri>;
  return (
    <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-2">
      <button
        type="button"
        onClick={() => actions.open({ entity: source.id })}
        className="inline-flex min-w-0 items-center gap-1 rounded-sm text-left text-accent hover:underline focus-visible:outline-2 focus-visible:outline-sky-400"
      >
        <FileText className="size-3 shrink-0" aria-hidden />
        <span className="truncate">{source.data.title}</span>
      </button>
    </span>
  );
}

/**
 * What a bar rests on: its claim with its mark, the quote and assumption (open, since the reader
 * opened the bar), and every source behind it, the quoted one with where the passage sits.
 */
function BarDetail({ id, claim }: { id: string; claim: Claim }) {
  const data = useViewData();
  const { locator } = claim.data;
  const quoted = quoteSourceOf(data, claim);
  const sources = claim.data.sourceIds
    .map((s) => artifactOf(data, s))
    .filter((s): s is Artifact => !!s);
  return (
    <div
      id={id}
      role="region"
      aria-label={claim.data.statement}
      className="mt-1.5 space-y-1.5 rounded-tile border border-line bg-neutral-50 p-3 text-sm dark:bg-neutral-900"
    >
      <p className="break-words text-ink">{claim.data.statement}</p>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <CertaintyMark claim={claim} />
        <ClaimBasis claim={claim} defaultOpen caption={false} />
      </div>
      {sources.length > 0 && (
        <div className="space-y-0.5 text-xs text-muted">
          <p className="font-medium text-ink-soft">
            {sources.length > 1 ? `Sources (${sources.length})` : 'Source'}
          </p>
          <ul className="space-y-0.5">
            {sources.map((s) => (
              <li key={s.id} className="flex min-w-0 flex-wrap items-baseline gap-x-1">
                <SourceLine source={s} />
                {locator && s.id === quoted?.id && (
                  <span>
                    <span aria-hidden>· </span>
                    {locator}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Up/Down, Home and End move between the bars' buttons. */
function moveFocus(e: KeyboardEvent<HTMLUListElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button[data-bar]')];
  const at = buttons.indexOf(e.target as HTMLButtonElement);
  if (at < 0) return;
  e.preventDefault();
  const next =
    e.key === 'Home'
      ? 0
      : e.key === 'End'
        ? buttons.length - 1
        : Math.min(buttons.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)));
  buttons[next]?.focus();
}

export function FindingChart({ node }: { node: Node }) {
  const data = useViewData();
  const baseId = useId();
  const [open, setOpen] = useState<string>();
  const claim = node.claim ? runQuery(data, 'claim', { where: { id: node.claim } })[0] : undefined;
  const bars = barsOf(data, node);
  const lit = highlightOf(bars, node.highlight);
  // The whole every bar is part of: the chart's `max`, else the longest bar.
  const whole = node.max;
  const max = whole ?? (Math.max(0, ...bars.map((b) => b.value)) || 1);
  const values = bars.map((b) => formatValue(b.value, b.unit));
  // Room kept after the longest bar for its value, so every bar is drawn on one scale.
  const reserve = Math.max(0, ...values.map((v) => v.length)) + 1;
  return (
    <figure className="min-w-0 space-y-3">
      {claim && (
        <figcaption className="space-y-1">
          <p className="font-semibold break-words text-ink">{claim.data.statement}</p>
          <CertaintyMark claim={claim} />
        </figcaption>
      )}
      {bars.length ? (
        <ul
          className="space-y-2"
          aria-label={claim?.data.statement ?? 'Bars'}
          onKeyDown={moveFocus}
        >
          {bars.map((b, i) => {
            const highlighted = b.key === lit;
            const value = values[i]!;
            const share = Math.min(1, Math.max(0, b.value) / max);
            const width = `calc((100% - ${reserve}ch) * ${share})`;
            const name = `${b.label}, ${value}${highlighted ? ', highlighted' : ''}`;
            const body = (
              <>
                <span
                  className={clsx(
                    'block truncate text-sm',
                    highlighted ? 'font-semibold text-ink' : 'text-muted',
                  )}
                >
                  {b.label}
                </span>
                <span className="flex h-5 items-center">
                  {whole === undefined ? (
                    <span
                      aria-hidden
                      data-highlighted={highlighted || undefined}
                      className={clsx(
                        'block h-full min-w-0.5 shrink-0 rounded-sm motion-safe:transition-[width]',
                        highlighted ? 'bg-sky-500' : 'bg-neutral-300 dark:bg-neutral-600',
                      )}
                      style={{ width }}
                    />
                  ) : (
                    // A faint track for the whole, so the bar reads as a share of it.
                    <span
                      aria-hidden
                      data-track
                      className="block h-full shrink-0 overflow-hidden rounded-sm bg-subtle"
                      style={{ width: `calc(100% - ${reserve}ch)` }}
                    >
                      <span
                        data-highlighted={highlighted || undefined}
                        className={clsx(
                          'block h-full min-w-0.5 rounded-sm motion-safe:transition-[width]',
                          highlighted ? 'bg-sky-500' : 'bg-neutral-300 dark:bg-neutral-600',
                        )}
                        style={{ width: `${share * 100}%` }}
                      />
                    </span>
                  )}
                  <span
                    className={clsx(
                      'ml-1.5 text-sm whitespace-nowrap tabular-nums',
                      highlighted ? 'font-semibold text-accent-strong' : 'text-muted',
                    )}
                  >
                    {value}
                  </span>
                </span>
              </>
            );
            if (!b.claim)
              return (
                <li key={b.key} aria-label={name} className="min-w-0">
                  {body}
                </li>
              );
            const panelId = `${baseId}-${i}`;
            const expanded = open === b.key;
            return (
              <li key={b.key} className="min-w-0">
                <button
                  type="button"
                  data-bar
                  aria-label={name}
                  aria-expanded={expanded}
                  aria-controls={expanded ? panelId : undefined}
                  onClick={() => setOpen(expanded ? undefined : b.key)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape' && expanded) {
                      e.stopPropagation();
                      setOpen(undefined);
                    }
                  }}
                  className="-mx-1 block w-[calc(100%+0.5rem)] min-w-0 rounded-control px-1 py-0.5 text-left hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-sky-400 dark:hover:bg-neutral-800/60"
                >
                  {body}
                </button>
                {expanded && <BarDetail id={panelId} claim={b.claim} />}
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty>No numbers to draw yet</Empty>
      )}
    </figure>
  );
}
