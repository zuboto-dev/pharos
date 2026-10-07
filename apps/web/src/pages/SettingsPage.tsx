import type { Entity } from '@pharos/schema';
import clsx from 'clsx';
import { Check, Copy, Monitor, Moon, Sun } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { BUTTON } from '../catalog/ui';
import { ApiError, postJson, useResource } from '../lib/api';
import {
  announceAgentStatus,
  useAgentStatus,
  useRevisionEvents,
  type AgentStatus,
} from '../lib/events';
import { plural, timeAgo } from '../lib/format';
import { useTheme, type Theme } from '../lib/theme';
import { LoadError } from './onboarding';

type ServerSettings = {
  version: string;
  dataPath: string | null;
  port: number;
  mcpUrl: string;
  projects: number;
  revisions: number;
};

const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900"
    >
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{title}</h2>
        {description && (
          <p className="text-sm text-neutral-500 dark:text-neutral-400">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-2 text-sm sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-neutral-500 dark:text-neutral-400">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/** A value people may want to paste elsewhere (a path, a command). */
function Copyable({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex max-w-full items-start gap-1.5">
      <code className="min-w-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[13px] break-all dark:bg-neutral-800">
        {text}
      </code>
      <button
        type="button"
        aria-label={`Copy ${label}`}
        onClick={() => void navigator.clipboard?.writeText(text).then(() => setCopied(true))}
        className="shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
    </span>
  );
}

function ThemeChoice() {
  const [theme, setTheme] = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-3 gap-2 sm:max-w-md">
      {THEMES.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          onClick={() => setTheme(value)}
          className={clsx(
            'flex flex-col items-center gap-1.5 rounded-lg border px-3 py-3 text-sm',
            theme === value
              ? 'border-sky-500 bg-sky-50 font-medium text-sky-900 dark:border-sky-500 dark:bg-sky-950/50 dark:text-sky-100'
              : 'border-neutral-200 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800',
          )}
        >
          <Icon className="size-4" /> {label}
        </button>
      ))}
    </div>
  );
}

