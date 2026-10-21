import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RevisionEvent, RevisionFeed } from './feed.js';
import type { Presence } from './presence.js';
import { PharosError } from './store/errors.js';
import type { Store } from './store/store.js';

export type RunResult = { exitCode: number | null; timedOut: boolean };
/** Runs the command; `signal` aborts when answering is paused mid-run (the run is stopped). */
export type Runner = (
  command: string,
  env: Record<string, string>,
  timeoutMs: number,
  signal?: AbortSignal,
) => Promise<RunResult>;

/**
 * What the answering agent is really doing (R11, W7): off (PHAROS_AGENT_COMMAND=off),
 * unavailable (no command), paused (in Settings; nothing runs and nothing is queued), idle,
 * queued (questions wait for the next run), running, or stopping (paused during a run: the run
 * was told to stop and hasn't exited yet).
 */
export type AgentState =
  'off' | 'unavailable' | 'paused' | 'idle' | 'queued' | 'running' | 'stopping';

/** How a run ended. */
export type RunOutcome = 'finished' | 'failed' | 'timed_out' | 'stopped';

export type AgentStatus = {
  /** A command is set up (Claude Code found, or PHAROS_AGENT_COMMAND). */
  configured: boolean;
  /** Questions are answered automatically: set up and not paused (W7.9). */
  enabled: boolean;
  /** Paused in Settings (the stored switch, whether or not a command is set up). */
  paused: boolean;
  state: AgentState;
  /** The run in progress: what it answers and since when. */
  run?: { projectIds: string[]; requestIds: string[]; startedAt: string; agent?: string };
  /** Where the command comes from. */
  mode: AgentSetup['mode'];
  /** The built-in agent that answers (mode `default`): chosen in Settings among the installed. */
  preset?: AgentPreset;
  /** The built-in agents and whether each is installed here (Settings offers the installed). */
  presets: { id: AgentPreset; label: string; installed: boolean }[];
  /** Who answers, in words: the preset's name, or "Your agent" for PHAROS_AGENT_COMMAND. */
  agent?: string;
  command?: string;
  logPath?: string;
  running: boolean;
  /** Projects whose questions the current run is answering. */
  answering: string[];
  /** Projects waiting for the next run. */
  queued: string[];
  lastRun?: {
    projectIds: string[];
    startedAt: string;
    durationMs: number;
    exitCode: number | null;
    timedOut: boolean;
    /** Stopped because answering was paused. */
    stopped?: boolean;
    outcome: RunOutcome;
    requestIds: string[];
    finishedAt: string;
    /** Which agent ran it (a choice made since applies to the next run). */
    agent?: string;
  };
};

/** The built-in answering agents. Their commands are fixed here; the API can only pick one. */
export const AGENT_PRESETS = ['claude', 'codex'] as const;
export type AgentPreset = (typeof AGENT_PRESETS)[number];
export const PRESET_LABELS: Record<AgentPreset, string> = { claude: 'Claude Code', codex: 'Codex' };
/** The app setting (not project data) holding the chosen preset. */
export const PRESET_SETTING = 'agent.preset';

export function isAgentPreset(value: unknown): value is AgentPreset {
  return typeof value === 'string' && (AGENT_PRESETS as readonly string[]).includes(value);
}

/**
 * The command for a built-in agent: run once, non-interactively, connected over MCP to this
 * server only, with the brief in $PHAROS_PROMPT.
 * - Claude Code: the MCP config file Pharos writes (`agentMcpConfig`), only Pharos's tools.
 * - Codex: as eval/compat runs it: not the user's config.toml (`--ignore-user-config`), only
 *   this server over `-c`, its tools approved (exec can't ask), no session kept, a read-only
 *   sandbox for its own shell.
 */
export function presetCommand(
  preset: AgentPreset,
  options: { mcpConfigPath: string; serverUrl: string },
): string {
  if (preset === 'codex')
    return [
      'codex exec --skip-git-repo-check --ignore-user-config --ephemeral --sandbox read-only',
      '--color never',
      `-c 'mcp_servers.pharos.url="${options.serverUrl}/mcp"'`,
      `-c 'mcp_servers.pharos.default_tools_approval_mode="approve"'`,
      '"$PHAROS_PROMPT"',
    ].join(' ');
  return `claude -p "$PHAROS_PROMPT" --mcp-config "${options.mcpConfigPath}" --strict-mcp-config --allowedTools "mcp__pharos__*"`;
}

/** What the person's environment says to run for new questions. */
export type AgentSetup =
  | { mode: 'custom'; command: string; installed: AgentPreset[] }
  | {
      mode: 'default';
      /** The command of the default preset (Settings may choose another installed one). */
      command: string;
      preset: AgentPreset;
      installed: AgentPreset[];
      /** The command of each installed preset. */
      commands: Partial<Record<AgentPreset, string>>;
    }
  | { mode: 'off' | 'unavailable'; command?: undefined; installed: AgentPreset[] };

