import {
  agentLabel,
  type Author,
  type Entity,
  type PageChanges,
  type ViewFreshness,
} from '@pharos/schema';
import clsx from 'clsx';
import { History, RefreshCw, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useViewData } from '../catalog/context';
import { BUTTON } from '../catalog/ui';
import { useRevisionEvents } from '../lib/events';
import { formatDate, localToday, plural, timeAgo } from '../lib/format';
import { markViewSeen, viewFreshness } from '../lib/freshness';

// Freshness on a page (R11): a dot on views that changed since the reader looked, a short "what
// changed" line on the page they open, and for pages an agent wrote, whether the written parts
// still match the data, with Refresh.

/** The calm mark on a tab, a More item or a project: changed since you looked. */
export function ChangedDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      data-changed-dot=""
      className={clsx(
        'pointer-events-none inline-block size-1.5 rounded-full bg-sky-500',
        className,
      )}
    />
  );
}

/** Words for a screen reader beside a ChangedDot. */
export const CHANGED_TEXT = 'changed since you looked';

/** Who made a change, in a few words. */
export function authorName(author: Author): string {
  if (author.kind === 'human') return author.name === 'me' ? 'You' : author.name;
  if (author.kind === 'system') return 'Pharos';
  return agentLabel(author.name);
}

/**
 * One sentence on what changed: who changed which items (the first few, by name), and whether
 * they changed the page itself. Newest first, one clause per author.
 */
export function changesSentence(changes: PageChanges): string {
  const byAuthor = new Map<string, { labels: string[]; more: number; page: boolean }>();
  for (const change of changes.recent) {
    const who = authorName(change.author);
    const entry = byAuthor.get(who) ?? { labels: [], more: 0, page: false };
    for (const item of change.items) {
      const label = item.label ? `“${item.label}”` : `a ${item.type.replace('_', ' ')}`;
      if (entry.labels.includes(label)) continue;
      if (entry.labels.length < 3) entry.labels.push(label);
      else entry.more += 1;
    }
    entry.page ||= change.page;
    byAuthor.set(who, entry);
  }
  const clauses = [...byAuthor].map(([who, { labels, more, page }]) => {
    const things = [...labels, ...(more ? [`${more} more`] : [])];
    const items = things.length
      ? things.length === 1
        ? things[0]
        : `${things.slice(0, -1).join(', ')} and ${things.at(-1)}`
      : '';
    const what = [items, page ? 'this page' : ''].filter(Boolean).join(' and ');
    return `${who} changed ${what}`;
  });
  const older = changes.total - changes.recent.length;
  return `${clauses.join('; ')}${older > 0 ? ` (and ${plural(older, 'earlier change')})` : ''}`;
}

/**
 * What changed since an answer was written: the changes, and when the date moved on far enough
 * that its date-based blocks ("due today") show other items (R11 review, gap 4).
 */
export function staleSentence(stale: PageChanges): string {
  const parts = stale.recent.length ? [changesSentence(stale)] : [];
  if (stale.calendar)
    parts.push(
      `the date moved on from ${formatDate(stale.calendar.from)}, so its date-based blocks show other items`,
    );
  return parts.join('; ') || 'its data changed';
}

/**
 * The open view's freshness: what changed since the reader last looked (kept while the page is
 * open, so it doesn't vanish once the view counts as seen) and its evidence. Opening the view
 * marks it seen; so does every change that arrives while it is open.
 */
export function usePageFreshness(
  projectId: string | undefined,
  viewId: string | undefined,
): ViewFreshness | null {
  const [state, setState] = useState<{
    viewId: string;
    since: number;
    value: ViewFreshness;
  } | null>(null);
  const since = useRef<{ viewId: string; since: number } | null>(null);
  // Requests may finish out of order (R11 review, gap 7): an answer is taken only when it is
  // newer than the one shown, by request order and by the latest revision it saw.
  const order = useRef({ started: 0, applied: 0, latest: 0 });
  const take = (request: number, latest: number) => {
    const o = order.current;
    if (request < o.applied || latest < o.latest) return false;
    order.current = { ...o, applied: request, latest };
    return true;
  };
  useEffect(() => {
    if (!projectId || !viewId) return;
    let live = true;
    since.current = null;
    order.current = { started: order.current.started, applied: 0, latest: 0 };
    const request = ++order.current.started;
    void viewFreshness(projectId, viewId).then((f) => {
      const value = f?.views[viewId];
      if (!live || !f || !value || !take(request, f.latest)) return;
      since.current = { viewId, since: value.seen };
      setState({ viewId, since: value.seen, value });
      void markViewSeen(viewId, f.latest);
    });
    return () => {
      live = false;
    };
  }, [projectId, viewId]);
  useRevisionEvents((event) => {
    if (!projectId || !viewId || !event.projectIds.includes(projectId)) return;
    const from = since.current?.viewId === viewId ? since.current.since : undefined;
    const request = ++order.current.started;
    void viewFreshness(projectId, viewId, from).then((f) => {
      const value = f?.views[viewId];
      if (!f || !value || since.current?.viewId !== viewId || !take(request, f.latest)) return;
      setState({ viewId, since: from ?? value.seen, value });
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden')
        void markViewSeen(viewId, f.latest);
    });
  });
  return state && state.viewId === viewId ? state.value : null;
}

