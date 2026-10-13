import {
  PRESENCE_TTL_MS,
  agentLabel,
  toBoard,
  type PresenceActivity,
  type PresenceEntry,
  type PresenceState,
  type ViewSpec,
} from '@pharos/schema';
import type { RevisionEvent, RevisionFeed } from './feed.js';
import type { Store } from './store/store.js';

/** One place an agent is working: a project, one of its views, or one block of a view. */
export type PresenceTarget = {
  projectId: string;
  viewId?: string;
  widgetId?: string;
  activity: PresenceActivity;
};

type Mark = PresenceTarget & {
  agent: string;
  since: number;
  /** When it expires (ms since epoch); undefined while held. */
  until?: number;
  /** Who set it, so it can be cleared when they stop (an MCP session, the answering run). */
  source: string;
};

const keyOf = (agent: string, t: { projectId: string; viewId?: string; widgetId?: string }) =>
  `${agent}\u0000${t.projectId}\u0000${t.viewId ?? ''}\u0000${t.widgetId ?? ''}`;

/**
 * Who is working where right now (v0.2 B5): an agent is "on" a view or block while it calls the
 * view tools or apply on it, and for `ttlMs` after its last call. The answering run holds a mark
 * on its projects until it ends. Marks clear when the agent stops (its MCP session closes, the run
 * finishes, fails or is paused), so they are never left behind.
 *
 * Kept in memory only: presence is not project data and never a revision. Runs timers and
 * listeners, so nothing here may throw out of a callback (see CLAUDE.md).
 */
