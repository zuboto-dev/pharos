import { randomBytes } from 'node:crypto';
import { PANEL_WORKING_MS, type PanelState } from '@pharos/schema';
import type { AgentPreset } from '../agent-runner.js';

/** What the sessions need of a pseudo-terminal (node-pty in the server, a fake in tests). */
export interface Pty {
  readonly pid: number;
  onData(listener: (data: string) => void): void;
  onExit(listener: (event: { exitCode: number; signal?: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

export type PtySpawn = (
  file: string,
  args: string[],
  options: { cwd: string; env: Record<string, string>; cols: number; rows: number },
) => Pty;

/** What a session runs: decided by the server only (see command.ts). */
export type TerminalLaunch = {
  preset: AgentPreset;
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  /**
   * The agent says when its turn ends (Claude Code's Stop hook posts to Pharos with the
   * session's `PHAROS_TERMINAL_TOKEN`); otherwise output going quiet after input says it.
   */
  hooked?: boolean;
};

/** Messages to the panel. */
export type TerminalServerMessage =
  | { t: 'o'; d: string }
  | { t: 'start'; agent: AgentPreset; cwd: string; replay: boolean }
  | { t: 'exit'; code: number | null; signal?: number }
  | { t: 'error'; message: string }
  | { t: 'pong' };

/** A connected panel (a WebSocket in the server). */
export type TerminalClient = {
  send(message: TerminalServerMessage): void;
  close(code?: number, reason?: string): void;
};

function startMessage(session: TerminalSession, replay: boolean): TerminalServerMessage {
  return { t: 'start', agent: session.launch.preset, cwd: session.launch.cwd, replay };
}

/** How much recent output a session keeps, so a reopened panel shows the conversation. */
const SCROLLBACK = 256 * 1024;

/** A DEC private mode set or reset (`ESC [ ? 1049 h`): screen, mouse, paste and cursor modes. */
// eslint-disable-next-line no-control-regex -- ESC starts the sequence
const PRIVATE_MODE = /\x1b\[\?([\d;]+)([hl])/g;
/** The alternate screen modes, replayed before the others (switching screens resets some). */
const SCREEN_MODES = new Set([47, 1047, 1049]);

export class TerminalSession {
  readonly clients = new Set<TerminalClient>();
  /** Recent output (up to twice SCROLLBACK, trimmed in one go), replayed to a panel that (re)attaches. */
  scrollback = '';
  /** Output was dropped from the front of `scrollback`. */
  private trimmed = false;
  /** The last value of each private mode the agent set, so a replay that starts after it keeps it. */
  private readonly modes = new Map<number, 'h' | 'l'>();
  /** The end of the last output, so a mode sequence split across two outputs is still seen. */
  private modeTail = '';
  /** When the agent last printed something (the panel's "new output" hint). */
  lastOutputAt: number | undefined;
  /** When the last panel went away (undefined while one is attached). */
  detachedAt: number | undefined;
  exited = false;
  /** Who ended it: the restart button, no panel for a while, the server stopping, or the owner's Stop. */
  endedBy: 'restart' | 'idle' | 'server' | 'owner' | undefined;
  /** Stable while it runs, for the Agents page (its key is a folder path). */
  readonly id = randomBytes(6).toString('hex');
  /** When the owner last typed in a panel of it (any key, the wheel, a pasted reference). */
  lastInputAt: number | undefined;
  /** When the owner last sent something (input with Enter): a turn starts. */
  lastSubmitAt: number | undefined;
  /** When its last turn ended (the hook, or output gone quiet after input). */
  turnEndedAt: number | undefined;
  /** Panels attached in a tab the owner can't see (a hidden browser tab). */
  readonly hidden = new Set<TerminalClient>();

  constructor(
    readonly key: string,
    readonly launch: TerminalLaunch,
    readonly pty: Pty,
    readonly startedAt: number = Date.now(),
  ) {}

  /** A panel shows it now, in a tab that is in front. */
  get watched(): boolean {
    for (const client of this.clients) if (!this.hidden.has(client)) return true;
    return false;
  }

  /**
   * What it is doing: waiting for the owner once its turn ended (and nothing was sent since),
   * working while it printed in the last PANEL_WORKING_MS after being asked something, else idle.
   */
  state(now: number): { state: PanelState; since: number } {
    const submit = this.lastSubmitAt ?? -Infinity;
    if (this.turnEndedAt !== undefined && this.turnEndedAt >= submit)
      return { state: 'waiting', since: this.turnEndedAt };
    if (
      this.lastSubmitAt !== undefined &&
      this.lastOutputAt !== undefined &&
      now - this.lastOutputAt < PANEL_WORKING_MS
    )
      return { state: 'working', since: this.lastSubmitAt };
    return {
      state: 'idle',
      since: Math.max(this.lastOutputAt ?? this.startedAt, this.turnEndedAt ?? this.startedAt),
    };
  }

  /** Keeps output for replay and notes the modes it sets. */
  record(data: string, at?: number): void {
    if (at !== undefined) this.lastOutputAt = at;
    const text = this.modeTail + data;
    for (const match of text.matchAll(PRIVATE_MODE))
      for (const mode of match[1]!.split(';'))
        if (mode) this.modes.set(Number(mode), match[2] as 'h' | 'l');
    this.modeTail = text.slice(-32);
    this.scrollback += data;
    if (this.scrollback.length > 2 * SCROLLBACK) {
      this.scrollback = this.scrollback.slice(-SCROLLBACK);
      this.trimmed = true;
    }
  }

  /**
   * What a reattached panel is sent: the last SCROLLBACK of output. When older output was
   * dropped, it starts at an escape sequence rather than inside one (or inside a character), and
   * is preceded by the modes set before it, so a full-screen agent (Claude Code) still draws on
   * its alternate screen and gets the mouse wheel after a long conversation.
   */
  replay(): string {
    if (!this.trimmed && this.scrollback.length <= SCROLLBACK) return this.scrollback;
    let text = this.scrollback.slice(-SCROLLBACK);
    const start = text.indexOf('\x1b');
    if (start > 0 && start < 4096) text = text.slice(start);
    const modes = [...this.modes].sort(
      ([a], [b]) => Number(SCREEN_MODES.has(b)) - Number(SCREEN_MODES.has(a)),
    );
    return modes.map(([mode, value]) => `\x1b[?${mode}${value}`).join('') + text;
  }

  broadcast(message: TerminalServerMessage): void {
    for (const client of this.clients) {
      try {
        client.send(message);
      } catch (error) {
        console.error('[pharos] Could not write to a terminal panel:', error);
      }
    }
  }
}

/**
 * The agent terminals (R17): one session per key (the service uses the working folder, so
 * projects that share a repository folder share one agent), reused when its panel reopens (the
 * conversation survives closing the panel). A session is killed
 * with its whole process group when the server stops and after `idleMs` with no panel attached
 * (`sweep`, run every minute by the server; tests call it with a fake clock).
 *
 * Every callback here catches and logs: a session must never end the server (CLAUDE.md).
 */
/** A session's agent exited (by itself, or ended by Pharos), for notifications. */
export type TerminalExit = {
  session: TerminalSession;
  exitCode: number | null;
  signal?: number;
  /** A panel showed it when it exited: the owner saw it happen. */
  watched: boolean;
};

/** A session's agent finished its turn: it waits for the owner. */
export type TerminalTurn = {
  session: TerminalSession;
  /** How Pharos knows: the agent's hook, or output gone quiet after the owner's input. */
  via: 'hook' | 'quiet';
  /** A panel showed it in a visible tab when the turn ended. */
  watched: boolean;
  /** The owner typed in a panel of it in the last TYPING_MS. */
  typing: boolean;
};

/** Typing in a panel this recently means the owner is at it. */
export const TYPING_MS = 5000;
/** Output quiet this long after the owner's input ends the turn (agents without a hook). */
export const QUIET_TURN_MS = 8000;

export class TerminalSessions {
  private readonly sessions = new Map<string, TerminalSession>();
  private readonly exitListeners = new Set<(exit: TerminalExit) => void>();
  private readonly turnListeners = new Set<(turn: TerminalTurn) => void>();
  private readonly now: () => number;
  private readonly idleMs: number;
  private readonly killGroup: (pid: number, signal: NodeJS.Signals) => void;

  constructor(
    private readonly spawn: PtySpawn,
    options: {
      now?: () => number;
      idleMs?: number;
      /** Signals a process group (tests record it instead). */
      killGroup?: (pid: number, signal: NodeJS.Signals) => void;
    } = {},
  ) {
    this.now = options.now ?? Date.now;
    this.idleMs = options.idleMs ?? 30 * 60_000;
    this.killGroup = options.killGroup ?? ((pid, signal) => process.kill(-pid, signal));
  }

  get(key: string): TerminalSession | undefined {
    const session = this.sessions.get(key);
    return session && !session.exited ? session : undefined;
  }

  /** The sessions still running. */
  running(): TerminalSession[] {
    return [...this.sessions.values()].filter((s) => !s.exited);
  }

  get size(): number {
    return this.sessions.size;
  }

  /** Calls `fn` when a session's agent exits. Returns an unsubscribe. */
  onExit(fn: (exit: TerminalExit) => void): () => void {
    this.exitListeners.add(fn);
    return () => this.exitListeners.delete(fn);
  }

  /** Calls `fn` when a session's agent finishes a turn. Returns an unsubscribe. */
  onTurn(fn: (turn: TerminalTurn) => void): () => void {
    this.turnListeners.add(fn);
    return () => this.turnListeners.delete(fn);
  }

  /** The running session started with this hook token (PHAROS_TERMINAL_TOKEN). */
  byToken(token: string): TerminalSession | undefined {
    if (!token) return undefined;
    return this.running().find((s) => s.launch.env.PHAROS_TERMINAL_TOKEN === token);
  }

  /** The session's agent finished its turn (its hook said so, or its output went quiet). */
  turnEnded(session: TerminalSession, via: TerminalTurn['via']): TerminalTurn | undefined {
    if (session.exited) return undefined;
    const now = this.now();
    session.turnEndedAt = now;
    const turn: TerminalTurn = {
      session,
      via,
      watched: session.watched,
      typing: session.lastInputAt !== undefined && now - session.lastInputAt < TYPING_MS,
    };
    for (const fn of this.turnListeners) {
      try {
        fn(turn);
      } catch (error) {
        console.error('[pharos] A terminal turn listener failed:', error);
      }
    }
    return turn;
  }

  /**
   * Agents without a hook (Codex): a turn ends when the owner sent something, the agent printed
   * after it, and then nothing for `quietMs`. Run every few seconds by the service.
   */
  checkQuiet(quietMs = QUIET_TURN_MS): TerminalTurn[] {
    const now = this.now();
    const ended: TerminalTurn[] = [];
    for (const session of this.running()) {
      if (session.launch.hooked) continue;
      const submit = session.lastSubmitAt;
      const output = session.lastOutputAt;
      if (submit === undefined || output === undefined || output <= submit) continue;
      if ((session.turnEndedAt ?? -Infinity) >= submit) continue;
      if (now - output < quietMs) continue;
      const turn = this.turnEnded(session, 'quiet');
      if (turn) ended.push(turn);
    }
    return ended;
  }

  /** Whether a panel's tab is in front (it says so on connect and when it changes). */
  visibility(key: string, client: TerminalClient, visible: boolean): void {
    const session = this.sessions.get(key);
    if (!session?.clients.has(client)) return;
    if (visible) session.hidden.delete(client);
    else session.hidden.add(client);
  }

  /**
   * Attaches a panel to the project's session, starting one with `launch()` when none is
   * running. A reattached panel gets the recent output first.
   */
  attach(
    key: string,
    launch: () => TerminalLaunch,
    client: TerminalClient,
    size: { cols: number; rows: number },
  ): TerminalSession {
    let session = this.get(key);
    const replay = Boolean(session);
    if (!session) {
      const exited = this.sessions.get(key);
      // An exited session's panels move to the new one.
      session = this.start(key, launch(), size);
      for (const other of exited?.clients ?? []) {
        session.clients.add(other);
        other.send(startMessage(session, false));
      }
    }
    session.clients.add(client);
    session.detachedAt = undefined;
    client.send(startMessage(session, replay));
    const output = session.replay();
    if (output) client.send({ t: 'o', d: output });
    try {
      session.pty.resize(size.cols, size.rows);
    } catch (error) {
      console.error('[pharos] Could not resize a terminal:', error);
    }
    return session;
  }

  /** A panel went away (closed, reloaded, lost its connection). */
  detach(key: string, client: TerminalClient): void {
    const session = this.sessions.get(key);
    if (!session?.clients.delete(client)) return;
    session.hidden.delete(client);
    if (session.clients.size === 0) session.detachedAt = this.now();
  }

  /** Typing in the panel: to the project's running session only. Enter starts a turn. */
  input(key: string, data: string): void {
    const session = this.get(key);
    if (!session) return;
    const now = this.now();
    session.lastInputAt = now;
    // Enter sends a carriage return (a pasted newline does not submit).
    if (data.includes('\r')) session.lastSubmitAt = now;
    session.pty.write(data);
  }

  resize(key: string, size: { cols: number; rows: number }): void {
    this.get(key)?.pty.resize(size.cols, size.rows);
  }

  /** Ends the project's session and starts a new one for its attached panels (the restart button). */
  restart(
    key: string,
    launch: () => TerminalLaunch,
    size: { cols: number; rows: number },
  ): TerminalSession {
    const old = this.sessions.get(key);
    const clients = old ? [...old.clients] : [];
    // The new one starts first: if it can't, the old one and its panels stay as they were.
    const session = this.start(key, launch(), size);
    if (old) {
      old.endedBy ??= 'restart';
      this.end(old);
    }
    for (const client of clients) {
      session.clients.add(client);
      client.send(startMessage(session, false));
    }
    if (!clients.length) session.detachedAt = this.now();
    return session;
  }

  /**
   * The owner stops the agent (the panel's Stop, the rail's list): its panels hear it ended,
   * then it goes with its process group. Its conversation is kept, so opening the panel again
   * resumes it. Returns whether one was running.
   */
  stop(key: string): boolean {
    const session = this.get(key);
    if (!session) return false;
    session.endedBy ??= 'owner';
    session.broadcast({ t: 'exit', code: null });
    // Ended first: a session already marked exited isn't signalled (its pid may be reused).
    this.end(session);
    session.exited = true;
    return true;
  }

  /** Ends sessions that have had no panel for `idleMs`. Returns the projects ended. */
  sweep(): string[] {
    const ended: string[] = [];
    const now = this.now();
    for (const session of [...this.sessions.values()])
      if (session.exited && session.clients.size === 0) this.sessions.delete(session.key);
      else if (
        session.clients.size === 0 &&
        session.detachedAt !== undefined &&
        now - session.detachedAt >= this.idleMs
      ) {
        session.endedBy ??= 'idle';
        this.end(session);
        ended.push(session.key);
      }
    return ended;
  }

  /** The server is stopping: every session goes, with its process group. */
  killAll(): void {
    for (const session of [...this.sessions.values()]) {
      session.endedBy ??= 'server';
      this.end(session, true);
    }
  }

  private start(
    key: string,
    launch: TerminalLaunch,
    size: { cols: number; rows: number },
  ): TerminalSession {
    const pty = this.spawn(launch.file, launch.args, {
      cwd: launch.cwd,
      env: launch.env,
      cols: size.cols,
      rows: size.rows,
    });
    const session = new TerminalSession(key, launch, pty, this.now());
    this.sessions.set(key, session);
    pty.onData((data) => {
      try {
        session.record(data, this.now());
        session.broadcast({ t: 'o', d: data });
      } catch (error) {
        console.error('[pharos] A terminal output callback failed:', error);
      }
    });
    pty.onExit(({ exitCode, signal }) => {
      try {
        // Kept (exited) so its panels stay attached for a restart; `sweep` drops it once unwatched.
        const watched = session.clients.size > 0;
        session.exited = true;
        session.broadcast({ t: 'exit', code: exitCode, ...(signal ? { signal } : {}) });
        for (const fn of this.exitListeners) {
          try {
            fn({ session, exitCode, ...(signal ? { signal } : {}), watched });
          } catch (error) {
            console.error('[pharos] A terminal exit listener failed:', error);
          }
        }
      } catch (error) {
        console.error('[pharos] A terminal exit callback failed:', error);
      }
    });
    return session;
  }

  /** Stops a session's whole process group: SIGHUP and SIGTERM, then SIGKILL if it lingers. */
  private end(session: TerminalSession, now = false): void {
    if (this.sessions.get(session.key) === session) this.sessions.delete(session.key);
    session.clients.clear();
    // An agent that already exited has nothing left to stop, and its pid may belong to another
    // program by now: never signal it (as `sweep` drops an exited session without a signal).
    if (session.exited) return;
    const pid = session.pty.pid;
    const signal = (sig: NodeJS.Signals) => {
      try {
        this.killGroup(pid, sig);
      } catch {
        // Already gone, or not a group leader: the pty itself then.
        try {
          session.pty.kill(sig);
        } catch {
          // Gone.
        }
      }
    };
    signal('SIGHUP');
    signal('SIGTERM');
    if (now) {
      if (!session.exited) signal('SIGKILL');
      return;
    }
    const timer = setTimeout(() => {
      if (!session.exited) signal('SIGKILL');
    }, 3000);
    timer.unref?.();
  }
}