/**
 * Picks the question-answering command: PHAROS_AGENT_COMMAND when set ("off" turns it off),
 * otherwise a built-in agent that is installed (Claude Code first, then Codex), talking to this
 * server over MCP. The environment decides the commands; Settings can only pick an installed
 * preset, and not at all when PHAROS_AGENT_COMMAND is set.
 */
export function agentSetup(
  configured: string | undefined,
  options: { hasClaude: boolean; hasCodex?: boolean; mcpConfigPath: string; serverUrl?: string },
): AgentSetup {
  const installed = AGENT_PRESETS.filter((p) =>
    p === 'claude' ? options.hasClaude : Boolean(options.hasCodex),
  );
  const value = configured?.trim();
  if (value && /^(off|false|0|no|none)$/i.test(value)) return { mode: 'off', installed };
  if (value) return { mode: 'custom', command: value, installed };
  const preset = installed[0];
  if (!preset) return { mode: 'unavailable', installed };
  const target = {
    mcpConfigPath: options.mcpConfigPath,
    serverUrl: options.serverUrl ?? 'http://localhost:4300',
  };
  const commands: Partial<Record<AgentPreset, string>> = {};
  for (const p of installed) commands[p] = presetCommand(p, target);
  return { mode: 'default', command: commands[preset]!, preset, installed, commands };
}

/** MCP client config pointing the default agent at this server. */
export function agentMcpConfig(serverUrl: string): string {
  return JSON.stringify({ mcpServers: { pharos: { type: 'http', url: `${serverUrl}/mcp` } } });
}

/**
 * Runs a shell command from the log's folder (so the agent doesn't pick up whatever project the
 * server was started in), logging its output; kills it after the timeout.
 */
export function shellRunner(logFile: string): Runner {
  return (command, env, timeoutMs, signal) =>
    new Promise((resolve) => {
      mkdirSync(dirname(logFile), { recursive: true });
      const log = (text: string) => appendFileSync(logFile, text);
      log(`\n--- ${new Date().toISOString()} ${command}\n`);
      const child = spawn(command, {
        shell: true,
        cwd: dirname(logFile),
        env: { ...process.env, ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
        // Its own process group, so stopping it also stops what the shell started: on Linux,
        // `sh -c` runs the command as a child, which would outlive the shell and keep the run open.
        detached: process.platform !== 'win32',
      });
      const kill = () => {
        try {
          if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
          else child.kill('SIGTERM');
        } catch {
          child.kill('SIGTERM');
        }
      };
      child.stdout.on('data', (d: Buffer) => log(d.toString()));
      child.stderr.on('data', (d: Buffer) => log(d.toString()));
      let timedOut = false;
      let done = false;
      const timer = setTimeout(() => {
        timedOut = true;
        kill();
      }, timeoutMs);
      // Paused in Settings: the run stops, so nothing says it is still answering.
      const stop = () => {
        log('--- stopped: answering was paused\n');
        kill();
      };
      signal?.addEventListener('abort', stop, { once: true });
      const finish = (line: string, result: RunResult) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', stop);
        log(line);
        resolve(result);
      };
      // Without a listener, a failed spawn is an uncaught exception that ends the server.
      child.on('error', (error) =>
        finish(`--- could not run: ${error.message}\n`, { exitCode: null, timedOut }),
      );
      child.on('close', (exitCode) =>
        finish(`--- exit ${exitCode}${timedOut ? ' (timed out)' : ''}\n`, { exitCode, timedOut }),
      );
    });
}

/**
 * Answers questions asked from the UI by running the person's own agent command (opt-in via
 * PHAROS_AGENT_COMMAND; it can't be set over the API). New questions are batched briefly, runs
 * never overlap, and nothing runs unless questions are still open.
 */
export class AgentRunner {
  private readonly queue = new Set<string>();
  private answering: string[] = [];
  private run: AgentStatus['run'];
  private get running(): boolean {
    return this.answering.length > 0;
  }
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Stops the current run (pausing answering). */
  private stopRun: AbortController | undefined;
  private lastRun: AgentStatus['lastRun'];
  private readonly listeners = new Set<(status: AgentStatus) => void>();

  constructor(
    private readonly store: Store,
    private readonly options: {
      command: string | undefined;
      /**
       * The installed built-in agents' commands (mode `default`): Settings picks one, saved as
       * PRESET_SETTING; `command` is then only the fallback.
       */
      presets?: Partial<Record<AgentPreset, string>>;
      runner: Runner;
      timeoutMs?: number;
      /** Wait this long after a question so several asked together share one run. */
      batchMs?: number;
      serverUrl?: string;
      mode?: AgentSetup['mode'];
      logPath?: string;
      /** Instructions for the run, passed as PHAROS_PROMPT. */
      prompt?: (projectIds: string[]) => string;
      /** Marks the projects being answered while a run lasts (v0.2 B5). */
      presence?: Presence;
      /** The agent's name on those marks (default: Claude Code, or "Your agent" for a command). */
      agentName?: string;
    },
  ) {}

