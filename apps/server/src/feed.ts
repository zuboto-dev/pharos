import type { Store } from './store/store.js';

export type RevisionEvent = { id: number; projectIds: string[] };

/**
 * New files on a report page (R13.5): uploads aren't revisions, so an open frame learns of them
 * here. One event per view per check, however many of its files arrived in between.
 */
export type ReportAssetsEvent = { type: 'report-assets'; viewId: string; at: string };

/**
 * Announces new revisions to subscribers (e.g. browsers over SSE). Revisions made in this
 * process are announced right away; ones written by other processes sharing the database
 * (like the stdio MCP server) are picked up by polling. Report asset uploads (from any process)
 * are picked up the same way, by their `updated_at`.
 */
export class RevisionFeed {
  private lastSeen: number;
  private lastAsset = '';
  private readonly subscribers = new Set<(event: RevisionEvent) => void>();
  private readonly assetSubscribers = new Set<(event: ReportAssetsEvent) => void>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly store: Store,
    private readonly pollMs = 1000,
  ) {
    this.lastSeen = store.latestRevisionId();
    store.onCommit(() => this.check());
  }

  subscribe(fn: (event: RevisionEvent) => void): () => void {
    return this.watch(this.subscribers, fn);
  }

  /** Calls `fn` when files of a report page are uploaded or replaced. Returns an unsubscribe. */
  subscribeAssets(fn: (event: ReportAssetsEvent) => void): () => void {
    // Only uploads from now on: what came before was loaded with the page.
    if (!this.assetSubscribers.size) this.lastAsset = this.latestAsset();
    return this.watch(this.assetSubscribers, fn);
  }

  private watch<T>(set: Set<T>, fn: T): () => void {
    set.add(fn);
    if (!this.timer && this.pollMs > 0) {
      this.timer = setInterval(() => this.check(), this.pollMs);
      this.timer.unref?.();
    }
    return () => {
      set.delete(fn);
      if (!this.subscribers.size && !this.assetSubscribers.size && this.timer) {
        clearInterval(this.timer);
        this.timer = undefined;
      }
    };
  }

  /**
   * Announces any revisions newer than the last one seen, then any asset uploads. Runs from a
   * timer and from commit hooks, so nothing here may throw: a failed read (say, a busy
   * database) is retried on the next poll, and one failing subscriber doesn't stop the others.
   */
  check(): void {
    this.checkRevisions();
    this.checkAssets();
  }

  private checkRevisions(): void {
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

  private latestAsset(): string {
    try {
      const row = this.store.database
        .prepare('SELECT MAX(updated_at) AS at FROM report_assets')
        .get() as { at: string | null };
      return row.at ?? '';
    } catch (error) {
      console.error('[pharos] Could not read report assets:', error);
      return this.lastAsset;
    }
  }

  private checkAssets(): void {
    if (!this.assetSubscribers.size) return;
    let fresh: { view_id: string; at: string }[];
    try {
      fresh = this.store.database
        .prepare(
          `SELECT view_id, MAX(updated_at) AS at FROM report_assets WHERE updated_at > ?
           GROUP BY view_id ORDER BY at`,
        )
        .all(this.lastAsset) as { view_id: string; at: string }[];
    } catch (error) {
      console.error('[pharos] Could not read new report assets:', error);
      return;
    }
    if (!fresh.length) return;
    this.lastAsset = fresh.at(-1)!.at;
    for (const row of fresh) {
      const event: ReportAssetsEvent = { type: 'report-assets', viewId: row.view_id, at: row.at };
      for (const fn of this.assetSubscribers) {
        try {
          fn(event);
        } catch (error) {
          console.error('[pharos] A report asset subscriber failed:', error);
        }
      }
    }
  }
}
