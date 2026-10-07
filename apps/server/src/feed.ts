import type { Store } from './store/store.js';

export type RevisionEvent = { id: number; projectIds: string[] };

/**
 * Announces new revisions to subscribers (e.g. browsers over SSE). Revisions made in this
 * process are announced right away; ones written by other processes sharing the database
 * (like the stdio MCP server) are picked up by polling.
 */
export class RevisionFeed {
  private lastSeen: number;
  private readonly subscribers = new Set<(event: RevisionEvent) => void>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly store: Store,
    private readonly pollMs = 1000,
  ) {
    this.lastSeen = store.latestRevisionId();
    store.onCommit(() => this.check());
  }

  subscribe(fn: (event: RevisionEvent) => void): () => void {
    this.subscribers.add(fn);
    if (!this.timer && this.pollMs > 0) {
      this.timer = setInterval(() => this.check(), this.pollMs);
      this.timer.unref?.();
    }
    return () => {
      this.subscribers.delete(fn);
      if (!this.subscribers.size && this.timer) {
        clearInterval(this.timer);
        this.timer = undefined;
      }
    };
  }

  /**
   * Announces any revisions newer than the last one seen. Runs from a timer and from commit
   * hooks, so nothing here may throw: a failed read (say, a busy database) is retried on the
   * next poll, and one failing subscriber doesn't stop the others.
   */
  check(): void {
    let fresh: RevisionEvent[];
    try {
      fresh = this.store.revisionsSince(this.lastSeen);
    } catch (error) {
      console.error('[pharos] Could not read new revisions:', error);
      return;
    }
    if (!fresh.length) return;
    this.lastSeen = fresh.at(-1)!.id;
    for (const event of fresh)
      for (const fn of this.subscribers) {
        try {
          fn(event);
        } catch (error) {
          console.error('[pharos] A revision subscriber failed:', error);
        }
      }
  }
}
