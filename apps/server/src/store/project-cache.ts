import type { Store } from './store.js';

/**
 * A per-project cache for work that reads a whole project (freshness, the desk): a result is
 * reused until a revision touches that project or anything outside projects (assignees, settings
 * kept as entities), or the caller's own key changes (seen marks, today). Asking whether a cached
 * result still holds is two indexed lookups, so the sidebar and the desk stay quick however many
 * projects there are.
 */

/** The latest revision that touched this project, and the latest that touched no project. */
export function projectVersion(store: Store, projectId: string): string {
  const db = store.database;
  const own = db
    .prepare('SELECT MAX(revision_id) AS v FROM changes WHERE project_id = ?')
    .get(projectId) as { v: number | null };
  const shared = db
    .prepare('SELECT MAX(revision_id) AS v FROM changes WHERE project_id IS NULL')
    .get() as { v: number | null };
  return `${own.v ?? 0}:${shared.v ?? 0}`;
}

const caches = new WeakMap<Store, Map<string, Map<string, { key: string; value: unknown }>>>();

/** `compute` for this project, or the cached result when the project and `key` are unchanged. */
export function perProject<T>(
  store: Store,
  name: string,
  projectId: string,
  key: string,
  compute: () => T,
): T {
  let byName = caches.get(store);
  if (!byName) caches.set(store, (byName = new Map()));
  let byProject = byName.get(name);
  if (!byProject) byName.set(name, (byProject = new Map()));
  const full = `${projectVersion(store, projectId)}|${key}`;
  const hit = byProject.get(projectId);
  if (hit && hit.key === full) return hit.value as T;
  const value = compute();
  byProject.set(projectId, { key: full, value });
  return value;
}
