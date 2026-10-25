import type { RunnerState, RunnerStatus, RunnersView } from '@pharos/schema';
import clsx from 'clsx';
import { ChevronRight, Laptop, Plus, RefreshCw, Server, Trash2, Wrench } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CopyButton } from '../catalog/copy';
import { ICON_GHOST, Tooltip } from '../catalog/tooltip';
import { BUTTON } from '../catalog/ui';
import { ApiError, ownerSend, useResource } from '../lib/api';

/**
 * Where routines run (owner, 2026-10-25): an unattended agent on this Mac may only do what it is
 * allowed, so commands are refused with nobody there to approve them. A separate machine (and
 * later a throwaway container or a cloud agent service) lets it work without asking. Pharos finds
 * the owner's machines, checks them, sets them up with one press and offers only ready ones.
 */

export const RUNNER_WORDS: Record<RunnerState, { label: string; tone: string }> = {
  ready: {
    label: 'Ready',
    tone: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200',
  },
  'needs-sign-in': {
    label: 'Sign in needed',
    tone: 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100',
  },
  'not-set-up': {
    label: 'Set up needed',
    tone: 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100',
  },
  unreachable: {
    label: 'Can’t reach',
    tone: 'bg-rose-50 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200',
  },
  unchecked: { label: 'Not checked', tone: 'bg-subtle text-muted' },
  checking: {
    label: 'Checking…',
    tone: 'bg-sky-50 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200',
  },
  'setting-up': {
    label: 'Setting up…',
    tone: 'bg-sky-50 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200',
  },
  'not-built': { label: 'Not built yet', tone: 'bg-subtle text-muted' },
};

/** Looked at again often while one of these: a check or setup running, or one about to start. */
const BUSY: RunnerState[] = ['checking', 'setting-up', 'unchecked'];
/** The buttons wait only while a check or setup actually runs. */
const WORKING: RunnerState[] = ['checking', 'setting-up'];

/** The runners view, looked at again every 3 s while a check or a setup runs, else every 30 s. */
export function useRunners() {
  const view = useResource<RunnersView>('/api/routines/runners');
  const { reload } = view;
  const busy = view.data?.runners.some((r) => BUSY.includes(r.status.state)) ?? false;
  useEffect(() => {
    const timer = setInterval(reload, busy ? 3000 : 30_000);
    return () => clearInterval(timer);
  }, [reload, busy]);
  return view;
}

function StatePill({ status }: { status: RunnerStatus }) {
  const words = RUNNER_WORDS[status.state] ?? RUNNER_WORDS.unchecked;
  return (
    <span
      data-runner-state={status.state}
      className={clsx('rounded-full px-2 py-0.5 text-xs', words.tone)}
    >
      {words.label}
    </span>
  );
}

