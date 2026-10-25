import {
  DAYS,
  DIFFICULTIES,
  ROUTINE_MODELS,
  WEEKDAYS,
  daysShort,
  daysText,
  type Day,
  ROUTINES,
  currentRoutinesValue,
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
  type RoutinesFolder,
  type RoutinesPharos,
  type RoutinesProject,
  type RoutineProposalView,
  type RoutinesCurrent,
  type RoutinesCurrentProject,
  type RoutinesProjectStatus,
  type RoutinesState,
} from '@pharos/schema';
import clsx from 'clsx';
import {
  AlertTriangle,
  Bot,
  Brush,
  CalendarClock,
  Globe,
  Check,
  ChevronRight,
  Clock,
  Flag,
  FolderGit2,
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
  Undo2,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { RailLink, WorkingMark } from './AgentsPage';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '../catalog/menu';
import { Select } from '../catalog/select';
import { ICON_GHOST, InfoTip, Tooltip } from '../catalog/tooltip';
import { BUTTON } from '../catalog/ui';
import { ApiError, getJson, useResource } from '../lib/api';
import { useRevisionEvents } from '../lib/events';
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
/** Today's day of the week in `timeZone`, 0 = Monday. */
export function weekdayIn(timeZone: string | undefined, now = new Date()): number {
  let name: string;
  try {
    name = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(now);
  } catch {
    name = new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(now);
  }
  return Math.max(0, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(name));
}

/**
 * Minutes until a routine next fires, counting only the days it runs (missing days: every day);
 * null when it never does. A run at this very minute is firing now; the next one counts.
 */
export function minutesUntil(
  routine: Pick<RoutineDef, 'time' | 'days'>,
  timeZone: string | undefined,
  now = new Date(),
): number | null {
  if (!/^\d\d:\d\d$/.test(routine.time)) return null;
  const current = minutesIn(timeZone, now);
  const today = weekdayIn(timeZone, now);
  const first = (toMinutes(routine.time) - current + 1440) % 1440 || 1440;
  for (let extra = 0; extra < 8; extra++) {
    const inMinutes = first + extra * 1440;
    // The day the run happens on: today, or a later day once it passes midnight.
    const day = (today + Math.floor((current + inMinutes) / 1440)) % 7;
    if (!routine.days || routine.days.includes(DAYS[day]!)) return inMinutes;
  }
  return null;
}

/** Whether a routine runs at its next time (tonight), or skips it for its days. */
export function runsTonight(
  routine: Pick<RoutineDef, 'time' | 'days'>,
  timeZone: string | undefined,
  now = new Date(),
): boolean {
  const left = minutesUntil(routine, timeZone, now);
  return left !== null && left <= 1440;
}

/** The next enabled routine to fire (on a day it runs), and in how many minutes. */
export function nextRun<T extends Pick<RoutineDef, 'time' | 'enabled' | 'days'>>(
  routines: T[],
  timeZone: string | undefined,
  now = new Date(),
): { routine: T; inMinutes: number } | null {
  const due = routines
    .filter((r) => r.enabled)
    .flatMap((routine) => {
      const inMinutes = minutesUntil(routine, timeZone, now);
      return inMinutes === null ? [] : [{ routine, inMinutes }];
    });
  return due.sort((a, b) => a.inMinutes - b.inMinutes)[0] ?? null;
}

/** "in 45 min", "in 10 h 26 min". */
export function inTime(minutes: number): string {
  if (minutes < 60) return `in ${minutes} min`;
  if (minutes >= 1440) {
    const d = Math.floor(minutes / 1440);
    const h = Math.floor((minutes % 1440) / 60);
    return h ? `in ${d} d ${h} h` : `in ${d} d`;
  }
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
  // Projects added from a Pharos folder, or taken out of routines.json.
  for (const p of draft.projects)
    if (!base.projects.some((b) => b.name === p.name))
      changes.push({ field: 'project', name: p.name, from: null, to: p });
  for (const b of base.projects)
    if (!draft.projects.some((p) => p.name === b.name))
      changes.push({ field: 'project', name: b.name, from: b, to: null });
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

// ── Unsaved edits survive ───────────────────────────────────────────────────────────────────

/**
 * The page's unsaved edits, kept in this browser until they are saved (owner's review: edits to
 * a routine's instructions were lost when a save was refused or the page reloaded during a
 * restart). A preference of this browser, not project data.
 */
export const DRAFT_KEY = 'pharos-routines-draft';

function readDraft(): RoutinesChange[] | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(list) && list.length ? (list as RoutinesChange[]) : null;
  } catch {
    return null;
  }
}

function writeDraft(changes: RoutinesChange[]) {
  try {
    if (changes.length) localStorage.setItem(DRAFT_KEY, JSON.stringify(changes));
    else localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Not kept in this browser: the page still works.
  }
}

/** One edit made to the draft (what the save will send, made here first). */
export function applyChange(d: Draft, ch: RoutinesChange): void {
  switch (ch.field) {
    case 'enrolled':
    case 'budget_usd':
    case 'hours': {
      const p = d.projects.find((x) => x.name === ch.project);
      if (p) Object.assign(p, { [ch.field]: ch.to });
      break;
    }
    case 'schedule':
      d.schedule[ch.routine] = ch.to;
      break;
    case 'timezone':
      d.schedule.timezone = ch.to;
      break;
    case 'dispatch':
      d.dispatch[ch.kind] = { ...d.dispatch[ch.kind], [ch.level]: ch.to };
      break;
    case 'routine': {
      const at = d.routines.findIndex((r) => r.id === ch.id);
      if (!ch.to) d.routines = d.routines.filter((r) => r.id !== ch.id);
      else if (at < 0) d.routines.push(ch.to);
      else d.routines[at] = ch.to;
      break;
    }
    case 'project':
      d.projects = d.projects.filter((x) => x.name !== ch.name);
      if (ch.to) d.projects.push(ch.to as RoutinesProject);
      break;
  }
}

