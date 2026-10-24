import {
  AGENTS_RECENT_MS,
  ENTITIES,
  agentLabel,
  type AgentPanelRow,
  type AgentsOverview,
  type AnsweringRow,
  type ConnectedAgentRow,
  type Entity,
  type PresenceState,
  type RoutineRunRow,
} from '@pharos/schema';
import type { AgentStatus } from './agent-runner.js';
import type { RunLog } from './desk.js';
import type { LookupLog } from './lookups.js';
import type { Store } from './store/store.js';

/**
 * The Agents page (GET /api/agents): who works with Pharos right now, in one look. Built from
 * what the server keeps anyway: the agent panels' sessions, presence marks, recent revisions and
 * lookups by agents, the answering agent's status and runs that haven't ended. Nothing here reads
 * a file, and nothing is stored.
 */
export type AgentsSources = {
  store: Store;
  presence: { state(): PresenceState };
  runs: RunLog;
  lookups: LookupLog;
  panels?: () => AgentPanelRow[];
  answering?: () => AgentStatus | undefined;
  now?: Date;
  /** The reader is an agent: panels leave out their folders. */
  forAgent?: boolean;
  /** The request came from this computer (panels can be stopped). */
  local?: boolean;
};

/** Routine and night runs still running are listed when they started this recently. */
const RUN_WINDOW_MS = 24 * 3600_000;

/** Short words for what a read tool did, when the thing read has no name. */
const TOOL_WORDS: Record<string, string> = {
  project_snapshot: 'Read the project',
  list: 'Listed records',
  get: 'Read a record',
  desk_list: 'Read the desk',
  history_list: 'Read the history',
  history_diff: 'Compared versions',
  changes_since: 'Read what changed',
  view_list: 'Listed the views',
  view_get: 'Read a view',
  report_asset_list: 'Listed a report’s files',
};

export function agentsOverview(sources: AgentsSources): AgentsOverview {
  const { store } = sources;
  const now = sources.now ?? new Date();
  const since = new Date(now.getTime() - AGENTS_RECENT_MS).toISOString();
  const names = new Map<string, string>();
  const projectName = (id: string): string | undefined => {
    if (!names.has(id)) {
      const p = store.get(id);
      names.set(id, p?.type === 'project' ? (p as Entity<'project'>).data.name : '');
    }
    return names.get(id) || undefined;
  };
  const labelOf = (id: string | null): string | null => {
    if (!id) return null;
    const known = store.lastKnown(id);
    const value = known
      ? (known.data as Record<string, unknown>)[ENTITIES[known.type].label]
      : null;
    return typeof value === 'string' && value ? value : null;
  };

  // ---------------------------------------------------------------- agent panels
  const panels = (sources.panels?.() ?? []).map((p) => {
    if (!sources.forAgent) return p;
    const rest = { ...p };
    delete rest.cwd;
    return rest;
  });

  // ---------------------------------------------------------------- other agents
  type Acc = { live: boolean; projects: Set<string>; last?: ConnectedAgentRow['last'] };
  const agents = new Map<string, Acc>();
  const acc = (name: string): Acc => {
    const label = agentLabel(name);
    let a = agents.get(label);
    if (!a) agents.set(label, (a = { live: false, projects: new Set() }));
    return a;
  };
  const newer = (a: Acc, last: NonNullable<Acc['last']>) => {
    if (!a.last || last.at > a.last.at) a.last = last;
  };
  for (const entry of sources.presence.state().entries) {
    const a = acc(entry.agent);
    a.live = true;
    a.projects.add(entry.projectId);
  }
  const projectsOf = store.database.prepare(
    'SELECT DISTINCT project_id AS id FROM changes WHERE revision_id = ? AND project_id IS NOT NULL',
  );
  for (const revision of store.history({ authorKind: 'agent', limit: 200 })) {
    if (revision.createdAt < since) break;
    const a = acc(revision.author.name);
    const ids = (projectsOf.all(revision.id) as { id: string }[]).map((r) => r.id);
    for (const id of ids) a.projects.add(id);
    newer(a, {
      kind: 'revision',
      text: revision.message,
      at: revision.createdAt,
      ...(ids[0] ? { projectId: ids[0] } : {}),
    });
  }
  for (const row of sources.lookups.list({ since })) {
    const a = acc(row.agent);
    if (row.projectId) a.projects.add(row.projectId);
    const label = labelOf(row.targetId);
    newer(a, {
      kind: 'lookup',
      text: label ? `Looked up “${label}”` : (TOOL_WORDS[row.tool] ?? 'Looked something up'),
      at: row.at,
      ...(row.projectId ? { projectId: row.projectId } : {}),
    });
  }
  const connected: ConnectedAgentRow[] = [...agents]
    .map(([agent, a]) => ({
      agent,
      live: a.live,
      projects: [...a.projects]
        .map((id) => ({ id, name: projectName(id) }))
        .filter((p): p is { id: string; name: string } => Boolean(p.name)),
      ...(a.last ? { last: a.last } : {}),
    }))
    .sort(
      (x, y) =>
        Number(y.live) - Number(x.live) || (y.last?.at ?? '').localeCompare(x.last?.at ?? ''),
    );

  // ---------------------------------------------------------------- answering, runs
  const status = sources.answering?.();
  const answering: AnsweringRow = {
    state: status?.state ?? 'unavailable',
    ...(status?.agent ? { agent: status.agent } : {}),
    ...(status?.run
      ? { run: { projectIds: status.run.projectIds, startedAt: status.run.startedAt } }
      : {}),
    queued: status?.queued.length ?? 0,
    ...(status?.lastRun
      ? {
          lastRun: {
            ...(status.lastRun.outcome ? { outcome: status.lastRun.outcome } : {}),
            ...(status.lastRun.finishedAt ? { finishedAt: status.lastRun.finishedAt } : {}),
          },
        }
      : {}),
  };
  const runSince = new Date(now.getTime() - RUN_WINDOW_MS).toISOString();
  const runs: RoutineRunRow[] = sources.runs
    .list({ limit: 200 })
    .filter(
      (r) =>
        !r.endedAt &&
        r.outcome === 'running' &&
        (r.kind === 'routine' || r.kind === 'night') &&
        r.startedAt >= runSince,
    )
    .map((r) => {
      const project = r.projectId ? projectName(r.projectId) : undefined;
      return {
        id: r.id,
        name: r.name,
        kind: r.kind,
        agent: agentLabel(r.agent),
        ...(r.projectId ? { projectId: r.projectId } : {}),
        ...(project ? { project } : {}),
        startedAt: r.startedAt,
      };
    });

  // ---------------------------------------------------------------- the glance
  const counts = { working: 0, waiting: 0, idle: 0 };
  for (const p of panels) counts[p.state] += 1;
  for (const c of connected) counts[c.live ? 'working' : 'idle'] += 1;
  // The answering row is listed whenever answering is set up, idle unless a run is on.
  if (answering.state === 'running' || answering.state === 'stopping') counts.working += 1;
  else if (answering.state !== 'unavailable') counts.idle += 1;
  counts.working += runs.length;

  return {
    at: now.toISOString(),
    counts,
    panels,
    connected,
    answering,
    runs,
    local: sources.local ?? false,
  };
}
