import type { Desk, DeskItem, DeskRun } from '@pharos/schema';
import clsx from 'clsx';
import {
  AlertTriangle,
  Check,
  CircleCheck,
  Clock,
  FileText,
  Inbox,
  ListChecks,
  Lock,
  Moon,
  Scale,
} from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, NavLink } from 'react-router';
import { BUTTON } from '../catalog/ui';
import { postJson, useResource } from '../lib/api';
import { useRevisionEvents } from '../lib/events';
import { LoadError } from './onboarding';

// The desk (R16, docs/reframe/r16-desk.md): everything waiting on the owner in every project,
// answered in place where it's small (a choice, a task done) and opened where it isn't (a sheet).

/** "5 min", "1 h 30 min". */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** How long something has waited: "now", "40 min", "5 h", "3 d". */
export function waited(since: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(since)) / 60_000));
  if (minutes < 2) return 'now';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

/** "just now", "40 min ago". */
const ago = (since: string) => {
  const w = waited(since);
  return w === 'now' ? 'just now' : `${w} ago`;
};

const KIND_ICON = { decision: Scale, sheet: FileText, task: ListChecks, run: Moon } as const;

function Answer({ item, onDone }: { item: DeskItem; onDone: (message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteFor, setNoteFor] = useState<NonNullable<DeskItem['options']>[number] | null>(null);
  const [note, setNote] = useState('');
  const send = async (body: object, path = '/api/desk/answer') => {
    setBusy(true);
    setError(null);
    try {
      const result = await postJson<{ revision?: { message: string } }>(path, body);
      onDone(result.revision?.message ?? 'Saved');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };
  if (item.kind === 'decision' && item.options?.length) {
    if (noteFor)
      return (
        <form
          className="mt-2 space-y-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (note.trim())
              void send({ id: item.id, chosenOptionId: noteFor.id, note: note.trim() });
          }}
        >
          <label className="block text-sm">
            <span className="text-muted">{noteFor.asks}</span>
            <textarea
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              className="mt-1 block w-full rounded-control border border-line-strong bg-surface p-2 text-sm"
            />
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={busy || !note.trim()} className={BUTTON.primary}>
              Choose “{noteFor.label}”
            </button>
            <button type="button" onClick={() => setNoteFor(null)} className={BUTTON.secondary}>
              Cancel
            </button>
          </div>
          {error && <p className="text-sm text-danger">{error}</p>}
        </form>
      );
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {item.options.map((o) => (
          <button
            key={o.id}
            type="button"
            disabled={busy}
            onClick={() =>
              o.asks ? setNoteFor(o) : void send({ id: item.id, chosenOptionId: o.id })
            }
            className={clsx(
              'rounded-control border px-2.5 py-1 text-sm transition disabled:opacity-50',
              o.id === item.recommendedOptionId
                ? 'border-sky-300 bg-sky-50 text-sky-900 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100'
                : 'border-line-strong bg-surface text-ink-soft hover:bg-sunken',
            )}
          >
            {o.label}
            {o.id === item.recommendedOptionId && (
              <span className="ml-1.5 text-xs text-sky-700 dark:text-sky-300">suggested</span>
            )}
          </button>
        ))}
        {error && <p className="w-full text-sm text-danger">{error}</p>}
      </div>
    );
  }
  if (item.kind === 'task')
    return (
      <div className="mt-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void send({ id: item.id, done: true })}
          className="inline-flex items-center gap-1 rounded-control border border-line-strong px-2.5 py-1 text-sm text-ink-soft hover:border-emerald-500 hover:text-emerald-600 disabled:opacity-50"
        >
          <Check aria-hidden className="size-3.5" strokeWidth={3} /> Mark done
        </button>
        {error && <p className="mt-1 text-sm text-danger">{error}</p>}
      </div>
    );
  if (item.kind === 'run')
    return (
      <div className="mt-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void send({}, `/api/runs/${encodeURIComponent(item.id)}/seen`)}
          className={BUTTON.secondary}
        >
          Seen
        </button>
        {error && <p className="mt-1 text-sm text-danger">{error}</p>}
      </div>
    );
  return null;
}

function Row({ item, onDone }: { item: DeskItem; onDone: (message: string) => void }) {
  const Icon = KIND_ICON[item.kind];
  return (
    <li
      id={item.kind === 'run' ? item.id : undefined}
      data-desk-item={item.kind}
      className="flex gap-3 rounded-block border border-line bg-surface p-3 sm:p-4"
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-faint" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <Link to={item.href} className="font-medium text-ink hover:underline">
            {item.title}
          </Link>
          {item.gate && (
            <span className="inline-flex items-center gap-0.5 text-xs font-medium text-warn">
              <Lock aria-hidden className="size-3" /> only you
            </span>
          )}
        </div>
        <p className="mt-0.5 text-sm text-muted">
          {item.project && <span className="text-ink-soft">{item.project}</span>}
          {item.project && item.ask && ' · '}
          {item.ask}
        </p>
        <Answer item={item} onDone={onDone} />
      </div>
      <div className="shrink-0 text-right text-xs text-muted tabular-nums">
        {item.minutes !== undefined && (
          <div title="About how long it takes">~{formatMinutes(item.minutes)}</div>
        )}
        <div className={clsx(item.overdue && 'font-medium text-warn')}>
          <Clock aria-hidden className="mr-0.5 inline size-3" />
          <span className="sr-only">waiting </span>
          {waited(item.since)}
        </div>
      </div>
    </li>
  );
}

