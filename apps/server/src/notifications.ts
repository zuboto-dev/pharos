import {
  NOTIFICATION_PREFS_SETTING,
  NOTIFICATION_PREF_KINDS,
  notificationPrefsOf,
  type Entity,
  type NotificationKind,
  type NotificationList,
  type NotificationPrefs,
  type PharosNotification,
} from '@pharos/schema';
import { deskOf, type RunLog } from './desk.js';
import type { RevisionFeed } from './feed.js';
import type { Store } from './store/store.js';
import { presetLabel } from './terminal/command.js';
import type { TerminalExit } from './terminal/sessions.js';
import { projectFreshness } from './views/freshness.js';

/**
 * Notifications: what happened while the owner was away, from what the server already knows.
 *
 * - desk: a decision, sheet or task new on the desk (or back from "later")
 * - run: a run in the run log failed or was partly done; the answering agent failed
 * - terminal: an agent in a panel finished, or was stopped after a while with no panel
 * - stale: an agent's change made a page an agent wrote out of date (R11)
 * - handback: a review handed back that no agent picked up for `handbackHours`
 * - system: Pharos restarted under a running agent terminal (the one modal)
 *
 * They are kept (the `notifications` table, not revisions), so a bell opened hours later lists
 * what happened while no tab was open; each new one is also sent on the change feed. Only what
 * happened after notifications started (`notifications.since`) notifies, so turning this on
 * never floods the bell with the old desk.
 */

/** Set once, the first time this runs: older desk items and runs don't notify. */
export const NOTIFICATIONS_SINCE_SETTING = 'notifications.since';
/** Agent terminals running when the server stopped, for the modal on the next start. */
export const INTERRUPTED_SETTING = 'notifications.interrupted';

export type NewNotification = {
  /** Makes it happen once (unique across restarts). */
  key: string;
  kind: NotificationKind;
  title: string;
  detail?: string;
  projectId?: string;
  href?: string;
  action?: string;
  gate?: boolean;
  modal?: boolean;
};

type Row = {
  id: number;
  key: string;
  kind: string;
  title: string;
  detail: string | null;
  project_id: string | null;
  href: string | null;
  action: string | null;
  gate: number;
  modal: number;
  created_at: string;
  read_at: string | null;
};

type AgentLike = {
  onChange(
    fn: (status: {
      lastRun?: { outcome?: string; finishedAt?: string; projectIds?: string[] };
    }) => void,
  ): () => void;
};

type TerminalLike = { onExit(fn: (exit: TerminalExit) => void): () => void };

const clip = (text: string, max = 160) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

export class Notifications {
  private readonly listeners = new Set<(n: PharosNotification) => void>();
  /** Stale pages already known (at start, or notified): a page notifies when it becomes stale. */
  private readonly knownStale = new Set<string>();
  private primed = false;
  private readonly pendingStale = new Set<string>();
  private deskTimer: ReturnType<typeof setTimeout> | undefined;
  private staleTimer: ReturnType<typeof setTimeout> | undefined;
  private interval: ReturnType<typeof setInterval> | undefined;
  private readonly stops: (() => void)[] = [];
  readonly since: string;

  constructor(
    private readonly store: Store,
    private readonly runs: RunLog,
    private readonly now: () => Date = () => new Date(),
  ) {
    let since = store.setting<string>(NOTIFICATIONS_SINCE_SETTING);
    if (!since) {
      since = this.now().toISOString();
      store.setSetting(NOTIFICATIONS_SINCE_SETTING, since);
    }
    this.since = since;
  }

  private get db() {
    return this.store.database;
  }

  // ------------------------------------------------------------------ preferences

  prefs(): NotificationPrefs {
    return notificationPrefsOf(this.store.setting(NOTIFICATION_PREFS_SETTING));
  }

  setPrefs(prefs: NotificationPrefs): NotificationPrefs {
    this.store.setSetting(NOTIFICATION_PREFS_SETTING, prefs);
    return this.prefs();
  }

  /** The kinds that show at all (off kinds aren't even in the bell); `system` always does. */
  private shownKinds(prefs = this.prefs()): string[] {
    return [...NOTIFICATION_PREF_KINDS.filter((k) => prefs.kinds[k].on), 'system'];
  }

  // ------------------------------------------------------------------ the log

