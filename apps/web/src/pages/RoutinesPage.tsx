import {
  DIFFICULTIES,
  ROUTINE_MODELS,
  ROUTINE_NAMES,
  ROUTINES,
  describeRoutinesChange,
  type Desk,
  type DeskRun,
  type Routine,
  type RoutineRun,
  type RoutinesChange,
  type RoutinesConfig,
  type RoutinesProject,
  type RoutinesProjectStatus,
  type RoutinesState,
} from '@pharos/schema';
import clsx from 'clsx';
import {
  AlertTriangle,
  Brush,
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
  RefreshCw,
  Repeat,
  ScrollText,
  Sun,
  Sunset,
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
import { LoadError } from './onboarding';

// The Routines page: the owner's daily routines (evening wrap-up, night run, morning report,
// cleanup) at a glance. The engine is the Routines app; Pharos reads it through /api/routines/*
// and shows only what's needed (owner's review 2026-10-23): one headline, tonight as a timeline
// with each project's last results as dots, and the rest one hover or click away. No planning
// files or logs on the page; a log opens in a dialog when asked for.

const ROUTINE_ICON: Record<Routine, LucideIcon> = {
  wrapup: Sunset,
  nightshift: Moon,
  daybreak: Sun,
};
/** Short names, lower case, for the headline and menus. */
const SHORT: Record<Routine, string> = {
  wrapup: 'wrap-up',
  nightshift: 'night',
  daybreak: 'morning',
};

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

/** The next routine the schedule fires, and in how many minutes. */
export function nextRun(
  schedule: RoutinesConfig['schedule'],
  now = new Date(),
): { routine: Routine; at: string; inMinutes: number } | null {
  const current = minutesIn(schedule.timezone, now);
  const due = ROUTINES.flatMap((routine) => {
    const at = schedule[routine];
    if (!at || !/^\d\d:\d\d$/.test(at)) return [];
    // A run at this very minute is firing now; the next one is tomorrow's.
    const inMinutes = (toMinutes(at) - current + 1440) % 1440 || 1440;
    return [{ routine, at, inMinutes }];
  });
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
 * Where tonight's three routines sit on the timeline (0–1), in order from the wrap-up, an hour
 * of room at each end. Proportional to the clock, but never closer than `gap`, so 00:00 and 01:00
 * stay apart on a phone. `at(minutes)` places any time (now) the same way, between the marks.
 */
export function timeline(schedule: RoutinesConfig['schedule'], gap = 0.3) {
  const times = ROUTINES.map((r) => schedule[r]).filter((t): t is string => Boolean(t));
  const start = (toMinutes(times[0] ?? '00:00') - 60 + 1440) % 1440;
  const rel = (m: number) => (m - start + 1440) % 1440;
  const marks = ROUTINES.map((r) => ({ routine: r, rel: rel(toMinutes(schedule[r] ?? '00:00')) }));
  const span = Math.max(...marks.map((m) => m.rel)) + 60;
  const raw = marks.map((m) => m.rel / span);
  const placed: number[] = [];
  raw.forEach((p, i) => placed.push(i === 0 ? p : Math.max(p, placed[i - 1]! + gap)));
  const scale = Math.min(1, 0.92 / Math.max(...placed));
  const pos = placed.map((p) => p * scale);
  const knots = [
    { rel: 0, x: 0 },
    ...marks.map((m, i) => ({ rel: m.rel, x: pos[i]! })),
    { rel: span, x: 1 },
  ].sort((a, b) => a.rel - b.rel);
  const at = (minutes: number): number | null => {
    const r = rel(minutes);
    if (r > span) return null;
    for (let i = 1; i < knots.length; i++) {
      const a = knots[i - 1]!;
      const b = knots[i]!;
      if (r <= b.rel) return a.x + ((r - a.rel) / Math.max(1, b.rel - a.rel)) * (b.x - a.x);
    }
    return null;
  };
  return {
    marks: marks.map((m, i) => ({ routine: m.routine, at: schedule[m.routine] ?? '', x: pos[i]! })),
    at,
  };
}

// ── Edits ───────────────────────────────────────────────────────────────────────────────────

/** What the page changed, field by field, as the save sends it (`from` is what it showed). */
export function diffConfig(base: RoutinesConfig, draft: RoutinesConfig): RoutinesChange[] {
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
  for (const routine of ROUTINES) {
    const to = draft.schedule[routine];
    if (to && to !== base.schedule[routine])
      changes.push({ field: 'schedule', routine, from: base.schedule[routine], to });
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

type Edit = (change: (draft: RoutinesConfig) => void) => void;

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

/** One routine's last result: a dot. Hover: when and how; click: its log. */
function RunDot({
  project,
  routine,
  run,
  today,
  onLog,
}: {
  project: string;
  routine: Routine;
  run: RoutineRun | null | undefined;
  today: string;
  onLog: (file: string) => void;
}) {
  const look: Look = run?.status ?? 'never';
  const time = runTime(run?.when, today);
  // Not from last night: shown faint, its date in the tooltip.
  const old = Boolean(run?.when && !run.when.startsWith(today));
  const label = `${ROUTINE_NAMES[routine]} · ${project}: ${RUN_WORD[look]}${time ? `, ${time}` : ''}`;
  return (
    <Tooltip label={label} detail={run?.file ? 'Click for its log' : undefined} className="flex">
      <button
        type="button"
        aria-label={label}
        data-run-dot={routine}
        data-look={look}
        disabled={!run?.file}
        onClick={(e) => {
          e.stopPropagation();
          if (run?.file) onLog(run.file);
        }}
        className="tap-area flex size-5 items-center justify-center rounded-full hover:bg-subtle focus-visible:outline-2 focus-visible:outline-sky-400 disabled:cursor-default disabled:hover:bg-transparent"
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

/** A dialog that asks before something real happens. */
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
  const titleId = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // The safe choice has focus: Enter alone never starts work.
    cancel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
    >
      <div className="absolute inset-0 bg-neutral-900/20 dark:bg-black/40" onClick={onCancel} />
      <div className="relative w-full max-w-md animate-pop-in space-y-4 rounded-block bg-surface p-5 shadow-overlay">
        <p id={titleId} className="text-base font-semibold">
          {title}
        </p>
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
      </div>
    </div>
  );
}

/** A Pharos page link from Routines ("http://127.0.0.1:4300/projects/…"): opened in this app. */
function pharosPath(url: string): string | null {
  try {
    const u = new URL(url);
    return /^\/projects\//.test(u.pathname) ? `${u.pathname}${u.search}` : null;
  } catch {
    return null;
  }
}

/** The project's Pharos id, when routines.json names one (by id, or by name via the desk). */
function pharosProjectId(project: RoutinesProject, desk: Desk | undefined): string | null {
  const ref = project.pm?.type === 'pharos' ? project.pm.project : undefined;
  if (!ref) return null;
  if (ref.startsWith('prj_')) return ref;
  const item = desk?.items.find((i) => i.project === ref && i.projectId);
  return item?.projectId ?? null;
}

/** The latest night run Pharos's desk logged for this project ("Night run · pharos"). */
function nightRunOf(project: string, desk: Desk | undefined): DeskRun | undefined {
  return desk?.runs.find((r) => r.name === `Night run · ${project}`);
}

// ── The headline and the timeline ───────────────────────────────────────────────────────────

const GRID =
  'grid grid-cols-[7rem_minmax(0,1fr)_2.5rem] items-center gap-x-2 sm:grid-cols-[11rem_minmax(0,1fr)_3rem]';

function Headline({
  schedule,
  enrolled,
  needs,
  running,
}: {
  schedule: RoutinesConfig['schedule'];
  enrolled: number;
  needs: number;
  running: { project: string; routine: Routine }[];
}) {
  const next = nextRun(schedule);
  const zone = zoneName(schedule.timezone);
  return (
    <p
      data-headline=""
      className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-muted"
    >
      <span className="font-medium text-ink-soft">Tonight:</span>
      {ROUTINES.map((r, i) => {
        const isNext = next?.routine === r;
        return (
          <span key={r} className="inline-flex items-center gap-1.5">
            {i > 0 && <span aria-hidden>→</span>}
            <Tooltip
              label={`${ROUTINE_NAMES[r]} at ${schedule[r] ?? '—'}${zone ? ` ${zone}` : ''}`}
              detail={isNext && next ? `Next, ${inTime(next.inMinutes)}` : undefined}
              className="flex"
            >
              <span
                tabIndex={0}
                data-next={isNext || undefined}
                className={clsx('rounded-control tabular-nums', isNext && 'font-medium text-ink')}
              >
                {SHORT[r]} {schedule[r] ?? '—'}
              </span>
            </Tooltip>
          </span>
        );
      })}
      <span aria-hidden>·</span>
      <span>{plural(enrolled, 'project')}</span>
      {needs > 0 && (
        <>
          <span aria-hidden>·</span>
          <Link to="/desk" className="font-medium text-warn hover:underline">
            {needs} need you
          </Link>
        </>
      )}
      {running.length > 0 && (
        <>
          <span aria-hidden>·</span>
          <span className="inline-flex items-center gap-1 text-accent">
            <Loader2 aria-hidden className="size-3 animate-spin" />
            {running.map((r) => `${SHORT[r.routine]} · ${r.project}`).join(', ')}
          </span>
        </>
      )}
    </p>
  );
}

/** The timeline's head: tonight's three routines on a line, and now when it falls in it. */
function Axis({ schedule }: { schedule: RoutinesConfig['schedule'] }) {
  const line = timeline(schedule);
  const now = line.at(minutesIn(schedule.timezone));
  return (
    <div className={clsx(GRID, 'px-3 pt-3 pb-1')} aria-hidden>
      <span />
      <div className="relative h-9">
        <div className="absolute inset-x-0 top-6 border-t border-line" />
        {line.marks.map((m) => {
          const Icon = ROUTINE_ICON[m.routine];
          return (
            <div
              key={m.routine}
              className="absolute top-0 flex -translate-x-1/2 flex-col items-center text-[11px] text-muted tabular-nums"
              style={{ left: `${m.x * 100}%` }}
            >
              <span className="flex items-center gap-0.5">
                <Icon className="hidden size-3 sm:block" />
                {m.at}
              </span>
              <span className="mt-1.5 size-1.5 rounded-full bg-line-strong" />
            </div>
          );
        })}
        {now !== null && (
          <div
            data-now=""
            className="absolute top-4 bottom-0 w-px bg-sky-500"
            style={{ left: `${now * 100}%` }}
          />
        )}
      </div>
      <span />
    </div>
  );
}

// ── Projects ────────────────────────────────────────────────────────────────────────────────

function ProjectLine({
  project,
  status,
  marks,
  today,
  open,
  onToggle,
  onLog,
  deskHref,
}: {
  project: RoutinesProject;
  status: RoutinesProjectStatus | undefined;
  marks: ReturnType<typeof timeline>['marks'];
  today: string;
  open: boolean;
  onToggle: () => void;
  onLog: (file: string) => void;
  deskHref: string;
}) {
  const needs = status?.queue?.needs_you ?? 0;
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
        {marks.map((m) => (
          <div
            key={m.routine}
            className="absolute top-0 -translate-x-1/2"
            style={{ left: `${m.x * 100}%` }}
          >
            <RunDot
              project={project.name}
              routine={m.routine}
              run={status?.runs?.[m.routine]}
              today={today}
              onLog={onLog}
            />
          </div>
        ))}
      </div>
      <span className="text-right">
        {needs > 0 && (
          <Tooltip
            label={`${needs} need you in ${project.name}`}
            detail="Open them on the desk"
            className="inline-flex"
          >
            <Link
              to={deskHref}
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
  night,
  deskHref,
  edit,
  onRun,
  onLog,
}: {
  project: RoutinesProject;
  status: RoutinesProjectStatus | undefined;
  night: DeskRun | undefined;
  deskHref: string;
  edit: Edit;
  onRun: (routine: Routine) => void;
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
  const needs = status?.queue?.needs_you ?? 0;
  const ship = status?.queue?.ship;
  const latest = ROUTINES.map((r) => status?.runs?.[r])
    .filter((r): r is RoutineRun => Boolean(r?.file))
    .sort((a, b) => (b.when ?? '').localeCompare(a.when ?? ''))[0];
  const counts = night?.counts;
  const nightRun = status?.runs?.nightshift;
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
            {ROUTINES.map((r) => (
              <MenuItem
                key={r}
                icon={ROUTINE_ICON[r]}
                disabled={!status?.exists || status?.runs?.[r]?.status === 'running'}
                onClick={() => {
                  setMenu(null);
                  onRun(r);
                }}
              >
                {ROUTINE_NAMES[r]}
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
        </Fact>
        <Fact icon={Inbox} label="Needs you">
          {needs ? (
            <Link to={deskHref} className="font-medium text-warn hover:underline">
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

function TimeChip({
  routine,
  value,
  onChange,
}: {
  routine: Routine;
  value: string;
  onChange: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const Icon = ROUTINE_ICON[routine];
  const chip =
    'inline-flex h-7 items-center gap-1 rounded-full border border-line bg-surface px-2.5 text-sm tabular-nums';
  if (editing)
    return (
      <span className={chip}>
        <Icon aria-hidden className="size-3.5 text-faint" />
        <input
          type="time"
          autoFocus
          value={value}
          aria-label={`${ROUTINE_NAMES[routine]} time`}
          onChange={(e) => /^\d\d:\d\d$/.test(e.target.value) && onChange(e.target.value)}
          onBlur={() => setEditing(false)}
          className="bg-transparent text-sm outline-none"
        />
      </span>
    );
  return (
    <Tooltip
      label={`${ROUTINE_NAMES[routine]} at ${value}`}
      detail="Click to change"
      className="flex"
    >
      <button
        type="button"
        data-time-chip={routine}
        aria-label={`${ROUTINE_NAMES[routine]} at ${value}. Change`}
        onClick={() => setEditing(true)}
        className={clsx(chip, 'hover:bg-subtle')}
      >
        <Icon aria-hidden className="size-3.5 text-faint" />
        {value || '—'}
      </button>
    </Tooltip>
  );
}

const MODEL_TONE: Record<string, string> = {
  haiku: 'bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-200',
  sonnet: 'bg-violet-50 text-violet-800 dark:bg-violet-950 dark:text-violet-200',
  opus: 'bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
};

function HowItRuns({
  draft,
  config,
  edit,
}: {
  draft: RoutinesConfig;
  config: RoutinesConfig;
  edit: Edit;
}) {
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
          <div className="flex flex-wrap items-center gap-2">
            {ROUTINES.map((r) => (
              <TimeChip
                key={r}
                routine={r}
                value={draft.schedule[r] ?? ''}
                onChange={(v) => edit((d) => (d.schedule[r] = v))}
              />
            ))}
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
              detail="Each routine fires once a day at its time; a computer asleep then runs the missed ones on wake, in order. Saved times apply within a minute."
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

type Pending = { routine: Routine; project: RoutinesProject };

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
  const [base, setBase] = useState<RoutinesConfig | null>(null);
  const [draft, setDraft] = useState<RoutinesConfig | null>(null);
  const changes = useMemo(() => (base && draft ? diffConfig(base, draft) : []), [base, draft]);
  const loaded = data?.config;
  const [seen, setSeen] = useState<RoutinesConfig | undefined>(undefined);
  if (loaded && loaded !== seen) {
    setSeen(loaded);
    if (!(changes.length && base)) {
      setBase(loaded);
      setDraft(structuredClone(loaded));
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
      await ownerPost('/api/routines/run', { routine, project: project.name });
      setNotice({
        tone: 'ok',
        text: `Started the ${ROUTINE_NAMES[routine].toLowerCase()} for ${project.name}`,
      });
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

  if (state.status === 'error' && !state.data)
    return <LoadError notFound={false} what="Routines" />;

  const status = new Map((data?.status ?? []).map((s) => [s.name, s]));
  const today = data?.now.slice(0, 10) ?? '';
  const enrolled = draft?.projects.filter((p) => p.enrolled) ?? [];
  const resting = draft?.projects.filter((p) => !p.enrolled) ?? [];
  const needs = enrolled.reduce((n, p) => n + (status.get(p.name)?.queue?.needs_you ?? 0), 0);
  const running = (data?.status ?? []).flatMap((s) =>
    ROUTINES.filter((r) => s.runs?.[r]?.status === 'running').map((routine) => ({
      project: s.name,
      routine,
    })),
  );
  const marks = draft ? timeline(draft.schedule).marks : [];
  const deskHref = (p: RoutinesProject) => {
    const id = pharosProjectId(p, desk.data);
    return id ? `/desk?project=${encodeURIComponent(id)}` : '/desk';
  };
  const pages = (['morning', 'evening'] as const).flatMap((k) => {
    const page = data?.pages[k];
    return page?.url ? [{ k, ...page }] : [];
  });

  const line = (p: RoutinesProject) => (
    <li key={p.name}>
      <ProjectLine
        project={p}
        status={status.get(p.name)}
        marks={marks}
        today={today}
        open={open === p.name}
        onToggle={() => setOpen(open === p.name ? null : p.name)}
        onLog={(file) => void openLog(file)}
        deskHref={deskHref(p)}
      />
      {open === p.name && (
        <ProjectDetail
          project={p}
          status={status.get(p.name)}
          night={nightRunOf(p.name, desk.data)}
          deskHref={deskHref(p)}
          edit={edit}
          onRun={(routine) => setPending({ routine, project: p })}
          onLog={(file) => void openLog(file)}
        />
      )}
    </li>
  );

  return (
    <div className={clsx('mx-auto max-w-3xl space-y-4 p-4 sm:p-8', changes.length && 'pb-24')}>
      <header className="space-y-1.5">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">Routines</h1>
          <span className="ml-auto flex items-center gap-1">
            {pages.map((p) => {
              const path = pharosPath(p.url);
              const name = p.k === 'morning' ? 'Morning' : 'Evening';
              const label = `${name} page · ${p.date ?? ''}${p.posted ? `, posted ${p.posted.slice(11)}` : ''}`;
              const cls = clsx(ICON_GHOST, 'gap-1 px-1.5 text-xs');
              const inner = (
                <>
                  <Newspaper aria-hidden className="size-3.5" />
                  {name}
                </>
              );
              return (
                <Tooltip key={p.k} label={label} className="flex">
                  {path ? (
                    <Link to={path} aria-label={label} data-page-link={p.k} className={cls}>
                      {inner}
                    </Link>
                  ) : (
                    <a href={p.url} aria-label={label} data-page-link={p.k} className={cls}>
                      {inner}
                    </a>
                  )}
                </Tooltip>
              );
            })}
            {data && (
              <Tooltip
                label="Refresh"
                detail={`As of ${data.now.slice(11)}, from ${data.url}`}
                className="flex"
              >
                <button type="button" aria-label="Refresh" onClick={reload} className={ICON_GHOST}>
                  <RefreshCw
                    aria-hidden
                    className={clsx('size-3.5', state.status === 'loading' && 'animate-spin')}
                  />
                </button>
              </Tooltip>
            )}
          </span>
        </div>
        {data && draft && (
          <Headline
            schedule={draft.schedule}
            enrolled={enrolled.length}
            needs={needs}
            running={running}
          />
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
            <Axis schedule={draft.schedule} />
            <ul className="divide-y divide-line-soft">{enrolled.map(line)}</ul>
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
          title={`Start the ${ROUTINE_NAMES[pending.routine].toLowerCase()} for ${pending.project.name} now?`}
          action={`Start ${SHORT[pending.routine]}`}
          danger
          busy={busy}
          onConfirm={() => void run(pending)}
          onCancel={() => setPending(null)}
        >
          <p>
            Real work: a headless agent in {pending.project.path}, up to{' '}
            <span className="font-medium">
              ${pending.routine === 'nightshift' ? pending.project.budget_usd : 2}
            </span>
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
