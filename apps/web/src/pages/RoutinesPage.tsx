import {
  DIFFICULTIES,
  ROUTINE_MODELS,
  ROUTINE_NAMES,
  ROUTINES,
  describeRoutinesChange,
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
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  GitBranch,
  Inbox,
  Loader2,
  Moon,
  Play,
  RefreshCw,
  Repeat,
  Sun,
  Sunset,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router';
import { Menu, MenuItem, MenuLabel } from '../catalog/menu';
import { Select } from '../catalog/select';
import { Tooltip } from '../catalog/tooltip';
import { BUTTON, Badge, Dot, type Tone } from '../catalog/ui';
import { ApiError, getJson, useResource } from '../lib/api';
import { plural } from '../lib/format';
import { LoadError } from './onboarding';
import { Section, Switch } from './settings-ui';

// The Routines page: one control panel for the owner's daily routines (evening wrap-up, night
// run, morning report, cleanup). The engine is the Routines app; Pharos reads it through
// /api/routines/* and draws it like the desk and Updates: at a glance first (what runs next,
// what runs now, what needs the owner, today's pages), then one row per project, then the
// schedule and the models, saved explicitly.

const ROUTINE_ICON: Record<Routine, LucideIcon> = {
  wrapup: Sunset,
  nightshift: Moon,
  daybreak: Sun,
};
/** Short names for chips. */
const SHORT: Record<Routine, string> = {
  wrapup: 'Wrap-up',
  nightshift: 'Night',
  daybreak: 'Morning',
};
const ROUTINE_ABOUT: Record<Routine, string> = {
  wrapup: 'Closes the day, updates Pharos, hands code-doable work to the night (HANDOFF.md).',
  nightshift: 'Works the handoff: dispatches each task to its model, verifies, lands small slices.',
  daybreak: 'Verifies the night and writes what was done, the results and today’s plan.',
};

const CLEANUP_LEVELS: Record<number, { name: string; about: string }> = {
  0: { name: 'Off', about: 'Nothing is cleaned up.' },
  1: {
    name: 'Safe',
    about:
      'After the wrap-up: merged clean worktrees and branches, and old scratch folders. Each removal is listed with the command that brings it back.',
  },
  2: {
    name: 'Tidy',
    about: 'Level 1, plus proposals for more that land on your desk to approve.',
  },
  3: { name: 'Deep', about: 'Not built yet: treated as level 1.' },
};

const CONTROL =
  'inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-muted hover:bg-sunken';

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

/** "HH:MM" now in `timeZone` (the schedule's), as minutes since midnight. */
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

// ── Small pieces ────────────────────────────────────────────────────────────────────────────

const RUN_LOOK: Record<RoutineRun['status'] | 'never', { tone: Tone; word: string }> = {
  ok: { tone: 'green', word: 'ok' },
  ran: { tone: 'amber', word: 'ran' },
  error: { tone: 'red', word: 'failed' },
  running: { tone: 'blue', word: 'running' },
  never: { tone: 'muted', word: 'never' },
};

const RUN_MEANING: Record<RoutineRun['status'] | 'never', string> = {
  ok: 'Finished and said so',
  ran: 'Ended without saying it finished: worth a look',
  error: 'The log mentions an error, a refusal or the budget',
  running: 'Running now',
  never: 'No run logged yet',
};

function RunChip({
  routine,
  run,
  today,
  onOpen,
}: {
  routine: Routine;
  run: RoutineRun | null | undefined;
  today: string;
  onOpen?: () => void;
}) {
  const status = run?.status ?? 'never';
  const look = RUN_LOOK[status];
  const time = runTime(run?.when, today);
  const chip = (
    <Badge tone={look.tone} className={clsx(status === 'running' && 'animate-pulse')}>
      {status === 'running' ? (
        <Loader2 aria-hidden className="size-3 animate-spin" />
      ) : (
        <Dot tone={look.tone} className="size-1.5" />
      )}
      {SHORT[routine]} {look.word}
      {time && <span className="font-normal tabular-nums opacity-75">{time}</span>}
    </Badge>
  );
  return (
    <Tooltip
      label={`${ROUTINE_NAMES[routine]}: ${look.word}${time ? ` · ${time}` : ''}`}
      detail={RUN_MEANING[status]}
      className="flex"
    >
      {onOpen && run?.file ? (
        <button
          type="button"
          data-run-chip={routine}
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="rounded-full"
        >
          {chip}
        </button>
      ) : (
        <span tabIndex={0} data-run-chip={routine} className="rounded-full">
          {chip}
        </span>
      )}
    </Tooltip>
  );
}

function Queue({ queue }: { queue: RoutinesProjectStatus['queue'] }) {
  if (!queue) return <span className="text-xs text-faint">no NEXT.md</span>;
  return (
    <span className="flex items-center gap-1 text-xs tabular-nums" data-queue="">
      <Tooltip
        label={`${queue.auto} auto`}
        detail="Claude does these without asking"
        className="flex"
      >
        <span tabIndex={0} className="rounded-full bg-sunken px-1.5 py-0.5 text-muted">
          {queue.auto} auto
        </span>
      </Tooltip>
      <Tooltip
        label={`${queue.review} review`}
        detail="Built on a branch, held for your look"
        className="flex"
      >
        <span tabIndex={0} className="rounded-full bg-sunken px-1.5 py-0.5 text-muted">
          {queue.review} review
        </span>
      </Tooltip>
      <Tooltip
        label={`${queue.needs_you} need you`}
        detail="Gates and questions only you answer"
        className="flex"
      >
        <span
          tabIndex={0}
          className={clsx(
            'rounded-full px-1.5 py-0.5',
            queue.needs_you
              ? 'bg-amber-100 font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200'
              : 'bg-sunken text-muted',
          )}
        >
          {queue.needs_you} need you
        </span>
      </Tooltip>
    </span>
  );
}

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
      onClick={(e) => e.stopPropagation()}
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
        onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          setText(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value.trim() !== '' && Number.isFinite(v) && v >= 0 && v <= max) onChange(v);
        }}
        className="w-9 bg-transparent text-right outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
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

