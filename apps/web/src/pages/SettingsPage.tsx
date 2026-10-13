import {
  FILE_ROUTES,
  FOLDER_LEVELS,
  type Entity,
  type FolderLevel,
  type FolderStatus,
} from '@pharos/schema';
import clsx from 'clsx';
import { Check, Copy, Folder, Monitor, Moon, Sun } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
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

function CopyButton({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      onClick={() => void navigator.clipboard?.writeText(text).then(() => setCopied(true))}
      className="shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </button>
  );
}

/** A value people may want to paste elsewhere (a path, a command). */
function Copyable({ label, text }: { label: string; text: string }) {
  return (
    <span className="inline-flex max-w-full items-start gap-1.5">
      <code className="min-w-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[13px] break-all dark:bg-neutral-800">
        {text}
      </code>
      <CopyButton label={label} text={text} />
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

// ------------------------------------------------------------------ folders (R7.3)

const LEVEL_ORDER: FolderLevel[] = ['hidden', 'details', 'contents'];

/** Sends a change to the folder routes; the server explains refusals in plain words. */
async function sendFolder<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const issues: string[] = data?.error?.issues ?? [];
    throw new ApiError(
      res.status,
      issues.length ? issues.join('; ') : (data?.error?.message ?? `HTTP ${res.status}`),
      issues,
    );
  }
  return data as T;
}

const folderUrl = (id: string) => FILE_ROUTES.folder.replace(':folderId', id);

const INPUT =
  'w-full rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-sm placeholder:text-neutral-400 focus:border-sky-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900';

function LevelSelect({
  value,
  label,
  onChange,
}: {
  value: FolderLevel;
  label: string;
  onChange: (level: FolderLevel) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as FolderLevel)}
      className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-sm focus:border-sky-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900"
    >
      {LEVEL_ORDER.map((level) => (
        <option key={level} value={level}>
          {FOLDER_LEVELS[level].label}
        </option>
      ))}
    </select>
  );
}

function scanLine(folder: FolderStatus): string {
  if (!folder.available) return 'Can’t be found right now; files from it show as missing';
  if (folder.scanning) return 'Scanning…';
  if (folder.error) return folder.error;
  if (folder.files === null) return 'Not scanned yet';
  const when = folder.scannedAt ? ` · scanned ${timeAgo(folder.scannedAt)}` : '';
  return `${plural(folder.files, 'file')}${when}`;
}

function FolderRow({
  folder,
  onChanged,
  onError,
}: {
  folder: FolderStatus;
  onChanged: () => void;
  onError: (err: unknown) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [label, setLabel] = useState(folder.label);
  const [confirming, setConfirming] = useState(false);

  const send = async (method: string, change?: { label?: string; level?: FolderLevel }) => {
    try {
      await sendFolder(method, folderUrl(folder.id), change);
      setRenaming(false);
      onChanged();
    } catch (err) {
      onError(err);
    }
  };
  const rename = (e: FormEvent) => {
    e.preventDefault();
    const next = label.trim();
    if (next && next !== folder.label) void send('PATCH', { label: next });
    else setRenaming(false);
  };

  return (
    <li className="space-y-2 py-3" aria-label={folder.label}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-0.5">
          {renaming ? (
            <form onSubmit={rename} className="flex items-center gap-2">
              <input
                aria-label="Folder name"
                autoFocus
                value={label}
                maxLength={60}
                onChange={(e) => setLabel(e.target.value)}
                className={clsx(INPUT, 'max-w-xs py-1')}
              />
              <button type="submit" className={BUTTON.secondary}>
                Save
              </button>
              <button
                type="button"
                className={BUTTON.secondary}
                onClick={() => {
                  setLabel(folder.label);
                  setRenaming(false);
                }}
              >
                Cancel
              </button>
            </form>
          ) : (
            <p className="flex items-center gap-2 text-sm font-medium">
              <Folder className="size-4 shrink-0 text-neutral-400" />
              {folder.label}
            </p>
          )}
          <p className="text-xs break-all text-neutral-500 dark:text-neutral-400">{folder.path}</p>
          <p
            className={clsx(
              'text-xs',
              folder.available && !folder.error
                ? 'text-neutral-500 dark:text-neutral-400'
                : 'text-amber-700 dark:text-amber-400',
            )}
          >
            {scanLine(folder)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <LevelSelect
            label={`What agents see in ${folder.label}`}
            value={folder.level}
            onChange={(level) => void send('PATCH', { level })}
          />
          {!renaming && (
            <button type="button" className={BUTTON.secondary} onClick={() => setRenaming(true)}>
              Rename
            </button>
          )}
          {!confirming && (
            <button type="button" className={BUTTON.secondary} onClick={() => setConfirming(true)}>
              Remove
            </button>
          )}
        </div>
      </div>
      <p className="text-xs text-neutral-600 dark:text-neutral-300">
        {FOLDER_LEVELS[folder.level].agents}
      </p>
      {confirming && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-neutral-50 px-3 py-2 text-sm dark:bg-neutral-800/60">
          <span className="min-w-0 flex-1">
            Remove {folder.label}? Files you added from it stay in their projects and show as
            missing. Nothing on disk changes.
          </span>
          <button type="button" className={BUTTON.danger} onClick={() => void send('DELETE')}>
            Remove folder
          </button>
          <button type="button" className={BUTTON.secondary} onClick={() => setConfirming(false)}>
            Keep
          </button>
        </div>
      )}
    </li>
  );
}

function AddFolder({ onAdded, onError }: { onAdded: () => void; onError: (err: unknown) => void }) {
  const [path, setPath] = useState('');
  const [label, setLabel] = useState('');
  const [level, setLevel] = useState<FolderLevel>('details');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!path.trim()) return;
    setBusy(true);
    try {
      await sendFolder('POST', FILE_ROUTES.folders, {
        path: path.trim(),
        ...(label.trim() ? { label: label.trim() } : {}),
        level,
      });
      setPath('');
      setLabel('');
      setLevel('details');
      onAdded();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      onSubmit={(e) => void submit(e)}
      aria-label="Add a folder"
      className="space-y-2 rounded-lg border border-dashed border-neutral-200 p-3 dark:border-neutral-700"
    >
      <div className="grid gap-2 sm:grid-cols-[1fr_12rem]">
        <input
          aria-label="Folder path"
          placeholder="/Users/you/Documents/Company"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          className={INPUT}
        />
        <input
          aria-label="Name (optional)"
          placeholder="Name (optional)"
          value={label}
          maxLength={60}
          onChange={(e) => setLabel(e.target.value)}
          className={INPUT}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <LevelSelect label="What agents see in the new folder" value={level} onChange={setLevel} />
        <button type="submit" disabled={busy || !path.trim()} className={BUTTON.primary}>
          Add folder
        </button>
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          Type or paste the full path. In Finder, Option-right-click a folder and choose Copy as
          Pathname.
        </span>
      </div>
    </form>
  );
}

