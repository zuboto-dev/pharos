import { FILES_UNADDED_TOOL, FILE_TEXT_TOOL } from '@pharos/schema';
import type { Store } from './store/store.js';

/**
 * The read log behind "looked up" on the Updates page: one row per MCP read call an agent makes
 * (which tool, on what, in which project, when). An app table like runs, never project data and
 * never a revision; kept to the last LOOKUP_DAYS days and LOOKUP_MAX rows.
 */

export const LOOKUP_DAYS = 30;
export const LOOKUP_MAX = 5000;

/** The MCP tools that read project data, and the argument naming what each one read. */
export const LOOKUP_TOOLS: Record<string, { target?: string; type?: string }> = {
  project_snapshot: { target: 'projectId' },
  list: { type: 'type' },
  get: { target: 'id' },
  desk_list: {},
  history_list: { target: 'entityId' },
  history_diff: {},
  changes_since: {},
  view_list: {},
  view_get: { target: 'viewId' },
  report_asset_list: { target: 'viewId' },
  [FILE_TEXT_TOOL]: { target: 'fileId' },
  [FILES_UNADDED_TOOL]: {},
};

export type LookupRow = {
  id: number;
  at: string;
  agent: string;
  projectId: string | null;
  tool: string;
  targetId: string | null;
  targetType: string | null;
};

type Row = {
  id: number;
  at: string;
  agent: string;
  project_id: string | null;
  tool: string;
  target_id: string | null;
  target_type: string | null;
};

const str = (v: unknown) => (typeof v === 'string' && v.length <= 200 ? v : null);

export class LookupLog {
  constructor(
    private readonly store: Store,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private get db() {
    return this.store.database;
  }

  /**
   * Records one read call. Never throws: a log that fails must not fail the agent's read.
   * Tools not in LOOKUP_TOOLS are ignored.
   */
  record(agent: string, tool: string, args: unknown): void {
    const spec = LOOKUP_TOOLS[tool];
    if (!spec) return;
    try {
      const input = (args && typeof args === 'object' ? args : {}) as Record<string, unknown>;
      const targetId = spec.target ? str(input[spec.target]) : null;
      let projectId = str(input.projectId);
      let targetType = spec.type ? str(input[spec.type]) : null;
      if (targetId) {
        const entity = this.store.get(targetId);
        if (entity) {
          targetType = entity.type;
          const own = (entity.data as { projectId?: unknown }).projectId;
          if (entity.type === 'project') projectId = entity.id;
          else if (typeof own === 'string') projectId = own;
        }
      }
      if (projectId && this.store.get(projectId)?.type !== 'project') projectId = null;
      const at = this.now();
      this.db
        .prepare(
          `INSERT INTO lookups (at, agent, project_id, tool, target_id, target_type)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(at.toISOString(), agent, projectId, tool, targetId, targetType);
      this.prune(at);
    } catch (err) {
      console.error('Could not record a lookup:', err);
    }
  }

  /** Drops rows older than LOOKUP_DAYS and beyond the newest LOOKUP_MAX. */
  prune(now = this.now()): void {
    const cutoff = new Date(now.getTime() - LOOKUP_DAYS * 86_400_000).toISOString();
    this.db.prepare('DELETE FROM lookups WHERE at < ?').run(cutoff);
    this.db
      .prepare(
        `DELETE FROM lookups WHERE id <= (SELECT id FROM lookups ORDER BY id DESC LIMIT 1 OFFSET ?)`,
      )
      .run(LOOKUP_MAX);
  }

  /** Lookups in [since, until), oldest first. */
  list(
    options: { since: string; until?: string; projectId?: string; agent?: string } = {
      since: '',
    },
  ): LookupRow[] {
    const clauses = ['at >= ?'];
    const params: string[] = [options.since];
    if (options.until) {
      clauses.push('at < ?');
      params.push(options.until);
    }
    if (options.projectId) {
      clauses.push('project_id = ?');
      params.push(options.projectId);
    }
    if (options.agent) {
      clauses.push('agent = ?');
      params.push(options.agent);
    }
    const rows = this.db
      .prepare(`SELECT * FROM lookups WHERE ${clauses.join(' AND ')} ORDER BY id LIMIT ?`)
      .all(...params, LOOKUP_MAX) as Row[];
    return rows.map((r) => ({
      id: r.id,
      at: r.at,
      agent: r.agent,
      projectId: r.project_id,
      tool: r.tool,
      targetId: r.target_id,
      targetType: r.target_type,
    }));
  }
}
