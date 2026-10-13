import clsx from 'clsx';
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';

// Charts and pictures look the same everywhere (v0.2 B7). FindingChart, CountChart, the StatCards
// and Text mini bars, Layers progress, ProgressRing, Gallery and BeforeAfter take their axis,
// label, value, legend, highlight and frame styles from here, and the palette is the one in
// index.css (`--ph-chart-*`): one highlight against the rest, plus ok/warn/bad for status.

/** How much a label or value stands out: no highlight in the chart, one of the rest, or the one. */
export type Emphasis = 'plain' | 'rest' | 'lit';

/** A mark's colour: the highlight, the rest, or a status (progress done = ok). */
export type ChartTone = 'highlight' | 'rest' | 'ok' | 'warn' | 'bad';

export const CHART = {
  /** A chart's heading when it is a claim: the sentence the picture proves. */
  title: 'font-semibold break-words text-ink',
  /** Small capitals naming an axis, a panel (Before / After) or a legend. */
  axis: 'text-xs font-semibold tracking-wider text-muted uppercase',
  label: {
    plain: 'text-sm text-ink-soft',
    rest: 'text-sm text-muted',
    lit: 'text-sm font-semibold text-ink',
  },
  value: {
    plain: 'text-sm tabular-nums text-ink-soft',
    rest: 'text-sm tabular-nums text-muted',
    lit: 'text-sm font-semibold tabular-nums text-accent-strong',
  },
  /** A big number (StatCards, Stat). */
  figure: 'text-figure tabular-nums',
  /** "/ 9" after a big number. */
  figureOf: 'text-base font-normal text-faint',
  /** The small label over a big number. */
  figureLabel: 'text-xs font-medium text-muted',
  /** A picture's caption and its source line. */
  caption: 'text-sm text-ink',
  source: 'text-xs text-muted',
  /** Where a passage or number comes from (a locator). */
  note: 'text-xs text-faint',
  fill: {
    highlight: 'bg-chart-highlight',
    rest: 'bg-chart-rest',
    ok: 'bg-chart-ok',
    warn: 'bg-chart-warn',
    bad: 'bg-chart-bad',
  } satisfies Record<ChartTone, string>,
  stroke: {
    highlight: 'stroke-chart-highlight',
    rest: 'stroke-chart-rest',
    ok: 'stroke-chart-ok',
    warn: 'stroke-chart-warn',
    bad: 'stroke-chart-bad',
  } satisfies Record<ChartTone, string>,
  track: 'bg-chart-track',
  trackStroke: 'stroke-chart-track',
  /** The frame around a picture: the highlighted one gets the highlight ring. */
  frame: {
    rest: 'border-line hover:border-line-strong',
    lit: 'border-chart-highlight ring-2 ring-chart-highlight/60',
  },
  /** Behind a picture while it loads or when it can't be shown. */
  picture: 'bg-sunken',
  /** Text removed and added (BeforeAfter, and its legend). */
  removed:
    'rounded-sm bg-rose-50 text-rose-800 decoration-rose-500/70 dark:bg-rose-950/60 dark:text-rose-200 dark:decoration-rose-400/70',
  added:
    'rounded-sm bg-emerald-50 text-emerald-900 underline decoration-emerald-600/60 decoration-2 underline-offset-2 dark:bg-emerald-950/60 dark:text-emerald-200 dark:decoration-emerald-400/70',
} as const;

/** Bar heights: a chart bar, a progress line, and a word-sized mini bar. */
const SIZES = { bar: 'h-5 rounded-sm', count: 'h-3 rounded-full', line: 'h-1.5 rounded-full' };

/** The emphasis of one item, given whether it is the highlight and whether the chart has one. */
export function emphasisOf(highlighted: boolean, anyHighlight: boolean): Emphasis {
  return highlighted ? 'lit' : anyHighlight ? 'rest' : 'plain';
}

/**
 * A bar showing `share` (0–1) of its track, in the chart palette. Decoration only: whoever
 * draws it shows the number as text, so it is hidden from screen readers.
 */
export function Bar({
  share,
  tone = 'highlight',
  size = 'line',
  track = true,
  fill,
  highlighted,
  inline = false,
  className,
  style,
  ...rest
}: Omit<HTMLAttributes<HTMLSpanElement>, 'children'> & {
  share: number;
  tone?: ChartTone;
  size?: keyof typeof SIZES;
  /** Draw the whole as a faint track behind the bar. */
  track?: boolean;
  /** A fill class instead of the tone (a project option's own colour). */
  fill?: string;
  /** Marks the highlighted bar (`data-highlighted`), e.g. for tests and styles. */
  highlighted?: boolean;
  /** Sits in a line of text (a mini bar) rather than on its own line. */
  inline?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  const width = `${Math.max(0, Math.min(1, share)) * 100}%`;
  return (
    <span
      aria-hidden
      data-track={track || undefined}
      {...rest}
      className={clsx(
        inline ? 'inline-block align-middle' : 'block',
        'min-w-0 overflow-hidden',
        SIZES[size],
        track && CHART.track,
        className,
      )}
      style={style}
    >
      <span
        data-highlighted={highlighted || undefined}
        className={clsx(
          'block h-full min-w-0.5 motion-safe:transition-[width]',
          SIZES[size].split(' ')[1],
          fill ?? CHART.fill[tone],
        )}
        style={{ width }}
      />
    </span>
  );
}

/** A legend: a swatch (a fill class, or an inline sample) and its words, for each series. */
export function Legend({
  items,
  className,
}: {
  items: { label: ReactNode; swatch: string | ReactNode }[];
  className?: string;
}) {
  return (
    <p aria-hidden className={clsx('flex flex-wrap gap-3 text-xs text-muted', className)}>
      {items.map((item, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          {typeof item.swatch === 'string' ? (
            <span className={clsx('inline-block size-2.5 rounded-sm', item.swatch)} />
          ) : (
            item.swatch
          )}
          {item.label}
        </span>
      ))}
    </p>
  );
}
