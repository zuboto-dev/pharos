import { presenceInProject, type PresenceEntry, type PresenceState } from '@pharos/schema';
import { describe, expect, it } from 'vitest';
import { Presence } from './presence.js';

describe('v0.2 presence review regressions', () => {
  it('publishes an expiry when a read prunes an overdue mark before its timer runs', () => {
    let now = 1_000;
    const presence = new Presence({ ttlMs: 100, now: () => now });
    const seen: PresenceState[] = [];
    presence.subscribe((state) => seen.push(state));
    presence.touch('Claude Code', { projectId: 'p1', activity: 'working' }, 'mcp:one');

    now = 1_101;
    expect(presence.state().entries).toEqual([]);
    expect(seen.at(-1)?.entries).toEqual([]);
    presence.dispose();
  });

  it('clears the ending run in its project without clearing a separate project mark', () => {
    const now = 2_000;
    const presence = new Presence({ now: () => now });
    presence.touch('Claude Code', { projectId: 'p1', activity: 'answering' }, 'runner:p1');
    presence.touch('Codex', { projectId: 'p2', activity: 'editing' }, 'mcp:p2');

    presence.clearProjects(['p1'], now);

    expect(presence.state().entries).toEqual([
      expect.objectContaining({ agent: 'Codex', projectId: 'p2', activity: 'editing' }),
    ]);
    presence.dispose();
  });

  it('shows only the requested project presence in a project-scoped view', () => {
    const entries: PresenceEntry[] = [
      {
        agent: 'Claude Code',
        projectId: 'p1',
        activity: 'working',
        since: '2026-10-13T12:00:00.000Z',
      },
      {
        agent: 'Codex',
        projectId: 'p2',
        activity: 'editing',
        since: '2026-10-13T12:00:00.000Z',
      },
    ];

    expect(presenceInProject(entries, 'p1')).toEqual([
      { agent: 'Claude Code', activity: 'working' },
    ]);
  });

  it('does not clear another agent active in the same project when a run ends', () => {
    let now = 3_000;
    const presence = new Presence({ now: () => now });
    presence.touch('Claude Code', { projectId: 'p1', activity: 'answering' }, 'runner:p1');
    now += 1;
    presence.touch('Codex', { projectId: 'p1', activity: 'editing' }, 'mcp:codex');

    presence.clearProjects(['p1'], 3_000);

    expect(presence.state().entries).toContainEqual(
      expect.objectContaining({ agent: 'Codex', projectId: 'p1', activity: 'editing' }),
    );
    presence.dispose();
  });
});
