import {
  DIFFICULTIES,
  ROUTINE_MODELS,
  ROUTINES,
  describeRoutinesChange,
  routineCovers,
  routinesOf,
  type Desk,
  type DeskItem,
  type DeskRun,
  type Routine,
  type RoutineDef,
  type RoutineRun,
  type RoutinesChange,
  type RoutinesConfig,
  type RoutinesPharos,
  type RoutinesProject,
  type RoutinesProjectStatus,
  type RoutinesState,
} from '@pharos/schema';
import clsx from 'clsx';
import {
  AlertTriangle,
  Brush,
  CalendarClock,
  Globe,
  Check,
  ChevronRight,
  Flag,
  GitBranch,
  Inbox,
  Loader2,
  Moon,
  MoreHorizontal,
  Newspaper,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Repeat,
  ScrollText,
  Sun,
  Sunset,
  Trash2,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '../catalog/menu';
import { Select } from '../catalog/select';
import { ICON_GHOST, InfoTip, Tooltip } from '../catalog/tooltip';
import { BUTTON } from '../catalog/ui';
import { ApiError, getJson, useResource } from '../lib/api';
import { plural } from '../lib/format';
import { isOpen as needsOwner } from './DeskPage';
import { LoadError } from './onboarding';
import { Switch } from './settings-ui';

// The Routines page: the owner's routines (the evening wrap-up, the night run, the morning report
// and any the owner adds) at a glance. The engine is the Routines app; Pharos reads it through
// /api/routines/* and shows only what's needed (owner's reviews 2026-10-23): tonight as a band of
// routines, evenly spaced in order, with now moving along it; one line per project with each
// routine's last result as a dot; the rest one hover or click away. Every "needs you" number is
// the desk's own count for that project's Pharos projects, and opens the desk on exactly those.

const SKILL_ICON: Record<Routine, LucideIcon> = {
  wrapup: Sunset,
  nightshift: Moon,
  daybreak: Sun,
};

/** A routine's symbol: a built-in's own; one the owner added: a calendar clock. */
export function routineIcon(r: Pick<RoutineDef, 'skill'>): LucideIcon {
  return r.skill && r.skill in SKILL_ICON ? SKILL_ICON[r.skill as Routine] : CalendarClock;
}

const CLEANUP_LEVELS: Record<number, { name: string; line: string; about: string }> = {
  0: { name: 'Off', line: 'nothing is cleaned up', about: 'Cleanup is turned off.' },
  1: {
    name: 'Safe',
    line: 'merged worktrees, branches and old scratch go after the wrap-up',
    about:
      'After the full wrap-up: worktrees already in main with no changes, merged branches, and scratch folders older than the kept days. Each removal is listed with the command that brings it back.',
  },
  2: {
    name: 'Tidy',
    line: 'proposals on your desk; nothing moves until you approve',
    about:
      'Level 1 runs as before; anything more is proposed on your desk, and nothing is removed until you approve it.',
  },
  3: { name: 'Deep', line: 'not built yet; runs as level 2', about: 'Level 3 is not built yet.' },
};

/** Writes and runs say who asks: the Pharos server refuses them otherwise. */
async function ownerPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-pharos-author': 'human:me' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok)
    throw new ApiError(
      res.status,
      data?.error?.message ?? `HTTP ${res.status}`,
      data?.error?.issues,
    );
  return data as T;
}

// ── Time ────────────────────────────────────────────────────────────────────────────────────

/** Now in `timeZone` (the schedule's), as minutes since midnight. */
export function minutesIn(timeZone: string | undefined, now = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    return (get('hour') % 24) * 60 + get('minute');
  } catch {
    return now.getHours() * 60 + now.getMinutes();
  }
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** "Tonight" starts at noon: an evening routine comes before the night and the morning. */
const DAY_START = 12 * 60;
const sinceNoon = (minutes: number) => (minutes - DAY_START + 1440) % 1440;

/** The routines in the order they run from noon: evening, night, morning. */
export function inOrder<T extends Pick<RoutineDef, 'time'>>(routines: T[]): T[] {
  return [...routines].sort((a, b) => sinceNoon(toMinutes(a.time)) - sinceNoon(toMinutes(b.time)));
}

/** The next enabled routine to fire, and in how many minutes. */
export function nextRun<T extends Pick<RoutineDef, 'time' | 'enabled'>>(
  routines: T[],
  timeZone: string | undefined,
  now = new Date(),
): { routine: T; inMinutes: number } | null {
  const current = minutesIn(timeZone, now);
  const due = routines
    .filter((r) => r.enabled && /^\d\d:\d\d$/.test(r.time))
    // A run at this very minute is firing now; the next one is tomorrow's.
    .map((routine) => ({
      routine,
      inMinutes: (toMinutes(routine.time) - current + 1440) % 1440 || 1440,
    }));
  return due.sort((a, b) => a.inMinutes - b.inMinutes)[0] ?? null;
}

