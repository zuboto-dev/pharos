// Presence (v0.2 B5): which agent is working where right now. A live signal, sent over the change
// feed (`GET /api/events`, event `presence`). It is not project data and never a revision: it
// lives in the server's memory and is gone after a restart.

/** A mark lasts this long after an agent's last call on that place, unless renewed. */
export const PRESENCE_TTL_MS = 20_000;

/** What the agent is doing there. */
export type PresenceActivity =
  /** Changing a view or its blocks (view_create/update, or a revision that changed a view). */
  | 'editing'
  /** Reading or checking a view (view_get, view_preview) before changing it. */
  | 'viewing'
  /** Changing the project's data (apply). */
  | 'working'
  /** The question-answering agent is running for the project. */
  | 'answering';

export type PresenceEntry = {
  /** The agent's name as people see it, e.g. "Claude Code". */
  agent: string;
  projectId: string;
  /** Set when the agent works on one view. */
  viewId?: string;
  /** Set when the agent edits one block (widget) of that view. */
  widgetId?: string;
  activity: PresenceActivity;
  /** When this mark started (ISO). */
  since: string;
  /**
   * Milliseconds until the mark expires, counted from when the event was sent; absent while it
   * is held (an answering run lasts until it finishes, fails or is paused).
   */
  expiresInMs?: number;
};

/** The `presence` event's data: every mark at that moment (an empty list clears them all). */
export type PresenceState = { entries: PresenceEntry[] };

/** Known MCP client names, shown the way people know the agent. */
const AGENT_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  'claude-ai': 'Claude',
  codex: 'Codex',
  'codex-mcp-client': 'Codex',
};

/** The name to show for an agent author or MCP client name. */
export function agentLabel(name: string | undefined): string {
  const trimmed = name?.trim();
  if (!trimmed) return 'An agent';
  return AGENT_LABELS[trimmed.toLowerCase()] ?? trimmed;
}

/** The marks for one view, and the blocks being edited in it (widget id → agent). */
export function presenceInView(
  entries: readonly PresenceEntry[],
  viewId: string,
): { agents: string[]; widgets: Map<string, string> } {
  const agents: string[] = [];
  const widgets = new Map<string, string>();
  for (const e of entries) {
    if (e.viewId !== viewId) continue;
    if (!agents.includes(e.agent)) agents.push(e.agent);
    if (e.widgetId && !widgets.has(e.widgetId)) widgets.set(e.widgetId, e.agent);
  }
  return { agents, widgets };
}

/** The agents working anywhere in a project (any view, its data, or answering its questions). */
export function presenceInProject(
  entries: readonly PresenceEntry[],
  projectId: string,
): { agent: string; activity: PresenceActivity }[] {
  const out: { agent: string; activity: PresenceActivity }[] = [];
  for (const e of entries)
    if (e.projectId === projectId && !out.some((o) => o.agent === e.agent))
      out.push({ agent: e.agent, activity: e.activity });
  return out;
}