/** An edit whose field changed underneath it (routines.json edited elsewhere). */
export type DraftConflict = { change: RoutinesChange; theirs: unknown };

const same = (a: unknown, b: unknown) =>
  (a ?? null) === (b ?? null) || canonical(a ?? null) === canonical(b ?? null);

/**
 * The owner's edits on top of a fresh routines.json: each one whose field still holds what the
 * owner saw is made again; one already there is dropped; one whose field changed meanwhile is a
 * conflict for the owner to settle (Keep mine / Use theirs).
 */
export function reapply(
  fresh: Draft,
  edits: RoutinesChange[],
): { draft: Draft; conflicts: DraftConflict[]; kept: number } {
  const draft = structuredClone(fresh);
  const conflicts: DraftConflict[] = [];
  let kept = 0;
  for (const ch of edits) {
    const theirs = currentRoutinesValue(fresh, ch);
    if (same(theirs, ch.to)) continue;
    if (same(theirs, ch.from)) {
      applyChange(draft, ch);
      kept++;
    } else conflicts.push({ change: ch, theirs });
  }
  return { draft, conflicts, kept };
}

/** Their value of a conflicting field, in a few words. */
function theirsText(c: DraftConflict): string {
  const v = c.theirs as unknown;
  if (v === null || v === undefined) return 'removed';
  if (typeof v !== 'object') return String(v);
  const r = v as Partial<RoutineDef> & { name?: string };
  if (c.change.field === 'routine')
    return `${r.time ?? ''}${r.days ? ` ${daysText(r.days)}` : ''} · “${(r.instructions ?? '').slice(0, 80)}${(r.instructions ?? '').length > 80 ? '…' : ''}”`;
  return r.name ?? 'changed';
}

// ── Rows: routines.json merged with Pharos's folders ────────────────────────────────────────

const samePath = (a: string, b: string) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');

/** A line under Parked: a parked project, one whose folder Pharos no longer has, or a new folder. */
export type ParkedRow =
  | { kind: 'parked'; project: RoutinesProject }
  | { kind: 'not-in-pharos'; project: RoutinesProject }
  | { kind: 'not-in-routines'; folder: RoutinesFolder };

/**
 * The page's rows: Pharos's folders decide what exists (owner's review: new folders show up,
 * deleted ones stop counting). An enrolled project whose path is a Pharos folder is a row; parked
 * ones, folders routines.json doesn't have yet, and projects with no Pharos folder go under
 * Parked. Without folders (a server with no store) routines.json alone decides, as before.
 */
export function arrangeRows(
  projects: RoutinesProject[],
  folders: RoutinesFolder[] | undefined,
): { active: RoutinesProject[]; parked: ParkedRow[] } {
  const inPharos = (p: RoutinesProject) =>
    !folders || folders.some((f) => Boolean(p.path) && samePath(f.path, p.path));
  const active = projects.filter((p) => p.enrolled && inPharos(p));
  const parked: ParkedRow[] = [
    ...projects
      .filter((p) => !p.enrolled && inPharos(p))
      .map((project) => ({ kind: 'parked' as const, project })),
    ...(folders ?? [])
      .filter((f) => !projects.some((p) => p.path && samePath(f.path, p.path)))
      .map((folder) => ({ kind: 'not-in-routines' as const, folder })),
    ...projects
      .filter((p) => !inPharos(p))
      .map((project) => ({ kind: 'not-in-pharos' as const, project })),
  ];
  return { active, parked };
}

/** The value most projects have (budgets and hours), for a new one; `fallback` when none do. */
function usual(values: number[], fallback: number): number {
  const counts = new Map<number, number>();
  for (const v of values) if (v > 0) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? fallback;
}

/**
 * The routines.json entry for a Pharos folder: named after the folder on disk (unique), enrolled,
 * the usual night budget, and linked to the folder's main Pharos project as routines.json links.
 */
export function entryFor(folder: RoutinesFolder, projects: RoutinesProject[]): RoutinesProject {
  const base =
    folder.path.replace(/\/+$/, '').split('/').pop()?.trim().toLowerCase() ||
    folder.name.trim().toLowerCase();
  let name = base;
  for (let i = 2; projects.some((p) => p.name === name); i++) name = `${base}-${i}`;
  return {
    name,
    path: folder.path,
    enrolled: true,
    budget_usd: usual(
      projects.map((p) => p.budget_usd),
      5,
    ),
    hours: usual(
      projects.map((p) => p.hours),
      4,
    ),
    pm: folder.project ? { type: 'pharos', project: folder.project.id } : null,
  };
}

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
  const label =
    look === 'running'
      ? `${routine.name} · ${project}: running ${minutesSince(run?.when)} min`
      : `${routine.name} · ${project}: ${RUN_WORD[look]}${time ? `, ${time}` : ''}`;
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
          <Loader2
            aria-hidden
            className="size-3 text-sky-500 motion-safe:animate-spin motion-reduce:animate-pulse"
          />
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

