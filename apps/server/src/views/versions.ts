import { versionChanges, type Author, type Entity, type ViewVersion } from '@pharos/schema';
import { HIDDEN_REVISION_MESSAGE, type AgentFiles } from '../store/agent-files.js';
import { PharosError } from '../store/errors.js';
import type { Store } from '../store/store.js';

/**
 * A view's versions (packages/schema/src/views/versions.ts): every revision that changed it, read
 * from the change log, and the view as each one left it. Nothing is stored for this: the change
 * log already keeps every version whole.
 */

type Row = {
  revision: number;
  at: string;
  kind: Author['kind'];
  name: string;
  message: string;
  op: ViewVersion['op'];
  before: string | null;
  after: string | null;
  revertedBy: number | null;
};

const SELECT = `SELECT r.id AS revision, r.created_at AS at, r.author_kind AS kind,
       r.author_name AS name, r.message AS message, c.op AS op, c.before AS before, c.after AS after,
       (SELECT MIN(u.id) FROM revisions u WHERE u.revert_of = r.id) AS revertedBy
  FROM changes c JOIN revisions r ON r.id = c.revision_id
 WHERE c.entity_type = 'view' AND c.entity_id = ?`;

function toVersion(row: Row): ViewVersion {
  const parse = (text: string | null) =>
    text ? (JSON.parse(text) as Entity<'view'>['data']) : null;
  const changes =
    row.op === 'delete' ? undefined : versionChanges(parse(row.before), parse(row.after));
  return {
    ...(changes ? { changes } : {}),
    revision: row.revision,
    at: row.at,
    author: { kind: row.kind, name: row.name },
    message: row.message,
    op: row.op,
    ...(row.revertedBy ? { revertedBy: row.revertedBy } : {}),
  };
}

/**
 * For an agent (R7.9), a version whose revision also changed an item it can't see gets a neutral
 * message, as in /api/history: the revision's own message may name a hidden file.
 */
function forAgent(store: Store, files: AgentFiles | null, version: ViewVersion): ViewVersion {
  if (!files) return version;
  const ids = store.database
    .prepare('SELECT DISTINCT entity_id AS id FROM changes WHERE revision_id = ?')
    .all(version.revision) as { id: string }[];
  return ids.every((r) => files.visible(r.id))
    ? version
    : { ...version, message: HIDDEN_REVISION_MESSAGE };
}

/** Newest first, at most `limit`; `files` when an agent asks. */
export function viewVersions(
  store: Store,
  viewId: string,
  limit = 200,
  files: AgentFiles | null = null,
): ViewVersion[] {
  if (store.get(viewId)?.type !== 'view' && !store.lastKnown(viewId))
    throw new PharosError('not_found', `View ${viewId} not found`);
  const rows = store.database
    .prepare(`${SELECT} ORDER BY r.id DESC, c.seq DESC LIMIT ?`)
    .all(viewId, limit * 2) as Row[];
  // One version per revision (a revision may touch a view twice).
  const seen = new Set<number>();
  return rows
    .filter((r) => !seen.has(r.revision) && seen.add(r.revision))
    .slice(0, limit)
    .map((row) => forAgent(store, files, toVersion(row)));
}

/** The view as revision `revision` left it, and as it was just before. */
export function viewAt(
  store: Store,
  viewId: string,
  revision: number,
  files: AgentFiles | null = null,
): {
  version: ViewVersion;
  after: Entity<'view'>['data'] | null;
  before: Entity<'view'>['data'] | null;
} {
  const rows = store.database
    .prepare(`${SELECT} AND r.id = ? ORDER BY c.seq`)
    .all(viewId, revision) as Row[];
  if (!rows.length)
    throw new PharosError('not_found', `Revision ${revision} didn't change view ${viewId}`);
  const parse = (text: string | null) =>
    text ? (JSON.parse(text) as Entity<'view'>['data']) : null;
  return {
    version: forAgent(store, files, toVersion(rows.at(-1)!)),
    before: parse(rows[0]!.before),
    after: parse(rows.at(-1)!.after),
  };
}

/**
 * Restores a view to the content a version left it with, as a new change (undoable): its doc,
 * board or page, and the evidence that text was written from, so restored prose that is out of
 * date says so. A main page stays a document: a version without one can't be restored onto it.
 */
export function restoreVersion(store: Store, author: Author, viewId: string, revision: number) {
  const view = store.get(viewId) as Entity<'view'> | null;
  if (view?.type !== 'view') throw new PharosError('not_found', `View ${viewId} not found`);
  const { version, after } = viewAt(store, viewId, revision);
  if (!after) throw new PharosError('invalid', 'That version deleted the view; nothing to restore');
  if (view.data.kind === 'main' && !after.doc && !after.page)
    throw new PharosError(
      'invalid',
      'That version was a board; the main page is a document. Restore a later version, or make another page the main page first',
    );
  return store.apply(
    author,
    {
      message: `Restore “${view.data.name}” to its version of ${version.at.slice(0, 16).replace('T', ' ')} UTC (#${revision})`,
      operations: [
        {
          op: 'update',
          type: 'view',
          id: viewId,
          data: {
            doc: after.doc ?? null,
            spec: after.spec ?? null,
            page: after.page ?? null,
            template: after.template ?? null,
          },
        },
      ],
    },
    after.evidenceRevision !== undefined ? { evidenceAt: after.evidenceRevision } : {},
  );
}
