import type { AgentPreset } from '../agent-runner.js';
import type { Entity } from '@pharos/schema';
import type { Store } from '../store/store.js';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AgentPanelRow } from '@pharos/schema';
import {
  CONVERSATIONS_SETTING,
  folderProjects,
  presetLabel,
  terminalBrief,
  terminalCommand,
  conversationKept,
  terminalCwd,
  terminalEnv,
  terminalPreset,
} from './command.js';
import {
  TerminalSessions,
  type PtySpawn,
  type TerminalClient,
  type TerminalLaunch,
  type TerminalSession,
} from './sessions.js';

/** What the panel shows before it connects (GET /api/projects/:id/terminal). */
export type TerminalStatus = {
  available: boolean;
  /** Why not: hosted (not this computer), no-agent (neither CLI installed), unsupported (no PTY). */
  reason?: 'hosted' | 'no-agent' | 'unsupported';
  message?: string;
  agent?: { id: AgentPreset; label: string };
  /** A session of this project is running (reopening the panel continues it). */
  running: boolean;
  /** The other projects in this project's folder: they share its session. */
  sharedWith?: { id: string; name: string }[];
};

/** A running agent (GET /api/terminal/running). */
export type TerminalRunning = {
  projectIds: string[];
  agent: string;
  /** A panel shows it now. */
  watched: boolean;
  lastOutputAt?: string;
};

export type TerminalServiceOptions = {
  store: Store;
  /** The installed agent CLIs and where each is (its absolute path when known). */
  installed: Partial<Record<AgentPreset, string>>;
  mcpConfigPath: string;
  /** Claude Code settings with the Stop hook (`terminalHookSettings`); without it, quiet output ends a turn. */
  hookSettingsPath?: string;
  serverUrl: string;
  /** The Pharos home (PHAROS_HOME or ~/.pharos): agent folders go under it. */
  home: string;
  /** The pseudo-terminal, or why there is none. */
  pty: { spawn: PtySpawn } | { error: string };
  serverEnv?: NodeJS.ProcessEnv;
  now?: () => number;
  idleMs?: number;
  killGroup?: (pid: number, signal: NodeJS.Signals) => void;
};