export class Presence {
  private readonly marks = new Map<string, Mark>();
  private readonly listeners = new Set<(state: PresenceState) => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly options: { ttlMs?: number; now?: () => number } = {}) {}

  private get ttl(): number {
    return this.options.ttlMs ?? PRESENCE_TTL_MS;
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  /** Marks `agent` as working on `target` for the next `ttlMs` (renewing an existing mark). */
  touch(agent: string, target: PresenceTarget, source = agent): void {
    this.set(agent, target, source, this.now() + this.ttl);
  }

  /** Marks `agent` as working on `target` until the returned release is called. */
  hold(agent: string, target: PresenceTarget, source = agent): () => void {
    const key = this.set(agent, target, source, undefined);
    return () => {
      const mark = this.marks.get(key);
      if (mark && mark.until === undefined && mark.source === source) {
        this.marks.delete(key);
        this.changed();
      }
    };
  }

  private set(
    rawAgent: string,
    target: PresenceTarget,
    source: string,
    until: number | undefined,
  ): string {
    const agent = agentLabel(rawAgent);
    const key = keyOf(agent, target);
    const was = this.marks.get(key);
    // A held mark (an answering run) isn't shortened by a touch on the same place.
    const keep = was && was.until === undefined && until !== undefined;
    this.marks.set(key, {
      ...target,
      agent,
      source: keep ? was.source : source,
      since: was?.since ?? this.now(),
      until: keep ? undefined : until,
      // A newer call says what the agent does there now, except that answering stays answering.
      activity: keep ? was.activity : target.activity,
    });
    this.changed();
    return key;
  }

  /** Clears every mark set by `source` (an MCP session that closed, a run that ended). */
  clearSource(source: string): void {
    let removed = false;
    for (const [key, mark] of this.marks)
      if (mark.source === source) {
        this.marks.delete(key);
        removed = true;
      }
    if (removed) this.changed();
  }

  /**
   * Clears the marks in `projectIds` that started at or after `since` by the answering run's
   * agent: what it did over MCP, once the run is over (its MCP session may not close by itself).
   * The agent is `agent`, or else whoever holds a run's mark (source "runner:…") there. Other
   * agents working in the same project keep their marks (v0.2 review, gap 12).
   */
  clearProjects(projectIds: readonly string[], since: number, agent?: string): void {
    const agents = new Set(
      agent
        ? [agentLabel(agent)]
        : [...this.marks.values()]
            .filter((m) => m.source.startsWith('runner:') && projectIds.includes(m.projectId))
            .map((m) => m.agent),
    );
    let removed = false;
    for (const [key, mark] of this.marks)
      if (projectIds.includes(mark.projectId) && mark.since >= since && agents.has(mark.agent)) {
        this.marks.delete(key);
        removed = true;
      }
    if (removed) this.changed();
  }

  /**
   * Every live mark, with how long each has left. A mark found expired here (before its timer
   * ran) is removed and the removal published, so listeners never keep it (v0.2 review, gap 12).
   */
  state(): PresenceState {
    const now = this.now();
    if (this.prune(now)) this.changed();
    return this.snapshot(now);
  }

  private snapshot(now: number): PresenceState {
    const entries: PresenceEntry[] = [...this.marks.values()].map((m) => ({
      agent: m.agent,
      projectId: m.projectId,
      ...(m.viewId ? { viewId: m.viewId } : {}),
      ...(m.widgetId ? { widgetId: m.widgetId } : {}),
      activity: m.activity,
      since: new Date(m.since).toISOString(),
      ...(m.until !== undefined ? { expiresInMs: Math.max(0, m.until - now) } : {}),
    }));
    return { entries };
  }

  /** Calls `fn` with the new state whenever a mark appears, changes, or goes. */
  subscribe(fn: (state: PresenceState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Stops the expiry timer (tests, shutdown). */
  dispose(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.listeners.clear();
  }

  private prune(now: number): boolean {
    let removed = false;
    for (const [key, mark] of this.marks)
      if (mark.until !== undefined && mark.until <= now) {
        this.marks.delete(key);
        removed = true;
      }
    return removed;
  }

  private changed(): void {
    const now = this.now();
    this.prune(now);
    const state = this.snapshot(now);
    for (const fn of this.listeners) {
      try {
        fn(state);
      } catch (error) {
        console.error('[pharos] A presence listener failed:', error);
      }
    }
    this.schedule();
  }

  /** Wakes up when the next mark expires, to clear it and tell the listeners. */
  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    let next = Infinity;
    for (const mark of this.marks.values())
      if (mark.until !== undefined) next = Math.min(next, mark.until);
    if (next === Infinity) return;
    this.timer = setTimeout(
      () => {
        try {
          this.timer = undefined;
          if (this.prune(this.now())) this.changed();
          else this.schedule();
        } catch (error) {
          console.error('[pharos] Presence expiry failed:', error);
        }
      },
      Math.max(0, next - this.now()) + 5,
    );
    this.timer.unref?.();
  }
}

/** The widget ids a view change added or changed (removed blocks are gone, so not marked). */
export function changedWidgets(before: unknown, after: unknown): string[] {
  const widgets = (spec: unknown) => {
    try {
      return spec && typeof spec === 'object' ? toBoard(spec as ViewSpec).widgets : [];
    } catch {
      return [];
    }
  };
  const was = new Map(widgets(before).map((w) => [w.id, JSON.stringify(w)]));
  return widgets(after)
    .filter((w) => was.get(w.id) !== JSON.stringify(w))
    .map((w) => w.id);
}

/**
 * Marks agents from their saved revisions, whichever process wrote them (the stdio MCP server, a
 * REST client with an agent author): the project for any change, and a view and its changed
 * blocks for a view change. Returns an unsubscribe.
 */
export function watchAgentRevisions(store: Store, feed: RevisionFeed, presence: Presence) {
  return feed.subscribe((event: RevisionEvent) => {
    try {
      const revision = store.revision(event.id);
      if (!revision || revision.author.kind !== 'agent') return;
      const agent = revision.author.name;
      const source = `revisions:${agentLabel(agent)}`;
      for (const projectId of event.projectIds)
        presence.touch(agent, { projectId, activity: 'working' }, source);
      for (const change of revision.changes) {
        if (change.type !== 'view' || change.op === 'delete') continue;
        const projectId =
          (store.get(change.id)?.data as { projectId?: string } | undefined)?.projectId ??
          event.projectIds[0];
        if (!projectId) continue;
        presence.touch(agent, { projectId, viewId: change.id, activity: 'editing' }, source);
        const spec = change.fields.spec;
        if (spec)
          for (const widgetId of changedWidgets(spec.before, spec.after))
            presence.touch(
              agent,
              { projectId, viewId: change.id, widgetId, activity: 'editing' },
              source,
            );
      }
    } catch (error) {
      console.error('[pharos] Could not mark an agent from its revision:', error);
    }
  });
}
