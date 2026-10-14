import {
  ENTITIES,
  SEEN_SETTING,
  boardReads,
  changeTouches,
  filterMatcher,
  type Author,
  type BoardReads,
  type ChangeLike,
  type ChangeOp,
  type ChangedItem,
  type ChangedViews,
  type Entity,
  type EntityType,
  type PageChange,
  type PageChanges,
  type ProjectFreshness,
  type SeenMarks,
  type ViewFreshness,
} from '@pharos/schema';
import { PharosError } from '../store/errors.js';
import type { Store } from '../store/store.js';
import { effectiveBoard, isExpired } from './service.js';

/**
 * Freshness (R11, see packages/schema/src/freshness.ts): what changed on each page since the
 * reader last looked, and whether an agent-built page's written parts still match their data.
 * Computed from the change log on request; nothing here is a revision.
 */

/** The one reader of a local install: the owner, who writes from the web app as human:me. */
export const READER: Author = { kind: 'human', name: 'me' };

const RECENT = 5;
const ITEMS = 5;

/** The reader's seen marks; the first call starts keeping track from the latest revision. */
export function seenMarks(store: Store): SeenMarks {
  const marks = store.setting<SeenMarks>(SEEN_SETTING);
  if (marks && typeof marks.baseline === 'number' && marks.views) return marks;
  const started: SeenMarks = { baseline: store.latestRevisionId(), views: {} };
  store.setSetting(SEEN_SETTING, started);
  return started;
}

/**
 * The reader opened a view: it counts as seen up to `revision` (default: the latest). Marks only
 * move forward, so a tab that loaded earlier can't bring an old change back.
 */
export function markSeen(store: Store, viewId: string, revision?: number): number {
  store.getOfType('view', viewId);
  const marks = seenMarks(store);
  const latest = store.latestRevisionId();
  const target = Math.min(revision ?? latest, latest);
  const next = Math.max(marks.views[viewId] ?? marks.baseline, target);
  // Marks of deleted views go, so the setting stays as small as the project.
  const existing = new Set(store.list('view').map((v) => v.id));
  const views = Object.fromEntries(
    Object.entries(marks.views).filter(([id]) => existing.has(id) && id !== viewId),
  );
  store.setSetting(SEEN_SETTING, { ...marks, views: { ...views, [viewId]: next } });
  return next;
}

type Row = {
  revision_id: number;
  op: string;
  entity_type: string;
  entity_id: string;
  before: string | null;
  after: string | null;
  author_kind: string;
  author_name: string;
  message: string;
  created_at: string;
};

type LoggedRevision = {
  id: number;
  at: string;
  author: Author;
  message: string;
  changes: (ChangeLike & { op: ChangeOp })[];
};

/** A project's revisions after `after`, oldest first, with their changes in the project. */
function revisionsAfter(store: Store, projectId: string, after: number): LoggedRevision[] {
  const rows = store.database
    .prepare(
      `SELECT c.revision_id, c.op, c.entity_type, c.entity_id, c.before, c.after,
              r.author_kind, r.author_name, r.message, r.created_at
       FROM changes c JOIN revisions r ON r.id = c.revision_id
       WHERE c.project_id = ? AND c.revision_id > ?
       ORDER BY c.revision_id, c.seq`,
    )
    .all(projectId, after) as Row[];
  const out: LoggedRevision[] = [];
  for (const row of rows) {
    let last = out.at(-1);
    if (last?.id !== row.revision_id) {
      last = {
        id: row.revision_id,
        at: row.created_at,
        author: { kind: row.author_kind as Author['kind'], name: row.author_name },
        message: row.message,
        changes: [],
      };
      out.push(last);
    }
    last.changes.push({
      op: row.op as ChangeOp,
      type: row.entity_type as EntityType,
      id: row.entity_id,
      before: row.before ? (JSON.parse(row.before) as Record<string, unknown>) : null,
      after: row.after ? (JSON.parse(row.after) as Record<string, unknown>) : null,
    });
  }
  return out;
}

function labelOf(change: ChangeLike): string | null {
  const data = change.after ?? change.before;
  const value = data?.[ENTITIES[change.type].label];
  return typeof value === 'string' ? value : null;
}

const isReader = (author: Author) => author.kind === READER.kind && author.name === READER.name;

/**
 * The revisions after `since` that touched a page: changed the view itself (when `page` is on)
 * or data its blocks read. `everything` lets an activity feed count every change.
 */