/** The agent terminal (R17): which agent, where it starts, and the sessions. */
export class TerminalService {
  readonly sessions: TerminalSessions | undefined;
  private sweeper: ReturnType<typeof setInterval> | undefined;
  private quietChecker: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly options: TerminalServiceOptions) {
    this.sessions =
      'spawn' in options.pty
        ? new TerminalSessions(options.pty.spawn, {
            ...(options.now ? { now: options.now } : {}),
            ...(options.idleMs !== undefined ? { idleMs: options.idleMs } : {}),
            ...(options.killGroup ? { killGroup: options.killGroup } : {}),
          })
        : undefined;
  }

  private get installed(): AgentPreset[] {
    return (Object.keys(this.options.installed) as AgentPreset[]).filter(
      (p) => this.options.installed[p],
    );
  }

  get preset(): AgentPreset | undefined {
    return terminalPreset(this.options.store, this.installed);
  }

  /**
   * The project's session key: its working folder, so projects that share a repository folder
   * share one agent (two agents in one checkout would overwrite each other's edits).
   */
  key(projectId: string, make = true): string {
    return terminalCwd(this.options.store, projectId, this.options.home, make).cwd;
  }

  /** The projects a session in this project's folder works for (just this one when it is alone). */
  private projects(projectId: string, cwd: string) {
    const shared = folderProjects(this.options.store, cwd);
    if (shared.some((p) => p.id === projectId)) return shared;
    const project = this.options.store.get(projectId);
    const name = project?.type === 'project' ? (project as Entity<'project'>).data.name : projectId;
    return [{ id: projectId, name }];
  }

  status(projectId: string): TerminalStatus {
    const key = this.key(projectId, false);
    const running = Boolean(this.sessions?.get(key));
    const others = this.projects(projectId, key).filter((p) => p.id !== projectId);
    const sharedWith = others.length ? { sharedWith: others } : {};
    const preset = this.preset;
    const agent = preset ? { id: preset, label: presetLabel(preset) } : undefined;
    if (!preset)
      return {
        available: false,
        reason: 'no-agent',
        message: 'Install Claude Code or Codex on this computer to use the agent terminal',
        running,
        ...sharedWith,
      };
    if (!this.sessions)
      return {
        available: false,
        reason: 'unsupported',
        message: 'The terminal can’t start on this server (node-pty did not load)',
        agent,
        running,
        ...sharedWith,
      };
    return { available: true, agent, running, ...sharedWith };
  }

  /**
   * The exact command, folder and environment for the project's session. Claude Code's
   * conversation is kept per folder: a session that ends with the server (an update, a restart)
   * or after 30 idle minutes resumes it next time, so the work goes on; `fresh` (the panel's
   * Start again) begins a new one.
   */
  launch(projectId: string, fresh = false): TerminalLaunch {
    const preset = this.preset;
    if (!preset) throw new Error('No agent CLI is installed');
    const cwd = this.key(projectId);
    const projects = this.projects(projectId, cwd);
    const env = terminalEnv(
      this.options.serverEnv ?? process.env,
      this.options.serverUrl,
      projects.map((p) => p.id),
    );
    const conversation = preset === 'claude' ? this.conversation(cwd, env.HOME, fresh) : undefined;
    // The Stop hook says which session ended its turn with this (never sent to a client).
    env.PHAROS_TERMINAL_TOKEN = randomBytes(16).toString('hex');
    const hooked = preset === 'claude' && Boolean(this.options.hookSettingsPath);
    const { file, args } = terminalCommand(preset, {
      mcpConfigPath: this.options.mcpConfigPath,
      serverUrl: this.options.serverUrl,
      brief: terminalBrief(projects, this.options.serverUrl),
      ...(conversation ? { conversation } : {}),
      ...(hooked ? { settingsPath: this.options.hookSettingsPath } : {}),
    });
    return {
      preset,
      hooked,
      // The CLI found at start (`command -v`), so the PATH given to the agent can't swap it.
      file: this.options.installed[preset] || file,
      args,
      cwd,
      env,
    };
  }

  /** The folder's conversation: resumed when Claude Code kept it, else a new id, remembered. */
  private conversation(cwd: string, home: string | undefined, fresh: boolean) {
    const store = this.options.store;
    const kept = store.setting<Record<string, string>>(CONVERSATIONS_SETTING) ?? {};
    const last = kept[cwd];
    if (!fresh && last && home && conversationKept(home, cwd, last))
      return { id: last, resume: true };
    const id = randomUUID();
    store.setSetting(CONVERSATIONS_SETTING, { ...kept, [cwd]: id });
    return { id, resume: false };
  }

  /** Attaches a panel of the project to its folder's session; input and sizes go to `session.key`. */
  attach(
    projectId: string,
    client: TerminalClient,
    size: { cols: number; rows: number },
  ): TerminalSession {
    if (!this.sessions) throw new Error('The terminal is unavailable');
    return this.sessions.attach(this.key(projectId), () => this.launch(projectId), client, size);
  }

  /** Stops the agent of the project's folder (the owner's Stop). */
  stopAgent(projectId: string): boolean {
    return this.sessions?.stop(this.key(projectId, false)) ?? false;
  }

  /** Restarts the project's folder session: every panel on it (other projects too) gets the new one. */
  restart(projectId: string, size: { cols: number; rows: number }): TerminalSession {
    if (!this.sessions) throw new Error('The terminal is unavailable');
    return this.sessions.restart(this.key(projectId), () => this.launch(projectId, true), size);
  }

  /**
   * The agents running now, for the hint of where one was opened (the rail, the sidebar, the
   * page's terminal button): the projects each works for, whether a panel shows it, and when it
   * last printed something.
   */
  runningSessions(): TerminalRunning[] {
    return (this.sessions?.running() ?? []).map((session) => ({
      projectIds: (session.launch.env.PHAROS_PROJECT_IDS ?? '').split(',').filter(Boolean),
      agent: presetLabel(session.launch.preset),
      watched: session.clients.size > 0,
      ...(session.lastOutputAt
        ? { lastOutputAt: new Date(session.lastOutputAt).toISOString() }
        : {}),
    }));
  }

  /** The Stop hook of a session posted: its turn ended. False when no running session has the token. */
  hookTurn(token: string): boolean {
    const session = this.sessions?.byToken(token);
    if (!session || !this.sessions) return false;
    this.sessions.turnEnded(session, 'hook');
    return true;
  }

  /** One row per running agent panel, for the Agents page. */
  panels(now = (this.options.now ?? Date.now)()): AgentPanelRow[] {
    const iso = (ms: number | undefined) =>
      ms === undefined ? undefined : new Date(ms).toISOString();
    return (this.sessions?.running() ?? []).map((session) => {
      const ids = (session.launch.env.PHAROS_PROJECT_IDS ?? '').split(',').filter(Boolean);
      const projects = ids.map((id) => {
        const p = this.options.store.get(id);
        return { id, name: p?.type === 'project' ? (p as Entity<'project'>).data.name : id };
      });
      const { state, since } = session.state(now);
      const lastOutputAt = iso(session.lastOutputAt);
      const turnEndedAt = iso(session.turnEndedAt);
      return {
        id: session.id,
        agent: presetLabel(session.launch.preset),
        cwd: session.launch.cwd,
        projects,
        state,
        since: new Date(since).toISOString(),
        startedAt: new Date(session.startedAt).toISOString(),
        ...(lastOutputAt ? { lastOutputAt } : {}),
        ...(turnEndedAt ? { turnEndedAt } : {}),
        watched: session.watched,
      };
    });
  }

  /** Ends idle sessions every minute (30 minutes with no panel); checks quiet turns every 2 s. */
  startSweeping(): void {
    if (!this.sessions || this.sweeper) return;
    this.quietChecker = setInterval(() => {
      try {
        this.sessions?.checkQuiet();
      } catch (error) {
        console.error('[pharos] Checking the terminals for ended turns failed:', error);
      }
    }, 2000);
    this.quietChecker.unref?.();
    this.sweeper = setInterval(() => {
      try {
        this.sessions?.sweep();
      } catch (error) {
        console.error('[pharos] Ending idle terminals failed:', error);
      }
    }, 60_000);
    this.sweeper.unref?.();
  }

  /** The server is stopping. */
  stop(): void {
    clearInterval(this.sweeper);
    clearInterval(this.quietChecker);
    try {
      this.sessions?.killAll();
    } catch (error) {
      console.error('[pharos] Stopping the terminals failed:', error);
    }
  }
}
