import type { Desk, DeskItem, DeskRun } from '@pharos/schema';
import clsx from 'clsx';
import {
  Sparkles,
  AlertTriangle,
  ArrowRight,
  ArrowUpDown,
  Check,
  ChevronDown,
  CircleCheck,
  Clock,
  Ellipsis,
  FileText,
  Inbox,
  ListChecks,
  Loader2,
  Lock,
  Moon,
  Scale,
} from 'lucide-react';
import { useEffect, useState, type FormEvent, type MouseEvent } from 'react';
import { Link, NavLink } from 'react-router';
import { OtherAnswerButton } from '../catalog/components/task-answer';
import { Menu, MenuItem } from '../catalog/menu';
import { Popover, usePopover } from '../catalog/popover';
import { Tooltip } from '../catalog/tooltip';
import { BUTTON } from '../catalog/ui';
import { postJson, useResource } from '../lib/api';
import { useRevisionEvents } from '../lib/events';
import { LoadError } from './onboarding';

// The desk (R16, docs/reframe/r16-desk.md): everything waiting on the owner in every project,
// answered in place where it's small (a choice, a task done) and opened where it isn't (a sheet).
// Compact (owner's review 2026-10-22): one line per item, grouped by what the owner does with it,
// and runs in one pill that opens the ones that need a look.

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

const KIND_ICON = { decision: Scale, sheet: FileText, task: ListChecks, run: Moon } as const;

/** Small buttons on a one-line row. */
const ROW_BUTTON =
  'inline-flex shrink-0 items-center gap-1 rounded-control border px-2 py-0.5 text-xs transition disabled:opacity-50';
const PLAIN = 'border-line-strong bg-surface text-ink-soft hover:bg-sunken';
const SUGGESTED =
  'border-sky-300 bg-sky-50 text-sky-900 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-100';
const ICON_ROW_BUTTON =
  'inline-flex size-6 shrink-0 items-center justify-center rounded-control border border-line-strong bg-surface text-ink-soft hover:bg-sunken disabled:opacity-50';

/** Wider than a phone (Tailwind's `sm`): rows have room for two answers. */
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

