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

/**
 * Review documents the owner finished and handed back since this agent last looked: every sheet
 * answered, then archived with `handedBack` by a person. One line each, for project_snapshot, so
 * the agent picks the answers up on its next turn without being told.
 */
export function handedBackLines(store: Store, agent: string, projectId: string): string[] {
  const cursor = store.agentCursor(agent, projectId);
  return store.list('view', { projectId }).flatMap((view) => {
    const back = view.data.handedBack;
    if (!view.data.archived || !back) return [];
    const recent = store
      .history({ entityId: view.id, after: cursor, authorKind: 'human', limit: 20 })
      .some((r) => r.changes.some((c) => c.id === view.id && 'handedBack' in c.fields));
    if (!recent) return [];
    const whom = !back.to || back.to === agent ? 'you' : back.to;
    return [
      `“${view.data.name}” (${view.id}): the owner answered all ${back.answered} and archived it, handed back to ${whom}. Read the answers with view_get.`,
    ];
  });
}