function pageChanges(
  revisions: LoggedRevision[],
  view: Entity<'view'>,
  reads: BoardReads,
  matches: Parameters<typeof changeTouches>[2],
  options: { since: number; page: boolean; everything: boolean; skip: (a: Author) => boolean },
): PageChanges | null {
  const touched: PageChange[] = [];
  for (const revision of revisions) {
    if (revision.id <= options.since || options.skip(revision.author)) continue;
    const page = options.page && revision.changes.some((c) => c.id === view.id);
    const items: ChangedItem[] = [];
    for (const change of revision.changes) {
      if (!changeTouches(reads, change, matches, { everything: options.everything })) continue;
      if (items.length < ITEMS)
        items.push({ type: change.type, id: change.id, label: labelOf(change), op: change.op });
      else break;
    }
    if (!page && !items.length) continue;
    touched.push({
      revision: revision.id,
      at: revision.at,
      author: revision.author,
      message: revision.message,
      items,
      page,
    });
  }
  if (!touched.length) return null;
  return { since: options.since, total: touched.length, recent: touched.slice(-RECENT).reverse() };
}

/**
 * Freshness of a project's views (the ones shown: not archived or expired, unless `view` names
 * one). `since` replaces the reader's mark for that view, so a page can keep listing what changed
 * since it was opened after it marked itself seen.
 */
export function projectFreshness(
  store: Store,
  projectId: string,
  options: { view?: string; since?: number } = {},
): ProjectFreshness {
  store.getOfType('project', projectId);
  const marks = seenMarks(store);
  const latest = store.latestRevisionId();
  const views = store
    .list('view', { projectId })
    .filter((v) => (options.view ? v.id === options.view : !v.data.archived && !isExpired(v)));
  if (options.view && !views.length)
    throw new PharosError('not_found', `view ${options.view} not found in this project`);
  const seenOf = (view: Entity<'view'>) =>
    view.id === options.view && options.since !== undefined
      ? options.since
      : // A view made later counts from its own start: what happened before it existed is no news.
        Math.max(marks.views[view.id] ?? marks.baseline, view.createdRev - 1);
  const from = Math.min(
    latest,
    ...views.map(seenOf),
    ...views.map((v) => v.data.evidenceRevision ?? latest),
  );
  const revisions = revisionsAfter(store, projectId, from);
  const matches = filterMatcher(store.dataset(projectId));
  const out: Record<string, ViewFreshness> = {};
  for (const view of views) {
    const seen = seenOf(view);
    const reads = boardReads(effectiveBoard(view));
    const changed = pageChanges(revisions, view, reads, matches, {
      since: seen,
      page: true,
      everything: true,
      // The reader knows what they changed; Pharos's own housekeeping isn't news.
      skip: (a) => isReader(a) || a.kind === 'system',
    });
    const evidenceRevision = view.data.evidenceRevision;
    let evidence: ViewFreshness['evidence'] = null;
    if (evidenceRevision !== undefined) {
      evidence = {
        revision: evidenceRevision,
        at: store.revision(evidenceRevision)?.createdAt ?? null,
        // Anyone's change to the data makes the written parts stale, the owner's included.
        stale: pageChanges(revisions, view, reads, matches, {
          since: evidenceRevision,
          page: false,
          everything: false,
          skip: (a) => a.kind === 'system',
        }),
      };
    } else if (view.data.kind === 'answer') {
      evidence = { unknown: true };
    }
    out[view.id] = { viewId: view.id, seen, changed, evidence };
  }
  return { projectId, latest, views: out };
}

/** Every project's views that changed since the reader looked (for the sidebar and tabs). */
export function changedViews(store: Store): ChangedViews {
  const projects: Record<string, string[]> = {};
  for (const project of store.list('project')) {
    if ((project.data as { archived?: boolean }).archived) continue;
    const { views } = projectFreshness(store, project.id);
    const changed = Object.values(views)
      .filter((v) => v.changed)
      .map((v) => v.viewId);
    if (changed.length) projects[project.id] = changed;
  }
  return { latest: store.latestRevisionId(), projects };
}

/**
 * Whether an agent-built view's written parts still match their data, for agents deciding whether
 * to reuse it (R11.6): fresh, stale, or unknown (no evidence revision: made before R11 or by a
 * person).
 */
export function evidenceState(store: Store, view: Entity<'view'>): 'fresh' | 'stale' | 'unknown' {
  if (view.data.evidenceRevision === undefined) return 'unknown';
  const evidence = projectFreshness(store, view.data.projectId, { view: view.id }).views[view.id]
    ?.evidence;
  return evidence && 'stale' in evidence && evidence.stale ? 'stale' : 'fresh';
}