  get configured(): boolean {
    return Boolean(this.command?.trim());
  }

  /** The installed built-in agents (only when the environment leaves the choice to Settings). */
  private get presets(): AgentPreset[] {
    return this.options.mode === 'default'
      ? AGENT_PRESETS.filter((p) => this.options.presets?.[p])
      : [];
  }

  /** The chosen built-in agent: the saved choice while it is installed, else the first one. */
  get preset(): AgentPreset | undefined {
    const installed = this.presets;
    const saved = this.store.setting<string>(PRESET_SETTING);
    return isAgentPreset(saved) && installed.includes(saved) ? saved : installed[0];
  }

  /** What the next run will run. */
  private get command(): string | undefined {
    const preset = this.preset;
    return (preset && this.options.presets?.[preset]) || this.options.command;
  }

  /** Who answers, in words (presence marks, Settings, the run). */
  get agentName(): string {
    if (this.options.agentName) return this.options.agentName;
    if (this.options.mode === 'custom') return 'Your agent';
    return PRESET_LABELS[this.preset ?? 'claude'];
  }

  /**
   * Picks which installed built-in agent answers (Settings). Refused when the environment sets
   * the command (PHAROS_AGENT_COMMAND) or the preset isn't installed. A run in progress keeps its
   * agent; the choice applies from the next run.
   */
  setPreset(preset: string): void {
    if (this.options.mode !== 'default')
      throw new PharosError(
        'invalid',
        this.options.mode === 'custom' || (!this.options.mode && this.configured)
          ? 'PHAROS_AGENT_COMMAND is set on the server, so it decides which agent answers'
          : 'No built-in agent can answer on this server',
      );
    if (!isAgentPreset(preset))
      throw new PharosError(
        'invalid',
        `Unknown agent "${preset}": use ${AGENT_PRESETS.join(' or ')}`,
      );
    if (!this.presets.includes(preset))
      throw new PharosError('invalid', `${PRESET_LABELS[preset]} isn't installed on this computer`);
    this.store.setSetting(PRESET_SETTING, preset);
    this.changed();
  }

  /** Settings can pause answering; the command itself only comes from the environment. */
  get enabled(): boolean {
    return this.store.setting<boolean>('agent.enabled') ?? true;
  }

  /** What is really happening now (see AgentState). */
  get state(): AgentState {
    const mode = this.options.mode ?? (this.configured ? 'custom' : 'unavailable');
    if (mode === 'off') return 'off';
    if (!this.configured) return 'unavailable';
    if (this.running) return this.stopRun?.signal.aborted ? 'stopping' : 'running';
    if (!this.enabled) return 'paused';
    return this.queue.size ? 'queued' : 'idle';
  }

  setEnabled(enabled: boolean): void {
    this.store.setSetting('agent.enabled', enabled);
    if (!enabled) {
      this.queue.clear();
      clearTimeout(this.timer);
      // A pause stops the current run too, so "paused" is true and its marks clear.
      this.stopRun?.abort();
    }
    this.changed();
  }

  /** Queues every project with open questions, e.g. ones asked while answering was paused. */
  answerWaiting(): number {
    if (!this.configured || !this.enabled) return 0;
    const projects = this.store
      .list('project')
      .map((p) => p.id)
      .filter((id) => this.openQuestions(id).length > 0);
    for (const id of projects) this.queue.add(id);
    if (projects.length) {
      this.changed();
      this.schedule();
    }
    return projects.reduce((n, id) => n + this.openQuestions(id).length, 0);
  }

  status(): AgentStatus {
    const { mode, logPath } = this.options;
    const command = this.command;
    const resolved = mode ?? (this.configured ? 'custom' : 'unavailable');
    const installed = this.presets;
    const preset = resolved === 'default' ? this.preset : undefined;
    return {
      configured: this.configured,
      enabled: this.configured && resolved !== 'off' && this.enabled,
      paused: !this.enabled,
      state: this.state,
      ...(this.run ? { run: this.run } : {}),
      mode: resolved,
      ...(preset ? { preset } : {}),
      presets: AGENT_PRESETS.map((id) => ({
        id,
        label: PRESET_LABELS[id],
        installed: installed.includes(id),
      })),
      ...(this.configured
        ? {
            agent: resolved === 'custom' && !this.options.agentName ? 'Your agent' : this.agentName,
          }
        : {}),
      ...(command ? { command } : {}),
      ...(logPath ? { logPath } : {}),
      running: this.running,
      answering: this.answering,
      queued: [...this.queue],
      ...(this.lastRun ? { lastRun: this.lastRun } : {}),
    };
  }

