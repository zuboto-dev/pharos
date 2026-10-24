/**
 * The Agents page (GET /api/agents): every agent working with Pharos right now, from what the
 * server already knows. Agent panels (R17) from the terminal sessions; other agents from presence
 * marks, recent revisions and lookups; the answering agent's state; routine and night runs that
 * haven't ended. Operational state only: no file contents, never revisions.
 */

/** A panel's agent: printing now, its turn ended (waiting on the owner), or quiet. */
export type PanelState = 'working' | 'waiting' | 'idle';

/** A panel printed in the last this-many ms: it is working. */
export const PANEL_WORKING_MS = 10_000;

/** Agents seen through MCP, revisions or lookups in this window are listed. */
export const AGENTS_RECENT_MS = 30 * 60_000;

export type AgentPanelRow = {
  /** Stable while the session runs (not its folder). */
  id: string;
  agent: string;
  /** The folder it works in (left out for agent readers). */
  cwd?: string;
  /** The projects whose panel it is (the first one opens it). */
  projects: { id: string; name: string }[];
  state: PanelState;
  /** When the current state began (output, the end of the turn, or the start). */
  since: string;
  startedAt: string;
  lastOutputAt?: string;
  /** The end of its last turn (Claude Code's Stop hook, or output gone quiet after input). */
  turnEndedAt?: string;
  /** A panel shows it now in a visible tab. */
  watched: boolean;
};

export type ConnectedAgentRow = {
  /** As people know it ("Claude Code"). */
  agent: string;
  /** Working now: a presence mark (view tools, its revisions in the last seconds). */
  live: boolean;
  projects: { id: string; name: string }[];
  /** What it did last: a revision's message, or what it looked up. */
  last?: { kind: 'revision' | 'lookup'; text: string; at: string; projectId?: string };
};

export type AnsweringRow = {
  state: 'off' | 'unavailable' | 'paused' | 'idle' | 'queued' | 'running' | 'stopping';
  agent?: string;
  run?: { projectIds: string[]; startedAt: string };
  queued: number;
  lastRun?: { outcome?: string; finishedAt?: string };
};

export type RoutineRunRow = {
  id: string;
  name: string;
  kind: string;
  agent: string;
  projectId?: string;
  project?: string;
  startedAt: string;
};

export type AgentsOverview = {
  at: string;
  /** The glance: every agent listed, by what it is doing. */
  counts: { working: number; waiting: number; idle: number };
  panels: AgentPanelRow[];
  connected: ConnectedAgentRow[];
  answering: AnsweringRow;
  runs: RoutineRunRow[];
  /** Panels can be stopped from here (this computer, not the hosted address). */
  local: boolean;
};