// ── At a glance ─────────────────────────────────────────────────────────────────────────────

/** A Pharos page link from Routines ("http://127.0.0.1:4300/projects/…"): opened in this app. */
function pharosPath(url: string): string | null {
  try {
    const u = new URL(url);
    return /^\/projects\//.test(u.pathname) ? `${u.pathname}${u.search}` : null;
  } catch {
    return null;
  }
}

function Tile({
  label,
  icon: Icon,
  children,
  detail,
  tone,
  data,
}: {
  label: string;
  icon: LucideIcon;
  children: ReactNode;
  detail?: ReactNode;
  tone?: 'warn' | 'live';
  data: string;
}) {
  return (
    <li
      data-tile={data}
      className={clsx(
        'min-w-0 rounded-block border bg-surface px-3 py-2.5',
        tone === 'warn'
          ? 'border-amber-300 dark:border-amber-800'
          : tone === 'live'
            ? 'border-sky-300 dark:border-sky-800'
            : 'border-line',
      )}
    >
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <Icon aria-hidden className="size-3" />
        {label}
      </div>
      <div className="mt-1 truncate text-lg leading-tight font-semibold text-ink">{children}</div>
      {detail && <div className="mt-0.5 truncate text-xs text-muted">{detail}</div>}
    </li>
  );
}