/** A project's place in the routine running now: its dot, its state on hover. */
const LIVE: Record<RoutinesCurrentProject['state'], { word: string; dot: string }> = {
  done: { word: 'done', dot: 'bg-emerald-500' },
  running: { word: 'running', dot: '' },
  waiting: { word: 'waiting', dot: 'bg-amber-500 motion-safe:animate-pulse' },
  queued: {
    word: 'queued',
    dot: 'border border-neutral-400 bg-transparent motion-safe:animate-pulse dark:border-neutral-500',
  },
  skipped: { word: 'skipped', dot: 'bg-amber-500' },
  failed: { word: 'failed', dot: 'bg-rose-500' },
};

function LiveDot({
  project,
  routine,
  live,
  run,
  onLog,
}: {
  project: string;
  routine: RoutineDef;
  live: RoutinesCurrentProject;
  run: RoutineRun | null | undefined;
  onLog: (file: string) => void;
}) {
  const look = LIVE[live.state];
  const minutes = live.since ? ` ${minutesSince(live.since)} min` : '';
  const label = `${routine.name} · ${project}: ${look.word}${live.state === 'running' || live.state === 'waiting' ? minutes : ''}${live.reason ? `: ${live.reason}` : ''}`;
  const report = live.state === 'done' && live.report?.startsWith('/') ? live.report : undefined;
  const dot =
    live.state === 'running' ? (
      <Loader2
        aria-hidden
        className="size-3 text-sky-500 motion-safe:animate-spin motion-reduce:animate-pulse"
      />
    ) : (
      <span aria-hidden className={clsx('block size-2.5 rounded-full', look.dot)} />
    );
  const cls =
    'tap-area flex size-5 items-center justify-center rounded-full hover:bg-subtle focus-visible:outline-2 focus-visible:outline-sky-400';
  return (
    <Tooltip
      label={label}
      detail={report ? 'Click for its report' : run?.file ? 'Click for its log' : undefined}
      className="flex"
    >
      {report ? (
        <Link
          to={report}
          aria-label={label}
          data-run-dot={routine.id}
          data-live={live.state}
          className={cls}
        >
          {dot}
        </Link>
      ) : (
        <button
          type="button"
          aria-label={label}
          data-run-dot={routine.id}
          data-live={live.state}
          disabled={!run?.file}
          onClick={(e) => {
            e.stopPropagation();
            if (run?.file) onLog(run.file);
          }}
          className={clsx(cls, 'disabled:cursor-default disabled:hover:bg-transparent')}
        >
          {dot}
        </button>
      )}
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

// ── Running now ─────────────────────────────────────────────────────────────────────────────

/** A time as Routines writes it (the computer's local time, "2026-10-23T21:05"). */
function localStamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Minutes since a Routines time, never negative. */
export function minutesSince(when: string | null | undefined, now = new Date()): number {
  const at = when ? new Date(when).getTime() : NaN;
  return Number.isNaN(at) ? 0 : Math.max(0, Math.round((now.getTime() - at) / 60_000));
}

/**
 * The run states the page shows: Routines' own, plus the routine runs Pharos's run log has open
 * ("Evening wrap-up · tutti", reported by the run itself) that Routines doesn't show as running.
 */
export function withOpenRuns(
  status: RoutinesProjectStatus[],
  routines: RoutineDef[],
  deskRuns: DeskRun[] | undefined,
): Map<string, RoutinesProjectStatus> {
  const out = new Map(status.map((s) => [s.name, s]));
  for (const run of deskRuns ?? []) {
    if (run.outcome !== 'running') continue;
    for (const r of routines) {
      const prefix = `${r.name} · `;
      if (!run.name.startsWith(prefix)) continue;
      const project = run.name.slice(prefix.length);
      const was = out.get(project) ?? { name: project, exists: true };
      if (was.runs?.[r.id]?.status === 'running') continue;
      out.set(project, {
        ...was,
        runs: {
          ...was.runs,
          [r.id]: {
            file: was.runs?.[r.id]?.file ?? null,
            when: localStamp(new Date(run.startedAt)),
            status: 'running',
            tail: '',
          },
        },
      });
    }
  }
  return out;
}

export type RoutineProgress = {
  running: boolean;
  /** Projects of this run already finished, and all the projects it covers. */
  done: number;
  total: number;
  /** When its first running project started (a Routines time). */
  since: string | null;
  /** Routines' own account of the run, project by project, when it gives one. */
  current?: RoutinesCurrent;
};

/** "Evening wrap-up · 3 of 6 done · waiting on breathe". */
export function currentLine(current: RoutinesCurrent): string {
  const done = current.projects.filter((p) => p.state === 'done').length;
  const waiting = current.projects.filter((p) => p.state === 'waiting').map((p) => p.name);
  const running = current.projects.filter((p) => p.state === 'running').map((p) => p.name);
  const now = waiting.length
    ? ` · waiting on ${waiting.join(', ')}`
    : running.length
      ? ` · running ${running.join(', ')}`
      : '';
  return `${current.name} · ${done} of ${current.projects.length} done${now}`;
}

/**
 * How far a running routine has got: of the projects it covers, how many finished in this run
 * (a run's logs share its date) while the others wait or run.
 */
export function progressOf(
  routine: RoutineDef,
  projects: RoutinesProject[],
  status: Map<string, RoutinesProjectStatus>,
  current?: RoutinesCurrent | null,
): RoutineProgress {
  // Routines says where the run is (newer apps): that decides, queued projects included.
  if (current && current.routine === routine.id)
    return {
      running: true,
      done: current.projects.filter((p) => p.state === 'done').length,
      total: current.projects.length,
      since: current.started,
      current,
    };
  const covered = projects.filter((p) => routineCovers(routine, p));
  const runs = covered.map((p) => status.get(p.name)?.runs?.[routine.id]);
  const running = runs.filter((r) => r?.status === 'running');
  if (!running.length) return { running: false, done: 0, total: covered.length, since: null };
  const since =
    running
      .map((r) => r!.when ?? '')
      .filter(Boolean)
      .sort()[0] ?? null;
  const day = (running.find((r) => r!.file)?.file ?? since ?? '').slice(0, 10);
  const done = runs.filter(
    (r) => r && r.status !== 'running' && Boolean(day) && (r.file ?? r.when ?? '').startsWith(day),
  ).length;
  return { running: true, done, total: covered.length, since };
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
  current,
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
  current?: RoutinesCurrent | null;
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
  // "Now" shows only while tonight is under way (between the first and the last routine); in the
  // daytime the ringed next routine and its countdown say it, and a dot left of the band looked
  // like a misplaced icon (owner's review, 10-23).
  const underway = now > first && now < last;
  const progress = new Map(ordered.map((r) => [r.id, progressOf(r, projects, status, current)]));
  const runningNow = ordered.filter((r) => progress.get(r.id)?.running);
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
        {runningNow.map((r) => {
          const p = progress.get(r.id)!;
          return (
            <p
              key={r.id}
              data-running-line={r.id}
              className="flex items-center gap-1 text-xs font-medium text-sky-700 dark:text-sky-300"
            >
              <Loader2
                aria-hidden
                className="size-3 shrink-0 motion-safe:animate-spin motion-reduce:animate-pulse"
              />
              <span>
                {p.current
                  ? currentLine(p.current)
                  : `${r.name} is running · ${p.done} of ${p.total}`}
              </span>
            </p>
          );
        })}
      </div>
      <div className="relative h-[4.25rem]" role="list" aria-label="Tonight’s routines">
        {/* The band, and the part of it already behind us tonight. */}
        <div
          aria-hidden
          className="absolute top-[13px] h-0.5 rounded-full bg-line"
          style={{ left: `${first * 100}%`, right: `${(1 - last) * 100}%` }}
        />
        {underway && (
          <div
            aria-hidden
            className="absolute top-[13px] h-0.5 rounded-full bg-sky-300/70 dark:bg-sky-700/70"
            style={{ left: `${first * 100}%`, width: `${(now - first) * 100}%` }}
          />
        )}
        {underway && (
          <div
            className="absolute top-[9px] z-10 -translate-x-1/2"
            style={{ left: `${now * 100}%` }}
          >
            <Tooltip label={`Now${zone ? ` (${zone})` : ''}`} className="flex">
              <span
                tabIndex={0}
                data-now=""
                aria-label="Now"
                className="block size-2.5 rounded-full border-2 border-surface bg-sky-500 shadow"
              />
            </Tooltip>
          </div>
        )}
        {ordered.map((r, i) => {
          const Icon = routineIcon(r);
          const isNext = next?.routine.id === r.id;
          const results = lastResults(r, projects, status);
          // Its days skip tonight (a Fridays-only routine on a Tuesday): drawn faint.
          const skips = r.enabled && !runsTonight(r, timeZone);
          const run = progress.get(r.id)!;
          return (
            <div
              key={r.id}
              role="listitem"
              className="absolute top-0 flex -translate-x-1/2 flex-col items-center"
              style={{ left: `${line.xs[i]! * 100}%` }}
            >
              <span className="relative flex">
                {run.running && (
                  // A ring going round the node while it runs; a pulse for reduced motion.
                  <svg
                    aria-hidden
                    viewBox="0 0 36 36"
                    data-running-ring=""
                    className="pointer-events-none absolute -inset-1 z-30 size-9 text-sky-500 motion-safe:animate-spin motion-reduce:animate-pulse"
                  >
                    <circle
                      cx="18"
                      cy="18"
                      r="16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeDasharray="28 100"
                    />
                  </svg>
                )}
                <Tooltip
                  label={`${r.name} · ${r.time}${zone ? ` ${zone}` : ''}${r.enabled ? '' : ' · off'}${skips ? ` · not tonight (${daysShort(r.days)})` : r.days ? ` · ${daysText(r.days)}` : ''}`}
                  detail={`${run.running ? `Running for ${minutesSince(run.since)} min: ${run.done} of ${run.total} projects done. ` : ''}${skips ? `Not tonight (${daysShort(r.days)}). ` : ''}${r.instructions || 'No instructions yet.'}${results ? ` Last: ${results}.` : ''}${isNext && next ? ` Next, ${inTime(next.inMinutes)}.` : ''}`}
                  className="flex"
                >
                  <button
                    type="button"
                    data-node={r.id}
                    data-running={run.running || undefined}
                    data-next={isNext || undefined}
                    data-skips={skips || undefined}
                    aria-label={`${r.name} at ${r.time}. Edit`}
                    onClick={() => onEdit(r)}
                    className={clsx(
                      'relative z-20 flex size-7 items-center justify-center rounded-full border bg-surface transition-colors hover:bg-subtle focus-visible:outline-2 focus-visible:outline-sky-400',
                      isNext
                        ? 'border-sky-400 text-sky-700 ring-4 ring-sky-100 dark:border-sky-500 dark:text-sky-300 dark:ring-sky-950'
                        : 'border-line-strong text-ink-soft',
                      !r.enabled && 'border-dashed text-faint',
                      skips && 'opacity-45',
                    )}
                  >
                    <Icon aria-hidden className="size-3.5" />
                  </button>
                </Tooltip>
              </span>
              <span
                className={clsx(
                  'mt-1 hidden max-w-28 truncate text-xs sm:block',
                  isNext ? 'font-medium text-ink' : 'text-muted',
                  !r.enabled && 'line-through',
                  skips && 'opacity-60',
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
                {run.running ? (
                  <span className="font-medium text-sky-700 dark:text-sky-300">
                    <span data-progress="" className="hidden sm:inline">
                      Running · {run.done} of {run.total}
                    </span>
                    {/* A phone has room for the numbers only. */}
                    <span aria-hidden className="sm:hidden">
                      {run.done}/{run.total}
                    </span>
                  </span>
                ) : isNext && next ? (
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
  const initialDays = routine?.days;
  const [dayMode, setDayMode] = useState<'every' | 'weekdays' | 'pick'>(
    !initialDays || initialDays.length >= 7
      ? 'every'
      : daysText(initialDays) === 'weekdays'
        ? 'weekdays'
        : 'pick',
  );
  const [picked, setPicked] = useState<Day[]>(initialDays ?? []);
  const days: Day[] | undefined =
    dayMode === 'every'
      ? undefined
      : dayMode === 'weekdays'
        ? WEEKDAYS
        : DAYS.filter((d) => picked.includes(d));
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
          : days && !days.length
            ? 'Pick at least one day'
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
      ...(days && days.length < 7 ? { days } : {}),
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
      <fieldset className="space-y-1.5" disabled={timeOnly} data-days="">
        <legend className="text-xs text-muted">Days</legend>
        <div className="flex flex-wrap gap-1.5">
          {(['every', 'weekdays', 'pick'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={dayMode === m}
              onClick={() => setDayMode(m)}
              className={clsx(
                'rounded-full px-2.5 py-1 text-xs ring-1 ring-inset disabled:opacity-60',
                dayMode === m ? 'bg-inverse text-on-inverse ring-inverse' : 'text-muted ring-line',
              )}
            >
              {m === 'every' ? 'Every day' : m === 'weekdays' ? 'Weekdays' : 'Pick days'}
            </button>
          ))}
        </div>
        {dayMode === 'pick' && (
          <div className="flex flex-wrap gap-1" role="group" aria-label="Days it runs">
            {DAYS.map((d) => {
              const on = picked.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  aria-label={d}
                  onClick={() => setPicked(on ? picked.filter((x) => x !== d) : [...picked, d])}
                  className={clsx(
                    'w-10 rounded-full py-0.5 text-xs capitalize ring-1 ring-inset',
                    on
                      ? 'bg-sky-50 text-sky-800 ring-sky-300 dark:bg-sky-950 dark:text-sky-200 dark:ring-sky-800'
                      : 'text-muted ring-line',
                  )}
                >
                  {d}
                </button>
              );
            })}
          </div>
        )}
      </fieldset>
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
  missing,
  current,
  onToggle,
  onLog,
}: {
  project: RoutinesProject;
  status: RoutinesProjectStatus | undefined;
  current?: RoutinesCurrent | null;
  routines: RoutineDef[];
  xs: number[];
  today: string;
  open: boolean;
  needs: number;
  needIds: string[];
  /** routines.json has it, Pharos has no folder at its path. */
  missing?: boolean;
  onToggle: () => void;
  onLog: (file: string) => void;
}) {
  return (
    <div
      className={clsx(GRID, 'min-h-10 px-3 py-1', open && 'bg-sunken/50', missing && 'opacity-60')}
      data-project-line={project.name}
      data-missing={missing || undefined}
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
        {missing && (
          <Tooltip
            label="Not in Pharos"
            detail="No Pharos folder has this path any more. Remove it from Routines in its ⋯ menu; its files stay."
            className="flex shrink-0"
          >
            <span tabIndex={0} className="text-xs whitespace-nowrap text-faint">
              Not in Pharos
            </span>
          </Tooltip>
        )}
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
          routineCovers(r, project) ||
          status?.runs?.[r.id] ||
          (current?.routine === r.id && current.projects.some((x) => x.name === project.name)) ? (
            <div
              key={r.id}
              className="absolute top-0 -translate-x-1/2"
              style={{ left: `${xs[i]! * 100}%` }}
            >
              {(() => {
                const live =
                  current?.routine === r.id
                    ? current.projects.find((x) => x.name === project.name)
                    : undefined;
                return live ? (
                  <LiveDot
                    project={project.name}
                    routine={r}
                    live={live}
                    run={status?.runs?.[r.id]}
                    onLog={onLog}
                  />
                ) : (
                  <RunDot
                    project={project.name}
                    routine={r}
                    run={status?.runs?.[r.id]}
                    today={today}
                    onLog={onLog}
                  />
                );
              })()}
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

/** A Pharos folder routines.json doesn't have yet: its name, and Enroll in its ⋯ menu. */
function FolderLine({
  folder,
  open,
  onToggle,
  onEnroll,
}: {
  folder: RoutinesFolder;
  open: boolean;
  onToggle: () => void;
  onEnroll: () => void;
}) {
  const [menu, setMenu] = useState<DOMRect | null>(null);
  return (
    <>
      <div
        className={clsx(GRID, 'min-h-10 px-3 py-1', open && 'bg-sunken/50')}
        data-folder-line={folder.name}
      >
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex min-w-0 items-center gap-1 rounded-control text-left text-sm text-muted hover:text-ink"
        >
          <ChevronRight
            aria-hidden
            className={clsx(
              'size-3.5 shrink-0 text-faint transition-transform',
              open && 'rotate-90',
            )}
          />
          <span className="truncate">{folder.name}</span>
        </button>
        <span className="text-xs text-faint" data-not-in-routines="">
          Not in Routines yet
        </span>
        <span className="flex justify-end">
          <Tooltip label={`Options for ${folder.name}`} className="flex">
            <button
              type="button"
              aria-label={`Options for ${folder.name}`}
              aria-haspopup="menu"
              aria-expanded={Boolean(menu)}
              onClick={(e) => setMenu(e.currentTarget.getBoundingClientRect())}
              className={ICON_GHOST}
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </button>
          </Tooltip>
        </span>
        {menu && (
          <Menu
            anchor={menu}
            align="end"
            label={`Options for ${folder.name}`}
            onClose={() => setMenu(null)}
          >
            <MenuItem
              icon={Play}
              onClick={() => {
                setMenu(null);
                onEnroll();
              }}
            >
              Enroll in the routines
            </MenuItem>
          </Menu>
        )}
      </div>
      {open && (
        <div className="border-t border-line-soft bg-sunken/50 px-3 py-3 sm:pl-[3.25rem]">
          <Fact icon={FolderGit2} label="Folder">
            <span className="block truncate font-mono text-xs">{folder.path}</span>
          </Fact>
        </div>
      )}
    </>
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
  onRemove,
  onEnrolled,
}: {
  project: RoutinesProject;
  status: RoutinesProjectStatus | undefined;
  routines: RoutineDef[];
  pharos: RoutinesPharos | undefined;
  /** Enroll or Pause: saved at once (owner's review), not left as an unsaved edit. */
  onEnrolled: (enrolled: boolean) => void;
  /** Shown for a project Pharos has no folder for: take it out of routines.json. */
  onRemove?: () => void;
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
                onEnrolled(!project.enrolled);
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
            {onRemove && (
              <>
                <MenuSeparator />
                <MenuItem
                  icon={Trash2}
                  danger
                  onClick={() => {
                    setMenu(null);
                    onRemove();
                  }}
                >
                  Remove from Routines
                </MenuItem>
              </>
            )}
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

/** Routines agents proposed (routine_propose), waiting on the owner: Add / Not now in place. */
function Proposals({
  proposals,
  onAnswer,
}: {
  proposals: RoutineProposalView[];
  onAnswer: (decisionId: string, option: 'add' | 'not-now') => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const answer = async (id: string, option: 'add' | 'not-now') => {
    setBusy(id);
    await onAnswer(id, option);
    setBusy(null);
  };
  return (
    <section aria-label="Proposed routines" className="space-y-1.5" data-proposals="">
      {proposals.map((p) => {
        const r = p.proposal;
        const Icon = routineIcon({});
        const scope =
          !r.projects || r.projects === 'enrolled' ? 'enrolled projects' : r.projects.join(', ');
        return (
          <div
            key={p.decisionId}
            data-proposal={p.decisionId}
            className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-block border border-sky-200 bg-sky-50/60 px-3 py-2 text-sm dark:border-sky-900 dark:bg-sky-950/40"
          >
            <Bot aria-hidden className="size-4 shrink-0 text-sky-700 dark:text-sky-300" />
            <span className="text-muted">Proposed by {p.proposedBy}:</span>
            <Tooltip
              label={`${r.name} · ${daysShort(r.days)} ${r.time} · for ${scope}`}
              detail={`${r.instructions} Why: ${r.reason}`}
              className="flex min-w-0"
            >
              <Link
                to={p.href}
                className="inline-flex min-w-0 items-center gap-1 font-medium text-ink hover:underline"
              >
                <Icon aria-hidden className="size-3.5 shrink-0 text-faint" />
                <span className="truncate">
                  {r.name} · {r.days ? `${daysShort(r.days)} ` : ''}
                  {r.time}
                </span>
              </Link>
            </Tooltip>
            {p.waiting && (
              <Tooltip label="Approved; waiting for Routines" detail={p.waiting} className="flex">
                <span tabIndex={0} className="text-warn">
                  <Clock aria-label="Approved; waiting for Routines" className="size-3.5" />
                </span>
              </Tooltip>
            )}
            <span className="ml-auto flex gap-1.5">
              <button
                type="button"
                disabled={busy === p.decisionId}
                onClick={() => void answer(p.decisionId, 'add')}
                className={BUTTON.primary}
              >
                Add
              </button>
              <button
                type="button"
                disabled={busy === p.decisionId}
                onClick={() => void answer(p.decisionId, 'not-now')}
                className={BUTTON.secondary}
              >
                Not now
              </button>
            </span>
          </div>
        );
      })}
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
  const reloadDesk = desk.reload;
  const data = state.data?.available ? state.data : null;
  // Folders and projects come and go in Pharos (made, renamed, deleted): look again on every
  // change, as the sidebar does.
  useRevisionEvents(() => {
    reload();
    reloadDesk();
  });
  // Runs move on their own: look again every 10 seconds while one runs, else every 30.
  const anyRunning = Boolean(
    data?.current ||
    data?.status.some((s) => Object.values(s.runs ?? {}).some((r) => r?.status === 'running')) ||
    desk.data?.runs.some((r) => r.outcome === 'running'),
  );
  useEffect(() => {
    const timer = setInterval(
      () => {
        reload();
        if (anyRunning) reloadDesk();
      },
      anyRunning ? 10_000 : 30_000,
    );
    return () => clearInterval(timer);
  }, [reload, reloadDesk, anyRunning]);
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
  // Edits to make again on the next load: this browser's unsaved ones at first, or the ones a
  // stale save was refused with.
  const [toReapply, setToReapply] = useState<{
    edits: RoutinesChange[];
    why: 'restored' | 'stale';
  } | null>(() => {
    const kept = readDraft();
    return kept ? { edits: kept, why: 'restored' } : null;
  });
  const [conflicts, setConflicts] = useState<DraftConflict[]>([]);
  const [ready, setReady] = useState(false);
  const [restoredNote, setRestoredNote] = useState<string | null>(null);
  if (loaded && loaded !== seen) {
    setSeen(loaded);
    if (toReapply || !(changes.length && base)) {
      const withRoutines = { ...loaded, routines: routinesOf(loaded) };
      setBase(withRoutines);
      if (toReapply) {
        const again = reapply(withRoutines, toReapply.edits);
        setDraft(again.draft);
        setConflicts(again.conflicts);
        if (again.kept || again.conflicts.length)
          setRestoredNote(
            toReapply.why === 'restored'
              ? 'Unsaved changes restored'
              : 'routines.json changed outside this page; your edits are kept on top',
          );
        setToReapply(null);
      } else setDraft(structuredClone(withRoutines));
      setReady(true);
    }
  }
  // Unsaved edits (and unsettled conflicts) stay in this browser until saved.
  useEffect(() => {
    if (ready) writeDraft([...changes, ...conflicts.map((c) => c.change)]);
  }, [ready, changes, conflicts]);
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
  const [removing, setRemoving] = useState<RoutinesProject | null>(null);
  const [toast, setToast] = useState<{ text: string; undo?: () => void } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(timer);
  }, [toast]);

  /**
   * Saves one small change right away (Enroll, Pause): through the same checked save, then the
   * page shows it at once (both the loaded config and the draft take it, so other unsaved edits
   * stay as they were) and reloads. On a refusal nothing moves and the error shows.
   */
  const saveNow = async (
    changes: RoutinesChange[],
    apply: (d: Draft) => void,
    done: {
      text: string;
      undo?: { changes: RoutinesChange[]; apply: (d: Draft) => void; text: string };
    },
  ): Promise<void> => {
    try {
      await ownerPost('/api/routines/save', { changes });
    } catch (err) {
      setToast(null);
      setNotice({ tone: 'error', text: (err as Error).message });
      return;
    }
    const take = (d: Draft | null) => {
      if (!d) return d;
      const next = structuredClone(d);
      apply(next);
      return next;
    };
    setBase(take);
    setDraft(take);
    const undo = done.undo;
    setToast({
      text: done.text,
      ...(undo ? { undo: () => void saveNow(undo.changes, undo.apply, { text: undo.text }) } : {}),
    });
    reload();
  };
  const setEnrolled = (project: RoutinesProject, enrolled: boolean) => {
    const was = base?.projects.find((p) => p.name === project.name);
    if (!was) return;
    const to = (value: boolean) => (d: Draft) => {
      const p = d.projects.find((x) => x.name === project.name);
      if (p) p.enrolled = value;
    };
    const change = (from: boolean, next: boolean): RoutinesChange[] => [
      { field: 'enrolled', project: project.name, from, to: next },
    ];
    void saveNow(change(was.enrolled, enrolled), to(enrolled), {
      text: `${project.name} ${enrolled ? 'enrolled' : 'paused'}`,
      undo: {
        changes: change(enrolled, was.enrolled),
        apply: to(was.enrolled),
        text: `${project.name} ${was.enrolled ? 'enrolled' : 'paused'} again`,
      },
    });
  };
  const enrollFolder = (folder: RoutinesFolder) => {
    if (!base) return;
    const entry = entryFor(folder, base.projects);
    void saveNow(
      [{ field: 'project', name: entry.name, from: null, to: entry }],
      (d) => {
        d.projects.push(entry);
      },
      {
        text: `${entry.name} enrolled`,
        undo: {
          changes: [{ field: 'project', name: entry.name, from: entry, to: null }],
          apply: (d) => {
            d.projects = d.projects.filter((p) => p.name !== entry.name);
          },
          text: `${entry.name} taken out again`,
        },
      },
    );
  };

  const save = async () => {
    setBusy(true);
    try {
      const res = await ownerPost<{ saved: string[] }>('/api/routines/save', { changes });
      setBase(draft);
      setRestoredNote(null);
      setNotice({ tone: 'ok', text: `Saved: ${res.saved.join('; ')}` });
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // routines.json changed since the page loaded: keep the owner's edits, load the fresh
        // file, and make them again on top (conflicts are shown to settle).
        setToReapply({ edits: changes, why: 'stale' });
        reload();
      } else setNotice({ tone: 'error', text: (err as Error).message });
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

  const status = withOpenRuns(data?.status ?? [], draft?.routines ?? [], desk.data?.runs);
  const today = data?.now.slice(0, 10) ?? '';
  const rows = draft ? arrangeRows(draft.projects, data?.folders) : { active: [], parked: [] };
  const enrolled = rows.active;
  const resting = rows.parked;
  const routines = draft ? inOrder(draft.routines) : [];
  const xs = band(routines.map((r) => r.time)).xs;
  const idsOf = (p: RoutinesProject) => data?.pharos?.[p.name]?.projects.map((x) => x.id) ?? [];
  const items = desk.data?.items;
  const enrolledIds = [...new Set(enrolled.flatMap(idsOf))];
  const needsTotal = items ? deskCount(items, enrolledIds) : null;

  const line = (p: RoutinesProject, missing = false) => {
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
          missing={missing}
          current={data?.current}
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
            onRemove={missing ? () => setRemoving(p) : undefined}
            onEnrolled={(enrolled) => setEnrolled(p, enrolled)}
          />
        )}
      </li>
    );
  };
  const parkedLine = (row: ParkedRow) =>
    row.kind === 'not-in-routines' ? (
      <li key={`folder:${row.folder.id}`}>
        <FolderLine
          folder={row.folder}
          open={open === `folder:${row.folder.id}`}
          onToggle={() =>
            setOpen(open === `folder:${row.folder.id}` ? null : `folder:${row.folder.id}`)
          }
          onEnroll={() => enrollFolder(row.folder)}
        />
      </li>
    ) : (
      line(row.project, row.kind === 'not-in-pharos')
    );

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

      {restoredNote && (
        <p role="status" data-restored="" className="flex items-center gap-2 text-xs text-muted">
          <Undo2 aria-hidden className="size-3.5" />
          {restoredNote}
          <Tooltip label="Dismiss" className="flex">
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setRestoredNote(null)}
              className={ICON_GHOST}
            >
              <X className="size-3" aria-hidden />
            </button>
          </Tooltip>
        </p>
      )}
      {conflicts.length > 0 && (
        <section
          aria-label="Edits that conflict"
          data-conflicts=""
          className="space-y-2 rounded-block border border-amber-300 bg-amber-50/60 px-3 py-2.5 text-sm dark:border-amber-800 dark:bg-amber-950/40"
        >
          <p className="flex items-center gap-1.5 font-medium">
            <AlertTriangle aria-hidden className="size-3.5 text-warn" />
            Changed in routines.json while you edited
          </p>
          <ul className="space-y-1.5">
            {conflicts.map((c, i) => (
              <li key={i} data-conflict="" className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="min-w-0 flex-1">
                  <span className="text-ink">Yours: {describeRoutinesChange(c.change)}</span>
                  <span className="block text-xs text-muted">Theirs now: {theirsText(c)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    edit((d) => applyChange(d, c.change));
                    setConflicts((all) => all.filter((x) => x !== c));
                  }}
                  className={BUTTON.primary}
                >
                  Keep mine
                </button>
                <button
                  type="button"
                  onClick={() => setConflicts((all) => all.filter((x) => x !== c))}
                  className={BUTTON.secondary}
                >
                  Use theirs
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {state.data && !state.data.available ? (
        <Unavailable reason={state.data.reason} url={state.data.url} onRetry={reload} />
      ) : !data || !draft ? (
        <div className="h-64 animate-pulse rounded-block bg-sunken" />
      ) : (
        <>
          {data.proposals && data.proposals.length > 0 && (
            <Proposals
              proposals={data.proposals}
              onAnswer={async (decisionId, chosenOptionId) => {
                try {
                  await ownerPost('/api/desk/answer', { id: decisionId, chosenOptionId });
                  setTimeout(reload, 600);
                } catch (err) {
                  setNotice({ tone: 'error', text: (err as Error).message });
                }
              }}
            />
          )}
          <section
            aria-label="Projects"
            className="overflow-hidden rounded-block border border-line bg-surface"
          >
            <Tonight
              current={data.current}
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
              {enrolled.map((p) => line(p))}
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
                {parked && <ul className="divide-y divide-line-soft">{resting.map(parkedLine)}</ul>}
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

      {toast && (
        <div
          role="status"
          data-toast=""
          className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 animate-pop-in items-center gap-3 rounded-control bg-inverse px-3 py-2 text-sm text-on-inverse shadow-overlay"
        >
          <Check aria-hidden className="size-3.5" />
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              type="button"
              onClick={() => {
                const undo = toast.undo!;
                setToast(null);
                undo();
              }}
              className="font-medium underline-offset-2 hover:underline"
            >
              Undo
            </button>
          )}
        </div>
      )}

      {removing && (
        <Confirm
          title={`Remove ${removing.name} from Routines?`}
          action="Remove"
          danger
          onConfirm={() => {
            const name = removing.name;
            edit((d) => {
              d.projects = d.projects.filter((p) => p.name !== name);
            });
            setRemoving(null);
          }}
          onCancel={() => setRemoving(null)}
        >
          <p>It leaves routines.json once you save; its folder and files stay where they are.</p>
        </Confirm>
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
/** The routine running now, for the sidebar: its name, or null (polled like the page). */
function useRunningRoutine(): string | null {
  const state = useResource<RoutinesState>('/api/routines/state');
  const { reload } = state;
  const current = state.data?.available ? state.data.current : null;
  useEffect(() => {
    const timer = setInterval(reload, current ? 10_000 : 30_000);
    return () => clearInterval(timer);
  }, [reload, current]);
  return current ? current.name || current.routine : null;
}

/** Routines on the folded sidebar's rail: the same turn while a routine runs. */
export function RoutinesRailLink() {
  const running = useRunningRoutine();
  return (
    <RailLink
      to="/routines"
      label={running ? `Routines · ${running} running` : 'Routines'}
      working={Boolean(running)}
      icon={Repeat}
    />
  );
}

/** Routines in the sidebar: its icon turns while a routine runs (owner, 2026-10-24). */
export function RoutinesLink() {
  const running = useRunningRoutine();
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
      <Repeat
        aria-hidden
        data-working={running ? true : undefined}
        className={clsx('size-3.5', running && 'animate-working text-presence')}
      />{' '}
      Routines
      {running && <WorkingMark label={`${running} running`} />}
    </NavLink>
  );
}