/** The Claude Code settings that keep its own tools out of the folders agents shouldn't read. */
function DenyRules({ folders }: { folders: FolderStatus[] }) {
  if (!folders.length) return null;
  const rules = folders.flatMap((f) => f.denyRules);
  const snippet = JSON.stringify({ permissions: { deny: rules } }, null, 2);
  return (
    <div className="space-y-2 border-t border-neutral-100 pt-4 dark:border-neutral-800">
      <h3 className="text-sm font-semibold">Keep Claude Code out of these folders</h3>
      {rules.length ? (
        <>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Claude Code can read your disk directly, without going through Pharos. Add these rules
            to the <code>permissions.deny</code> list in <code>~/.claude/settings.json</code>, and
            it won’t open files in folders set to Hidden or Details. They stop its file tools and
            commands like <code>cat</code>, but not a script that opens files itself; to stop those
            too, turn on Claude Code’s sandbox (<code>"sandbox": {'{ "enabled": true }'}</code>),
            which applies these rules to every shell command.
          </p>
          <div className="relative">
            <pre
              aria-label="Claude Code deny rules"
              className="overflow-x-auto rounded-lg bg-neutral-100 p-3 pr-10 text-[13px] dark:bg-neutral-800"
            >
              {snippet}
            </pre>
            <span className="absolute top-2 right-2">
              <CopyButton label="deny rules" text={snippet} />
            </span>
          </div>
        </>
      ) : (
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Every folder is set to Contents, so there’s no Claude Code rule to add.
        </p>
      )}
    </div>
  );
}

function Folders() {
  const folders = useResource<FolderStatus[]>(FILE_ROUTES.folders);
  const [error, setError] = useState<string | null>(null);
  const report = (err: unknown) =>
    setError(err instanceof ApiError ? err.message : 'Couldn’t reach the server');
  const changed = () => {
    setError(null);
    folders.reload();
  };
  const list = folders.data ?? [];
  return (
    <Section
      title="Folders"
      description="Folders on this computer you can add files from. Files stay where they are: Pharos only reads them, and never moves, renames or deletes anything."
    >
      {folders.status === 'error' && !folders.data ? (
        <p className="text-sm text-rose-600 dark:text-rose-400">Couldn’t load folders.</p>
      ) : list.length ? (
        <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {list.map((f) => (
            <FolderRow key={`${f.id}:${f.label}`} folder={f} onChanged={changed} onError={report} />
          ))}
        </ul>
      ) : folders.data ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">No folders yet.</p>
      ) : (
        <p className="text-sm text-neutral-400">Loading…</p>
      )}
      <AddFolder onAdded={changed} onError={report} />
      {error && (
        <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
      <dl aria-label="Levels" className="divide-y divide-neutral-100 dark:divide-neutral-800">
        {LEVEL_ORDER.map((level) => (
          <Row key={level} label={FOLDER_LEVELS[level].label}>
            <span className="text-neutral-600 dark:text-neutral-400">
              {FOLDER_LEVELS[level].agents}
              {level === 'details' && ' The default.'}
            </span>
          </Row>
        ))}
      </dl>
      <DenyRules folders={list} />
      <div
        role="note"
        aria-label="What Pharos can and can’t enforce"
        className="space-y-1.5 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100"
      >
        <p className="font-medium">What Pharos can and can’t enforce</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Pharos enforces these levels for agents that connect over MCP, and only you, on this
            page, can add folders or give agents more access.
          </li>
          <li>
            An agent with shell access, such as Claude Code, can read the disk without asking
            Pharos. The rules above cover Claude Code; other agents need their own settings.
          </li>
          <li>
            A program on this computer can call Pharos’s local API directly (a <code>curl</code> to
            the server, say). Pharos refuses requests that say they come from an agent, but it can’t
            fully tell a local program from this page.
          </li>
        </ul>
      </div>
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
      <Folders />
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