/** The facts of a check, in one line: "Linux · Node v22.20.0 · Claude 2.1.310 · 8 GB · 391 GB free". */
export function runnerFacts(s: RunnerStatus): string {
  return [
    s.os,
    s.node && `Node ${s.node}`,
    s.claude && `Claude ${s.claude}`,
    s.memory_gb && `${s.memory_gb} GB`,
    s.disk_free_gb && `${s.disk_free_gb} GB free`,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function RunnersCard({ view }: { view: ReturnType<typeof useRunners> }) {
  const [error, setError] = useState<string | null>(null);
  const [others, setOthers] = useState(false);
  const data = view.data;
  const act = async (action: string, body: object) => {
    setError(null);
    try {
      await ownerSend(`/api/routines/runners/${action}`, body);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Couldn’t reach the server');
    }
    view.reload();
  };
  if (!data) return null;
  const devices = data.candidates.filter((c) => c.source === 'tailscale');
  const hosts = data.candidates.filter((c) => c.source !== 'tailscale');
  return (
    <section
      aria-label="Where routines run"
      data-runners=""
      className="space-y-3 rounded-tile border border-line bg-surface p-4"
    >
      <header className="space-y-0.5">
        <h2 className="text-sm font-semibold">Where routines run</h2>
        <p className="text-xs text-muted">
          On this Mac an unattended agent is refused any command not allowed in advance. On a
          machine of its own it can work without asking. Choose per project under its “Runs on”.
        </p>
      </header>
      <ul className="divide-y divide-line-soft">
        <li className="flex items-center gap-2 py-2 text-sm">
          <Laptop aria-hidden className="size-4 text-muted" />
          <span className="font-medium">{data.local.name}</span>
          <StatePill status={data.local.status} />
          <span className="text-xs text-muted">runs here, with only the commands you allowed</span>
        </li>
        {data.runners.map((r) => (
          <li key={r.id} data-runner={r.id} className="space-y-1 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Server aria-hidden className="size-4 text-muted" />
              <span className="font-medium">{r.name}</span>
              <StatePill status={r.status} />
              <span className="text-xs text-muted">
                {r.kind === 'ssh' ? 'your machine, over SSH' : r.kind}
                {r.projects.length ? ` · ${r.projects.join(', ')}` : ''}
              </span>
              <span className="ml-auto flex items-center gap-1">
                {r.status.state === 'not-set-up' && (
                  <button
                    type="button"
                    onClick={() => void act('setup', { id: r.id })}
                    className={BUTTON.primary}
                  >
                    <Wrench aria-hidden className="size-3.5" /> Set up
                  </button>
                )}
                <Tooltip label="Check again" className="flex">
                  <button
                    type="button"
                    aria-label={`Check ${r.name} again`}
                    disabled={WORKING.includes(r.status.state)}
                    onClick={() => void act('check', { id: r.id })}
                    className={ICON_GHOST}
                  >
                    <RefreshCw
                      aria-hidden
                      className={clsx(
                        'size-3.5',
                        WORKING.includes(r.status.state) && 'animate-spin',
                      )}
                    />
                  </button>
                </Tooltip>
                <Tooltip label="Remove (its projects run on this Mac again)" className="flex">
                  <button
                    type="button"
                    aria-label={`Remove ${r.name}`}
                    onClick={() => void act('remove', { id: r.id })}
                    className={ICON_GHOST}
                  >
                    <Trash2 aria-hidden className="size-3.5" />
                  </button>
                </Tooltip>
              </span>
            </div>
            <p className="pl-6 text-xs text-muted">
              {r.status.state === 'ready' ? runnerFacts(r.status) : r.status.detail}
              {r.status.checked
                ? ` · checked ${r.status.checked.replace('T', ' ').slice(0, 16)}`
                : ''}
            </p>
            {r.status.state === 'needs-sign-in' && (
              <div className="ml-6 space-y-1 text-xs">
                <p>
                  Sign in to Claude there once (only you can): run this, type /login, follow the
                  link.
                </p>
                <div data-doc-code="" className="doc-code">
                  <pre className="!pr-24 text-xs">ssh -t {r.host} ~/.local/bin/claude</pre>
                  <CopyButton text={`ssh -t ${r.host} ~/.local/bin/claude`} label="Copy command" />
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      {(devices.length > 0 || hosts.length > 0) && (
        <div className="space-y-1.5">
          <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">
            Add a machine
          </h3>
          <ul className="space-y-1">
            {devices.map((c) => (
              <li key={c.host} className="flex items-center gap-2 text-sm">
                <span>{c.name}</span>
                <span className="text-xs text-muted">your {c.os ?? ''} device on Tailscale</span>
                <button
                  type="button"
                  onClick={() => void act('add', { host: c.host })}
                  className={clsx(BUTTON.secondary, 'ml-auto')}
                >
                  <Plus aria-hidden className="size-3.5" /> Add
                </button>
              </li>
            ))}
          </ul>
          {hosts.length > 0 && (
            <div>
              <button
                type="button"
                aria-expanded={others}
                onClick={() => setOthers(!others)}
                className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink"
              >
                <ChevronRight
                  aria-hidden
                  className={clsx('size-3.5 transition-transform', others && 'rotate-90')}
                />
                Other SSH hosts ({hosts.length})
              </button>
              {others && (
                <ul className="mt-1 space-y-1 pl-5">
                  {hosts.map((c) => (
                    <li key={c.host} className="flex items-center gap-2 text-sm">
                      <span>{c.host}</span>
                      <button
                        type="button"
                        onClick={() => void act('add', { host: c.host })}
                        className={clsx(BUTTON.secondary, 'ml-auto')}
                      >
                        <Plus aria-hidden className="size-3.5" /> Add
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
      <p className="text-xs text-faint">
        Coming: a throwaway container or VM per run, and cloud agent services.
      </p>
      {error && <p className="text-xs text-danger">{error}</p>}
    </section>
  );
}
