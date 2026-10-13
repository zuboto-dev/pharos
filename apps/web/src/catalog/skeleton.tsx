import clsx from 'clsx';
import type { CSSProperties, ReactNode } from 'react';

// Loading skeletons (v0.2 B8): calm, token-styled placeholders in the shape of what's coming,
// instead of blank boxes or "Loading…". The shimmer is a slow sweep of a lighter band
// (index.css `.ph-skeleton`); with reduced motion it stands still. Generic on purpose: pages,
// blocks, the drawer, history and lazily loaded components all build on these pieces.

/** One placeholder shape: a bar by default; give it a size and a radius with `className`. */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <span
      aria-hidden
      data-skeleton
      className={clsx('ph-skeleton block h-3 rounded-control', className)}
      style={style}
    />
  );
}

/**
 * A region that is loading: announced once to screen readers by `label` ("Loading history"),
 * with the placeholder shapes inside hidden from them.
 */
export function Loading({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div role="status" aria-label={label} aria-busy="true" className={className}>
      {children}
      <span className="sr-only">{label}…</span>
    </div>
  );
}

/** Line widths that look like text, cycled, so a block of lines doesn't read as a grid. */
const WIDTHS = ['92%', '78%', '85%', '64%', '88%', '70%'];

/** A few lines of text-shaped bars. */
export function SkeletonLines({
  lines = 3,
  label = 'Loading',
  className,
}: {
  lines?: number;
  label?: string;
  className?: string;
}) {
  return (
    <Loading label={label} className={clsx('space-y-2.5 py-1', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} style={{ width: WIDTHS[i % WIDTHS.length] }} />
      ))}
    </Loading>
  );
}

/** List rows: a small round mark (icon or avatar), a line and a shorter second line. */
export function SkeletonRows({
  rows = 3,
  label = 'Loading',
  className,
}: {
  rows?: number;
  label?: string;
  className?: string;
}) {
  return (
    <Loading label={label} className={clsx('space-y-3 py-1', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-start gap-2.5">
          <Skeleton className="size-5 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5 pt-0.5">
            <Skeleton style={{ width: WIDTHS[i % WIDTHS.length] }} />
            <Skeleton className="h-2.5" style={{ width: '40%' }} />
          </div>
        </div>
      ))}
    </Loading>
  );
}

/** A block-shaped placeholder (a panel with a title bar and a few lines), for boards and pages. */
export function SkeletonBlock({ className, lines = 3 }: { className?: string; lines?: number }) {
  return (
    <div
      aria-hidden
      className={clsx('rounded-block border border-line bg-surface p-panel', className)}
    >
      <Skeleton className="mb-4 h-3.5 w-1/3" />
      <div className="space-y-2.5">
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} style={{ width: WIDTHS[i % WIDTHS.length] }} />
        ))}
      </div>
    </div>
  );
}
