import { AgentFiles } from '../store/agent-files.js';
import type { Store } from '../store/store.js';

const FIRST_LOOK = 20;

/**
 * What others changed in a project since this agent last looked, then (by default) marks it as
 * seen. Agents rarely remember between sessions, so Pharos keeps the place for them.
 */
export function changesSince(
  store: Store,
  agent: string,
  projectId: string,
  options: { mark?: boolean; onlyPeople?: boolean } = {},
) {
  store.getOfType('project', projectId);
  const cursor = store.agentCursor(agent, projectId);
  const latest = store.latestRevisionId();
  // Agents see file details only, and nothing of hidden files (R7.5).
  const revisions = new AgentFiles(store).revisions(
    store.history({
      projectId,
      after: cursor,
      excludeAuthor: agent,
      authorKind: options.onlyPeople ? 'human' : undefined,
      limit: cursor ? 200 : FIRST_LOOK,
    }),
  );
  if (options.mark ?? true) store.setAgentCursor(agent, projectId, latest);
  return {
    since: cursor || null,
    note: cursor
      ? undefined
      : `First look at this project: showing the ${FIRST_LOOK} most recent changes by others.`,
    count: revisions.length,
    revisions: revisions.map((r) => ({
      id: r.id,
      author: `${r.author.kind}:${r.author.name}`,
      message: r.message,
      at: r.createdAt,
      changes: r.changes.map((c) => ({
        op: c.op,
        type: c.type,
        id: c.id,
        label: c.label,
        fields: Object.keys(c.fields),
      })),
    })),
  };
}

/** How many revisions by others this agent hasn't seen yet in a project. */
export function unseenCount(store: Store, agent: string, projectId: string): number {
  return new AgentFiles(store).revisions(
    store.history({
      projectId,
      after: store.agentCursor(agent, projectId),
      excludeAuthor: agent,
      limit: 200,
    }),
  ).length;
}
