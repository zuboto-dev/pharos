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

/** At most this many revisions are read; older news is folded into the counts it already has. */
const READ_LIMIT = 2000;

export function landedSince(store: Store, now = new Date()): Landed {
  const seen = store.setting<number>(DESK_SEEN_SETTING);
  const dayAgo = new Date(now.getTime() - 86_400_000).toISOString();
  const rows = store
    .revisionsSince(seen ?? 0)
    .slice(-READ_LIMIT)
    .map((r) => ({ ...r, revision: store.revision(r.id) }));
  const byProject = new Map<string, Landed['projects'][number]>();
  for (const { projectIds, revision } of rows) {
    if (!revision || revision.author.kind !== 'agent') continue;
    if (seen === undefined && revision.createdAt < dayAgo) continue;
    for (const projectId of projectIds) {
      const project = store.get(projectId);
      if (project?.type !== 'project') continue;
      const entry = byProject.get(projectId) ?? {
        projectId,
        project: (project.data as { name: string }).name,
        revisions: 0,
        agents: [],
        latest: { message: revision.message, at: revision.createdAt },
      };
      entry.revisions += 1;
      if (!entry.agents.includes(revision.author.name)) entry.agents.push(revision.author.name);
      if (revision.createdAt >= entry.latest.at)
        entry.latest = { message: revision.message, at: revision.createdAt };
      byProject.set(projectId, entry);
    }
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
