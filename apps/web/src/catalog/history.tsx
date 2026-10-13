import type { RevisionSummary } from '@pharos/schema';
import clsx from 'clsx';
import { Bot, Cog, RotateCcw, User } from 'lucide-react';
import { useState } from 'react';
import { ApiError, getJson, useResource } from '../lib/api';
import { formatDate, timeAgo } from '../lib/format';
import { SkeletonRows } from './skeleton';
import { useViewData } from './context';
import { BUTTON, Empty } from './ui';

export const AUTHOR_ICONS = { human: User, agent: Bot, system: Cog };

const PAGE = 50;
const FILTERS = [
  { key: 'all', label: 'Everyone' },
  { key: 'human', label: 'People' },
  { key: 'agent', label: 'Agents' },
] as const;
type FilterKey = (typeof FILTERS)[number]['key'];

/** One revision in a list; opens its details. */
export function RevisionItem({ rev }: { rev: RevisionSummary }) {
  const { actions } = useViewData();
  const Icon = AUTHOR_ICONS[rev.author.kind];
  return (
    <li>
      <button
        type="button"
        onClick={() => actions.open({ revision: rev.id })}
        className="flex w-full gap-2.5 rounded-control px-1.5 py-1.5 text-left hover:bg-sunken"
      >
        <Icon className="mt-0.5 size-4 shrink-0 text-neutral-400" />
        <span className="min-w-0 text-sm">
          <span className={clsx('block', rev.revertedBy && 'text-neutral-400 line-through')}>
            {rev.message}
          </span>
          <span className="text-xs text-muted">
            #{rev.id} · {rev.author.name} · {timeAgo(rev.createdAt)}
            {rev.revertOf && ` · reverts #${rev.revertOf}`}
            {rev.revertedBy && ` · reverted by #${rev.revertedBy}`}
          </span>
        </span>
      </button>
    </li>
  );
}

/** "Today", "Yesterday", or the date, for grouping revisions by day. */
function dayLabel(iso: string, now = new Date()): string {
  const day = iso.slice(0, 10);
  const local = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const date = local(new Date(iso));
  if (date === local(now)) return 'Today';
  if (date === local(new Date(now.getTime() - 86_400_000))) return 'Yesterday';
  return formatDate(date || day);
}

/** Every change to the project, newest first, by day; filterable by who made it. */
export function ProjectHistory() {
  const [filter, setFilter] = useState<FilterKey>('all');
  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="Changes by" className="flex gap-1 text-sm">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            role="radio"
            aria-checked={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={clsx(
              'rounded-full px-2.5 py-0.5',
              filter === f.key ? 'bg-inverse text-on-inverse' : 'text-muted hover:bg-subtle',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
      <HistoryList key={filter} filter={filter} />
    </div>
  );
}

function HistoryList({ filter }: { filter: FilterKey }) {
  const { project, version } = useViewData();
  const query = `projectId=${project.id}&limit=${PAGE}${filter === 'all' ? '' : `&authorKind=${filter}`}`;
  // The newest page stays live; older pages are fetched on demand and kept.
  const latest = useResource<RevisionSummary[]>(`/api/history?${query}&v=${version}`);
  const [older, setOlder] = useState<RevisionSummary[]>([]);
  const [more, setMore] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  if (latest.status === 'loading') return <SkeletonRows rows={5} label="Loading history" />;
  if (!latest.data) return <Empty>Couldn’t load history</Empty>;
  const first = latest.data;
  const seen = new Set(first.map((r) => r.id));
  const revisions = [...first, ...older.filter((r) => !seen.has(r.id))];
  if (!revisions.length) return <Empty>No changes yet</Empty>;
  const hasMore = more !== 'done' && (older.length ? true : first.length === PAGE);
  const loadOlder = async () => {
    setMore('loading');
    try {
      const page = await getJson<RevisionSummary[]>(
        `/api/history?${query}&before=${revisions.at(-1)!.id}`,
      );
      setOlder((o) => [...o, ...page]);
      setMore(page.length < PAGE ? 'done' : 'idle');
    } catch {
      setMore('error');
    }
  };

  const groups: { day: string; revisions: RevisionSummary[] }[] = [];
  for (const rev of revisions) {
    const day = dayLabel(rev.createdAt);
    if (groups.at(-1)?.day === day) groups.at(-1)!.revisions.push(rev);
    else groups.push({ day, revisions: [rev] });
  }
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <section key={g.day} aria-label={g.day}>
          <h3 className="mb-1 text-xs font-medium text-neutral-400">{g.day}</h3>
          <ul className="-mx-1.5 space-y-0.5">
            {g.revisions.map((rev) => (
              <RevisionItem key={rev.id} rev={rev} />
            ))}
          </ul>
        </section>
      ))}
      {hasMore && (
        <button
          type="button"
          disabled={more === 'loading'}
          onClick={() => void loadOlder()}
          className="text-sm text-accent hover:underline disabled:opacity-50"
        >
          {more === 'loading'
            ? 'Loading…'
            : more === 'error'
              ? 'Couldn’t load; try again'
              : 'Show older changes'}
        </button>
      )}
    </div>
  );
}

/** Reverts a revision (any one, not just the latest); the revert is itself a revision. */
export function RevertButton({ rev }: { rev: RevisionSummary }) {
  const { actions } = useViewData();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!actions.revert) return null;
  if (rev.revertedBy)
    return (
      <p className="text-sm text-muted">
        Reverted by{' '}
        <button
          type="button"
          onClick={() => actions.open({ revision: rev.revertedBy! })}
          className="text-accent hover:underline"
        >
          #{rev.revertedBy}
        </button>
        .
      </p>
    );
  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const outcome = await actions.revert!(rev.id, `Revert “${rev.message}”`);
          setBusy(false);
          if (!outcome.ok) setError(outcome.error);
        }}
        className={BUTTON.secondary}
      >
        <RotateCcw className="size-3.5" /> {busy ? 'Reverting…' : 'Revert this change'}
      </button>
      {error && (
        <p role="alert" className="text-sm whitespace-pre-line text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function revertError(err: unknown): string {
  return err instanceof ApiError ? [err.message, ...err.issues].join('\n') : String(err);
}