function Glance({
  state,
  draft,
}: {
  state: Extract<RoutinesState, { available: true }>;
  draft: RoutinesConfig;
}) {
  const enrolled = new Set(draft.projects.filter((p) => p.enrolled).map((p) => p.name));
  const next = nextRun(state.config.schedule);
  const running = state.status.flatMap((s) =>
    ROUTINES.filter((r) => s.runs?.[r]?.status === 'running').map((r) => ({
      project: s.name,
      routine: r,
      since: s.runs?.[r]?.when,
    })),
  );
  const needs = state.status
    .filter((s) => enrolled.has(s.name))
    .reduce((n, s) => n + (s.queue?.needs_you ?? 0), 0);
  const needing = state.status.filter((s) => enrolled.has(s.name) && s.queue?.needs_you);
  const today = state.now.slice(0, 10);
  const pages = (['morning', 'evening'] as const).flatMap((k) => {
    const page = state.pages[k];
    return page?.url ? [{ k, ...page }] : [];
  });
  const zone = zoneName(state.config.schedule.timezone);
  return (
    <ul className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="At a glance">
      <Tile
        label="Next run"
        icon={CalendarClock}
        data="next"
        detail={next ? `${inTime(next.inMinutes)}${zone ? ` · ${zone}` : ''}` : undefined}
      >
        {next ? (
          <>
            {ROUTINE_NAMES[next.routine]} <span className="text-muted tabular-nums">{next.at}</span>
          </>
        ) : (
          'None scheduled'
        )}
      </Tile>
      <Tile
        label="Running now"
        icon={Workflow}
        data="running"
        tone={running.length ? 'live' : undefined}
        detail={
          running.length
            ? running
                .map(
                  (r) =>
                    `${SHORT[r.routine]} · ${r.project}${r.since ? ` since ${runTime(r.since, today)}` : ''}`,
                )
                .join(', ')
            : 'No routine is working right now'
        }
      >
        {running.length ? plural(running.length, 'routine') : 'Nothing'}
      </Tile>
      <Tile
        label="Needs you"
        icon={Inbox}
        data="needs"
        tone={needs ? 'warn' : undefined}
        detail={
          needing.length ? (
            <>
              {needing.map((s) => `${s.name} ${s.queue!.needs_you}`).join(' · ')} ·{' '}
              <Link to="/desk" className="font-medium text-accent hover:underline">
                Desk
              </Link>
            </>
          ) : (
            'in enrolled projects’ queues'
          )
        }
      >
        {needs ? plural(needs, 'item') : 'Nothing'}
      </Tile>
      <Tile
        label="Today’s pages"
        icon={FileText}
        data="pages"
        detail={
          pages.length
            ? pages
                .map(
                  (p) =>
                    `${p.k === 'morning' ? 'Morning' : 'Evening'} ${p.posted?.slice(11) ?? p.date ?? ''}`,
                )
                .join(' · ')
            : 'They appear after the first runs'
        }
      >
        {pages.length ? (
          <span className="flex flex-wrap gap-x-3 text-base">
            {pages.map((p) => {
              const path = pharosPath(p.url);
              const name = p.k === 'morning' ? 'Morning' : 'Evening';
              const old = p.date && p.date !== today;
              const Icon = p.k === 'morning' ? Sun : Sunset;
              const inner = (
                <>
                  <Icon aria-hidden className="size-3.5" />
                  {name}
                  {old && (
                    <span className="text-xs font-normal text-muted">({p.date?.slice(5)})</span>
                  )}
                </>
              );
              return path ? (
                <Link
                  key={p.k}
                  to={path}
                  data-page-link={p.k}
                  className="inline-flex items-center gap-1 text-accent hover:underline"
                >
                  {inner}
                </Link>
              ) : (
                <a
                  key={p.k}
                  href={p.url}
                  data-page-link={p.k}
                  className="inline-flex items-center gap-1 text-accent hover:underline"
                >
                  {inner}
                </a>
              );
            })}
          </span>
        ) : (
          'None yet'
        )}
      </Tile>
    </ul>
  );
}

// ── Projects ────────────────────────────────────────────────────────────────────────────────

function ProjectRow({
  project,
  status,
  today,
  open,
  onToggle,
  edit,
  onRun,
  onLog,
}: {
  project: RoutinesProject;
  status: RoutinesProjectStatus | undefined;
  today: string;
  open: boolean;
  onToggle: () => void;
  edit: Edit;
  onRun: (routine: Routine) => void;
  onLog: (file: string) => void;
}) {
  const detailsId = useId();
  const git = status?.git;
  const set = (patch: Partial<RoutinesProject>) =>
    edit((d) => {
      const p = d.projects.find((x) => x.name === project.name);
      if (p) Object.assign(p, patch);
    });
  return (
    <li data-routines-project={project.name} className={clsx(!project.enrolled && 'bg-sunken/40')}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
        <Switch
          checked={project.enrolled}
          label={`Enrol ${project.name}`}
          onChange={(enrolled) => set({ enrolled })}
        />
        <button
          type="button"
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={onToggle}
          className="flex min-w-0 flex-1 basis-40 items-center gap-1.5 text-left"
        >
          {open ? (
            <ChevronDown aria-hidden className="size-3.5 shrink-0 text-faint" />
          ) : (
            <ChevronRight aria-hidden className="size-3.5 shrink-0 text-faint" />
          )}
          <span className="min-w-0">
            <span
              className={clsx(
                'block truncate text-sm font-medium',
                project.enrolled ? 'text-ink' : 'text-muted',
              )}
            >
              {project.name}
            </span>
            <span className="block truncate text-xs text-muted">
              {status && !status.exists ? 'folder missing' : project.note || project.path}
            </span>
          </span>
        </button>
        <Queue queue={status?.queue} />
        <span className="flex items-center gap-1.5" aria-label={`Night budget for ${project.name}`}>
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
        </span>
        {/* Second line, lined up under the name: the last runs and the repo. */}
        <span className="flex basis-full flex-wrap items-center gap-1 sm:pl-[4.75rem]">
          {ROUTINES.map((r) => {
            const run = status?.runs?.[r];
            return (
              <RunChip
                key={r}
                routine={r}
                run={run}
                today={today}
                onOpen={run?.file ? () => onLog(run.file!) : undefined}
              />
            );
          })}
          {git && (
            <Tooltip label={git.head} detail="Last commit" className="flex">
              <span
                tabIndex={0}
                data-repo=""
                className="ml-1 flex items-center gap-1 text-xs text-muted tabular-nums"
              >
                <GitBranch aria-hidden className="size-3" />
                {git.dirty ? `${git.dirty} changed` : 'clean'}
                {git.ahead !== '-' && git.ahead !== '0' && ` · ${git.ahead} ahead`}
              </span>
            </Tooltip>
          )}
        </span>
      </div>
      {open && (
        <ProjectDetails
          id={detailsId}
          project={project}
          status={status}
          today={today}
          onRun={onRun}
          onLog={onLog}
        />
      )}
    </li>
  );
}

