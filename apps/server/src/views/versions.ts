import type { Author, Entity, ViewVersion } from '@pharos/schema';
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
  return {
    revision: row.revision,
    at: row.at,
    author: { kind: row.kind, name: row.name },
    message: row.message,
    op: row.op,
    ...(row.revertedBy ? { revertedBy: row.revertedBy } : {}),
  };
}

/** Newest first, at most `limit`. */
export function viewVersions(store: Store, viewId: string, limit = 200): ViewVersion[] {
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
    .map(toVersion);
}

/** The view as revision `revision` left it, and as it was just before. */
export function viewAt(
  store: Store,
  viewId: string,
  revision: number,
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
    version: toVersion(rows.at(-1)!),
    before: parse(rows[0]!.before),
    after: parse(rows.at(-1)!.after),
  };
}
