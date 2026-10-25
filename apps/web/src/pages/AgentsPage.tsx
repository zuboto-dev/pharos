import type {
  AgentPanelRow,
  AgentsOverview,
  AnsweringRow,
  ConnectedAgentRow,
  PanelState,
  RoutineRunRow,
} from '@pharos/schema';
import clsx from 'clsx';
import {
  Bot,
  ChevronRight,
  Clock,
  Eye,
  EyeOff,
  Hand,
  Loader2,
  MessageCircleQuestion,
  Moon,
  Radar,
  Square,
  SquareTerminal,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router';
import { ICON_GHOST, Tooltip } from '../catalog/tooltip';
import { terminalsChanged } from '../agent/running';
import { useResource } from '../lib/api';
import { useAgentStatus, usePresence, useRevisionEvents } from '../lib/events';
import { timeAgo } from '../lib/format';
import { LoadError } from './onboarding';

// The Agents page: who works with Pharos right now. A glance first (how many are working, waiting
// for you, idle), then one line per agent that opens to its details. Live: the change feed
// (presence, revisions, the answering agent) reloads it, and it looks again every 5 s, since a
// panel's state follows its output.

/** One symbol and colour per state, the same in the glance and the rows. */
export const STATE: Record<
  PanelState,
  { name: string; short: string; icon: LucideIcon; tone: string }
> = {
  working: { name: 'Working', short: 'Working', icon: Loader2, tone: 'text-accent' },
  // "Waiting" alone on a phone, where three counts share the width.
  waiting: { name: 'Waiting for you', short: 'Waiting', icon: Hand, tone: 'text-warn' },
  idle: { name: 'Idle', short: 'Idle', icon: Moon, tone: 'text-faint' },
};

const POLL_MS = 5000;

/** "4 min", "1 h 5 min", "20 s": how long since `iso`. */
export function duration(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/** A state's symbol; the working one spins only while something is working (`still` otherwise). */
function StateIcon({
  state,
  still,
  className,
}: {
  state: PanelState;
  still?: boolean;
  className?: string;
}) {
  const { icon: Icon, tone } = STATE[state];
  return (
    <Icon
      aria-hidden
      data-state={state}
      className={clsx(
        'size-4 shrink-0',
        still ? 'text-faint' : tone,
        state === 'working' && !still && 'animate-spin',
        className,
      )}
    />
  );
}

function Glance({
  counts,
  picked,
  onPick,
}: {
  counts: AgentsOverview['counts'];
  picked: PanelState | null;
  onPick: (s: PanelState | null) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3" role="group" aria-label="At a glance">
      {(Object.keys(STATE) as PanelState[]).map((s) => {
        const on = picked === s;
        return (
          <button
            key={s}
            type="button"
            aria-pressed={on}
            aria-label={`${STATE[s].name}: ${counts[s]}`}
            data-count={s}
            onClick={() => onPick(on ? null : s)}
            className={clsx(
              'flex min-w-0 flex-col items-start gap-1 rounded-block border bg-surface p-3 text-left transition-colors sm:p-4',
              on ? 'border-line-strong bg-subtle' : 'border-line hover:bg-sunken',
            )}
          >
            <span className="flex max-w-full min-w-0 items-center gap-1.5 text-xs text-muted">
              <span className="shrink-0">
                <StateIcon state={s} still={!counts[s]} />
              </span>
              <span className="truncate sm:hidden">{STATE[s].short}</span>
              <span className="hidden truncate sm:inline">{STATE[s].name}</span>
            </span>
            <span
              className={clsx(
                'text-2xl font-semibold tabular-nums sm:text-3xl',
                counts[s] ? 'text-ink' : 'text-faint',
              )}
            >
              {counts[s]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: LucideIcon;
  title: string;
  /** How many rows (left out for the one answering agent). */
  count?: number;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="space-y-1.5">
      <h2 className="flex items-center gap-1.5 px-1 text-xs font-semibold tracking-wide text-faint uppercase">
        <Icon aria-hidden className="size-3.5" />
        {title}
        {count !== undefined && <span className="font-normal tabular-nums">{count}</span>}
      </h2>
      <ul className="divide-y divide-line overflow-hidden rounded-block border border-line bg-surface">
        {children}
      </ul>
    </section>
  );
}

/** A row that opens to its details on click; actions sit at its end. */
function Row({
  label,
  lead,
  main,
  side,
  actions,
  details,
}: {
  label: string;
  lead: ReactNode;
  main: ReactNode;
  side?: ReactNode;
  actions?: ReactNode;
  details: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <div className="flex items-center gap-1 pr-2">
        <button
          type="button"
          aria-expanded={open}
          aria-label={label}
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-2.5 py-2.5 pl-3 text-left hover:bg-sunken/60"
        >
          <ChevronRight
            aria-hidden
            className={clsx(
              'size-3.5 shrink-0 text-faint transition-transform',
              open && 'rotate-90',
            )}
          />
          {lead}
          <span className="min-w-0 flex-1">{main}</span>
          {side && <span className="shrink-0 text-xs text-muted tabular-nums">{side}</span>}
        </button>
        {actions}
      </div>
      {open && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-line bg-sunken/40 px-4 py-3 pl-11 text-xs">
          {details}
        </dl>
      )}
    </li>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{term}</dt>
      <dd className="min-w-0 break-words text-ink-soft">{children}</dd>
    </>
  );
}

const at = (iso: string | undefined, now: number) =>
  iso ? `${clock.format(Date.parse(iso))} · ${timeAgo(iso, now)}` : '—';

function PanelRowView({
  panel,
  now,
  local,
}: {
  panel: AgentPanelRow;
  now: number;
  local: boolean;
}) {
  const navigate = useNavigate();
  const first = panel.projects[0];
  const names = panel.projects.map((p) => p.name).join(', ') || 'A folder of its own';
  const [stopping, setStopping] = useState(false);
  const stop = () => {
    if (!first) return;
    setStopping(true);
    // Its conversation is kept: opening the panel again resumes it.
    void fetch(`/api/projects/${encodeURIComponent(first.id)}/terminal/stop`, {
      method: 'POST',
      headers: { 'x-pharos-author': 'human:me' },
    })
      .catch(() => {})
      .finally(() => {
        setStopping(false);
        terminalsChanged();
      });
  };
  const Watch = panel.watched ? Eye : EyeOff;
  return (
    <Row
      label={`${panel.agent} in ${names}: ${STATE[panel.state].name}`}
      lead={<StateIcon state={panel.state} />}
      main={
        <span className="flex min-w-0 flex-col sm:flex-row sm:items-baseline sm:gap-2">
          <span className="truncate font-medium text-ink">{names}</span>
          <span className="truncate text-xs text-muted">
            {panel.agent} · {STATE[panel.state].name.toLowerCase()}
          </span>
        </span>
      }
      side={
        <span className="flex items-center gap-1.5">
          <Tooltip label={panel.watched ? 'A panel shows it now' : 'No panel shows it'}>
            <Watch
              aria-label={panel.watched ? 'Watched' : 'Not watched'}
              className={clsx('size-3.5', panel.watched ? 'text-ink-soft' : 'text-faint')}
            />
          </Tooltip>
          {duration(panel.since, now)}
        </span>
      }
      actions={
        first && (
          <>
            <Tooltip label="Open its panel">
              <button
                type="button"
                aria-label={`Open the panel of ${names}`}
                className={ICON_GHOST}
                onClick={() => navigate(`/projects/${first.id}?terminal=1`)}
              >
                <SquareTerminal aria-hidden className="size-4" />
              </button>
            </Tooltip>
            {local && (
              <Tooltip label="Stop the agent (its conversation is kept)">
                <button
                  type="button"
                  aria-label={`Stop the agent of ${names}`}
                  disabled={stopping}
                  className={clsx(ICON_GHOST, 'hover:text-danger')}
                  onClick={stop}
                >
                  <Square aria-hidden className="size-3.5" />
                </button>
              </Tooltip>
            )}
          </>
        )
      }
      details={
        <>
          <Fact term="State">
            {STATE[panel.state].name} for {duration(panel.since, now)}
          </Fact>
          <Fact term="Started">{at(panel.startedAt, now)}</Fact>
          <Fact term="Last output">{at(panel.lastOutputAt, now)}</Fact>
          <Fact term="Last answer">{at(panel.turnEndedAt, now)}</Fact>
          {panel.cwd && (
            <Fact term="Folder">
              <code className="font-mono text-[11px]">{panel.cwd}</code>
            </Fact>
          )}
          <Fact term="Projects">
            {panel.projects.map((p, i) => (
              <span key={p.id}>
                {i > 0 && ', '}
                <Link to={`/projects/${p.id}`} className="underline-offset-2 hover:underline">
                  {p.name}
                </Link>
              </span>
            ))}
          </Fact>
        </>
      }
    />
  );
}

function ConnectedRowView({ agent, now }: { agent: ConnectedAgentRow; now: number }) {
  const state: PanelState = agent.live ? 'working' : 'idle';
  const projects = agent.projects.map((p) => p.name).join(', ');
  return (
    <Row
      label={`${agent.agent}: ${STATE[state].name}`}
      lead={
        <span className="relative">
          <Bot aria-hidden className="size-4 text-ink-soft" />
          {agent.live && (
            <span
              aria-hidden
              data-live=""
              className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-presence ring-2 ring-presence/30"
            />
          )}
        </span>
      }
      main={
        <span className="flex min-w-0 flex-col sm:flex-row sm:items-baseline sm:gap-2">
          <span className="truncate font-medium text-ink">{agent.agent}</span>
          <span className="truncate text-xs text-muted">
            {agent.last?.text ?? (agent.live ? 'Working now' : '')}
          </span>
        </span>
      }
      side={agent.last ? timeAgo(agent.last.at, now) : agent.live ? 'now' : undefined}
      details={
        <>
          <Fact term="State">{agent.live ? 'Working now' : 'Seen recently'}</Fact>
          {agent.last && (
            <Fact term={agent.last.kind === 'revision' ? 'Last change' : 'Last lookup'}>
              {agent.last.text} · {at(agent.last.at, now)}
            </Fact>
          )}
          {projects && (
            <Fact term="Projects">
              {agent.projects.map((p, i) => (
                <span key={p.id}>
                  {i > 0 && ', '}
                  <Link to={`/projects/${p.id}`} className="underline-offset-2 hover:underline">
                    {p.name}
                  </Link>
                </span>
              ))}
            </Fact>
          )}
          <Fact term="History">
            <Link to={`/updates`} className="underline-offset-2 hover:underline">
              Updates
            </Link>
          </Fact>
        </>
      }
    />
  );
}

const ANSWERING_WORDS: Record<AnsweringRow['state'], string> = {
  off: 'Off',
  unavailable: 'Not set up',
  paused: 'Paused',
  idle: 'Waiting for questions',
  queued: 'Questions queued',
  running: 'Answering',
  stopping: 'Stopping',
};

function AnsweringRowView({ answering, now }: { answering: AnsweringRow; now: number }) {
  const state: PanelState =
    answering.state === 'running' || answering.state === 'stopping' ? 'working' : 'idle';
  return (
    <Row
      label={`Answering questions: ${ANSWERING_WORDS[answering.state]}`}
      lead={<StateIcon state={state} />}
      main={
        <span className="flex min-w-0 flex-col sm:flex-row sm:items-baseline sm:gap-2">
          <span className="truncate font-medium text-ink">{answering.agent ?? 'Answering'}</span>
          <span className="truncate text-xs text-muted">{ANSWERING_WORDS[answering.state]}</span>
        </span>
      }
      side={answering.run ? duration(answering.run.startedAt, now) : undefined}
      details={
        <>
          <Fact term="State">{ANSWERING_WORDS[answering.state]}</Fact>
          {answering.run && <Fact term="Started">{at(answering.run.startedAt, now)}</Fact>}
          {answering.queued > 0 && <Fact term="Queued">{answering.queued} projects</Fact>}
          {answering.lastRun?.finishedAt && (
            <Fact term="Last run">
              {answering.lastRun.outcome ?? 'ended'} · {at(answering.lastRun.finishedAt, now)}
            </Fact>
          )}
          <Fact term="Settings">
            <Link to="/settings" className="underline-offset-2 hover:underline">
              Pause or resume
            </Link>
          </Fact>
        </>
      }
    />
  );
}

function RunRowView({ run, now }: { run: RoutineRunRow; now: number }) {
  return (
    <Row
      label={`${run.name}: running`}
      lead={<StateIcon state="working" />}
      main={
        <span className="flex min-w-0 flex-col sm:flex-row sm:items-baseline sm:gap-2">
          <span className="truncate font-medium text-ink">{run.name}</span>
          <span className="truncate text-xs text-muted">
            {run.agent}
            {run.project ? ` · ${run.project}` : ''}
          </span>
        </span>
      }
      side={duration(run.startedAt, now)}
      details={
        <>
          <Fact term="Kind">{run.kind === 'night' ? 'Night run' : 'Routine'}</Fact>
          <Fact term="Started">{at(run.startedAt, now)}</Fact>
          {run.projectId && (
            <Fact term="Project">
              <Link
                to={`/projects/${run.projectId}`}
                className="underline-offset-2 hover:underline"
              >
                {run.project ?? 'Project'}
              </Link>
            </Fact>
          )}
          <Fact term="Desk">
            <Link to="/desk" className="underline-offset-2 hover:underline">
              Runs on the desk
            </Link>
          </Fact>
        </>
      }
    />
  );
}

export function AgentsPage({ pollMs = POLL_MS }: { pollMs?: number }) {
  const overview = useResource<AgentsOverview>('/api/agents');
  const { reload } = overview;
  // Live: presence marks, revisions and the answering agent come on the feed; panels by polling.
  const presence = usePresence();
  const answering = useAgentStatus();
  useRevisionEvents(() => reload());
  useEffect(() => reload(), [presence, answering.state, reload]);
  useEffect(() => {
    const timer = setInterval(reload, pollMs);
    return () => clearInterval(timer);
  }, [reload, pollMs]);
  const [picked, setPicked] = useState<PanelState | null>(null);

  useEffect(() => {
    const before = document.title;
    document.title = 'Agents · Pharos';
    return () => {
      document.title = before;
    };
  }, []);

  const data = overview.data;
  // The server's time of the look: durations count from it (polled every few seconds).
  const now = data ? Date.parse(data.at) : 0;
  const shown = useMemo(() => {
    if (!data) return null;
    const keep = (s: PanelState) => !picked || picked === s;
    const answeringState: PanelState =
      data.answering.state === 'running' || data.answering.state === 'stopping'
        ? 'working'
        : 'idle';
    return {
      panels: data.panels.filter((p) => keep(p.state)),
      connected: data.connected.filter((c) => keep(c.live ? 'working' : 'idle')),
      runs: data.runs.filter(() => keep('working')),
      answering:
        data.answering.state !== 'unavailable' && keep(answeringState) ? data.answering : null,
    };
  }, [data, picked]);

  if (overview.status === 'error' && !data) return <LoadError notFound={false} what="Agents" />;

  const nothing =
    shown &&
    !shown.panels.length &&
    !shown.connected.length &&
    !shown.runs.length &&
    !shown.answering;

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-4 sm:p-8">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
        <Tooltip label="Live: updates as agents work">
          <span className="flex items-center gap-1 text-sm text-muted" aria-label="Live">
            <span aria-hidden className="size-1.5 rounded-full bg-ok" />
            live
          </span>
        </Tooltip>
      </header>
      {data && <Glance counts={data.counts} picked={picked} onPick={setPicked} />}
      {!data && <div className="h-24 animate-pulse rounded-block bg-sunken" aria-busy="true" />}
      {shown && (
        <div className="space-y-5">
          {shown.panels.length > 0 && (
            <Section icon={SquareTerminal} title="Agent panels" count={shown.panels.length}>
              {shown.panels.map((p) => (
                <PanelRowView key={p.id} panel={p} now={now} local={data!.local} />
              ))}
            </Section>
          )}
          {shown.connected.length > 0 && (
            <Section icon={Bot} title="Connected agents" count={shown.connected.length}>
              {shown.connected.map((c) => (
                <ConnectedRowView key={c.agent} agent={c} now={now} />
              ))}
            </Section>
          )}
          {shown.runs.length > 0 && (
            <Section icon={Clock} title="Routines running" count={shown.runs.length}>
              {shown.runs.map((r) => (
                <RunRowView key={r.id} run={r} now={now} />
              ))}
            </Section>
          )}
          {shown.answering && (
            <Section icon={MessageCircleQuestion} title="Answering questions">
              <AnsweringRowView answering={shown.answering} now={now} />
            </Section>
          )}
          {nothing && (
            <p className="flex items-center justify-center gap-2 rounded-block border border-dashed border-line py-10 text-sm text-muted">
              <Bot aria-hidden className="size-4" />
              {picked ? `None ${STATE[picked].name.toLowerCase()}` : 'No agents right now'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** The sidebar's link, next to Updates. */
/** How many agents are working now, for the sidebar: the page's look, polled less often. */
function useWorkingAgents(pollMs = 15_000): number {
  const overview = useResource<AgentsOverview>('/api/agents');
  const { reload } = overview;
  const presence = usePresence();
  const answering = useAgentStatus();
  useEffect(() => reload(), [presence, answering.state, reload]);
  useEffect(() => {
    const timer = setInterval(reload, pollMs);
    return () => clearInterval(timer);
  }, [reload, pollMs]);
  return overview.data?.counts?.working ?? 0;
}

/** Agents in the sidebar: its icon turns while any agent is working (owner, 2026-10-24). */
export function AgentsLink() {
  const working = useWorkingAgents();
  return (
    <NavLink
      to="/agents"
      className={({ isActive }) =>
        clsx(
          'flex w-full items-center gap-1.5 rounded-control px-2 py-1.5 text-sm',
          isActive ? 'bg-subtle font-medium text-ink' : 'text-ink-soft hover:bg-sunken',
        )
      }
    >
      <Radar
        aria-hidden
        data-working={working > 0 || undefined}
        className={clsx('size-3.5', working > 0 && 'animate-working text-presence')}
      />{' '}
      Agents
      {working > 0 && <WorkingMark label={`${working} working`} />}
    </NavLink>
  );
}

/** Agents on the folded sidebar's rail: the same turn while agents work. */
export function AgentsRailLink() {
  const working = useWorkingAgents();
  return (
    <RailLink
      to="/agents"
      label={working > 0 ? `Agents · ${working} working` : 'Agents'}
      working={working > 0}
      icon={Radar}
    />
  );
}

/** An icon link on the folded sidebar's rail; its icon turns while its page has work running. */
export function RailLink({
  to,
  label,
  working,
  icon: Icon,
}: {
  to: string;
  label: string;
  working: boolean;
  icon: typeof Radar;
}) {
  return (
    <Tooltip label={label}>
      <Link
        to={to}
        aria-label={label}
        className="relative flex size-8 items-center justify-center rounded-control text-muted hover:bg-sunken hover:text-ink"
      >
        <Icon
          aria-hidden
          data-working={working || undefined}
          className={clsx('size-4', working && 'animate-working text-presence')}
        />
        {working && (
          <span
            aria-hidden
            className="absolute top-1 right-1 size-1.5 animate-presence rounded-full bg-presence"
          />
        )}
      </Link>
    </Tooltip>
  );
}

/** The dot after a sidebar link's name while its page has something working, with what. */
export function WorkingMark({ label }: { label: string }) {
  return (
    <span className="ml-auto inline-flex items-center" title={label}>
      <span aria-hidden className="size-1.5 animate-presence rounded-full bg-presence" />
      <span className="sr-only"> ({label})</span>
    </span>
  );
}
