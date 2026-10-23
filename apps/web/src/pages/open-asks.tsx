import type { Desk, DeskItem } from '@pharos/schema';
import clsx from 'clsx';
import { useEffect, useMemo } from 'react';
import { useResource } from '../lib/api';
import { useRevisionEvents } from '../lib/events';

// What still waits for the owner, per view and per project, counted from the desk itself so the
// numbers always agree with it. A view the owner has seen but not finished (an open review sheet,
// an unanswered decision) keeps its count until it is answered, so they can find their way back
// (Chaeeon, 10-23: "I forgot where to come back when I moved away from that view").

/** Counted as the desk counts: not runs, not the folded old ones. */
const counts = (item: DeskItem) => item.kind !== 'run' && !item.old;

/** The view a desk item lives in, from its link (`/projects/p/views/<id>#sheet-…`). */
export function viewOfItem(item: Pick<DeskItem, 'href'>): string | undefined {
  return /\/views\/(view_[A-Za-z0-9]+)/.exec(item.href ?? '')?.[1];
}

export type OpenAsks = { byView: Map<string, number>; byProject: Map<string, number> };

export function openAsksOf(desk: Desk | undefined): OpenAsks {
  const byView = new Map<string, number>();
  const byProject = new Map<string, number>();
  for (const item of desk?.items ?? []) {
    if (!counts(item)) continue;
    const view = viewOfItem(item);
    if (view) byView.set(view, (byView.get(view) ?? 0) + 1);
    if (item.projectId) byProject.set(item.projectId, (byProject.get(item.projectId) ?? 0) + 1);
  }
  return { byView, byProject };
}

/** Open asks per view and project, kept current with every change and once a minute. */
export function useOpenAsks(): OpenAsks {
  const desk = useResource<Desk>('/api/desk');
  const { reload } = desk;
  useRevisionEvents(() => reload());
  useEffect(() => {
    const timer = setInterval(reload, 60_000);
    return () => clearInterval(timer);
  }, [reload]);
  return useMemo(() => openAsksOf(desk.data), [desk.data]);
}

/** An amber count: how many answers a view or project still waits for. */
export function AsksBadge({ n, className }: { n: number; className?: string }) {
  if (n <= 0) return null;
  return (
    <span
      data-open-asks={n}
      title={`${n} waiting for your answer`}
      className={clsx(
        'inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-amber-100 px-1 text-[10px] leading-none font-semibold text-amber-800 tabular-nums dark:bg-amber-900/50 dark:text-amber-200',
        className,
      )}
    >
      {n}
      <span className="sr-only"> waiting for your answer</span>
    </span>
  );
}
