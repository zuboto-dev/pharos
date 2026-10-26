import { PULSE_DAYS, addDays, type ProjectPulse, type Pulse } from '@pharos/schema';
import clsx from 'clsx';
import { useState } from 'react';
import { Link } from 'react-router';
import { useResource } from '../lib/api';
import { useRevisionEvents } from '../lib/events';
import { formatDate, plural, timeAgo } from '../lib/format';

/**
 * Projects' pulses (packages/schema/src/pulse.ts), worked out by Pharos: the home page lists them
 * side by side, the project page shows its own above the views. Words are counts and dates only.
 */

/** Tasks finished per day as small bars, one per day, today last; a title per bar on hover. */
export function DoneBars({ days, today }: { days: number[]; today: string }) {
  const max = Math.max(1, ...days);
  const total = days.reduce((a, b) => a + b, 0);
  const W = 6;
  const GAP = 2;
  const H = 24;
  return (
    <svg
      role="img"
      aria-label={`${plural(total, 'task')} finished in the last ${PULSE_DAYS} days`}
      width={days.length * (W + GAP) - GAP}
      height={H}
      className="shrink-0 overflow-visible"
    >
      {days.map((n, i) => {
        const day = addDays(today, i - (days.length - 1));
        const h = n ? Math.max(3, Math.round((n / max) * H)) : 1;
        return (
          <g key={day}>
            <title>{`${formatDate(day, true)}: ${plural(n, 'task')} finished`}</title>
            {/* The hover target is the whole column, not just the bar. */}
            <rect x={i * (W + GAP)} y={0} width={W} height={H} fill="transparent" />
            <rect
              x={i * (W + GAP)}
              y={H - h}
              width={W}
              height={h}
              rx={n ? 1.5 : 0}
              className={
                n ? 'fill-sky-500 dark:fill-sky-400' : 'fill-neutral-300 dark:fill-neutral-700'
              }
            />
          </g>
        );
      })}
    </svg>
  );
}

/** "Ship 2026-10-28 · in 2 days" or "· 8 days late". */
function shipText(stage: NonNullable<ProjectPulse['stage']>) {
  if (!stage.targetDate || stage.daysLeft === undefined) return undefined;
  const d = stage.daysLeft;
  const when = d === 0 ? 'today' : d > 0 ? `in ${plural(d, 'day')}` : `${plural(-d, 'day')} late`;
  return {
    text: `${formatDate(stage.targetDate, true)} · ${when}`,
    late: d < 0,
    soon: d >= 0 && d <= 3,
  };
}

/** The numbers a project's pulse shows, as short labelled counts. */
function Counts({ p }: { p: ProjectPulse }) {
  const items: { n: number; label: string; tone?: 'warn' | 'bad' }[] = [
    { n: p.tasks.doneWeek, label: 'done this week' },
    { n: p.tasks.addedWeek, label: 'added this week' },
    { n: p.tasks.inProgress, label: 'in progress' },
    { n: p.tasks.review, label: 'to review' },
    { n: p.tasks.blocked, label: 'blocked', tone: 'bad' },
  ];
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
      {items
        .filter((i) => i.n > 0)
        .map((i) => (
          <span
            key={i.label}
            className={clsx(i.tone === 'bad' && 'text-rose-600 dark:text-rose-400')}
          >
            <span className="font-medium tabular-nums text-ink-soft">{i.n}</span> {i.label}
          </span>
        ))}
    </span>
  );
}

function Waiting({ p }: { p: ProjectPulse }) {
  if (!p.waiting.count) return <span className="text-xs text-faint">Nothing waits on you</span>;
  return (
    <Link
      to={`/desk?project=${encodeURIComponent(p.projectId)}`}
      className="text-xs font-medium text-amber-700 hover:underline dark:text-amber-400"
    >
      {plural(p.waiting.count, 'item')} {p.waiting.count === 1 ? 'waits' : 'wait'} on you
      {p.waiting.oldestSince && ` · oldest ${timeAgo(p.waiting.oldestSince)}`}
      {p.waiting.gates > 0 && ` · ${plural(p.waiting.gates, 'gate')}`}
    </Link>
  );
}

/** Rows shown before Show all. */
const FIRST = 8;

/** Projects with something going on, those that need the owner first. */
function rank(projects: ProjectPulse[]) {
  const active = (p: ProjectPulse) =>
    p.waiting.count > 0 ||
    p.running.length > 0 ||
    p.tasks.doneWeek > 0 ||
    p.tasks.blocked > 0 ||
    (p.stage?.daysLeft !== undefined && p.stage.daysLeft <= 14);
  const score = (p: ProjectPulse) =>
    (p.waiting.gates ? 1000 : 0) +
    (p.stage?.daysLeft !== undefined && p.stage.daysLeft < 0 ? 500 : 0) +
    p.waiting.count * 10 +
    p.tasks.blocked * 5 +
    p.tasks.doneWeek;
  const shown = projects.filter(active).sort((a, b) => score(b) - score(a));
  return { shown, quiet: projects.length - shown.length };
}

