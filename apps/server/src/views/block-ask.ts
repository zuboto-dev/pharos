import { isDeepStrictEqual } from 'node:util';
import {
  TEMPLATES,
  toBoard,
  type Board,
  type Change,
  type Entity,
  type Operation,
  type ViewSpec,
} from '@pharos/schema';
import type { Store } from '../store/store.js';

/**
 * "Ask about this block" (R10.6–R10.9): a person asks from one block, and the request (mode
 * "block") names the view and widget. While it is open, an agent may change only that block of
 * that view: the other blocks, their order and sizes, and the view itself stay as they are. The
 * view service (view_update) and REST /api/apply refuse anything else from an agent. People are
 * never limited, so a person's layout edit always survives an agent's retry.
 */

/** Open "change this block" requests on a view. */
export function openBlockRequests(store: Store, view: Entity<'view'>): Entity<'request'>[] {
  return store
    .list('request', { projectId: view.data.projectId, where: { status: 'open' } })
    .filter(
      (r) => r.data.mode === 'block' && r.data.viewId === view.id && Boolean(r.data.widgetId),
    );
}

/** The blocks agents may change on a view right now; empty when no block request is open. */
export function askedBlocks(store: Store, view: Entity<'view'>): Set<string> {
  return new Set(openBlockRequests(store, view).map((r) => r.data.widgetId!));
}

function names(ids: Iterable<string>): string {
  return [...ids].map((id) => `"${id}"`).join(', ');
}

/**
 * Why a board change touches more than the asked blocks (undefined when it doesn't): another
 * block changed, moved, was added or removed, or an asked block was removed.
 */
export function blockChangeIssue(
  before: Board,
  after: Board,
  allowed: Set<string>,
): string | undefined {
  const scope = `Only ${names(allowed)} may change on this view (an open "ask about this block" request)`;
  const beforeIds = before.widgets.map((w) => w.id);
  const afterIds = after.widgets.map((w) => w.id);
  const removed = beforeIds.filter((id) => !afterIds.includes(id));
  const added = afterIds.filter((id) => !beforeIds.includes(id));
  if (removed.some((id) => allowed.has(id)))
    return `${scope}: keep block ${names(removed.filter((id) => allowed.has(id)))} and change it in place with {op: "update", id, set: {…}}`;
  if (removed.length) return `${scope}: block ${names(removed)} would be removed`;
  if (added.length) return `${scope}: don't add blocks (${names(added)}) while answering it`;
  if (!isDeepStrictEqual(beforeIds, afterIds))
    return `${scope}: keep the blocks in their order; move nothing`;
  const changed = before.widgets
    .filter((w, i) => !allowed.has(w.id) && !isDeepStrictEqual(w, after.widgets[i]))
    .map((w) => w.id);
  if (changed.length) return `${scope}: block ${names(changed)} would change too`;
  return undefined;
}

/** View fields an agent can't change while a block request is open (only blocks may change). */
const VIEW_FIELDS = ['name', 'description', 'pinned', 'archived', 'order', 'kind', 'expiresAt'];

/**
 * Why an agent's apply operations on views go beyond the blocks people asked about (REST
 * /api/apply; MCP agents edit views only with view_update, which checks the same).
 */
export function agentViewOpsIssue(store: Store, operations: Operation[]): string | undefined {
  for (const [i, op] of operations.entries()) {
    if (op.type !== 'view' || op.op === 'create') continue;
    const found = store.get(op.id);
    if (found?.type !== 'view') continue;
    const view = found as Entity<'view'>;
    const allowed = askedBlocks(store, view);
    if (!allowed.size) continue;
    const at = `operations[${i}]`;
    if (op.op === 'delete')
      return `${at}: view "${view.data.name}" has an open request to change only ${names(allowed)}; it can't be deleted now`;
    const fields = VIEW_FIELDS.filter((f) => f in op.data);
    if (fields.length)
      return `${at}: view "${view.data.name}" has an open request to change only ${names(allowed)}; leave ${fields.join(', ')} as they are`;
    if (!('spec' in op.data)) continue;
    const spec = op.data.spec as ViewSpec | null;
    if (spec === null)
      return `${at}: view "${view.data.name}" has an open request to change only ${names(allowed)}; don't reset it`;
    const issue = blockChangeIssue(boardOfData(view.data), toBoard(spec), allowed);
    if (issue) return `${at}: ${issue}`;
  }
  return undefined;
}