function ProjectDetails({
  id,
  project,
  status,
  today,
  onRun,
  onLog,
}: {
  id: string;
  project: RoutinesProject;
  status: RoutinesProjectStatus | undefined;
  today: string;
  onRun: (routine: Routine) => void;
  onLog: (file: string) => void;
}) {
  const files = Object.keys(status?.files ?? {});
  const [file, setFile] = useState(files.includes('NEXT.md') ? 'NEXT.md' : files[0]);
  const text = useResource<{ text: string }>(
    file
      ? `/api/routines/file?${new URLSearchParams({ project: project.name, name: file })}`
      : null,
  );
  const [menu, setMenu] = useState<DOMRect | null>(null);
  const lines = (text.data?.text ?? '').split('\n');
  const [all, setAll] = useState(false);
  const shown = all ? lines : lines.slice(0, 14);
  const running = ROUTINES.some((r) => status?.runs?.[r]?.status === 'running');
  return (
    <div
      id={id}
      data-routines-details={project.name}
      className="space-y-3 border-t border-line-soft bg-sunken/30 px-3 py-3 sm:pl-16"
    >
      <div className="flex flex-wrap items-center gap-2">
        {status?.queue?.ship && (
          <p className="min-w-0 flex-1 text-xs text-ink-soft">
            <span className="font-medium">Ship:</span> {status.queue.ship}
          </p>
        )}
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={Boolean(menu)}
          disabled={!status?.exists}
          onClick={(e) => setMenu(e.currentTarget.getBoundingClientRect())}
          className={clsx(BUTTON.secondary, 'ml-auto')}
        >
          <Play aria-hidden className="size-3.5" /> Run now{' '}
          <ChevronDown aria-hidden className="size-3" />
        </button>
        {menu && (
          <Menu
            anchor={menu}
            align="end"
            label={`Run a routine for ${project.name} now`}
            onClose={() => setMenu(null)}
          >
            <MenuLabel>Starts real work now; asks first</MenuLabel>
            {ROUTINES.map((r) => (
              <MenuItem
                key={r}
                icon={ROUTINE_ICON[r]}
                disabled={status?.runs?.[r]?.status === 'running'}
                onClick={() => {
                  setMenu(null);
                  onRun(r);
                }}
              >
                {ROUTINE_NAMES[r]}
              </MenuItem>
            ))}
          </Menu>
        )}
      </div>
      {running && (
        <p className="flex items-center gap-1.5 text-xs text-accent">
          <Loader2 aria-hidden className="size-3 animate-spin" /> A routine is running in this
          project.
        </p>
      )}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-label="Planning files" className="min-w-0 space-y-1.5">
          {files.length ? (
            <>
              <div role="tablist" aria-label="Planning files" className="flex flex-wrap gap-1">
                {files.map((f) => (
                  <button
                    key={f}
                    type="button"
                    role="tab"
                    aria-selected={f === file}
                    onClick={() => {
                      setFile(f);
                      setAll(false);
                    }}
                    className={clsx(
                      'rounded-full px-2 py-0.5 text-xs',
                      f === file
                        ? 'bg-inverse text-on-inverse'
                        : 'bg-surface text-muted ring-1 ring-line hover:bg-subtle',
                    )}
                  >
                    {f.replace('.md', '')}
                  </button>
                ))}
              </div>
              <pre
                data-file-text=""
                className="max-h-80 overflow-auto rounded-control border border-line bg-surface px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap text-ink-soft"
              >
                {text.status === 'loading' && !text.data
                  ? 'Loading…'
                  : text.error
                    ? text.error.message
                    : shown.join('\n') || '(empty)'}
              </pre>
              {lines.length > shown.length && (
                <button type="button" onClick={() => setAll(true)} className={CONTROL}>
                  Show all {lines.length} lines
                </button>
              )}
            </>
          ) : (
            <p className="text-xs text-muted">
              No planning files yet. Run /triage in this project, or the wrap-up.
            </p>
          )}
        </section>
        <section aria-label="Last runs" className="min-w-0 space-y-1.5">
          <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Last runs</h3>
          <ul className="space-y-1.5">
            {ROUTINES.map((r) => {
              const run = status?.runs?.[r];
              const tail = (run?.tail ?? '')
                .trim()
                .split('\n')
                .filter(Boolean)
                .slice(-3)
                .join('\n');
              return (
                <li key={r} className="rounded-control border border-line bg-surface px-2.5 py-2">
                  <div className="flex items-center gap-2">
                    <RunChip routine={r} run={run} today={today} />
                    {run?.file && (
                      <button
                        type="button"
                        onClick={() => onLog(run.file!)}
                        className="ml-auto text-xs font-medium text-accent hover:underline"
                      >
                        Open log
                      </button>
                    )}
                  </div>
                  {tail && (
                    <p className="mt-1.5 line-clamp-3 text-xs whitespace-pre-line text-muted">
                      {tail}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}

// ── Schedule and dispatch ───────────────────────────────────────────────────────────────────

function Schedule({ draft, edit }: { draft: RoutinesConfig; edit: Edit }) {
  const zone = zoneName(draft.schedule.timezone);
  return (
    <Section
      title="Schedule"
      icon={Clock}
      description="When each routine fires every day. A computer asleep at that time runs the missed ones on wake, in order. Saved times apply within a minute."
    >
      <ul className="divide-y divide-line-soft">
        {ROUTINES.map((r) => {
          const Icon = ROUTINE_ICON[r];
          return (
            <li key={r} className="space-y-0.5 py-2.5 first:pt-0">
              <label className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <Icon aria-hidden className="size-3.5 text-faint" /> {ROUTINE_NAMES[r]}
                </span>
                <input
                  type="time"
                  value={draft.schedule[r] ?? ''}
                  aria-label={`${ROUTINE_NAMES[r]} time`}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (/^\d\d:\d\d$/.test(v)) edit((d) => (d.schedule[r] = v));
                  }}
                  className="rounded-control border border-line-strong bg-surface px-2 py-1 text-sm tabular-nums"
                />
              </label>
              <p className="text-xs text-muted">{ROUTINE_ABOUT[r]}</p>
            </li>
          );
        })}
      </ul>
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">Timezone</span>
        <input
          type="text"
          value={draft.schedule.timezone ?? ''}
          aria-label="Timezone"
          spellCheck={false}
          onChange={(e) => edit((d) => (d.schedule.timezone = e.target.value))}
          className="w-48 rounded-control border border-line-strong bg-surface px-2 py-1 text-sm"
        />
        {zone ? (
          <span className="text-xs text-muted">now {zone}</span>
        ) : (
          <span className="text-xs text-danger">not a timezone this browser knows</span>
        )}
      </label>
    </Section>
  );
}

function Dispatch({ draft, edit }: { draft: RoutinesConfig; edit: Edit }) {
  const options = ROUTINE_MODELS.map((m) => ({ value: m, label: m }));
  return (
    <Section
      title="Model dispatch"
      icon={Workflow}
      description="The night run hands each task to the model for its kind and difficulty. The master that dispatches and verifies is fixed in routines.json."
    >
      <p className="text-xs text-muted">
        Master: <span className="font-medium text-ink-soft">{draft.master.model}</span>,{' '}
        {draft.master.effort} effort
      </p>
      <div className="overflow-x-auto">
        <table className="w-full max-w-2xl min-w-[22rem] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-1 pr-2 font-medium">Kind</th>
              {DIFFICULTIES.map((l) => (
                <th key={l} className="px-1 py-1 font-medium capitalize">
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {Object.entries(draft.dispatch).map(([kind, row]) => (
              <tr key={kind}>
                <td className="py-1.5 pr-2 capitalize">{kind}</td>
                {DIFFICULTIES.map((level) => (
                  <td key={level} className="px-1 py-1.5">
                    <Select
                      value={row[level] ?? ''}
                      label={`${kind}, ${level}`}
                      options={
                        row[level] && !(ROUTINE_MODELS as readonly string[]).includes(row[level]!)
                          ? [...options, { value: row[level]!, label: row[level]! }]
                          : options
                      }
                      onChange={(model) =>
                        edit((d) => {
                          d.dispatch[kind] = { ...d.dispatch[kind], [level]: model };
                        })
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Cleanup({ config }: { config: RoutinesConfig }) {
  const level = config.cleanup?.level ?? 1;
  const look = CLEANUP_LEVELS[level] ?? CLEANUP_LEVELS[1]!;
  const overrides = config.projects.filter((p) => typeof p.cleanup === 'number');
  return (
    <Section
      title="Cleanup"
      icon={Brush}
      description="Runs at the end of the full wrap-up, before the night makes new worktrees. Its list joins the evening page. The level is set in routines.json."
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1" data-cleanup-level={level}>
        <span className="text-sm font-medium">
          Level {level} · {look.name}
        </span>
        {config.cleanup?.scratch_days !== undefined && (
          <span className="text-xs text-muted">
            scratch kept {config.cleanup.scratch_days} days
          </span>
        )}
      </div>
      <p className="text-sm text-muted">{look.about}</p>
      {overrides.length > 0 && (
        <p className="text-xs text-muted">
          Per project: {overrides.map((p) => `${p.name} level ${p.cleanup}`).join(', ')}
        </p>
      )}
      <p className="text-xs text-faint">
        Level 2 proposals will arrive on your{' '}
        <Link to="/desk" className="text-accent hover:underline">
          desk
        </Link>{' '}
        to approve; nothing to set here yet.
      </p>
    </Section>
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
      className="space-y-3 rounded-block border border-line bg-surface p-5"
    >
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <AlertTriangle aria-hidden className="size-4 text-warn" /> Can’t reach Routines
      </h2>
      <p className="text-sm text-ink-soft">{reason}</p>
      <p className="text-xs text-muted">In the Routines folder:</p>
      <pre className="overflow-x-auto rounded-control bg-sunken px-3 py-2 font-mono text-xs text-ink-soft">
        python3 server.py
      </pre>
      <p className="text-xs text-muted">
        Pharos looks for it at {url} (set <code>PHAROS_ROUTINES_URL</code> to change that). The
        schedule keeps firing without the page; only this panel needs it.
      </p>
      <button type="button" onClick={onRetry} className={BUTTON.secondary}>
        <RefreshCw aria-hidden className="size-3.5" /> Try again
      </button>
    </section>
  );
}

type Pending = { routine: Routine; project: RoutinesProject };

export function RoutinesPage() {
  const state = useResource<RoutinesState>('/api/routines/state');
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

  const [open, setOpen] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: ReactNode } | null>(null);
  const [confirmSave, setConfirmSave] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<{ file: string; text: string | null } | null>(null);

  const save = async () => {
    setBusy(true);
    try {
      const res = await ownerPost<{ saved: string[] }>('/api/routines/save', { changes });
      setConfirmSave(false);
      setBase(draft);
      setNotice({
        tone: 'ok',
        text: <>Saved to routines.json: {res.saved.join('; ')}.</>,
      });
      reload();
    } catch (err) {
      setConfirmSave(false);
      setNotice({ tone: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const run = async ({ routine, project }: Pending) => {
    setBusy(true);
    try {
      await ownerPost('/api/routines/run', { routine, project: project.name });
      setNotice({
        tone: 'ok',
        text: `Started the ${ROUTINE_NAMES[routine].toLowerCase()} for ${project.name}.`,
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
  const enrolled = draft?.projects.filter((p) => p.enrolled).length ?? 0;

  return (
    <div className={clsx('mx-auto max-w-5xl space-y-5 p-4 sm:p-8', changes.length && 'pb-24')}>
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Routines</h1>
        <span className="text-sm text-muted">
          {data && draft
            ? `wrap-up, night run and morning report for ${plural(enrolled, 'enrolled project')}`
            : 'wrap-up, night run, morning report and cleanup'}
        </span>
        {data && (
          <Tooltip
            label={`As of ${data.now.replace('T', ' ')}`}
            detail={`From Routines at ${data.url}`}
            className="ml-auto flex"
          >
            <button type="button" onClick={reload} className={CONTROL} aria-label="Refresh">
              <RefreshCw
                aria-hidden
                className={clsx('size-3', state.status === 'loading' && 'animate-spin')}
              />
              {data.now.slice(11)}
            </button>
          </Tooltip>
        )}
      </header>

      {notice && (
        <p
          role="status"
          data-routines-notice={notice.tone}
          className={clsx(
            'flex items-start gap-2 rounded-control px-3 py-2 text-sm',
            notice.tone === 'ok'
              ? 'bg-sunken text-ink-soft'
              : 'bg-rose-50 text-rose-800 dark:bg-rose-950 dark:text-rose-200',
          )}
        >
          <span className="min-w-0 flex-1">{notice.text}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="text-xs text-muted hover:text-ink"
          >
            Dismiss
          </button>
        </p>
      )}

      {state.data && !state.data.available ? (
        <Unavailable reason={state.data.reason} url={state.data.url} onRetry={reload} />
      ) : !data || !draft ? (
        <div className="space-y-3">
          <div className="h-20 animate-pulse rounded-block bg-sunken" />
          <div className="h-64 animate-pulse rounded-block bg-sunken" />
        </div>
      ) : (
        <>
          <Glance state={data} draft={draft} />

          <section aria-label="Projects" className="space-y-1.5">
            <h2 className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted uppercase">
              Projects <span className="tabular-nums text-faint">{draft.projects.length}</span>
              <span className="font-normal tracking-normal normal-case text-faint">
                · $ caps the night’s spend; h is how much work the wrap-up hands over
              </span>
            </h2>
            <ul className="divide-y divide-line-soft overflow-hidden rounded-block border border-line bg-surface">
              {draft.projects.map((p) => (
                <ProjectRow
                  key={p.name}
                  project={p}
                  status={status.get(p.name)}
                  today={today}
                  open={open.has(p.name)}
                  onToggle={() =>
                    setOpen((prev) => {
                      const next = new Set(prev);
                      if (next.has(p.name)) next.delete(p.name);
                      else next.add(p.name);
                      return next;
                    })
                  }
                  edit={edit}
                  onRun={(routine) => setPending({ routine, project: p })}
                  onLog={(file) => void openLog(file)}
                />
              ))}
            </ul>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Schedule draft={draft} edit={edit} />
            <Cleanup config={data.config} />
          </div>
          <Dispatch draft={draft} edit={edit} />
        </>
      )}

      {changes.length > 0 && (
        <div
          role="region"
          aria-label="Unsaved changes"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur sm:left-auto sm:right-6 sm:bottom-6 sm:rounded-block sm:border sm:shadow-overlay"
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
            The next scheduled runs use these. There is no undo here: change them back and save
            again.
          </p>
        </Confirm>
      )}

      {pending && (
        <Confirm
          title={`Start the ${ROUTINE_NAMES[pending.routine].toLowerCase()} for ${pending.project.name} now?`}
          action={`Start ${SHORT[pending.routine].toLowerCase()}`}
          danger
          busy={busy}
          onConfirm={() => void run(pending)}
          onCancel={() => setPending(null)}
        >
          <p>
            This starts real work: a headless Claude Code session in {pending.project.path}, capped
            at{' '}
            <span className="font-medium">
              ${pending.routine === 'nightshift' ? pending.project.budget_usd : 2}
            </span>
            {pending.routine === 'nightshift' && (
              <> and {pending.project.hours} h of handed-off work</>
            )}
            .
          </p>
          {pending.routine === 'wrapup' && (
            <p className="text-xs text-muted">It rewrites HANDOFF.md for tonight’s run.</p>
          )}
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
            <div className="flex items-center gap-2 border-b border-line-soft px-4 py-2.5">
              <Repeat aria-hidden className="size-3.5 text-faint" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{log.file}</span>
              <button type="button" onClick={() => setLog(null)} className={BUTTON.secondary}>
                Close
              </button>
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