  /** Calls `fn` whenever the status changes (queued, started, finished). */
  onChange(fn: (status: AgentStatus) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed(): void {
    const status = this.status();
    for (const fn of this.listeners) {
      try {
        fn(status);
      } catch (error) {
        console.error('[pharos] An agent status listener failed:', error);
      }
    }
  }

  /** Watches the feed for new questions. Returns an unsubscribe. */
  watch(feed: RevisionFeed): () => void {
    return feed.subscribe((event) => this.onRevision(event));
  }

  onRevision(event: RevisionEvent): void {
    if (!this.configured || !this.enabled) return;
    const revision = this.store.revision(event.id);
    const asked = revision?.changes.filter((c) => c.type === 'request' && c.op === 'create') ?? [];
    if (!asked.length) return;
    for (const id of event.projectIds) this.queue.add(id);
    this.changed();
    this.schedule();
  }

  private schedule(): void {
    if (this.running) return; // picked up when the current run finishes
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      // From a timer, a rejection here would be unhandled and end the server.
      this.runNext().catch((error: unknown) =>
        console.error('[pharos] Answering questions failed:', error),
      );
    }, this.options.batchMs ?? 2000);
  }

  private openQuestions(projectId: string): string[] {
    return this.store.list('request', { projectId, where: { status: 'open' } }).map((r) => r.id);
  }

  async runNext(): Promise<void> {
    if (this.running || !this.queue.size || !this.configured || !this.enabled) return;
    const projectIds = [...this.queue].filter((id) => this.openQuestions(id).length > 0);
    this.queue.clear();
    if (!projectIds.length) return this.changed();
    this.answering = projectIds;
    const requestIds = projectIds.flatMap((id) => this.openQuestions(id));
    const stop = new AbortController();
    this.stopRun = stop;
    const started = Date.now();
    // The agent chosen now runs this whole batch; a change in Settings applies to the next run.
    const command = this.command!;
    const agentName = this.agentName;
    this.run = {
      projectIds,
      requestIds,
      startedAt: new Date(started).toISOString(),
      agent: agentName,
    };
    const presence = this.options.presence;
    const source = `runner:${started}`;
    try {
      for (const projectId of projectIds) {
        presence?.hold(agentName, { projectId, activity: 'answering' }, source);
        // "Ask about this block" (R10): the block shows the agent editing it while the run lasts.
        for (const request of this.store.list('request', {
          projectId,
          where: { status: 'open' },
        }))
          if (request.data.mode === 'block' && request.data.viewId && request.data.widgetId)
            presence?.hold(
              agentName,
              {
                projectId,
                viewId: request.data.viewId,
                widgetId: request.data.widgetId,
                activity: 'editing',
              },
              source,
            );
      }
    } catch (error) {
      console.error('[pharos] Could not mark the projects being answered:', error);
    }
    this.changed();
    try {
      const result = await this.options.runner(
        command,
        {
          PHAROS_PROJECT_IDS: projectIds.join(','),
          PHAROS_REQUEST_IDS: requestIds.join(','),
          PHAROS_URL: this.options.serverUrl ?? 'http://localhost:4300',
          ...(this.options.prompt ? { PHAROS_PROMPT: this.options.prompt(projectIds) } : {}),
        },
        this.options.timeoutMs ?? 600_000,
        stop.signal,
      );
      this.lastRun = {
        projectIds,
        requestIds,
        startedAt: new Date(started).toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        agent: agentName,
        ...result,
        ...(stop.signal.aborted ? { stopped: true } : {}),
        outcome: stop.signal.aborted
          ? 'stopped'
          : result.timedOut
            ? 'timed_out'
            : result.exitCode === 0
              ? 'finished'
              : 'failed',
      };
    } catch (error) {
      // A runner that throws is a failed run, not a server crash (CLAUDE.md).
      console.error('[pharos] The answering run failed:', error);
      this.lastRun = {
        projectIds,
        requestIds,
        startedAt: new Date(started).toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        exitCode: null,
        timedOut: false,
        agent: agentName,
        outcome: stop.signal.aborted ? 'stopped' : 'failed',
        ...(stop.signal.aborted ? { stopped: true } : {}),
      };
    } finally {
      this.stopRun = undefined;
      // The run is over (finished, failed, timed out or paused): its marks go, including what
      // its agent marked over MCP during the run (its session may not close by itself).
      try {
        presence?.clearProjects(projectIds, started, agentName);
        presence?.clearSource(source);
      } catch (error) {
        console.error('[pharos] Could not clear the answering marks:', error);
      }
      this.answering = [];
      this.run = undefined;
      this.changed();
      // Questions asked during the run get their own run.
      if (this.queue.size) this.schedule();
    }
  }
}