type Data = Record<string, unknown>;

/** The board a view's stored data shows (its spec, else its template). */
function boardOfData(data: Data): Board {
  const spec =
    (data.spec as ViewSpec | null | undefined) ??
    TEMPLATES[(data.template as keyof typeof TEMPLATES | undefined) ?? 'overview'];
  return toBoard(spec);
}

const isOpenBlockRequest = (data: Data | null | undefined): data is Data =>
  !!data &&
  data.status === 'open' &&
  data.mode === 'block' &&
  typeof data.viewId === 'string' &&
  typeof data.widgetId === 'string';

/**
 * The store's own check of an agent's revision (v0.2 review, gap 3), on everything it does:
 * view_update, REST apply, deletes and Undo alike. While a project has an open "ask about this
 * block" request, an agent's revision may change views in that project only by changing the asked
 * blocks in place. When the revision closes block requests (answers or dismisses them), only the
 * blocks those requests name may change; otherwise the blocks of every open block request may.
 * Other views in the project, and every view's own fields, stay as they are; new views are fine.
 */
export function agentBlockScopeIssue(store: Store, changes: Change[]): string | undefined {
  // Each entity's state before this revision, and its last change in it.
  const before = new Map<string, Data | null>();
  const last = new Map<string, Change>();
  for (const change of changes) {
    if (!before.has(change.id)) before.set(change.id, change.before);
    last.set(change.id, change);
  }
  const projects = new Set(
    changes.filter((c) => c.type === 'view' && c.projectId).map((c) => c.projectId!),
  );
  for (const projectId of projects) {
    // Requests as they were before this revision (its own writes set aside).
    const requests = new Map<string, Data | null>();
    for (const r of store.list('request', { projectId }))
      requests.set(r.id, before.has(r.id) ? before.get(r.id)! : (r.data as Data));
    for (const [id, data] of before)
      if (!requests.has(id) && last.get(id)?.type === 'request' && data?.projectId === projectId)
        requests.set(id, data);
    const open: [string, Data][] = [];
    for (const [id, data] of requests) if (isOpenBlockRequest(data)) open.push([id, data]);
    if (!open.length) continue;
    const closing = open.filter(([id]) => {
      const change = last.get(id);
      return change !== undefined && !isOpenBlockRequest(change.after);
    });
    const scope = closing.length ? closing : open;
    const asked = names(new Set(open.map(([, d]) => d.widgetId as string)));
    const waiting = `A person is waiting for block ${asked} to change (an open "ask about this block" request)`;
    for (const [id, change] of last) {
      if (change.type !== 'view' || change.projectId !== projectId) continue;
      const was = before.get(id) ?? null;
      const now = change.after;
      if (!was) continue; // a new view (an answer) is fine
      const name = String(was.name ?? id);
      const allowed = new Set(
        scope.filter(([, d]) => d.viewId === id).map(([, d]) => d.widgetId as string),
      );
      if (!now) return `${waiting}; view "${name}" can't be deleted now`;
      if (!allowed.size)
        return closing.length
          ? `${waiting}; the request this answers asks about another view, so view "${name}" stays as it is`
          : `${waiting}; leave view "${name}" as it is until the request is answered`;
      const fields = [...new Set([...Object.keys(was), ...Object.keys(now)])].filter(
        (k) => k !== 'spec' && !isDeepStrictEqual(was[k] ?? null, now[k] ?? null),
      );
      if (fields.length)
        return `${waiting}; leave ${fields.join(', ')} of view "${name}" as they are`;
      if (!isDeepStrictEqual(was.spec ?? null, now.spec ?? null)) {
        if ((now.spec ?? null) === null) return `${waiting}; don't reset view "${name}"`;
        const issue = blockChangeIssue(boardOfData(was), boardOfData(now), allowed);
        if (issue) return `View "${name}": ${issue}`;
      }
    }
  }
  return undefined;
}
