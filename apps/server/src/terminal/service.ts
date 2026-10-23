import type { AgentPreset } from '../agent-runner.js';
import type { Entity } from '@pharos/schema';
import type { Store } from '../store/store.js';
import {
  folderProjects,
  presetLabel,
  terminalBrief,
  terminalCommand,
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

export type TerminalServiceOptions = {
  store: Store;
  /** The installed agent CLIs and where each is (its absolute path when known). */
  installed: Partial<Record<AgentPreset, string>>;
  mcpConfigPath: string;
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

  /** The exact command, folder and environment for the project's session. */
  launch(projectId: string): TerminalLaunch {
    const preset = this.preset;
    if (!preset) throw new Error('No agent CLI is installed');
    const cwd = this.key(projectId);
    const projects = this.projects(projectId, cwd);
    const { file, args } = terminalCommand(preset, {
      mcpConfigPath: this.options.mcpConfigPath,
      serverUrl: this.options.serverUrl,
      brief: terminalBrief(projects, this.options.serverUrl),
    });
    return {
      preset,
      // The CLI found at start (`command -v`), so the PATH given to the agent can't swap it.
      file: this.options.installed[preset] || file,
      args,
      cwd,
      env: terminalEnv(
        this.options.serverEnv ?? process.env,
        this.options.serverUrl,
        projects.map((p) => p.id),
      ),
    };
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

  /** Restarts the project's folder session: every panel on it (other projects too) gets the new one. */
  restart(projectId: string, size: { cols: number; rows: number }): TerminalSession {
    if (!this.sessions) throw new Error('The terminal is unavailable');
    return this.sessions.restart(this.key(projectId), () => this.launch(projectId), size);
  }

  /** Ends idle sessions every minute (30 minutes with no panel). */
  startSweeping(): void {
    if (!this.sessions || this.sweeper) return;
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
    try {
      this.sessions?.killAll();
    } catch (error) {
      console.error('[pharos] Stopping the terminals failed:', error);
    }
  }
}
