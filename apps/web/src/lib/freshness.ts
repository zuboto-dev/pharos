import type { ChangedViews, ProjectFreshness } from '@pharos/schema';
import { useEffect, useState } from 'react';
import { useRevisionEvents } from './events';

// Freshness (R11): which views changed since the reader last looked. One shared copy of the
// server's answer for the sidebar and the tabs, loaded again (once, however many listen) when
// anything is saved and after the reader opens a view.

const EMPTY: ChangedViews = { latest: 0, projects: {} };
let changed: ChangedViews = EMPTY;
const listeners = new Set<(value: ChangedViews) => void>();
let pending: ReturnType<typeof setTimeout> | undefined;
/** Loads started, and the latest one announced: an older answer never replaces a newer one. */
let started = 0;
let applied = 0;

function announce(value: ChangedViews) {
  changed = value;
  for (const listener of listeners) listener(value);
}

async function load(): Promise<void> {
  const ticket = ++started;
  try {
    const res = await fetch('/api/freshness');
    if (!res.ok) return;
    const body = (await res.json()) as ChangedViews;
    if (ticket < applied) return;
    if (body && typeof body === 'object' && body.projects && typeof body.projects === 'object') {
      applied = ticket;
      announce(body);
    }
  } catch {
    // No server (or a test without one): no dots, nothing breaks.
  }
}

/** Loads the changed views again soon; calls close together share one request. */
export function reloadChangedViews(delayMs = 150): void {
  clearTimeout(pending);
  pending = setTimeout(() => void load(), delayMs);
}

/** Takes a value as the server's (tests, and after marking a view seen). */
export function announceChangedViews(value: ChangedViews): void {
  announce(value);
}

/** Which views changed since the reader last looked: project id → view ids. */
export function useChangedViews(): ChangedViews {
  const [value, setValue] = useState(changed);
  useEffect(() => {
    listeners.add(setValue);
    if (listeners.size === 1) reloadChangedViews(0);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  useRevisionEvents(() => reloadChangedViews());
  return value;
}

/** The reader has the view open: it counts as seen up to now. Its dot clears everywhere. */
export async function markViewSeen(viewId: string, revision?: number): Promise<void> {
  // Cleared here at once, so the dot doesn't wait for the server.
  const projects = Object.fromEntries(
    Object.entries(changed.projects)
      .map(([id, views]) => [id, views.filter((v) => v !== viewId)] as const)
      .filter(([, views]) => views.length),
  );
  announce({ ...changed, projects });
  try {
    await fetch(`/api/views/${viewId}/seen`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(revision !== undefined ? { revision } : {}),
    });
  } catch {
    // Seen again on the next visit.
  }
  reloadChangedViews();
}

/** A view's freshness: changes since `since` (default: the reader's mark), and its evidence. */
export async function viewFreshness(
  projectId: string,
  viewId: string,
  since?: number,
): Promise<ProjectFreshness | null> {
  try {
    const query = new URLSearchParams({ view: viewId });
    if (since !== undefined) query.set('since', String(since));
    const res = await fetch(`/api/projects/${projectId}/freshness?${query}`);
    if (!res.ok) return null;
    const body = (await res.json()) as ProjectFreshness | null;
    // Anything else (an older server, a test's stand-in) means nothing is known.
    return body && typeof body.views === 'object' && body.views !== null ? body : null;
  } catch {
    return null;
  }
}