/** "What changed since you looked": one calm line under the tabs, with a link to the history. */
export function WhatChanged({ freshness }: { freshness: ViewFreshness | null }) {
  const { actions } = useViewData();
  const [hidden, setHidden] = useState<string | null>(null);
  const changed = freshness?.changed;
  const key = changed ? `${freshness.viewId}:${changed.recent[0]?.revision}` : null;
  if (!changed || !key || hidden === key) return null;
  const latest = changed.recent[0]!;
  return (
    <div
      role="status"
      data-what-changed=""
      className="flex animate-fade-in items-start gap-2 rounded-tile border border-sky-200 bg-sky-50/70 px-3 py-2 text-sm dark:border-sky-900 dark:bg-sky-950/40"
    >
      <ChangedDot className="mt-1.5 shrink-0" />
      <p className="min-w-0 flex-1">
        <span className="font-medium">Since you last looked: </span>
        {changesSentence(changed)}.{' '}
        <span className="text-xs text-muted">Latest {timeAgo(latest.at)}.</span>
      </p>
      <button
        type="button"
        onClick={() => actions.open({ history: true })}
        className="inline-flex shrink-0 items-center gap-1 rounded-control text-xs font-medium text-accent hover:underline"
      >
        <History className="size-3.5" aria-hidden /> History
      </button>
      <button
        type="button"
        aria-label="Hide what changed"
        onClick={() => setHidden(key)}
        className="-m-0.5 shrink-0 rounded-control p-0.5 text-faint hover:text-ink"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

/** The request that asks the answering agent to answer this view's question again. */
export function refreshRequest(view: Entity<'view'>) {
  const question = view.data.question ?? view.data.description ?? `Refresh “${view.data.name}”`;
  return {
    message: `Refresh “${view.data.name}”: its data changed since it was written`,
    operations: [
      {
        op: 'create' as const,
        type: 'request' as const,
        data: {
          projectId: view.data.projectId,
          question,
          about: `Answer “${view.data.name}”`,
          viewId: view.id,
          mode: 'refresh' as const,
        },
      },
    ],
  };
}

/**
 * Refresh for a page an agent wrote: asks the answering agent to write it again (a request with
 * `mode: "refresh"`), or says it is already asked.
 */
export function RefreshButton({
  view,
  label = 'Refresh',
}: {
  view: Entity<'view'>;
  label?: string;
}) {
  const { requests, actions } = useViewData();
  const [asking, setAsking] = useState(false);
  const waiting = (requests ?? []).some(
    (r) => r.data.mode === 'refresh' && r.data.viewId === view.id && r.data.status === 'open',
  );
  const refresh = async () => {
    setAsking(true);
    const { message, operations } = refreshRequest(view);
    await actions.apply(message, operations);
    setAsking(false);
  };
  return waiting ? (
    <span className="text-xs text-muted" role="status">
      Refresh asked: waiting for your agent
    </span>
  ) : (
    <button
      type="button"
      onClick={() => void refresh()}
      disabled={asking}
      className={clsx(BUTTON.secondary, 'shrink-0')}
    >
      <RefreshCw className={clsx('size-3.5', asking && 'animate-spin')} aria-hidden /> {label}
    </button>
  );
}

/**
 * For a page an agent wrote: "as of" its evidence, and whether what it wrote still matches the
 * data. Live blocks always show today's data; the written parts are a snapshot. Stale pages (and
 * answers whose evidence is unknown) offer Refresh, which asks the answering agent again.
 */
export function EvidenceNote({
  view,
  freshness,
}: {
  view: Entity<'view'>;
  freshness: ViewFreshness | null;
}) {
  const evidence = freshness?.evidence;
  if (!evidence) return null;
  const button = <RefreshButton view={view} />;
  if ('unknown' in evidence)
    return (
      <div
        data-evidence="unknown"
        className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted"
      >
        <span className="min-w-0 flex-1">
          {evidence.reason === 'no_data'
            ? 'Evidence unknown: nothing on this page reads the project’s data, so Pharos can’t tell whether what it says still holds.'
            : 'Evidence unknown: written before Pharos kept track of the data behind it. Its blocks show today’s data; check the written parts against them.'}
        </span>
        {button}
      </div>
    );
  // The reader's own calendar day, not the server's UTC one.
  const asOf = evidence.at
    ? formatDate(localToday(new Date(evidence.at)))
    : `revision ${evidence.revision}`;
  if (!evidence.stale)
    return (
      <p data-evidence="fresh" className="text-xs text-muted">
        Written as of {asOf}
        {evidence.at ? ` (${timeAgo(evidence.at)})` : ''}; nothing it was written from has changed
        since.
      </p>
    );
  // A saved page an agent built is mostly live blocks: a quiet line. An answer is what was
  // written, so it says plainly that it may be out of date.
  if (view.data.kind !== 'answer')
    return (
      <div
        data-evidence="stale"
        className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted"
      >
        <span className="min-w-0 flex-1">
          Written as of {asOf}; since then {staleSentence(evidence.stale)}. Its blocks show today’s
          data; its text may be out of date.
        </span>
        {button}
      </div>
    );
  return (
    <div
      data-evidence="stale"
      role="status"
      className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-tile border border-amber-200 bg-amber-50/70 px-3 py-2 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <p className="min-w-0 flex-1">
        <span className="font-medium">May be out of date. </span>
        Written as of {asOf}; since then {staleSentence(evidence.stale)}. Its blocks show today’s
        data; the written parts are from {asOf}.
      </p>
      {button}
    </div>
  );
}