/** Saves an answer from the desk and reports its revision message, or the error. */
function useDeskSend(onDone: (message: string) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (body: object, path = '/api/desk/answer') => {
    setBusy(true);
    setError(null);
    try {
      const result = await postJson<{ revision?: { message: string } }>(path, body);
      onDone(result.revision?.message ?? 'Saved');
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, send };
}

/** The note an option asks for, in a small panel under its button. */
function NoteForm({
  option,
  busy,
  onSave,
  onCancel,
}: {
  option: NonNullable<DeskItem['options']>[number];
  busy: boolean;
  onSave: (note: string) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState('');
  return (
    <form
      className="space-y-2"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (note.trim()) onSave(note.trim());
      }}
    >
      <label className="block text-sm">
        <span className="text-muted">{option.asks}</span>
        <textarea
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          className="mt-1 block w-full rounded-control border border-line-strong bg-surface p-2 text-sm"
        />
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !note.trim()} className={BUTTON.primary}>
          Choose “{option.label}”
        </button>
        <button type="button" onClick={onCancel} className={BUTTON.secondary}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * The answer at the end of a row: a decision's options (on a phone only the suggested one), a
 * task's Mark done and other answers, a sheet's way in.
 */
function Answer({ item, onDone }: { item: DeskItem; onDone: (message: string) => void }) {
  const { busy, error, send } = useDeskSend(onDone);
  const wide = useWide();
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const [note, setNote] = useState<{
    option: NonNullable<DeskItem['options']>[number];
    anchor: DOMRect;
  } | null>(null);
  const failed = error && (
    <Tooltip label="Not saved" detail={error}>
      <span tabIndex={0} className="text-danger">
        <AlertTriangle aria-label={`Not saved: ${error}`} className="size-3.5" />
      </span>
    </Tooltip>
  );
  if (item.kind === 'decision' && item.options?.length) {
    // The suggested option first; two fit on a row (on a phone only the suggested one), and the
    // rest wait in the ··· menu.
    const options = [...item.options].sort(
      (x, y) =>
        Number(y.id === item.recommendedOptionId) - Number(x.id === item.recommendedOptionId),
    );
    const inline = options
      .slice(0, wide ? 2 : 1)
      .filter((o) => wide || o.id === item.recommendedOptionId);
    const more = options.filter((o) => !inline.includes(o));
    const choose = (o: (typeof options)[number], anchor: DOMRect) =>
      o.asks ? setNote({ option: o, anchor }) : void send({ id: item.id, chosenOptionId: o.id });
    return (
      <div className="flex shrink-0 items-center gap-1.5">
        {failed}
        {inline.map((o) => {
          const suggested = o.id === item.recommendedOptionId;
          return (
            <button
              key={o.id}
              type="button"
              disabled={busy}
              title={o.label}
              onClick={(e: MouseEvent<HTMLButtonElement>) =>
                choose(o, e.currentTarget.getBoundingClientRect())
              }
              className={clsx(ROW_BUTTON, 'max-w-44', suggested ? SUGGESTED : PLAIN)}
            >
              <span className="truncate">{o.label}</span>
              {suggested && <span className="sr-only"> (suggested)</span>}
            </button>
          );
        })}
        {more.length > 0 && (
          <button
            type="button"
            disabled={busy}
            aria-label={`More answers for “${item.title}”`}
            aria-haspopup="menu"
            aria-expanded={menu !== null}
            title="More answers"
            onClick={(e: MouseEvent<HTMLButtonElement>) =>
              setMenu(menu ? null : e.currentTarget.getBoundingClientRect())
            }
            className={ICON_ROW_BUTTON}
          >
            <Ellipsis aria-hidden className="size-3.5" />
          </button>
        )}
        {menu && (
          <Menu
            anchor={menu}
            align="end"
            label={`Answer “${item.title}”`}
            onClose={() => setMenu(null)}
          >
            {more.map((o) => (
              <MenuItem
                key={o.id}
                onClick={() => {
                  const anchor = menu;
                  setMenu(null);
                  choose(o, anchor);
                }}
              >
                {o.label}
                {o.id === item.recommendedOptionId && (
                  <span className="text-xs text-sky-700 dark:text-sky-300"> suggested</span>
                )}
              </MenuItem>
            ))}
          </Menu>
        )}
        {note && (
          <Popover
            anchor={note.anchor}
            label={`Note for “${note.option.label}”`}
            onClose={() => setNote(null)}
          >
            <NoteForm
              option={note.option}
              busy={busy}
              onCancel={() => setNote(null)}
              onSave={(text) =>
                void send({ id: item.id, chosenOptionId: note.option.id, note: text }).then(
                  (ok) => ok && setNote(null),
                )
              }
            />
          </Popover>
        )}
      </div>
    );
  }
  if (item.kind === 'task')
    return (
      <div className="flex shrink-0 items-center gap-1.5">
        {failed}
        <button
          type="button"
          disabled={busy}
          aria-label={`Mark “${item.title}” done`}
          title="Mark done"
          onClick={() => void send({ id: item.id, done: true })}
          className={clsx(ICON_ROW_BUTTON, 'hover:border-emerald-500 hover:text-emerald-600')}
        >
          <Check aria-hidden className="size-3.5" strokeWidth={3} />
        </button>
        {/* Or: won't do, later (it comes back on that day), or a reply of their own. */}
        <OtherAnswerButton
          title={item.title}
          busy={busy}
          onAnswer={(a) =>
            send(
              a.kind === 'wontDo'
                ? { id: item.id, wontDo: true }
                : a.kind === 'later'
                  ? { id: item.id, later: a.until }
                  : a.kind === 'reply'
                    ? { id: item.id, reply: a.text }
                    : { id: item.id },
            )
          }
        />
      </div>
    );
  return (
    <Link
      to={item.href}
      aria-label={`Open “${item.title}”`}
      title="Open"
      className={ICON_ROW_BUTTON}
    >
      <ArrowRight aria-hidden className="size-3.5" />
    </Link>
  );
}

/**
 * One line: what it is, the title (its ask in the tooltip), only-you, project, time it takes,
 * how long it has waited once that's over two days, and the answer.
 */
function Row({ item, onDone }: { item: DeskItem; onDone: (message: string) => void }) {
  const Icon = KIND_ICON[item.kind];
  return (
    <li
      data-desk-item={item.kind}
      className="flex min-h-11 items-center gap-2.5 px-3 py-1.5 sm:gap-3"
    >
      <Icon aria-hidden className="size-3.5 shrink-0 text-faint" />
      <Tooltip label={item.title} detail={item.ask} className="flex min-w-24 flex-1 sm:min-w-56">
        <Link
          to={item.href}
          className="min-w-0 truncate text-sm font-medium text-ink hover:underline"
        >
          {item.title}
        </Link>
      </Tooltip>
      {item.gate && <Lock aria-label="only you" className="size-3 shrink-0 text-warn" />}
      {item.project && (
        <span className="hidden max-w-36 shrink-0 truncate text-xs text-muted sm:block">
          {item.project}
        </span>
      )}
      <span className="hidden w-12 shrink-0 text-right text-xs text-muted tabular-nums sm:block">
        {item.minutes !== undefined && (
          <span title="About how long it takes">
            ~{formatMinutes(item.minutes).replace(' min', 'm')}
          </span>
        )}
      </span>
      {item.overdue && (
        <span className="shrink-0 text-xs font-medium text-warn tabular-nums">
          <span className="sr-only">waiting </span>
          {waited(item.since)}
        </span>
      )}
      <Answer item={item} onDone={onDone} />
    </li>
  );
}

/** A group of rows under a small heading. */
function Group({
  title,
  items,
  onDone,
}: {
  title: string;
  items: DeskItem[];
  onDone: (message: string) => void;
}) {
  if (!items.length) return null;
  return (
    <section aria-label={title} className="space-y-1.5">
      <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">
        {title} <span className="tabular-nums text-faint">{items.length}</span>
      </h2>
      <ul className="divide-y divide-line-soft rounded-block border border-line bg-surface">
        {items.map((item) => (
          <Row key={item.id} item={item} onDone={onDone} />
        ))}
      </ul>
    </section>
  );
}

/**
 * The runs in one pill: how many went fine, how many need a look. It opens the ones that need a
 * look (failed or partly done, not yet seen), with their summaries and one Seen all.
 */
function RunsPill({
  runs,
  look,
  onDone,
}: {
  runs: DeskRun[];
  look: DeskItem[];
  onDone: (message: string) => void;
}) {
  const popover = usePopover();
  const { busy, error, send } = useDeskSend(onDone);
  const ok = runs.filter((r) => r.outcome === 'ok').length;
  const running = runs.some((r) => r.outcome === 'running');
  if (!runs.length && !look.length) return null;
  const seenAll = async () => {
    for (const run of look)
      if (!(await send({}, `/api/runs/${encodeURIComponent(run.id)}/seen`))) return;
    popover.close(true);
    onDone(`Seen ${look.length} ${look.length === 1 ? 'run' : 'runs'}`);
  };
  return (
    <>
      <button
        type="button"
        {...popover.trigger}
        aria-label={`Runs: ${ok} ok, ${look.length} need a look`}
        className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-muted hover:bg-sunken"
      >
        {running && <Loader2 aria-hidden className="size-3.5 animate-spin" />}
        <span className="inline-flex items-center gap-0.5 text-ok">
          <CircleCheck aria-hidden className="size-3.5" />
          <span className="tabular-nums">{ok}</span>
        </span>
        {look.length > 0 && (
          <span className="inline-flex items-center gap-0.5 text-warn">
            <AlertTriangle aria-hidden className="size-3.5" />
            <span className="tabular-nums">{look.length}</span>
          </span>
        )}
        runs
        <ChevronDown aria-hidden className="size-3" />
      </button>
      {popover.anchor && (
        <Popover anchor={popover.anchor} label="Runs that need a look" onClose={popover.close}>
          <div className="space-y-2">
            {look.length ? (
              <>
                <ul className="space-y-2">
                  {look.map((run) => (
                    <li key={run.id} data-desk-item="run" className="flex gap-2">
                      <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warn" />
                      <div className="min-w-0">
                        <Link to={run.href} className="font-medium text-ink hover:underline">
                          {run.title}
                        </Link>
                        {run.ask && <p className="line-clamp-2 text-xs text-muted">{run.ask}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void seenAll()}
                  className={BUTTON.secondary}
                >
                  Seen all
                </button>
                {error && <p className="text-xs text-danger">{error}</p>}
              </>
            ) : (
              <p className="text-muted">
                {ok} {ok === 1 ? 'run' : 'runs'} went fine; nothing needs a look.
              </p>
            )}
          </div>
        </Popover>
      )}
    </>
  );
}

type LandedNews = {
  since: number;
  projects: {
    projectId: string;
    project: string;
    revisions: number;
    agents: string[];
    latest: { message: string; at: string };
  }[];
};

/**
 * What agents landed since you last opened the desk, by project (the Routines morning report's
 * "what landed", now in Pharos). Read once when the desk opens, which then marks it seen, so the
 * next visit shows only what is new.
 */
/** The busiest projects shown at first; the rest behind one click. */
const LANDED_SHOWN = 5;

function Landed() {
  const [news, setNews] = useState<LandedNews | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await fetch('/api/desk/landed');
        const data = (await res.json()) as LandedNews;
        if (!live || !Array.isArray(data?.projects)) return;
        setNews(data);
        await fetch('/api/desk/seen', { method: 'PUT' });
      } catch {
        // Nothing new to show is fine.
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  if (!news?.projects.length) return null;
  const total = news.projects.reduce((n, p) => n + p.revisions, 0);
  return (
    <section aria-label="Since you last looked" data-landed="" className="space-y-2">
      <h2 className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
        <Sparkles aria-hidden className="size-3.5" />
        Since you last looked
        <span className="font-normal tracking-normal text-faint normal-case tabular-nums">
          {total} {total === 1 ? 'change' : 'changes'} by agents
        </span>
      </h2>
      <ul className="divide-y divide-line-soft rounded-block border border-line bg-surface">
        {(all ? news.projects : news.projects.slice(0, LANDED_SHOWN)).map((p) => (
          <li key={p.projectId} className="flex items-center gap-3 px-3 py-2 text-sm">
            <Link
              to={`/projects/${p.projectId}`}
              className="shrink-0 font-medium text-ink hover:underline"
            >
              {p.project}
            </Link>
            <Tooltip
              label={p.latest.message}
              detail={p.agents.join(', ')}
              className="flex min-w-0 flex-1"
            >
              <span tabIndex={0} className="min-w-0 flex-1 truncate text-muted">
                {p.latest.message}
              </span>
            </Tooltip>
            <span className="shrink-0 rounded-full bg-sunken px-1.5 text-xs text-muted tabular-nums">
              {p.revisions}
              <span className="sr-only"> changes</span>
            </span>
          </li>
        ))}
      </ul>
      {news.projects.length > LANDED_SHOWN && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          aria-expanded={all}
          className="text-xs text-muted hover:underline"
        >
          {all ? 'Fewer' : `+${news.projects.length - LANDED_SHOWN}`}
          <span className="sr-only"> projects</span>
        </button>
      )}
    </section>
  );
}

const DESK_VIEW_KEY = 'pharos-desk-view';

/** How the desk orders each group: the server's order (gates, then waiting longest) or another. */
export const DESK_SORTS = {
  waiting: 'Waiting longest',
  newest: 'Newest',
  quickest: 'Quickest first',
} as const;
export type DeskSort = keyof typeof DESK_SORTS;

/** The desk's filter and order, remembered per browser. */
type DeskView = { project: string | null; sort: DeskSort };

function loadDeskView(): DeskView {
  try {
    const saved = JSON.parse(localStorage.getItem(DESK_VIEW_KEY) ?? '{}') as Partial<DeskView>;
    return {
      project: typeof saved.project === 'string' ? saved.project : null,
      sort: saved.sort && saved.sort in DESK_SORTS ? saved.sort : 'waiting',
    };
  } catch {
    return { project: null, sort: 'waiting' };
  }
}

/** One project's items (or all), in the chosen order; the server's order breaks ties. */
export function arrangeDesk(items: DeskItem[], view: DeskView): DeskItem[] {
  const shown = view.project ? items.filter((i) => i.projectId === view.project) : items;
  if (view.sort === 'waiting') return shown;
  const order = new Map(items.map((item, index) => [item.id, index]));
  const tie = (a: DeskItem, b: DeskItem) => order.get(a.id)! - order.get(b.id)!;
  return [...shown].sort((a, b) =>
    view.sort === 'newest'
      ? b.since.localeCompare(a.since) || tie(a, b)
      : (a.minutes ?? Infinity) - (b.minutes ?? Infinity) || tie(a, b),
  );
}

/** What needs the owner now: not runs (the pill has those) and not the folded old ones. */
const isOpen = (item: DeskItem) => item.kind !== 'run' && !item.old;

/** The projects with something open on the desk, with how many, most first. */
export function deskProjects(items: DeskItem[]): { id: string; name: string; count: number }[] {
  const projects = new Map<string, { id: string; name: string; count: number }>();
  for (const item of items) {
    if (!item.projectId || !isOpen(item)) continue;
    const entry = projects.get(item.projectId) ?? {
      id: item.projectId,
      name: item.project ?? item.projectId,
      count: 0,
    };
    entry.count += 1;
    projects.set(item.projectId, entry);
  }
  return [...projects.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

const CONTROL =
  'inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-muted hover:bg-sunken';

/** One menu for the project (only projects with something open) and one for the order. */
function DeskControls({
  items,
  view,
  onView,
}: {
  items: DeskItem[];
  view: DeskView;
  onView: (view: DeskView) => void;
}) {
  const [open, setOpen] = useState<{ which: 'project' | 'sort'; anchor: DOMRect } | null>(null);
  const projects = deskProjects(items);
  const chosen = projects.find((p) => p.id === view.project);
  const total = items.filter(isOpen).length;
  const opener = (which: 'project' | 'sort') => ({
    'aria-haspopup': 'menu' as const,
    'aria-expanded': open?.which === which,
    onClick: (e: MouseEvent<HTMLButtonElement>) =>
      setOpen(
        open?.which === which ? null : { which, anchor: e.currentTarget.getBoundingClientRect() },
      ),
  });
  const pick = (next: DeskView) => {
    setOpen(null);
    onView(next);
  };
  return (
    <>
      {projects.length > 1 && (
        <button
          type="button"
          {...opener('project')}
          className={clsx(CONTROL, chosen && 'border-accent text-ink')}
        >
          <span className="max-w-40 truncate">{chosen ? chosen.name : 'All projects'}</span>
          <ChevronDown aria-hidden className="size-3" />
        </button>
      )}
      <button
        type="button"
        {...opener('sort')}
        aria-label={`Sort: ${DESK_SORTS[view.sort]}`}
        className={CONTROL}
      >
        <ArrowUpDown aria-hidden className="size-3" />
        <span className="hidden sm:inline">{DESK_SORTS[view.sort]}</span>
      </button>
      {open?.which === 'project' && (
        <Menu anchor={open.anchor} label="Project" onClose={() => setOpen(null)}>
          <MenuItem current={!view.project} onClick={() => pick({ ...view, project: null })}>
            All projects <span className="text-faint tabular-nums">{total}</span>
          </MenuItem>
          {projects.map((p) => (
            <MenuItem
              key={p.id}
              current={view.project === p.id}
              onClick={() => pick({ ...view, project: p.id })}
            >
              {p.name} <span className="text-faint tabular-nums">{p.count}</span>
            </MenuItem>
          ))}
        </Menu>
      )}
      {open?.which === 'sort' && (
        <Menu anchor={open.anchor} label="Sort" align="end" onClose={() => setOpen(null)}>
          {(Object.keys(DESK_SORTS) as DeskSort[]).map((sort) => (
            <MenuItem
              key={sort}
              current={view.sort === sort}
              onClick={() => pick({ ...view, sort })}
            >
              {DESK_SORTS[sort]}
            </MenuItem>
          ))}
        </Menu>
      )}
    </>
  );
}

export function DeskPage() {
  const desk = useResource<Desk>('/api/desk');
  const { reload } = desk;
  const [notice, setNotice] = useState<string | null>(null);
  const [deskView, setDeskViewState] = useState(loadDeskView);
  const setDeskView = (next: DeskView) => {
    setDeskViewState(next);
    try {
      localStorage.setItem(DESK_VIEW_KEY, JSON.stringify(next));
    } catch {
      // Not remembered: fine.
    }
  };
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
  const all = data?.items ?? [];
  // A project with nothing open any more shows them all again.
  const view =
    deskView.project && !deskProjects(all).some((p) => p.id === deskView.project)
      ? { ...deskView, project: null }
      : deskView;
  const open = all.filter(isOpen);
  const minutes = open.reduce((sum, i) => sum + (i.minutes ?? 0), 0);
  const overdue = open.filter((i) => i.overdue).length;
  const shown = arrangeDesk(all, view);
  const fresh = shown.filter(isOpen);
  const old = shown.filter((i) => i.kind !== 'run' && i.old);
  const look = all.filter((i) => i.kind === 'run' && !i.old);
  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-8">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 data-needs-you="" className="text-2xl font-semibold tracking-tight">
          {!data ? (
            <span className="block h-8 w-64 animate-pulse rounded bg-sunken" />
          ) : open.length ? (
            <>
              Needs you: {open.length}
              {minutes > 0 && <> · ~{formatMinutes(minutes)}</>}
            </>
          ) : (
            'Nothing needs you'
          )}
        </h1>
        {overdue > 0 && (
          <span className="flex items-center gap-1 text-xs text-warn">
            <Clock aria-hidden className="size-3" /> {overdue} over two days
          </span>
        )}
        <div className="flex basis-full flex-wrap items-center gap-1.5 sm:ml-auto sm:basis-auto">
          {data && <DeskControls items={all} view={view} onView={setDeskView} />}
          {data && <RunsPill runs={data.runs} look={look} onDone={onDone} />}
        </div>
      </header>
      {notice && (
        <p role="status" className="rounded-control bg-sunken px-3 py-2 text-sm text-ink-soft">
          {notice}
        </p>
      )}
      <Group title="Only you" items={fresh.filter((i) => i.gate)} onDone={onDone} />
      <Group
        title="Answer here"
        items={fresh.filter((i) => !i.gate && i.kind !== 'sheet')}
        onDone={onDone}
      />
      <Group
        title="Open to review"
        items={fresh.filter((i) => !i.gate && i.kind === 'sheet')}
        onDone={onDone}
      />
      <Landed />
      {old.length > 0 && (
        <details className="space-y-2">
          <summary className="cursor-pointer text-sm text-muted">
            Older than two weeks <span className="tabular-nums">({old.length})</span>
          </summary>
          <ul className="mt-2 divide-y divide-line-soft rounded-block border border-line bg-surface">
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
  // What needs the owner, as the desk counts it: not runs, not the folded old ones.
  const items = desk.data?.items?.filter(isOpen) ?? [];
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
