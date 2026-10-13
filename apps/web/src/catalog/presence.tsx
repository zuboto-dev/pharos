import { presenceInProject, presenceInView, type PresenceEntry } from '@pharos/schema';
import clsx from 'clsx';
import { useMemo } from 'react';
import { usePresence } from '../lib/events';

// "Being edited" and "agent working" (v0.2 B5): calm marks for where an agent is at work right
// now. A small pulsing dot (opacity only with reduced motion) and, on a block, the agent's name.
// Every mark is absolutely placed or an outline, so one appearing or going never moves layout.

/** The pulsing dot. Decoration: whoever shows it also says it in words (visible or sr-only). */
export function PresenceDot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      data-presence-dot=""
      className={clsx(
        'pointer-events-none inline-block size-2 shrink-0 animate-presence rounded-full bg-presence',
        className,
      )}
    />
  );
}

/** "Claude Code is editing…": the mark on a block an agent is changing right now. */
export function BlockPresence({ agent }: { agent: string }) {
  return (
    <span
      role="status"
      data-presence={agent}
      className="pointer-events-none absolute -top-2.5 left-3 z-10 inline-flex max-w-[calc(100%-1.5rem)] animate-fade-in items-center gap-1.5 rounded-full border border-line bg-surface px-2 py-0.5 text-xs whitespace-nowrap text-presence-ink shadow-xs"
    >
      <PresenceDot />
      <span className="truncate">{agent} is editing…</span>
    </span>
  );
}

/**
 * "Claude Code is working on this view": the mark on a whole view, at the top right of its board.
 * Absolutely placed, so the board's blocks don't move.
 */
export function ViewPresence({ agents }: { agents: readonly string[] }) {
  return (
    <span
      role="status"
      data-presence={agents.join(', ')}
      className="pointer-events-none absolute -top-3.5 right-0 z-10 inline-flex max-w-full animate-fade-in items-center gap-1.5 rounded-full border border-line bg-surface px-2 py-0.5 text-xs whitespace-nowrap text-presence-ink shadow-xs"
    >
      <PresenceDot />
      <span className="truncate">{workingLine(agents, 'this view')}</span>
    </span>
  );
}

/** The outline around a block being edited: an outline, so nothing around it moves. */
export const BLOCK_PRESENCE_OUTLINE =
  'rounded-block outline-1 outline-offset-2 outline-presence/50 outline-solid';

/** Who works on a view now, and the blocks being edited in it (widget id → agent). */
export function useViewPresence(viewId: string | undefined) {
  const entries = usePresence();
  return useMemo(
    () => (viewId ? presenceInView(entries, viewId) : { agents: [], widgets: new Map() }),
    [entries, viewId],
  );
}

/** Which views have an agent at work: view id → the agents' names. */
export function viewsWithPresence(entries: readonly PresenceEntry[]): Map<string, string[]> {
  const views = new Map<string, string[]>();
  for (const e of entries) {
    if (!e.viewId) continue;
    const agents = views.get(e.viewId) ?? [];
    if (!agents.includes(e.agent)) agents.push(e.agent);
    views.set(e.viewId, agents);
  }
  return views;
}

/** One line for a tooltip or a screen reader: "Claude Code is working on this view". */
export function workingLine(agents: readonly string[], what: string): string {
  const who =
    agents.length <= 1
      ? (agents[0] ?? 'An agent')
      : `${agents.slice(0, -1).join(', ')} and ${agents.at(-1)}`;
  return `${who} ${agents.length > 1 ? 'are' : 'is'} working on ${what}`;
}

/** The agents at work anywhere in a project (a view, its data, or answering its questions). */
export function useProjectPresence(projectId: string | undefined) {
  const entries = usePresence();
  return useMemo(
    () => (projectId ? presenceInProject(entries, projectId) : []),
    [entries, projectId],
  );
}