  subscribe(fn: (n: PharosNotification) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private toNotification(row: Row): PharosNotification {
    const project = row.project_id ? this.store.get(row.project_id) : null;
    return {
      id: row.id,
      kind: row.kind as NotificationKind,
      title: row.title,
      ...(row.detail ? { detail: row.detail } : {}),
      ...(row.project_id ? { projectId: row.project_id } : {}),
      ...(project?.type === 'project' ? { project: (project as Entity<'project'>).data.name } : {}),
      ...(row.href ? { href: row.href } : {}),
      ...(row.action ? { action: row.action } : {}),
      gate: row.gate === 1,
      modal: row.modal === 1,
      at: row.created_at,
      ...(row.read_at ? { readAt: row.read_at } : {}),
    };
  }

  /** Records one (once per key) and tells subscribers; null when its key was already used. */
  add(input: NewNotification): PharosNotification | null {
    const result = this.db
      .prepare(
        `INSERT OR IGNORE INTO notifications (key, kind, title, detail, project_id, href, action,
           gate, modal, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.key,
        input.kind,
        clip(input.title, 200),
        input.detail ? clip(input.detail, 300) : null,
        input.projectId ?? null,
        input.href ?? null,
        input.action ?? null,
        input.gate ? 1 : 0,
        input.modal ? 1 : 0,
        this.now().toISOString(),
      );
    if (!result.changes) return null;
    const row = this.db
      .prepare('SELECT * FROM notifications WHERE id = ?')
      .get(Number(result.lastInsertRowid)) as Row;
    const notification = this.toNotification(row);
    if (this.shownKinds().includes(notification.kind))
      for (const fn of this.listeners) {
        try {
          fn(notification);
        } catch (error) {
          console.error('[pharos] A notification subscriber failed:', error);
        }
      }
    return notification;
  }

  /** The newest first (only kinds that are on), with the unread count. */
  list(options: { since?: number; limit?: number } = {}): NotificationList {
    const kinds = this.shownKinds();
    const marks = kinds.map(() => '?').join(',');
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const rows = this.db
      .prepare(
        `SELECT * FROM notifications WHERE kind IN (${marks}) AND id > ? ORDER BY id DESC LIMIT ?`,
      )
      .all(...kinds, options.since ?? 0, limit) as Row[];
    const { unread } = this.db
      .prepare(
        `SELECT COUNT(*) AS unread FROM notifications WHERE kind IN (${marks}) AND read_at IS NULL`,
      )
      .get(...kinds) as { unread: number };
    const { latest } = this.db
      .prepare('SELECT COALESCE(MAX(id), 0) AS latest FROM notifications')
      .get() as { latest: number };
    return { items: rows.map((r) => this.toNotification(r)), unread, latest };
  }

  /** Marks these read, or every one when no ids are given. Returns how many changed. */
  markRead(ids?: number[]): number {
    const at = this.now().toISOString();
    if (!ids)
      return Number(
        this.db.prepare('UPDATE notifications SET read_at = ? WHERE read_at IS NULL').run(at)
          .changes,
      );
    let changed = 0;
    const update = this.db.prepare(
      'UPDATE notifications SET read_at = ? WHERE id = ? AND read_at IS NULL',
    );
    for (const id of ids) changed += Number(update.run(at, id).changes);
    return changed;
  }

  // ------------------------------------------------------------------ sources

  /** New desk items and runs that need a look, since notifications started. */
  checkDesk(): PharosNotification[] {
    const added: PharosNotification[] = [];
    const desk = deskOf(this.store, this.runs, { now: this.now() });
    for (const item of desk.items) {
      if (item.since <= this.since) continue;
      const run = item.kind === 'run';
      const n = this.add({
        key: run ? `run:${item.id}:${item.title}` : `desk:${item.id}:${item.since}`,
        kind: run ? 'run' : 'desk',
        title: item.title,
        ...(item.ask ? { detail: item.ask } : {}),
        ...(item.projectId ? { projectId: item.projectId } : {}),
        href: item.href,
        action: item.kind === 'decision' || item.kind === 'sheet' ? 'Answer' : 'Open',
        gate: item.gate,
      });
      if (n) added.push(n);
    }
    return added;
  }

  /** The answering agent's run ended badly. */
  agentRun(lastRun: { outcome?: string; finishedAt?: string; projectIds?: string[] } | undefined) {
    if (!lastRun?.finishedAt || lastRun.finishedAt <= this.since) return null;
    if (lastRun.outcome !== 'failed' && lastRun.outcome !== 'timed_out') return null;
    const projectId = lastRun.projectIds?.length === 1 ? lastRun.projectIds[0] : undefined;
    return this.add({
      key: `answer:${lastRun.finishedAt}`,
      kind: 'run',
      title: lastRun.outcome === 'timed_out' ? 'Answering timed out' : 'Answering failed',
      detail: 'The agent answering questions stopped before it finished',
      ...(projectId ? { projectId } : {}),
      href: '/settings',
      action: 'Open',
    });
  }

  /** An agent terminal ended: finished by itself, or stopped with no panel for a while. */
  terminalExited(exit: TerminalExit): PharosNotification | null {
    const { session } = exit;
    // The owner saw it, restarted it, or Pharos is stopping (the next start says so).
    if (exit.watched || session.endedBy === 'restart' || session.endedBy === 'server') return null;
    const projectIds = (session.launch.env.PHAROS_PROJECT_IDS ?? '').split(',').filter(Boolean);
    const first = projectIds[0];
    const agent = presetLabel(session.launch.preset);
    const idle = session.endedBy === 'idle';
    const at = this.now().toISOString();
    return this.add({
      key: `terminal:${session.key}:${at}`,
      kind: 'terminal',
      title: idle ? `${agent} stopped` : `${agent} finished`,
      detail: idle
        ? 'No panel was open for a while, so Pharos stopped it'
        : exit.exitCode
          ? `It exited with code ${exit.exitCode}`
          : 'It exited by itself',
      ...(first ? { projectId: first } : {}),
      ...(first ? { href: `/projects/${first}?terminal=1` } : {}),
      action: 'Open',
    });
  }

  /** Pages of these projects that an agent's change just made out of date. */
  checkStale(projectIds: Iterable<string>): PharosNotification[] {
    const added: PharosNotification[] = [];
    for (const projectId of projectIds) {
      const project = this.store.get(projectId);
      if (project?.type !== 'project') continue;
      let views;
      try {
        views = projectFreshness(this.store, projectId).views;
      } catch (error) {
        console.error('[pharos] Could not work out which pages are out of date:', error);
        continue;
      }
      for (const f of Object.values(views)) {
        const evidence = f.evidence;
        if (!evidence || 'unknown' in evidence || !evidence.stale) continue;
        const key = `stale:${f.viewId}:${evidence.revision}`;
        if (this.knownStale.has(key)) continue;
        this.knownStale.add(key);
        if (!this.primed) continue;
        const view = this.store.get(f.viewId) as Entity<'view'> | null;
        if (!view || view.data.archived) continue;
        // The owner's own answers making a page stale isn't news to them.
        const by = evidence.stale.recent[0]?.author;
        if (!by || by.kind === 'human') continue;
        const n = this.add({
          key,
          kind: 'stale',
          title: `“${view.data.name}” is out of date`,
          detail: `${evidence.stale.total} ${evidence.stale.total === 1 ? 'change' : 'changes'} since it was written, latest by ${by.name}`,
          projectId,
          href: `/projects/${projectId}/views/${view.id}`,
          action: 'Open',
        });
        if (n) added.push(n);
      }
    }
    return added;
  }

  /** Which pages are stale now, so only pages that become stale later notify. */
  primeStale(): void {
    this.primed = false;
    this.checkStale(this.store.list('project').map((p) => p.id));
    this.primed = true;
  }

  /** Reviews the owner handed back that no agent has picked up for `handbackHours`. */
  checkHandbacks(): PharosNotification[] {
    const added: PharosNotification[] = [];
    const hours = this.prefs().handbackHours;
    const before = this.now().getTime() - hours * 3600_000;
    for (const view of this.store.list('view')) {
      const back = view.data.handedBack;
      if (!view.data.archived || !back) continue;
      const handBack = this.store
        .history({ entityId: view.id, authorKind: 'human', limit: 20 })
        .find((r) => r.changes.some((c) => c.id === view.id && 'handedBack' in c.fields));
      if (!handBack || handBack.createdAt <= this.since) continue;
      if (Date.parse(handBack.createdAt) > before) continue;
      const projectId = view.data.projectId;
      const pickedUp =
        this.store.history({ projectId, after: handBack.id, authorKind: 'agent', limit: 1 })
          .length > 0 ||
        (back.to !== undefined && this.store.agentCursor(back.to, projectId) >= handBack.id);
      if (pickedUp) continue;
      const n = this.add({
        key: `handback:${view.id}:${handBack.id}`,
        kind: 'handback',
        title: `“${view.data.name}” waits for ${back.to ?? 'an agent'}`,
        detail: `Handed back over ${hours} h ago; no agent has picked it up`,
        projectId,
        href: `/projects/${projectId}/views/${view.id}`,
        action: 'Open',
      });
      if (n) added.push(n);
    }
    return added;
  }

  /** At start: the agent terminals the last stop ended, as one modal. */
  checkInterrupted(): PharosNotification | null {
    const interrupted =
      this.store.setting<{ projectIds: string[]; agent: string; at: string }[]>(
        INTERRUPTED_SETTING,
      );
    if (!interrupted?.length) return null;
    this.store.setSetting(INTERRUPTED_SETTING, []);
    const first = interrupted[0]!;
    const projectId = first.projectIds[0];
    const names = interrupted
      .flatMap((r) => r.projectIds)
      .map((id) => this.store.get(id))
      .filter((p): p is Entity<'project'> => p?.type === 'project')
      .map((p) => p.data.name);
    const agents = [...new Set(interrupted.map((r) => r.agent))].join(', ');
    return this.add({
      key: `system:interrupted:${first.at}`,
      kind: 'system',
      title: 'Pharos restarted; your agent stopped',
      detail: `${agents} was running${names.length ? ` in ${names.join(', ')}` : ''}. Reopen the panel to start it again.`,
      ...(projectId ? { projectId, href: `/projects/${projectId}?terminal=1` } : {}),
      action: 'Reopen',
      modal: true,
    });
  }

  /** Before the server stops: notes the agent terminals that are about to be ended. */
  noteInterrupted(running: { projectIds: string[]; agent: string }[]): void {
    if (!running.length) return;
    const at = this.now().toISOString();
    try {
      this.store.setSetting(
        INTERRUPTED_SETTING,
        running.map((r) => ({ projectIds: r.projectIds, agent: r.agent, at })),
      );
    } catch (error) {
      console.error('[pharos] Could not note the running agents:', error);
    }
  }

  // ------------------------------------------------------------------ wiring

  private safely(what: string, fn: () => unknown): void {
    try {
      fn();
    } catch (error) {
      console.error(`[pharos] Notifications: ${what} failed:`, error);
    }
  }

  /**
   * Starts listening: revisions (debounced) check the desk and the touched projects' pages; a
   * timer checks runs reported from other processes and hand-backs; the answering agent and
   * the agent terminals report their ends. Every callback catches its own errors (CLAUDE.md).
   */
  watch(
    feed: RevisionFeed,
    sources: {
      agent?: AgentLike;
      terminal?: TerminalLike;
      debounceMs?: number;
      everyMs?: number;
    } = {},
  ): () => void {
    const debounceMs = sources.debounceMs ?? 1500;
    this.safely('the interrupted check', () => this.checkInterrupted());
    this.safely('priming stale pages', () => this.primeStale());
    this.stops.push(
      feed.subscribe((event) => {
        for (const id of event.projectIds) this.pendingStale.add(id);
        if (!this.deskTimer)
          this.deskTimer = setTimeout(() => {
            this.deskTimer = undefined;
            this.safely('the desk check', () => this.checkDesk());
          }, debounceMs);
        if (!this.staleTimer)
          this.staleTimer = setTimeout(() => {
            this.staleTimer = undefined;
            const ids = [...this.pendingStale];
            this.pendingStale.clear();
            this.safely('the stale check', () => this.checkStale(ids));
          }, debounceMs);
        this.deskTimer.unref?.();
        this.staleTimer.unref?.();
      }),
    );
    if (sources.agent)
      this.stops.push(
        sources.agent.onChange((status) =>
          this.safely('the answering check', () => this.agentRun(status.lastRun)),
        ),
      );
    if (sources.terminal)
      this.stops.push(
        sources.terminal.onExit((exit) =>
          this.safely('the terminal check', () => this.terminalExited(exit)),
        ),
      );
    const everyMs = sources.everyMs ?? 30_000;
    this.interval = setInterval(() => {
      this.safely('the desk check', () => this.checkDesk());
      this.safely('the hand-back check', () => this.checkHandbacks());
    }, everyMs);
    this.interval.unref?.();
    // What happened while the server was off (runs from other processes, waiting hand-backs).
    this.safely('the desk check', () => this.checkDesk());
    this.safely('the hand-back check', () => this.checkHandbacks());
    return () => this.stop();
  }

  stop(): void {
    clearTimeout(this.deskTimer);
    clearTimeout(this.staleTimer);
    clearInterval(this.interval);
    this.deskTimer = this.staleTimer = this.interval = undefined;
    for (const stop of this.stops.splice(0)) stop();
  }
}
