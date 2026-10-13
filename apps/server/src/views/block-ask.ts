import { isDeepStrictEqual } from 'node:util';
import { toBoard, type Board, type Entity, type Operation, type ViewSpec } from '@pharos/schema';
import type { Store } from '../store/store.js';
import { effectiveBoard } from './service.js';

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
    const issue = blockChangeIssue(effectiveBoard(view), toBoard(spec), allowed);
    if (issue) return `${at}: ${issue}`;
  }
  return undefined;
}