function RunChip({ run }: { run: DeskRun }) {
  const bad = run.outcome === 'failed' || run.outcome === 'partial';
  const label =
    run.outcome === 'running'
      ? 'running'
      : run.outcome === 'ok'
        ? 'ok'
        : run.outcome === 'partial'
          ? 'partly done'
          : 'failed';
  const body = (
    <>
      {bad ? (
        <AlertTriangle aria-hidden className="size-3.5 text-warn" />
      ) : (
        <CircleCheck aria-hidden className="size-3.5 text-ok" />
      )}
      <span className="font-medium text-ink-soft">{run.name}</span>
      <span>
        {label} · {ago(run.endedAt ?? run.startedAt)}
      </span>
    </>
  );
  const className =
    'inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-muted';
  return (
    <li title={run.summary}>
      {run.viewId && run.projectId ? (
        <Link
          to={`/projects/${run.projectId}/views/${run.viewId}`}
          className={clsx(className, 'hover:bg-sunken')}
        >
          {body}
        </Link>
      ) : (
        <span className={className}>{body}</span>
      )}
    </li>
  );
}

export function DeskPage() {
  const desk = useResource<Desk>('/api/desk');
  const { reload } = desk;
  const [notice, setNotice] = useState<string | null>(null);
  // Anyone's change can open or close an item; runs aren't revisions, so look again each minute.
  useRevisionEvents(() => reload());
  useEffect(() => {
    const timer = setInterval(reload, 60_000);
    return () => clearInterval(timer);
  }, [reload]);
  const onDone = (message: string) => {
    setNotice(message);
    reload();
  };
  if (desk.status === 'error') return <LoadError notFound={false} what="Desk" />;
  const data = desk.data;
  const fresh = data?.items.filter((i) => !i.old) ?? [];
  const overdue = fresh.filter((i) => i.overdue);
  const today = fresh.filter((i) => !i.overdue);
  const old = data?.items.filter((i) => i.old) ?? [];
  const minutes = fresh.reduce((sum, i) => sum + (i.minutes ?? 0), 0);
  const section = (title: string, items: DeskItem[], tone?: 'warn') =>
    items.length > 0 && (
      <section className="space-y-2" aria-label={title}>
        <h2 className={clsx('text-sm font-medium', tone ? 'text-warn' : 'text-muted')}>
          {title} <span className="tabular-nums">({items.length})</span>
        </h2>
        <ul className="space-y-2">
          {items.map((item) => (
            <Row key={item.id} item={item} onDone={onDone} />
          ))}
        </ul>
      </section>
    );
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
      <header className="space-y-1">
        <p className="text-xs font-semibold tracking-wide text-faint uppercase">Desk</p>
        {data ? (
          <h1 data-needs-you="" className="text-2xl font-semibold tracking-tight">
            {fresh.length ? (
              <>
                Needs you: {fresh.length} {fresh.length === 1 ? 'item' : 'items'}
                {minutes > 0 && <>, about {formatMinutes(minutes)}</>}
              </>
            ) : (
              'Nothing needs you'
            )}
          </h1>
        ) : (
          <div className="h-8 w-64 animate-pulse rounded bg-sunken" />
        )}
        {overdue.length > 0 && (
          <p className="text-sm text-warn">{overdue.length} waiting more than two days</p>
        )}
      </header>
      {notice && (
        <p role="status" className="rounded-control bg-sunken px-3 py-2 text-sm text-ink-soft">
          {notice}
        </p>
      )}
      {data && data.runs.length > 0 && (
        <section aria-label="Runs">
          <ul className="flex flex-wrap gap-2">
            {data.runs.map((run) => (
              <RunChip key={run.id} run={run} />
            ))}
          </ul>
        </section>
      )}
      {section('Waiting more than two days', overdue, 'warn')}
      {section('Today', today)}
      {old.length > 0 && (
        <details className="group space-y-2">
          <summary className="cursor-pointer text-sm font-medium text-muted">
            Older than two weeks <span className="tabular-nums">({old.length})</span>
          </summary>
          <ul className="mt-2 space-y-2">
            {old.map((item) => (
              <Row key={item.id} item={item} onDone={onDone} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** The sidebar's way to the desk, with how many items wait (today's, not the old ones). */
export function DeskLink() {
  const desk = useResource<Desk>('/api/desk');
  const { reload } = desk;
  useRevisionEvents(() => reload());
  useEffect(() => {
    const timer = setInterval(reload, 60_000);
    return () => clearInterval(timer);
  }, [reload]);
  const items = desk.data?.items?.filter((i) => !i.old) ?? [];
  const overdue = items.some((i) => i.overdue);
  return (
    <NavLink
      to="/desk"
      className={({ isActive }) =>
        clsx(
          'flex w-full items-center gap-1.5 rounded-control px-2 py-1.5 text-sm',
          isActive ? 'bg-subtle font-medium text-ink' : 'text-ink-soft hover:bg-sunken',
        )
      }
    >
      <Inbox aria-hidden className="size-3.5" /> Desk
      {items.length > 0 && (
        <span
          data-desk-count=""
          className={clsx(
            'ml-auto rounded-full px-1.5 text-xs tabular-nums',
            overdue
              ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
              : 'bg-sunken text-muted',
          )}
        >
          {items.length}
          <span className="sr-only"> waiting{overdue ? ', some over two days' : ''}</span>
        </span>
      )}
    </NavLink>
  );
}