function Switch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-40',
        checked ? 'bg-emerald-500' : 'bg-neutral-300 dark:bg-neutral-700',
      )}
    >
      <span
        className={clsx(
          'inline-block size-5 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-5.5' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

/** One line on what the answering agent is doing, or why it isn't. */
function agentSummary(agent: AgentStatus): { text: string; tone: 'green' | 'amber' | 'muted' } {
  if (agent.mode === 'off')
    return { text: 'Off: PHAROS_AGENT_COMMAND=off is set on the server', tone: 'muted' };
  if (!agent.configured)
    return {
      text: 'Not set up: install Claude Code, or set PHAROS_AGENT_COMMAND, then restart the server',
      tone: 'muted',
    };
  if (!agent.enabled)
    return { text: 'Paused: questions wait for you or your agent', tone: 'amber' };
  if (agent.running) return { text: 'Answering now…', tone: 'green' };
  return { text: 'On: new questions are answered automatically', tone: 'green' };
}

const TONES = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  muted: 'bg-neutral-300 dark:bg-neutral-600',
};

function AnsweringAgent({ waiting }: { waiting: number }) {
  const agent = useAgentStatus();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const summary = agentSummary(agent);
  const report = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : 'Couldn’t reach the server');

  const setEnabled = async (enabled: boolean) => {
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/settings/agent', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const body = (await res.json()) as AgentStatus & { error?: { message: string } };
      if (!res.ok) throw new ApiError(res.status, body.error?.message ?? `HTTP ${res.status}`);
      announceAgentStatus(body);
    } catch (err) {
      report(err);
    }
  };
  const answerWaiting = async () => {
    setError(null);
    try {
      const { questions } = await postJson<{ questions: number }>('/api/agent/answer-waiting', {});
      setNotice(`Answering ${plural(questions, 'question')}…`);
    } catch (err) {
      report(err);
    }
  };

  return (
    <Section
      title="Answering questions"
      description="When someone uses Ask in a view, an agent on this computer answers with a view. Each answer uses that agent's model and counts toward its usage; the cost depends on the agent and model."
    >
      <div className="flex items-start justify-between gap-4">
        <p className="flex items-center gap-2 text-sm">
          <span className={clsx('size-2 shrink-0 rounded-full', TONES[summary.tone])} />
          {summary.text}
        </p>
        <Switch
          label="Answer questions automatically"
          checked={agent.configured && agent.enabled}
          disabled={!agent.configured}
          onChange={(on) => void setEnabled(on)}
        />
      </div>
      {agent.configured && agent.enabled && waiting > 0 && !agent.running && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
          {plural(waiting, 'question')} {waiting === 1 ? 'is' : 'are'} waiting for an answer.
          <button type="button" onClick={() => void answerWaiting()} className={BUTTON.accent}>
            Answer now
          </button>
        </div>
      )}
      {notice && <p className="text-sm text-neutral-500">{notice}</p>}
      {error && (
        <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
      <dl className="divide-y divide-neutral-100 dark:divide-neutral-800">
        <Row label="Agent">
          {agent.mode === 'default' ? (
            'Claude Code (found on this computer), connected only to Pharos'
          ) : agent.mode === 'custom' && agent.command ? (
            <Copyable label="command" text={agent.command} />
          ) : (
            'None'
          )}
        </Row>
        {agent.lastRun && (
          <Row label="Last run">
            {timeAgo(agent.lastRun.startedAt)} · {Math.round(agent.lastRun.durationMs / 1000)}s ·{' '}
            {agent.lastRun.timedOut
              ? 'timed out'
              : agent.lastRun.exitCode === 0
                ? 'finished'
                : `failed (exit ${agent.lastRun.exitCode})`}
          </Row>
        )}
        {agent.logPath && (
          <Row label="Log">
            <Copyable label="log path" text={agent.logPath} />
          </Row>
        )}
        <Row label="Change the agent">
          <span className="text-neutral-600 dark:text-neutral-400">
            Set <code>PHAROS_AGENT_COMMAND</code> to your own command (or <code>off</code>) and
            restart the server. For safety, the command can only be set on the server, not from this
            page.
          </span>
        </Row>
      </dl>
    </Section>
  );
}

export function SettingsPage() {
  const settings = useResource<ServerSettings>('/api/settings');
  const requests = useResource<Entity<'request'>[]>('/api/entities/request?status=open');
  const { reload } = requests;
  useRevisionEvents(() => reload());
  if (settings.status === 'error' && !settings.data)
    return <LoadError notFound={false} what="Settings" />;
  const s = settings.data;
  const mcpCommand = s ? `claude mcp add --transport http pharos ${s.mcpUrl}` : '';
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <Section title="Appearance" description="Saved in this browser.">
        <ThemeChoice />
      </Section>
      <AnsweringAgent waiting={requests.data?.length ?? 0} />
      <Section
        title="Data and connection"
        description="Pharos keeps everything in one file on this computer. Agents connect over MCP."
      >
        {s ? (
          <dl className="divide-y divide-neutral-100 dark:divide-neutral-800">
            <Row label="Database">
              {s.dataPath ? <Copyable label="database path" text={s.dataPath} /> : 'In memory'}
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                {plural(s.projects, 'project')} · {plural(s.revisions, 'revision')}. Move it with{' '}
                <code>PHAROS_DB</code>; back it up by copying the file while the server is stopped.
              </p>
            </Row>
            <Row label="Server">
              <span className="tabular-nums">Port {s.port}</span>
              <span className="text-neutral-500"> · change it with </span>
              <code>PORT</code>
            </Row>
            <Row label="MCP endpoint">
              <Copyable label="MCP endpoint" text={s.mcpUrl} />
            </Row>
            <Row label="Connect Claude Code">
              <Copyable label="MCP command" text={mcpCommand} />
            </Row>
            <Row label="Version">{s.version}</Row>
          </dl>
        ) : (
          <p className="text-sm text-neutral-400">Loading…</p>
        )}
      </Section>
    </div>
  );
}
