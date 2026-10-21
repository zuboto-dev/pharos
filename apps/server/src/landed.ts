import type { Store } from './store/store.js';

/**
 * What agents landed since the owner last looked at the desk (R16, the Routines morning report's
 * "what landed", now in Pharos): agent revisions after the desk's seen mark, by project. The mark
 * is an app setting (never a revision); a person moves it by opening the desk.
 */

export const DESK_SEEN_SETTING = 'desk.seen';

export type Landed = {
  /** The revision the owner last saw on the desk (0: never; the last day is shown). */
  since: number;
  /** Projects agents changed since then, the busiest first. */
  projects: {
    projectId: string;
    project: string;
    revisions: number;
    agents: string[];
    /** The newest change's message and time. */
    latest: { message: string; at: string };
  }[];
};

export function landedSince(store: Store, now = new Date()): Landed {
  const seen = store.setting<number>(DESK_SEEN_SETTING);
  const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
  // One query: agents' revisions after the mark (or in the last day), with the projects each one
  // changed, oldest first.
  const rows = store.database
    .prepare(
      `SELECT r.id AS id, r.author_name AS agent, r.message AS message, r.created_at AS at,
              c.project_id AS projectId
         FROM revisions r JOIN changes c ON c.revision_id = r.id
        WHERE r.id > ? AND r.author_kind = 'agent' AND c.project_id IS NOT NULL
          AND (? IS NOT NULL OR r.created_at >= ?)
        GROUP BY r.id, c.project_id
        ORDER BY r.id`,
    )
    .all(seen ?? 0, seen ?? null, dayAgo) as {
    id: number;
    agent: string;
    message: string;
    at: string;
    projectId: string;
  }[];
  const names = new Map(store.list('project').map((p) => [p.id, p.data.name]));
  const byProject = new Map<string, Landed['projects'][number]>();
  for (const row of rows) {
    const project = names.get(row.projectId);
    if (project === undefined) continue;
    const entry = byProject.get(row.projectId) ?? {
      projectId: row.projectId,
      project,
      revisions: 0,
      agents: [],
      latest: { message: row.message, at: row.at },
    };
    entry.revisions += 1;
    if (!entry.agents.includes(row.agent)) entry.agents.push(row.agent);
    if (row.at >= entry.latest.at) entry.latest = { message: row.message, at: row.at };
    byProject.set(row.projectId, entry);
  }
  return {
    since: seen ?? 0,
    projects: [...byProject.values()].sort(
      (a, b) => b.revisions - a.revisions || b.latest.at.localeCompare(a.latest.at),
    ),
  };
}

/** The owner has looked at the desk: news before the latest revision is no longer news. */
export function markDeskSeen(store: Store): number {
  const latest = store.latestRevisionId();
  store.setSetting(DESK_SEEN_SETTING, latest);
  return latest;
}