/** "in 45 min", "in 10 h 26 min". */
export function inTime(minutes: number): string {
  if (minutes < 60) return `in ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `in ${h} h ${m} min` : `in ${h} h`;
}

/** The short name of `timeZone` right now ("CDT"); empty when the browser doesn't know it. */
function zoneName(timeZone: string | undefined): string {
  if (!timeZone) return '';
  try {
    return (
      new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
        .formatToParts(new Date())
        .find((p) => p.type === 'timeZoneName')?.value ?? ''
    );
  } catch {
    return '';
  }
}

/** A Routines time ("2026-10-23T00:02", the Routines computer's local time): "00:02" today. */
export function runTime(when: string | null | undefined, today: string): string {
  if (!when) return '';
  const [day, time] = when.split('T');
  if (day === today) return time ?? '';
  const d = new Date(`${day}T12:00`);
  const date = Number.isNaN(d.getTime())
    ? day
    : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(d);
  return `${date} ${time ?? ''}`.trim();
}

/**
 * Where the routines sit on the band (0–1): evenly spaced, in the order they run (the owner's
 * review: order matters, not clock distance). `at(minutes)` places a time (now) between the two
 * routines around it, in proportion to the time between them; before the first and after the
 * last it runs to the band's ends, which stand for noon.
 */
export function band(times: string[]) {
  const n = times.length;
  const xs = times.map((_, i) => (n ? (i + 0.5) / n : 0.5));
  const knots = [
    { rel: 0, x: 0 },
    ...times.map((t, i) => ({ rel: sinceNoon(toMinutes(t)), x: xs[i]! })),
    { rel: 1440, x: 1 },
  ].sort((a, b) => a.rel - b.rel || a.x - b.x);
  const at = (minutes: number): number => {
    const r = sinceNoon(minutes);
    for (let i = 1; i < knots.length; i++) {
      const a = knots[i - 1]!;
      const b = knots[i]!;
      if (r <= b.rel) return a.x + ((r - a.rel) / Math.max(1, b.rel - a.rel)) * (b.x - a.x);
    }
    return 1;
  };
  return { xs, at };
}

// ── Edits ───────────────────────────────────────────────────────────────────────────────────

/** JSON with sorted keys, to tell whether a routine changed. */
const canonical = (value: unknown) =>
  JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );

/** The draft: routines.json as the page edits it, with the routines list always there. */
type Draft = RoutinesConfig & { routines: RoutineDef[] };

/**
 * What the page changed, as the save sends it (`from` is what it showed). With a Routines app
 * that keeps a routines list (`editable`) routines are saved whole; an older one only knows the
 * three built-ins' times, saved as `schedule`.
 */
export function diffConfig(base: Draft, draft: Draft, editable = true): RoutinesChange[] {
  const changes: RoutinesChange[] = [];
  for (const p of draft.projects) {
    const was = base.projects.find((b) => b.name === p.name);
    if (!was) continue;
    if (p.enrolled !== was.enrolled)
      changes.push({ field: 'enrolled', project: p.name, from: was.enrolled, to: p.enrolled });
    if (p.budget_usd !== was.budget_usd)
      changes.push({
        field: 'budget_usd',
        project: p.name,
        from: was.budget_usd,
        to: p.budget_usd,
      });
    if (p.hours !== was.hours)
      changes.push({ field: 'hours', project: p.name, from: was.hours, to: p.hours });
  }
  if (editable) {
    for (const r of draft.routines) {
      const was = base.routines.find((b) => b.id === r.id) ?? null;
      if (!was || canonical(was) !== canonical(r))
        changes.push({ field: 'routine', id: r.id, from: was, to: r });
    }
    for (const was of base.routines)
      if (!draft.routines.some((r) => r.id === was.id))
        changes.push({ field: 'routine', id: was.id, from: was, to: null });
  } else {
    for (const routine of ROUTINES) {
      const to = draft.schedule[routine];
      if (to && to !== base.schedule[routine])
        changes.push({ field: 'schedule', routine, from: base.schedule[routine], to });
    }
  }
  const tz = draft.schedule.timezone;
  if (tz && tz !== base.schedule.timezone)
    changes.push({ field: 'timezone', from: base.schedule.timezone, to: tz });
  for (const [kind, row] of Object.entries(draft.dispatch)) {
    for (const level of DIFFICULTIES) {
      const to = row[level];
      const from = base.dispatch[kind]?.[level];
      if (to && to !== from) changes.push({ field: 'dispatch', kind, level, from, to });
    }
  }
  return changes;
}

/** A new routine's id from its name ("Weekly review" → "weekly-review"), unique in the list. */
export function routineId(name: string, taken: string[]): string {
  const stem =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 28) || 'routine';
  let id = stem;
  for (let i = 2; taken.includes(id); i++) id = `${stem}-${i}`;
  return id;
}

type Edit = (change: (draft: Draft) => void) => void;

// ── Desk counts ─────────────────────────────────────────────────────────────────────────────

/** What waits on the owner in these Pharos projects, counted as the desk counts it. */
export function deskCount(items: DeskItem[] | undefined, projectIds: string[]): number {
  if (!items || !projectIds.length) return 0;
  return items.filter((i) => i.projectId && projectIds.includes(i.projectId) && needsOwner(i))
    .length;
}

const deskHref = (ids: string[]) => (ids.length ? `/desk?project=${ids.join(',')}` : '/desk');

// ── Run dots ────────────────────────────────────────────────────────────────────────────────

type Look = RoutineRun['status'] | 'never';

const RUN_WORD: Record<Look, string> = {
  ok: 'ok',
  ran: 'ended without finishing',
  error: 'failed',
  running: 'running now',
  never: 'never ran',
};

/** Last night in a word, when Pharos's desk has no run report with counts. */
const NIGHT_WORD: Record<RoutineRun['status'], string> = {
  ok: 'Finished',
  ran: 'Ended without finishing',
  error: 'Failed',
  running: 'Running',
};

const DOT: Record<Look, string> = {
  ok: 'bg-emerald-500',
  ran: 'bg-amber-500',
  error: 'bg-rose-500',
  running: 'bg-sky-500',
  never: 'border border-neutral-300 bg-transparent dark:border-neutral-600',
};

/** What the dots mean, in one quiet line under the timeline. */
function DotLegend() {
  const looks: Look[] = ['ok', 'ran', 'error', 'running', 'never'];
  return (
    <ul
      data-dot-legend=""
      aria-label="What the dots mean"
      className="-mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-xs text-muted"
    >
      {looks.map((look) => (
        <li key={look} className="flex items-center gap-1.5">
          <span aria-hidden className={clsx('inline-block size-2 rounded-full', DOT[look])} />
          {RUN_WORD[look]}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="inline-block size-2 rounded-full bg-emerald-500 opacity-35" />
        faint: before today
      </li>
    </ul>
  );
}

/** One routine's last result: a dot. Hover: when and how; click: its log. */
function RunDot({
  project,
  routine,
  run,
  today,
  onLog,
}: {
  project: string;
  routine: RoutineDef;
  run: RoutineRun | null | undefined;
  today: string;
  onLog: (file: string) => void;
}) {
  const look: Look = run?.status ?? 'never';
  const time = runTime(run?.when, today);
  // Not from last night: shown faint, its date in the tooltip.
  const old = Boolean(run?.when && !run.when.startsWith(today));
  const label = `${routine.name} · ${project}: ${RUN_WORD[look]}${time ? `, ${time}` : ''}`;
  return (
    <Tooltip label={label} detail={run?.file ? 'Click for its log' : undefined} className="flex">
      <button
        type="button"
        aria-label={label}
        data-run-dot={routine.id}
        data-look={look}
        disabled={!run?.file}
        onClick={(e) => {
          e.stopPropagation();
          if (run?.file) onLog(run.file);
        }}
        className={clsx(
          'tap-area flex size-5 items-center justify-center rounded-full hover:bg-subtle focus-visible:outline-2 focus-visible:outline-sky-400 disabled:cursor-default disabled:hover:bg-transparent',
          !routine.enabled && 'opacity-40',
        )}
      >
        {look === 'running' ? (
          <Loader2 aria-hidden className="size-3 animate-spin text-sky-500" />
        ) : (
          <span
            aria-hidden
            className={clsx('block size-2.5 rounded-full', DOT[look], old && 'opacity-35')}
          />
        )}
      </button>
    </Tooltip>
  );
}

// ── Small pieces ────────────────────────────────────────────────────────────────────────────

/** A whole-number field that only changes the draft with a valid value. */
function NumberField({
  value,
  label,
  prefix,
  suffix,
  max,
  onChange,
}: {
  value: number;
  label: string;
  prefix?: string;
  suffix?: string;
  max: number;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  // A new value from outside (a reload, Discard) replaces what's typed.
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setText(String(value));
  }
  const n = Number(text);
  const bad = text.trim() === '' || !Number.isFinite(n) || n < 0 || n > max;
  return (
    <label
      className={clsx(
        'inline-flex h-7 items-center gap-0.5 rounded-control border bg-surface px-1.5 text-sm tabular-nums focus-within:ring-2 focus-within:ring-sky-300 dark:focus-within:ring-sky-800',
        bad ? 'border-rose-400 dark:border-rose-700' : 'border-line-strong',
      )}
    >
      {prefix && <span className="text-faint">{prefix}</span>}
      <input
        type="number"
        inputMode="decimal"
        min={0}
        max={max}
        step={1}
        value={text}
        aria-label={label}
        aria-invalid={bad || undefined}
        onChange={(e) => {
          setText(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value.trim() !== '' && Number.isFinite(v) && v >= 0 && v <= max) onChange(v);
        }}
        className="w-8 bg-transparent text-right outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
      />
      {suffix && <span className="text-faint">{suffix}</span>}
    </label>
  );
}

/** A dialog shell: a title, its content, and its buttons. Escape cancels. */
function Dialog({
  title,
  children,
  onCancel,
  wide,
  data,
}: {
  title: string;
  children: ReactNode;
  onCancel: () => void;
  wide?: boolean;
  data?: string;
}) {
  const titleId = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-dialog={data}
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
    >
      <div className="absolute inset-0 bg-neutral-900/20 dark:bg-black/40" onClick={onCancel} />
      <div
        className={clsx(
          'relative max-h-[90vh] w-full animate-pop-in space-y-4 overflow-y-auto rounded-block bg-surface p-5 shadow-overlay',
          wide ? 'max-w-lg' : 'max-w-md',
        )}
      >
        <p id={titleId} className="text-base font-semibold">
          {title}
        </p>
        {children}
      </div>
    </div>
  );
}

/** A dialog that asks before something real happens. The safe choice has focus. */
function Confirm({
  title,
  children,
  action,
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  action: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => cancel.current?.focus(), []);
  return (
    <Dialog title={title} onCancel={onCancel}>
      <div className="space-y-2 text-sm text-ink-soft">{children}</div>
      <div className="flex flex-wrap justify-end gap-2">
        <button ref={cancel} type="button" onClick={onCancel} className={BUTTON.secondary}>
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onConfirm}
          className={danger ? BUTTON.danger : BUTTON.primary}
        >
          {busy && <Loader2 aria-hidden className="size-3.5 animate-spin" />}
          {action}
        </button>
      </div>
    </Dialog>
  );
}

/** The latest night run Pharos's desk logged for this project ("Night run · pharos"). */
function nightRunOf(project: string, desk: Desk | undefined): DeskRun | undefined {
  return desk?.runs.find((r) => r.name === `Night run · ${project}`);
}

// ── Tonight: the band of routines ───────────────────────────────────────────────────────────

const GRID =
  'grid grid-cols-[7rem_minmax(0,1fr)_2.5rem] items-center gap-x-2 sm:grid-cols-[11rem_minmax(0,1fr)_3rem]';

/** "3 ok · 1 ended early" across the projects a routine covers. */
function lastResults(
  routine: RoutineDef,
  projects: RoutinesProject[],
  status: Map<string, RoutinesProjectStatus>,
) {
  const counts = new Map<Look, number>();
  for (const p of projects) {
    if (!routineCovers(routine, p)) continue;
    const look: Look = status.get(p.name)?.runs?.[routine.id]?.status ?? 'never';
    counts.set(look, (counts.get(look) ?? 0) + 1);
  }
  const order: Look[] = ['ok', 'ran', 'error', 'running', 'never'];
  return order
    .filter((l) => counts.get(l))
    .map((l) => `${counts.get(l)} ${RUN_WORD[l]}`)
    .join(' · ');
}

function Tonight({
  routines,
  timeZone,
  projects,
  status,
  needs,
  enrolled,
  needIds,
  editable,
  onEdit,
  onAdd,
}: {
  routines: RoutineDef[];
  timeZone: string | undefined;
  projects: RoutinesProject[];
  status: Map<string, RoutinesProjectStatus>;
  needs: number | null;
  enrolled: number;
  needIds: string[];
  editable: boolean;
  onEdit: (routine: RoutineDef) => void;
  onAdd: () => void;
}) {
  const ordered = inOrder(routines);
  const line = band(ordered.map((r) => r.time));
  const now = line.at(minutesIn(timeZone));
  const next = nextRun(ordered, timeZone);
  const zone = zoneName(timeZone);
  const first = line.xs[0] ?? 0;
  const last = line.xs[line.xs.length - 1] ?? 1;
  return (
    <div className={clsx(GRID, 'items-start px-3 pt-3 pb-2')} data-tonight="">
      <div className="space-y-0.5 pt-1">
        <p className="text-sm font-semibold text-ink">Tonight</p>
        <p className="text-xs text-muted">
          {plural(enrolled, 'project')}
          {needs !== null && needs > 0 && (
            <>
              {' · '}
              <Link
                to={deskHref(needIds)}
                data-needs-total={needs}
                className="font-medium whitespace-nowrap text-warn hover:underline"
              >
                {needs} need you
              </Link>
            </>
          )}
        </p>
      </div>
      <div className="relative h-[4.25rem]" role="list" aria-label="Tonight’s routines">
        {/* The band, and the part of it already behind us tonight. */}
        <div
          aria-hidden
          className="absolute top-[13px] h-0.5 rounded-full bg-line"
          style={{ left: `${first * 100}%`, right: `${(1 - last) * 100}%` }}
        />
        <div
          aria-hidden
          className="absolute top-[13px] left-0 h-0.5 rounded-full bg-sky-300/70 dark:bg-sky-700/70"
          style={{ width: `${now * 100}%` }}
        />
        <div className="absolute top-[9px] z-10 -translate-x-1/2" style={{ left: `${now * 100}%` }}>
          <Tooltip label={`Now${zone ? ` (${zone})` : ''}`} className="flex">
            <span
              tabIndex={0}
              data-now=""
              aria-label="Now"
              className="block size-2.5 rounded-full border-2 border-surface bg-sky-500 shadow"
            />
          </Tooltip>
        </div>
        {ordered.map((r, i) => {
          const Icon = routineIcon(r);
          const isNext = next?.routine.id === r.id;
          const results = lastResults(r, projects, status);
          return (
            <div
              key={r.id}
              role="listitem"
              className="absolute top-0 flex -translate-x-1/2 flex-col items-center"
              style={{ left: `${line.xs[i]! * 100}%` }}
            >
              <Tooltip
                label={`${r.name} · ${r.time}${zone ? ` ${zone}` : ''}${r.enabled ? '' : ' · off'}`}
                detail={`${r.instructions || 'No instructions yet.'}${results ? ` Last: ${results}.` : ''}${isNext && next ? ` Next, ${inTime(next.inMinutes)}.` : ''}`}
                className="flex"
              >
                <button
                  type="button"
                  data-node={r.id}
                  data-next={isNext || undefined}
                  aria-label={`${r.name} at ${r.time}. Edit`}
                  onClick={() => onEdit(r)}
                  className={clsx(
                    'relative z-20 flex size-7 items-center justify-center rounded-full border bg-surface transition-colors hover:bg-subtle focus-visible:outline-2 focus-visible:outline-sky-400',
                    isNext
                      ? 'border-sky-400 text-sky-700 ring-4 ring-sky-100 dark:border-sky-500 dark:text-sky-300 dark:ring-sky-950'
                      : 'border-line-strong text-ink-soft',
                    !r.enabled && 'border-dashed text-faint',
                  )}
                >
                  <Icon aria-hidden className="size-3.5" />
                </button>
              </Tooltip>
              <span
                className={clsx(
                  'mt-1 hidden max-w-28 truncate text-xs sm:block',
                  isNext ? 'font-medium text-ink' : 'text-muted',
                  !r.enabled && 'line-through',
                )}
              >
                {r.name}
              </span>
              <span
                className={clsx(
                  'text-[11px] tabular-nums',
                  isNext ? 'font-medium text-sky-700 dark:text-sky-300' : 'text-faint',
                )}
              >
                {isNext && next ? (
                  <>
                    {r.time} <span className="hidden sm:inline">· {inTime(next.inMinutes)}</span>
                  </>
                ) : (
                  r.time
                )}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex justify-end pt-0.5">
        {editable && (
          <Tooltip label="Add a routine" className="flex">
            <button type="button" aria-label="Add a routine" onClick={onAdd} className={ICON_GHOST}>
              <Plus className="size-4" aria-hidden />
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

/** Add or change one routine: its name, time, what to do in the owner's words, which projects. */
function RoutineForm({
  routine,
  projects,
  editable,
  taken,
  onDone,
  onRemove,
  onCancel,
}: {
  routine: RoutineDef | null;
  projects: RoutinesProject[];
  editable: boolean;
  taken: string[];
  onDone: (routine: RoutineDef) => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(routine?.name ?? '');
  const [time, setTime] = useState(routine?.time ?? '18:00');
  const [instructions, setInstructions] = useState(routine?.instructions ?? '');
  const [enabled, setEnabled] = useState(routine?.enabled ?? true);
  const [scope, setScope] = useState<'enrolled' | 'chosen'>(
    !routine || routine.projects === 'enrolled' ? 'enrolled' : 'chosen',
  );
  const [chosen, setChosen] = useState<string[]>(
    routine && routine.projects !== 'enrolled' ? routine.projects : [],
  );
  const [removing, setRemoving] = useState(false);
  const ids = useId();
  // An older Routines app keeps only the built-ins' times.
  const timeOnly = !editable;
  const custom = !routine?.skill;
  const problem = !name.trim()
    ? 'Give it a name'
    : !/^\d\d:\d\d$/.test(time)
      ? 'Give it a time'
      : custom && !instructions.trim()
        ? 'Say what it should do'
        : scope === 'chosen' && !chosen.length
          ? 'Pick at least one project'
          : null;
  const field =
    'w-full rounded-control border border-line-strong bg-surface px-2.5 py-1.5 text-sm disabled:opacity-60';
  const done = () => {
    if (problem) return;
    onDone({
      id: routine?.id ?? routineId(name, taken),
      name: name.trim(),
      time,
      enabled,
      ...(routine?.skill ? { skill: routine.skill } : {}),
      instructions: instructions.trim(),
      projects: scope === 'enrolled' ? 'enrolled' : chosen,
    });
  };
  if (removing && routine)
    return (
      <Confirm
        title={`Remove “${routine.name}”?`}
        action="Remove"
        danger
        onConfirm={onRemove}
        onCancel={() => setRemoving(false)}
      >
        <p>It stops running once you save.</p>
      </Confirm>
    );
  return (
    <Dialog
      title={routine ? routine.name : 'New routine'}
      onCancel={onCancel}
      wide
      data="routine-form"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
        <label className="space-y-1">
          <span className="text-xs text-muted">Name</span>
          <input
            id={`${ids}-name`}
            value={name}
            disabled={timeOnly}
            autoFocus={!timeOnly}
            onChange={(e) => setName(e.target.value)}
            placeholder="Weekly review"
            className={field}
          />
        </label>
        <label className="space-y-1">
          <span className="text-xs text-muted">Time</span>
          <input
            type="time"
            value={time}
            autoFocus={timeOnly}
            onChange={(e) => setTime(e.target.value)}
            className={clsx(field, 'tabular-nums')}
          />
        </label>
      </div>
      <label className="block space-y-1">
        <span className="flex items-center gap-1 text-xs text-muted">
          What to do
          {routine?.skill && (
            <InfoTip
              label="About built-in routines"
              detail={`Runs the ${routine.skill} skill; these words are added to it.`}
            />
          )}
        </span>
        <textarea
          value={instructions}
          disabled={timeOnly}
          rows={3}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="In your words: what it should look at, and what it leaves you"
          className={clsx(field, 'resize-y')}
        />
      </label>
      <fieldset className="space-y-1.5" disabled={timeOnly}>
        <legend className="text-xs text-muted">Projects</legend>
        <div className="flex flex-wrap gap-1.5">
          {(['enrolled', 'chosen'] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={scope === s}
              onClick={() => setScope(s)}
              className={clsx(
                'rounded-full px-2.5 py-1 text-xs ring-1 ring-inset disabled:opacity-60',
                scope === s ? 'bg-inverse text-on-inverse ring-inverse' : 'text-muted ring-line',
              )}
            >
              {s === 'enrolled' ? 'Every enrolled project' : 'Only some'}
            </button>
          ))}
        </div>
        {scope === 'chosen' && (
          <div className="flex flex-wrap gap-1.5" data-project-choices="">
            {projects.map((p) => {
              const on = chosen.includes(p.name);
              return (
                <button
                  key={p.name}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setChosen(on ? chosen.filter((n) => n !== p.name) : [...chosen, p.name])
                  }
                  className={clsx(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ring-1 ring-inset',
                    on
                      ? 'bg-sky-50 text-sky-800 ring-sky-300 dark:bg-sky-950 dark:text-sky-200 dark:ring-sky-800'
                      : 'text-muted ring-line',
                  )}
                >
                  {on && <Check aria-hidden className="size-3" />}
                  {p.name}
                </button>
              );
            })}
          </div>
        )}
      </fieldset>
      {routine && editable && (
        <div className="flex items-center gap-2 text-sm">
          <Switch checked={enabled} label="Runs every day" onChange={setEnabled} />
          <span className="text-muted">{enabled ? 'On' : 'Off'}</span>
        </div>
      )}
      {timeOnly && (
        <p className="text-xs text-muted">
          This Routines app keeps only the times; update it for the rest.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {routine && editable && (
          <Tooltip label="Remove this routine" className="flex">
            <button
              type="button"
              aria-label="Remove this routine"
              onClick={() => setRemoving(true)}
              className={clsx(ICON_GHOST, 'text-danger')}
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          </Tooltip>
        )}
        <span className="ml-auto text-xs text-muted" role="status">
          {problem}
        </span>
        <button type="button" onClick={onCancel} className={BUTTON.secondary}>
          Cancel
        </button>
        <button type="button" disabled={Boolean(problem)} onClick={done} className={BUTTON.primary}>
          {routine ? 'Done' : 'Add'}
        </button>
      </div>
    </Dialog>
  );
}

// ── Projects ────────────────────────────────────────────────────────────────────────────────

function ProjectLine({
  project,
  status,
  routines,
  xs,
  today,
  open,
  needs,
  needIds,
  onToggle,
  onLog,
}: {
  project: RoutinesProject;
  status: RoutinesProjectStatus | undefined;
  routines: RoutineDef[];
  xs: number[];
  today: string;
  open: boolean;
  needs: number;
  needIds: string[];
  onToggle: () => void;
  onLog: (file: string) => void;
}) {
  return (
    <div
      className={clsx(GRID, 'min-h-10 px-3 py-1', open && 'bg-sunken/50')}
      data-project-line={project.name}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={clsx(
          'flex min-w-0 items-center gap-1 rounded-control text-left text-sm hover:text-ink',
          project.enrolled ? 'font-medium text-ink' : 'text-muted',
        )}
      >
        <ChevronRight
          aria-hidden
          className={clsx('size-3.5 shrink-0 text-faint transition-transform', open && 'rotate-90')}
        />
        <span className="truncate">{project.name}</span>
        {status && !status.exists && (
          <Tooltip label="Folder missing" className="flex">
            <span tabIndex={0} className="text-warn">
              <AlertTriangle aria-label="Folder missing" className="size-3" />
            </span>
          </Tooltip>
        )}
      </button>
      <div className="relative h-5" data-run-strip="">
        <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-line-soft" />
        {routines.map((r, i) =>
          // A routine that doesn't cover this project leaves its place empty.
          routineCovers(r, project) || status?.runs?.[r.id] ? (
            <div
              key={r.id}
              className="absolute top-0 -translate-x-1/2"
              style={{ left: `${xs[i]! * 100}%` }}
            >
              <RunDot
                project={project.name}
                routine={r}
                run={status?.runs?.[r.id]}
                today={today}
                onLog={onLog}
              />
            </div>
          ) : null,
        )}
      </div>
      <span className="text-right">
        {needs > 0 && (
          <Tooltip
            label={`${needs} need you in ${project.name}`}
            detail="Open them on the desk"
            className="inline-flex"
          >
            <Link
              to={deskHref(needIds)}
              data-needs={needs}
              aria-label={`${needs} need you in ${project.name}`}
              className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 text-xs font-medium text-amber-900 tabular-nums hover:bg-amber-200 dark:bg-amber-950 dark:text-amber-200"
            >
              {needs}
            </Link>
          </Tooltip>
        )}
      </span>
    </div>
  );
}

/** One fact in a project's detail: its symbol (the name in its tooltip), then the value. */
function Fact({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2" data-fact={label}>
      <Tooltip label={label} className="flex shrink-0">
        <span tabIndex={0} className="rounded-control text-faint">
          <Icon aria-label={label} className="size-3.5" />
        </span>
      </Tooltip>
      <div className="min-w-0 flex-1 text-sm text-ink-soft">{children}</div>
    </div>
  );
}

function ProjectDetail({
  project,
  status,
  routines,
  pharos,
  night,
  needs,
  needIds,
  edit,
  onRun,
  onLog,
}: {
  project: RoutinesProject;
  status: RoutinesProjectStatus | undefined;
  routines: RoutineDef[];
  pharos: RoutinesPharos | undefined;
  night: DeskRun | undefined;
  needs: number;
  needIds: string[];
  edit: Edit;
  onRun: (routine: RoutineDef) => void;
  onLog: (file: string) => void;
}) {
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const [budget, setBudget] = useState(false);
  const set = (patch: Partial<RoutinesProject>) =>
    edit((d) => {
      const p = d.projects.find((x) => x.name === project.name);
      if (p) Object.assign(p, patch);
    });
  const git = status?.git;
  const ship = status?.queue?.ship;
  const latest = Object.values(status?.runs ?? {})
    .filter((r): r is RoutineRun => Boolean(r?.file))
    .sort((a, b) => (b.when ?? '').localeCompare(a.when ?? ''))[0];
  const counts = night?.counts;
  const nightRoutine = routines.find((r) => r.skill === 'nightshift');
  const nightRun = nightRoutine ? status?.runs?.[nightRoutine.id] : undefined;
  const reports = pharos?.reports ?? [];
  const nightReport = reports.find((r) => r.routine === nightRoutine?.id);
  return (
    <div
      data-project-detail={project.name}
      className="relative border-t border-line-soft bg-sunken/50 px-3 py-3 sm:pl-[3.25rem]"
    >
      <div className="absolute top-2 right-2">
        <Tooltip label={`Options for ${project.name}`} className="flex">
          <button
            type="button"
            aria-label={`Options for ${project.name}`}
            aria-haspopup="menu"
            aria-expanded={Boolean(menu)}
            onClick={(e) => setMenu(e.currentTarget.getBoundingClientRect())}
            className={ICON_GHOST}
          >
            <MoreHorizontal className="size-4" aria-hidden />
          </button>
        </Tooltip>
        {menu && (
          <Menu
            anchor={menu}
            align="end"
            label={`Options for ${project.name}`}
            onClose={() => setMenu(null)}
          >
            <MenuLabel>Run now (asks first)</MenuLabel>
            {routines.map((r) => (
              <MenuItem
                key={r.id}
                icon={routineIcon(r)}
                disabled={!status?.exists || status?.runs?.[r.id]?.status === 'running'}
                onClick={() => {
                  setMenu(null);
                  onRun(r);
                }}
              >
                {r.name}
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem
              icon={project.enrolled ? Pause : Play}
              onClick={() => {
                setMenu(null);
                set({ enrolled: !project.enrolled });
              }}
            >
              {project.enrolled ? 'Pause (leave the routines)' : 'Enroll in the routines'}
            </MenuItem>
            <MenuItem
              icon={ScrollText}
              disabled={!latest}
              onClick={() => {
                setMenu(null);
                if (latest?.file) onLog(latest.file);
              }}
            >
              Open last log
            </MenuItem>
          </Menu>
        )}
      </div>
      <div className="grid max-w-2xl grid-cols-1 gap-x-6 gap-y-2 pr-8 sm:grid-cols-2">
        {ship && (
          <div className="min-w-0 sm:col-span-2">
            <Fact icon={Flag} label="Ship criterion">
              <Tooltip label={ship} className="flex max-w-full min-w-0">
                <span tabIndex={0} className="block min-w-0 truncate">
                  {ship}
                </span>
              </Tooltip>
            </Fact>
          </div>
        )}
        <Fact icon={Moon} label="Last night">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2">
            {counts && (counts.done || counts.failed || counts.unverified) ? (
              <Tooltip label={night?.summary ?? 'Last night'} className="flex min-w-0">
                <span tabIndex={0} className="flex flex-wrap gap-x-2 tabular-nums" data-night="">
                  <span className="text-emerald-700 dark:text-emerald-300">
                    {counts.done ?? 0} done
                  </span>
                  {counts.failed ? (
                    <span className="text-rose-700 dark:text-rose-300">{counts.failed} failed</span>
                  ) : null}
                  {counts.unverified ? (
                    <span className="text-amber-700 dark:text-amber-300">
                      {counts.unverified} unverified
                    </span>
                  ) : null}
                </span>
              </Tooltip>
            ) : night ? (
              <Tooltip label={night.summary ?? night.outcome} className="flex min-w-0">
                <span tabIndex={0} data-night="" className="truncate">
                  {night.outcome === 'ok'
                    ? 'Finished'
                    : night.outcome === 'running'
                      ? 'Running'
                      : night.outcome === 'failed'
                        ? 'Failed'
                        : 'Partly done'}
                </span>
              </Tooltip>
            ) : (
              <span data-night="" className="text-muted">
                {nightRun ? NIGHT_WORD[nightRun.status] : 'No night run yet'}
              </span>
            )}
            {nightReport && (
              <Link
                to={nightReport.href}
                data-report-link=""
                className="inline-flex items-center gap-1 text-accent hover:underline"
              >
                <Newspaper aria-hidden className="size-3.5" />
                Last night’s report
              </Link>
            )}
          </span>
        </Fact>
        <Fact icon={Inbox} label="Needs you">
          {needs ? (
            <Link to={deskHref(needIds)} className="font-medium text-warn hover:underline">
              {plural(needs, 'item')}
            </Link>
          ) : (
            <span className="text-muted">Nothing</span>
          )}
        </Fact>
        <Fact icon={Wallet} label="Night budget: $ cap and hours handed over">
          {budget ? (
            <span className="flex items-center gap-1.5">
              <NumberField
                value={project.budget_usd}
                max={500}
                prefix="$"
                label={`Night budget in dollars for ${project.name}`}
                onChange={(budget_usd) => set({ budget_usd })}
              />
              <NumberField
                value={project.hours}
                max={24}
                suffix="h"
                label={`Night hours for ${project.name}`}
                onChange={(hours) => set({ hours })}
              />
              <Tooltip label="Done" className="flex">
                <button
                  type="button"
                  aria-label="Done"
                  onClick={() => setBudget(false)}
                  className={ICON_GHOST}
                >
                  <Check className="size-3.5" aria-hidden />
                </button>
              </Tooltip>
            </span>
          ) : (
            <Tooltip label="Edit the night budget" className="flex">
              <button
                type="button"
                data-budget=""
                aria-label={`Night budget for ${project.name}: $${project.budget_usd}, ${project.hours} h. Edit`}
                onClick={() => setBudget(true)}
                className="group inline-flex items-center gap-1 rounded-control tabular-nums hover:text-ink"
              >
                ${project.budget_usd} · {project.hours}h
                <Pencil
                  aria-hidden
                  className="size-3 text-faint opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                />
              </button>
            </Tooltip>
          )}
        </Fact>
        {git && (
          <Fact icon={GitBranch} label="Repository">
            <Tooltip label={git.head} detail="Last commit" className="flex">
              <span tabIndex={0} data-repo="" className="tabular-nums">
                {git.dirty ? `${git.dirty} changed` : 'clean'}
                {git.ahead !== '-' && git.ahead !== '0' && ` · ${git.ahead} ahead`}
              </span>
            </Tooltip>
          </Fact>
        )}
      </div>
    </div>
  );
}

// ── How it runs ─────────────────────────────────────────────────────────────────────────────

const MODEL_TONE: Record<string, string> = {
  haiku: 'bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  sonnet: 'bg-violet-50 text-violet-800 dark:bg-violet-950 dark:text-violet-200',
  opus: 'bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
};

function HowItRuns({ draft, config, edit }: { draft: Draft; config: RoutinesConfig; edit: Edit }) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState(false);
  const level = config.cleanup?.level ?? 1;
  const cleanup = CLEANUP_LEVELS[level] ?? CLEANUP_LEVELS[1]!;
  const zone = zoneName(draft.schedule.timezone);
  const options = ROUTINE_MODELS.map((m) => ({ value: m, label: m }));
  return (
    <section aria-label="How it runs" className="space-y-3">
      <h2>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1 rounded-control text-xs font-semibold tracking-wide text-muted uppercase hover:text-ink"
        >
          <ChevronRight
            aria-hidden
            className={clsx('size-3.5 text-faint transition-transform', open && 'rotate-90')}
          />
          How it runs
        </button>
      </h2>
      {open && (
        <div className="space-y-4 rounded-block border border-line bg-surface p-4" data-how="">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Globe aria-hidden className="size-3.5 shrink-0 text-faint" />
            <label className="inline-flex h-7 items-center gap-1 rounded-full border border-line px-2.5 text-xs text-muted">
              <input
                type="text"
                value={draft.schedule.timezone ?? ''}
                aria-label="Timezone"
                spellCheck={false}
                onChange={(e) => edit((d) => (d.schedule.timezone = e.target.value))}
                className="w-32 bg-transparent outline-none"
              />
              {zone ? (
                <span>{zone}</span>
              ) : (
                <Tooltip label="Not a timezone this browser knows" className="flex">
                  <span tabIndex={0} className="text-danger">
                    <AlertTriangle
                      aria-label="Not a timezone this browser knows"
                      className="size-3"
                    />
                  </span>
                </Tooltip>
              )}
            </label>
            <InfoTip
              label="About the schedule"
              detail="Each routine fires once a day at its time, in this timezone; a computer asleep then runs the missed ones on wake, in order. Change a routine's time by clicking it above."
            />
          </div>

          <p
            className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm"
            data-cleanup-level={level}
          >
            <Brush aria-hidden className="size-3.5 shrink-0 text-faint" />
            <span className="font-medium whitespace-nowrap">
              Level {level} · {cleanup.name}
            </span>
            <span className="text-muted">{cleanup.line}</span>
            <InfoTip
              label="About cleanup"
              detail={`${cleanup.about} Set in routines.json${config.cleanup?.scratch_days !== undefined ? `; scratch kept ${config.cleanup.scratch_days} days` : ''}.`}
            />
          </p>

          <div className="space-y-1.5" data-dispatch="">
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <span className="font-medium">Models</span>
              <InfoTip
                label="About models"
                detail={`The night run hands each task to the model for its kind and difficulty. The master that dispatches and verifies: ${draft.master.model}, ${draft.master.effort} effort.`}
              />
              <Tooltip
                label={models ? 'Done editing models' : 'Edit models'}
                className="ml-auto flex"
              >
                <button
                  type="button"
                  aria-label={models ? 'Done editing models' : 'Edit models'}
                  aria-pressed={models}
                  onClick={() => setModels(!models)}
                  className={ICON_GHOST}
                >
                  {models ? (
                    <Check className="size-3.5" aria-hidden />
                  ) : (
                    <Pencil className="size-3.5" aria-hidden />
                  )}
                </button>
              </Tooltip>
            </div>
            <div className="overflow-x-auto">
              <table className="text-xs">
                <thead>
                  <tr className="text-faint">
                    <th className="pr-3 text-left font-normal" />
                    {DIFFICULTIES.map((l) => (
                      <th key={l} className="px-1 pb-1 text-left font-normal">
                        {l}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(draft.dispatch).map(([kind, row]) => (
                    <tr key={kind}>
                      <td className="py-0.5 pr-3 text-muted">{kind}</td>
                      {DIFFICULTIES.map((level) => {
                        const model = row[level] ?? '';
                        return (
                          <td key={level} className="px-1 py-0.5">
                            {models ? (
                              <Select
                                value={model}
                                label={`${kind}, ${level}`}
                                className="w-24"
                                options={
                                  model && !(ROUTINE_MODELS as readonly string[]).includes(model)
                                    ? [...options, { value: model, label: model }]
                                    : options
                                }
                                onChange={(m) =>
                                  edit((d) => {
                                    d.dispatch[kind] = { ...d.dispatch[kind], [level]: m };
                                  })
                                }
                              />
                            ) : (
                              <span
                                data-model={`${kind}-${level}`}
                                className={clsx(
                                  'inline-block w-14 rounded px-1.5 py-0.5 text-center',
                                  MODEL_TONE[model] ?? 'bg-sunken text-muted',
                                )}
                              >
                                {model || '—'}
                              </span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ── The page ────────────────────────────────────────────────────────────────────────────────

function Unavailable({
  reason,
  url,
  onRetry,
}: {
  reason: string;
  url: string;
  onRetry: () => void;
}) {
  return (
    <section
      data-routines-unavailable=""
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-block border border-line bg-surface px-4 py-3"
    >
      <AlertTriangle aria-hidden className="size-4 text-warn" />
      <span className="text-sm font-medium">Routines isn’t answering</span>
      <code className="rounded-control bg-sunken px-2 py-0.5 font-mono text-xs text-ink-soft">
        python3 server.py
      </code>
      <InfoTip
        label="About starting Routines"
        detail={`${reason} Pharos looks for it at ${url} (PHAROS_ROUTINES_URL). The schedule keeps firing without it; only this page needs it.`}
      />
      <Tooltip label="Try again" className="ml-auto flex">
        <button type="button" aria-label="Try again" onClick={onRetry} className={ICON_GHOST}>
          <RefreshCw className="size-4" aria-hidden />
        </button>
      </Tooltip>
    </section>
  );
}

type Pending = { routine: RoutineDef; project: RoutinesProject };
/** The routine form: a new routine (null) or one to change. */
type Editing = { routine: RoutineDef | null };

export function RoutinesPage() {
  const state = useResource<RoutinesState>('/api/routines/state');
  const desk = useResource<Desk>('/api/desk');
  const { reload } = state;
  const data = state.data?.available ? state.data : null;
  // Runs move on their own: look again every 30 seconds.
  useEffect(() => {
    const timer = setInterval(reload, 30_000);
    return () => clearInterval(timer);
  }, [reload]);
  useEffect(() => {
    const before = document.title;
    document.title = 'Routines · Pharos';
    return () => {
      document.title = before;
    };
  }, []);

  // The config as last loaded (`base`) and the page's edits on top (`draft`). A reload replaces
  // both only while nothing is unsaved, so `from` in each change is what the owner saw.
  const editable = data?.editable ?? false;
  const [base, setBase] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const changes = useMemo(
    () => (base && draft ? diffConfig(base, draft, editable) : []),
    [base, draft, editable],
  );
  const loaded = data?.config;
  const [seen, setSeen] = useState<RoutinesConfig | undefined>(undefined);
  if (loaded && loaded !== seen) {
    setSeen(loaded);
    if (!(changes.length && base)) {
      const withRoutines = { ...loaded, routines: routinesOf(loaded) };
      setBase(withRoutines);
      setDraft(structuredClone(withRoutines));
    }
  }
  const edit: Edit = (change) =>
    setDraft((d) => {
      if (!d) return d;
      const next = structuredClone(d);
      change(next);
      return next;
    });

  const [open, setOpen] = useState<string | null>(null);
  const [parked, setParked] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [confirmSave, setConfirmSave] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<{ file: string; text: string | null } | null>(null);

  const save = async () => {
    setBusy(true);
    try {
      const res = await ownerPost<{ saved: string[] }>('/api/routines/save', { changes });
      setBase(draft);
      setNotice({ tone: 'ok', text: `Saved: ${res.saved.join('; ')}` });
      reload();
    } catch (err) {
      setNotice({ tone: 'error', text: (err as Error).message });
    } finally {
      setConfirmSave(false);
      setBusy(false);
    }
  };
  const run = async ({ routine, project }: Pending) => {
    setBusy(true);
    try {
      await ownerPost('/api/routines/run', { routine: routine.id, project: project.name });
      setNotice({ tone: 'ok', text: `Started ${routine.name} for ${project.name}` });
      setTimeout(reload, 1500);
    } catch (err) {
      setNotice({ tone: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
      setPending(null);
    }
  };
  const openLog = async (file: string) => {
    setLog({ file, text: null });
    try {
      const res = await getJson<{ text: string }>(
        `/api/routines/log?${new URLSearchParams({ file })}`,
      );
      setLog({ file, text: res.text || '(empty)' });
    } catch (err) {
      setLog({ file, text: (err as Error).message });
    }
  };
  const putRoutine = (routine: RoutineDef) => {
    edit((d) => {
      const at = d.routines.findIndex((r) => r.id === routine.id);
      if (at < 0) d.routines.push(routine);
      else d.routines[at] = routine;
      // An older Routines app keeps the built-ins' times in `schedule`.
      if (!editable && (ROUTINES as readonly string[]).includes(routine.id))
        d.schedule[routine.id as Routine] = routine.time;
    });
    setEditing(null);
  };

  if (state.status === 'error' && !state.data)
    return <LoadError notFound={false} what="Routines" />;

  const status = new Map((data?.status ?? []).map((s) => [s.name, s]));
  const today = data?.now.slice(0, 10) ?? '';
  const enrolled = draft?.projects.filter((p) => p.enrolled) ?? [];
  const resting = draft?.projects.filter((p) => !p.enrolled) ?? [];
  const routines = draft ? inOrder(draft.routines) : [];
  const xs = band(routines.map((r) => r.time)).xs;
  const idsOf = (p: RoutinesProject) => data?.pharos?.[p.name]?.projects.map((x) => x.id) ?? [];
  const items = desk.data?.items;
  const enrolledIds = [...new Set(enrolled.flatMap(idsOf))];
  const needsTotal = items ? deskCount(items, enrolledIds) : null;

  const line = (p: RoutinesProject) => {
    const ids = idsOf(p);
    const needs = deskCount(items, ids);
    return (
      <li key={p.name}>
        <ProjectLine
          project={p}
          status={status.get(p.name)}
          routines={routines}
          xs={xs}
          today={today}
          open={open === p.name}
          needs={needs}
          needIds={ids}
          onToggle={() => setOpen(open === p.name ? null : p.name)}
          onLog={(file) => void openLog(file)}
        />
        {open === p.name && (
          <ProjectDetail
            project={p}
            status={status.get(p.name)}
            routines={routines.filter((r) => r.enabled)}
            pharos={data?.pharos?.[p.name]}
            night={nightRunOf(p.name, desk.data)}
            needs={needs}
            needIds={ids}
            edit={edit}
            onRun={(routine) => setPending({ routine, project: p })}
            onLog={(file) => void openLog(file)}
          />
        )}
      </li>
    );
  };

  return (
    <div className={clsx('mx-auto max-w-3xl space-y-4 p-4 sm:p-8', changes.length && 'pb-24')}>
      <header className="flex items-center gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Routines</h1>
        {data && (
          <Tooltip
            label="Refresh"
            detail={`As of ${data.now.slice(11)}, from ${data.url}`}
            className="ml-auto flex"
          >
            <button type="button" aria-label="Refresh" onClick={reload} className={ICON_GHOST}>
              <RefreshCw
                aria-hidden
                className={clsx('size-3.5', state.status === 'loading' && 'animate-spin')}
              />
            </button>
          </Tooltip>
        )}
      </header>

      {notice && (
        <p
          role="status"
          data-routines-notice={notice.tone}
          className={clsx(
            'flex items-center gap-2 rounded-control px-3 py-1.5 text-sm',
            notice.tone === 'ok'
              ? 'bg-sunken text-ink-soft'
              : 'bg-rose-50 text-rose-800 dark:bg-rose-950 dark:text-rose-200',
          )}
        >
          {notice.tone === 'ok' ? (
            <Check aria-hidden className="size-3.5 shrink-0" />
          ) : (
            <AlertTriangle aria-hidden className="size-3.5 shrink-0" />
          )}
          <span className="min-w-0 flex-1 truncate">{notice.text}</span>
          <Tooltip label="Dismiss" className="flex">
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setNotice(null)}
              className={ICON_GHOST}
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </Tooltip>
        </p>
      )}

      {state.data && !state.data.available ? (
        <Unavailable reason={state.data.reason} url={state.data.url} onRetry={reload} />
      ) : !data || !draft ? (
        <div className="h-64 animate-pulse rounded-block bg-sunken" />
      ) : (
        <>
          <section
            aria-label="Projects"
            className="overflow-hidden rounded-block border border-line bg-surface"
          >
            <Tonight
              routines={routines}
              timeZone={draft.schedule.timezone}
              projects={draft.projects}
              status={status}
              needs={needsTotal}
              enrolled={enrolled.length}
              needIds={enrolledIds}
              editable={editable}
              onEdit={(routine) => setEditing({ routine })}
              onAdd={() => setEditing({ routine: null })}
            />
            <ul className="divide-y divide-line-soft border-t border-line-soft">
              {enrolled.map(line)}
            </ul>
            {resting.length > 0 && (
              <div className="border-t border-line-soft">
                <button
                  type="button"
                  aria-expanded={parked}
                  onClick={() => setParked(!parked)}
                  className="flex w-full items-center gap-1 px-3 py-2 text-left text-sm text-muted hover:text-ink"
                >
                  <ChevronRight
                    aria-hidden
                    className={clsx(
                      'size-3.5 text-faint transition-transform',
                      parked && 'rotate-90',
                    )}
                  />
                  Parked <span className="tabular-nums">({resting.length})</span>
                </button>
                {parked && <ul className="divide-y divide-line-soft">{resting.map(line)}</ul>}
              </div>
            )}
          </section>
          <DotLegend />
          {!editable && (
            <p className="flex items-center gap-1.5 text-xs text-muted" data-old-routines="">
              Adding routines needs a newer Routines app.
              <InfoTip
                label="About adding routines"
                detail="This Routines app keeps only the wrap-up, night run and morning report. Their times can still change here; update it to add, rename or remove routines."
              />
            </p>
          )}

          <HowItRuns draft={draft} config={data.config} edit={edit} />
        </>
      )}

      {changes.length > 0 && (
        <div
          role="region"
          aria-label="Unsaved changes"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur sm:right-6 sm:bottom-6 sm:left-auto sm:rounded-block sm:border sm:shadow-overlay"
        >
          <div className="flex items-center gap-2">
            <span className="mr-auto text-sm font-medium" data-unsaved={changes.length}>
              {plural(changes.length, 'unsaved change')}
            </span>
            <button
              type="button"
              onClick={() => base && setDraft(structuredClone(base))}
              className={BUTTON.secondary}
            >
              Discard
            </button>
            <button type="button" onClick={() => setConfirmSave(true)} className={BUTTON.primary}>
              Save…
            </button>
          </div>
        </div>
      )}

      {editing && draft && (
        <RoutineForm
          routine={editing.routine}
          projects={draft.projects}
          editable={editable}
          taken={draft.routines.map((r) => r.id)}
          onDone={putRoutine}
          onRemove={() => {
            const id = editing.routine?.id;
            edit((d) => {
              d.routines = d.routines.filter((r) => r.id !== id);
            });
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      )}

      {confirmSave && (
        <Confirm
          title={`Save ${plural(changes.length, 'change')} to routines.json?`}
          action="Save"
          busy={busy}
          onConfirm={() => void save()}
          onCancel={() => setConfirmSave(false)}
        >
          <ul className="list-disc space-y-0.5 pl-5" data-save-list="">
            {changes.map((c, i) => (
              <li key={i}>{describeRoutinesChange(c)}</li>
            ))}
          </ul>
          <p className="text-xs text-muted">
            The next runs use these. No undo: change back and save.
          </p>
        </Confirm>
      )}

      {pending && (
        <Confirm
          title={`Start ${pending.routine.name} for ${pending.project.name} now?`}
          action={`Start ${pending.routine.name.toLowerCase()}`}
          danger
          busy={busy}
          onConfirm={() => void run(pending)}
          onCancel={() => setPending(null)}
        >
          <p>
            Real work: a headless agent in {pending.project.path}
            {pending.routine.skill === 'nightshift' ? (
              <>
                , up to <span className="font-medium">${pending.project.budget_usd}</span>
              </>
            ) : pending.routine.skill ? (
              <>
                , up to <span className="font-medium">$2</span>
              </>
            ) : null}
            .
          </p>
        </Confirm>
      )}

      {log && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={log.file}
          className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
        >
          <div
            className="absolute inset-0 bg-neutral-900/20 dark:bg-black/40"
            onClick={() => setLog(null)}
          />
          <div className="relative flex max-h-[85vh] w-full max-w-3xl animate-pop-in flex-col rounded-block bg-surface shadow-overlay">
            <div className="flex items-center gap-2 border-b border-line-soft px-4 py-2">
              <ScrollText aria-hidden className="size-3.5 text-faint" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{log.file}</span>
              <Tooltip label="Close" className="flex">
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setLog(null)}
                  className={ICON_GHOST}
                >
                  <X className="size-4" aria-hidden />
                </button>
              </Tooltip>
            </div>
            <pre className="min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-ink-soft">
              {log.text ?? 'Loading…'}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

/** The sidebar link, under Updates. */
export function RoutinesLink() {
  return (
    <NavLink
      to="/routines"
      className={({ isActive }) =>
        clsx(
          'flex w-full items-center gap-1.5 rounded-control px-2 py-1.5 text-sm',
          isActive ? 'bg-subtle font-medium text-ink' : 'text-ink-soft hover:bg-sunken',
        )
      }
    >
      <Repeat aria-hidden className="size-3.5" /> Routines
    </NavLink>
  );
}