/** The home page's view of every project at once: one row each, those needing you first. */
export function PortfolioPulse() {
  const pulse = useResource<Pulse>('/api/pulse');
  const { reload } = pulse;
  useRevisionEvents(() => reload());
  const [all, setAll] = useState(false);
  const data = Array.isArray(pulse.data?.projects) ? pulse.data : undefined;
  if (!data) return null;
  const { shown: ranked, quiet } = rank(data.projects);
  const total = (f: (p: ProjectPulse) => number) => data.projects.reduce((s, p) => s + f(p), 0);
  const waiting = total((p) => p.waiting.count);
  const byRules = total((p) => p.byRules);
  return (
    <section aria-label="How projects are going" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-muted">This week</h2>
        <p className="text-xs text-muted">
          <span className="font-medium tabular-nums text-ink-soft">
            {total((p) => p.tasks.doneWeek)}
          </span>{' '}
          tasks done ·{' '}
          <Link to="/desk" className="hover:underline">
            <span className="font-medium tabular-nums text-ink-soft">{waiting}</span> wait on you
          </Link>
          {byRules > 0 && (
            <>
              {' '}
              ·{' '}
              <Link to="/settings#approvals" className="hover:underline">
                <span className="font-medium tabular-nums text-ink-soft">{byRules}</span> answered
                by your rules
              </Link>
            </>
          )}
        </p>
      </div>
      <ul className="divide-y divide-line-soft rounded-block border border-line bg-surface">
        {(all ? ranked : ranked.slice(0, FIRST)).map((p) => (
          <PulseRow key={p.projectId} p={p} today={data.today} />
        ))}
      </ul>
      {ranked.length > FIRST && (
        <button
          type="button"
          onClick={() => setAll((a) => !a)}
          className="text-xs font-medium text-accent hover:underline"
        >
          {all ? 'Show fewer' : `Show all ${ranked.length} with something going on`}
        </button>
      )}
      {quiet > 0 && (
        <p className="text-xs text-faint">
          {plural(quiet, 'project')} with no work this week and nothing waiting are below.
        </p>
      )}
    </section>
  );
}

function PulseRow({ p, today }: { p: ProjectPulse; today: string }) {
  const ship = p.stage && shipText(p.stage);
  return (
    <li className="grid gap-x-4 gap-y-1 p-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <Link
          to={`/projects/${p.projectId}`}
          className="block truncate font-medium hover:underline"
        >
          {p.project}
        </Link>
        {p.stage && (
          <p className="truncate text-xs text-muted">
            Stage {p.stage.index} of {p.stage.of}: {p.stage.name}
          </p>
        )}
      </div>
      <div className="min-w-0 space-y-0.5">
        {ship && (
          <p
            className={clsx(
              'text-xs',
              ship.late
                ? 'font-medium text-rose-600 dark:text-rose-400'
                : ship.soon
                  ? 'font-medium text-amber-700 dark:text-amber-400'
                  : 'text-muted',
            )}
          >
            Stage due {ship.text}
          </p>
        )}
        <Counts p={p} />
        <Waiting p={p} />
        {p.running.length > 0 && (
          <p className="text-xs text-sky-700 dark:text-sky-400">
            Running now: {p.running.map((r) => r.name).join(', ')}
          </p>
        )}
      </div>
      <DoneBars days={p.doneByDay} today={today} />
    </li>
  );
}

/** One project's pulse, as a line above its views. */
export function ProjectPulseStrip({ projectId }: { projectId: string }) {
  const pulse = useResource<Pulse>(`/api/pulse?projectId=${encodeURIComponent(projectId)}`);
  const { reload } = pulse;
  useRevisionEvents((e) => {
    if (e.projectIds.includes(projectId)) reload();
  });
  const projects = Array.isArray(pulse.data?.projects) ? pulse.data.projects : [];
  const p = projects.find((x) => x.projectId === projectId);
  if (!p || !pulse.data) return null;
  const ship = p.stage && shipText(p.stage);
  return (
    <div
      aria-label="How this project is going"
      className="!mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-block border border-line bg-surface px-4 py-2.5"
    >
      {p.stage && (
        <span className="text-xs text-muted">
          Stage {p.stage.index} of {p.stage.of}:{' '}
          <span className="font-medium text-ink-soft">{p.stage.name}</span>
          {ship && (
            <span
              className={clsx(
                ship.late && 'text-rose-600 dark:text-rose-400',
                ship.soon && 'text-amber-700 dark:text-amber-400',
              )}
            >
              {' '}
              · due {ship.text}
            </span>
          )}
        </span>
      )}
      <Counts p={p} />
      <Waiting p={p} />
      {p.last && (
        <span className="text-xs text-faint">
          Last change {timeAgo(p.last.at)} by {p.last.who}
        </span>
      )}
      <span className="ml-auto">
        <DoneBars days={p.doneByDay} today={pulse.data.today} />
      </span>
    </div>
  );
}
