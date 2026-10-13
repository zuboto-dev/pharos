import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RevisionEvent, RevisionFeed } from './feed.js';
import type { Presence } from './presence.js';
import type { Store } from './store/store.js';

export type RunResult = { exitCode: number | null; timedOut: boolean };
/** Runs the command; `signal` aborts when answering is paused mid-run (the run is stopped). */
export type Runner = (
  command: string,
  env: Record<string, string>,
  timeoutMs: number,
  signal?: AbortSignal,
) => Promise<RunResult>;

export type AgentStatus = {
  /** A command is set up (Claude Code found, or PHAROS_AGENT_COMMAND). */
  configured: boolean;
  /** Turned on in Settings (on unless someone paused it). */
  enabled: boolean;
  /** Where the command comes from. */
  mode: AgentSetup['mode'];
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
  };
};

/** What the person's environment says to run for new questions. */
export type AgentSetup =
  | { mode: 'custom' | 'default'; command: string }
  | { mode: 'off' | 'unavailable'; command?: undefined };

/**
 * Picks the question-answering command: PHAROS_AGENT_COMMAND when set ("off" turns it off),
 * otherwise Claude Code when it is installed, talking to this server over MCP. Only the
 * environment decides this; nothing in the API can change it.
 */
export function agentSetup(
  configured: string | undefined,
  options: { hasClaude: boolean; mcpConfigPath: string },
): AgentSetup {
  const value = configured?.trim();
  if (value && /^(off|false|0|no|none)$/i.test(value)) return { mode: 'off' };
  if (value) return { mode: 'custom', command: value };
  if (!options.hasClaude) return { mode: 'unavailable' };
  return {
    mode: 'default',
    command: `claude -p "$PHAROS_PROMPT" --mcp-config "${options.mcpConfigPath}" --strict-mcp-config --allowedTools "mcp__pharos__*"`,
  };
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
      });
      child.stdout.on('data', (d: Buffer) => log(d.toString()));
      child.stderr.on('data', (d: Buffer) => log(d.toString()));
      let timedOut = false;
      let done = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeoutMs);
      // Paused in Settings: the run stops, so nothing says it is still answering.
      const stop = () => {
        log('--- stopped: answering was paused\n');
        child.kill('SIGTERM');
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
    return Boolean(this.options.command?.trim());
  }

  /** Settings can pause answering; the command itself only comes from the environment. */
  get enabled(): boolean {
    return this.store.setting<boolean>('agent.enabled') ?? true;
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
    const { mode, command, logPath } = this.options;
    return {
      configured: this.configured,
      enabled: this.enabled,
      mode: mode ?? (this.configured ? 'custom' : 'unavailable'),
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
    const stop = new AbortController();
    this.stopRun = stop;
    const started = Date.now();
    const presence = this.options.presence;
    const source = `runner:${started}`;
    const agentName =
      this.options.agentName ?? (this.options.mode === 'custom' ? 'Your agent' : 'Claude Code');
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
        this.options.command!,
        {
          PHAROS_PROJECT_IDS: projectIds.join(','),
          PHAROS_REQUEST_IDS: projectIds.flatMap((id) => this.openQuestions(id)).join(','),
          PHAROS_URL: this.options.serverUrl ?? 'http://localhost:4300',
          ...(this.options.prompt ? { PHAROS_PROMPT: this.options.prompt(projectIds) } : {}),
        },
        this.options.timeoutMs ?? 600_000,
        stop.signal,
      );
      this.lastRun = {
        projectIds,
        startedAt: new Date(started).toISOString(),
        durationMs: Date.now() - started,
        ...result,
        ...(stop.signal.aborted ? { stopped: true } : {}),
      };
    } finally {
      this.stopRun = undefined;
      // The run is over (finished, failed, timed out or paused): its marks go, including what
      // its agent marked over MCP during the run (its session may not close by itself).
      try {
        presence?.clearSource(source);
        presence?.clearProjects(projectIds, started);
      } catch (error) {
        console.error('[pharos] Could not clear the answering marks:', error);
      }
      this.answering = [];
      this.changed();
      // Questions asked during the run get their own run.
      if (this.queue.size) this.schedule();
    }
  }
}
