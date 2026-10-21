import { isDeepStrictEqual } from 'node:util';
import {
  ENTITIES,
  OWNER_DECISION_FIELDS,
  OWNER_TASK_FIELDS,
  SEEN_SETTING,
  boardReads,
  changeTouches,
  docDecisionIds,
  docLeaves,
  docReads,
  dueOf,
  filterMatcher,
  localToday,
  mergeReads,
  pageReads,
  readsNothing,
  runQuery,
  type Author,
  type BoardReads,
  type ChangeLike,
  type ChangeOp,
  type ChangedItem,
  type ChangedViews,
  type Entity,
  type EntityType,
  type FilterMatcher,
  type PageChange,
  type PageChanges,
  type ProjectDataset,
  type ProjectFreshness,
  type ReportDoc,
  type SeenMarks,
  type ViewFreshness,
} from '@pharos/schema';
import { AgentFiles } from '../store/agent-files.js';
import { PharosError } from '../store/errors.js';
import { perProject } from '../store/project-cache.js';
import type { Store } from '../store/store.js';
import { effectiveBoard, isExpired } from './service.js';

/**
 * Freshness (R11, see packages/schema/src/freshness.ts): what changed on each page since the
 * reader last looked, and whether an agent-built page's written parts still match their data.
 * Computed from the change log on request; nothing here is a revision.
 */

/**
 * What a view reads: a report page's named reads (R13), a report document's components and named
 * reads (R14), or its board's queries.
 */
export function viewReads(view: Entity<'view'>): BoardReads {
  if (view.data.page) return pageReads(view.data.page);
  if (view.data.doc) return docReads(view.data.doc);
  return boardReads(effectiveBoard(view));
}

/** The one reader of a local install: the owner, who writes from the web app as human:me. */
export const READER: Author = { kind: 'human', name: 'me' };

const RECENT = 5;
const ITEMS = 5;

const isMark = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/**
 * The reader's seen marks; the first call starts keeping track from the latest revision. A
 * damaged setting is repaired, not trusted: a bad baseline starts again from the latest revision
 * and bad view marks are dropped (those views count from the baseline).
 */
export function seenMarks(store: Store): SeenMarks {
  const latest = store.latestRevisionId();
  const stored = store.setting<unknown>(SEEN_SETTING);
  const raw =
    stored && typeof stored === 'object' && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : undefined;
  const views =
    raw?.views && typeof raw.views === 'object' && !Array.isArray(raw.views)
      ? (raw.views as Record<string, unknown>)
      : {};
  const marks: SeenMarks = {
    baseline: isMark(raw?.baseline) ? Math.min(raw.baseline, latest) : latest,
    views: Object.fromEntries(
      Object.entries(views).flatMap(([id, mark]) =>
        isMark(mark) ? [[id, Math.min(mark, latest)]] : [],
      ),
    ),
  };
  if (!isDeepStrictEqual(stored, marks)) store.setSetting(SEEN_SETTING, marks);
  return marks;
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
      at: row.created_at,
    });
  }
  return out;
}

/**
 * The change log as agents may see it (R11 review, gap 1): nothing of items hidden from them, and
 * only the fields they can read of the rest (a change to a file's notes alone is no change). The
 * same rules as every agent read, applied to past changes.
 */
function asAgentSees(files: AgentFiles, revisions: LoggedRevision[]): LoggedRevision[] {
  return revisions.map((revision) => ({
    ...revision,
    changes: revision.changes.flatMap((change) => {
      if (!files.visible(change.id)) return [];
      const seen = (data: Record<string, unknown> | null) =>
        data ? files.data(change.type, change.id, data) : null;
      const [before, after] = [seen(change.before), seen(change.after)];
      return isDeepStrictEqual(before, after) ? [] : [{ ...change, before, after }];
    }),
  }));
}

function labelOf(change: ChangeLike): string | null {
  const data = change.after ?? change.before;
  const value = data?.[ENTITIES[change.type].label];
  return typeof value === 'string' ? value : null;
}

const isReader = (author: Author) => author.kind === READER.kind && author.name === READER.name;

/** Filter matchers over one dataset, one per calendar day ("$today" as that day). */
function matchersFor(dataset: ProjectDataset) {
  const byDay = new Map<string, FilterMatcher>();
  return (day: string) => {
    let found = byDay.get(day);
    if (!found) byDay.set(day, (found = filterMatcher(dataset, { today: day })));
    return found;
  };
}

/**
 * The revisions after `since` that touched a page: changed the view itself (when `page` is on)
 * or data its blocks read. `everything` lets an activity feed count every change. Each revision
 * is judged on its own day: a task moved to "due today" counts on the day it was moved.
 */
function pageChanges(
  revisions: LoggedRevision[],
  view: Entity<'view'>,
  reads: BoardReads,
  matcherOn: (day: string) => FilterMatcher,
  options: { since: number; page: boolean; everything: boolean; skip: (a: Author) => boolean },
): PageChanges | null {
  const touched: PageChange[] = [];
  for (const revision of revisions) {
    if (revision.id <= options.since || options.skip(revision.author)) continue;
    const page = options.page && revision.changes.some((c) => c.id === view.id);
    const items: ChangedItem[] = [];
    const matches = matcherOn(localToday(revision.at));
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
 * The view as an agent built it: its data in the revision that set its current evidence
 * revision (the first change to it after that revision), or null when the log has none.
 */
function builtVersion(
  store: Store,
  view: Entity<'view'>,
  evidenceRevision: number,
): { view: Entity<'view'>; at: string } | null {
  const row = store.database
    .prepare(
      `SELECT c.after, r.created_at FROM changes c JOIN revisions r ON r.id = c.revision_id
       WHERE c.entity_id = ? AND c.revision_id > ? ORDER BY c.revision_id, c.seq LIMIT 1`,
    )
    .get(view.id, evidenceRevision) as { after: string | null; created_at: string } | undefined;
  if (!row?.after) return null;
  const data = JSON.parse(row.after) as Entity<'view'>['data'];
  return data.evidenceRevision === evidenceRevision
    ? { view: { ...view, data }, at: row.created_at }
    : null;
}

/** What the page's queries select on one day (and when each repeating record is due). */
function selectionOn(dataset: ProjectDataset, reads: BoardReads, day: string): string {
  return JSON.stringify(
    reads.queries.map((q) =>
      runQuery(dataset, q.type, q.filter ?? {}, { today: day }).map((row) =>
        row.type === 'record'
          ? `${row.id}:${dueOf(dataset, row as Entity<'record'>, { today: day })?.band ?? ''}`
          : row.id,
      ),
    ),
  );
}

export type FreshnessOptions = {
  /** Only this view (shown or not). */
  view?: string;
  /** Replaces the reader's mark for that view. */
  since?: number;
  /**
   * Work out evidence as an agent may see it (hidden files and withheld fields left out), for
   * the snapshot and the answer brief. Seen marks are the reader's own and stay out of it.
   */
  files?: AgentFiles;
};

/**
 * Freshness of a project's views (the ones shown: not archived or expired, unless `view` names
 * one). `since` replaces the reader's mark for that view, so a page can keep listing what changed
 * since it was opened after it marked itself seen.
 */
export function projectFreshness(
  store: Store,
  projectId: string,
  options: FreshnessOptions = {},
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
  const logged = revisionsAfter(store, projectId, from);
  const revisions = options.files ? asAgentSees(options.files, logged) : logged;
  const dataset = options.files
    ? options.files.dataset(store.dataset(projectId))
    : store.dataset(projectId);
  const matcherOn = matchersFor(dataset);
  const today = localToday();
  const out: Record<string, ViewFreshness> = {};
  for (const view of views) {
    const seen = seenOf(view);
    const reads = viewReads(view);
    const changed = options.files
      ? null
      : pageChanges(revisions, view, reads, matcherOn, {
          since: seen,
          page: true,
          everything: true,
          // The reader knows what they changed; Pharos's own housekeeping isn't news.
          skip: (a) => isReader(a) || a.kind === 'system',
        });
    out[view.id] = {
      viewId: view.id,
      seen,
      changed,
      evidence: evidenceOf(store, view, reads, revisions, dataset, matcherOn, today),
    };
  }
  return { projectId, latest, views: out };
}

/** The data fields a change sets differently. */
function changedFields(change: ChangeLike): string[] {
  const before = change.before ?? {};
  const after = change.after ?? {};
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(
    (k) => !isDeepStrictEqual(before[k], after[k]),
  );
}

const OWNER_FIELDS = new Set<string>(OWNER_DECISION_FIELDS);
/** What answering a decision writes besides the owner's fields: accepted, by whom, on which day. */
const ANSWER_FIELDS = new Set<string>([
  ...OWNER_DECISION_FIELDS,
  'status',
  'decidedById',
  'decisionDate',
]);

/**
 * A decision answered, changed or reopened: a change that sets the owner-only fields (the choice,
 * an answer of their own, a deferral) and nothing else but the status, who decided and when.
 */
function isAnswer(change: ChangeLike): boolean {
  if (change.type !== 'decision' || !change.before || !change.after) return false;
  const fields = changedFields(change);
  return fields.some((f) => OWNER_FIELDS.has(f)) && fields.every((f) => ANSWER_FIELDS.has(f));
}

/** What answering a task writes: its status (done, won't do), a reply, a later day. */
const TASK_ANSWER_FIELDS = new Set<string>(['status', ...OWNER_TASK_FIELDS]);

/** A task ticked or answered otherwise: only its status, the reply or the later day change. */
function isTaskAnswer(change: ChangeLike): boolean {
  const fields = changedFields(change);
  return fields.length > 0 && fields.every((f) => TASK_ANSWER_FIELDS.has(f));
}

/** The tasks a document shows in its TaskChecklists, where the reader ticks them (R15). */
function checklistReads(doc: ReportDoc): BoardReads {
  const widgets = docLeaves(doc.blocks).flatMap((b) =>
    b.kind === 'block' && b.node.component === 'TaskChecklist' ? [{ id: b.id, node: b.node }] : [],
  );
  return boardReads({ component: 'Board', widgets });
}

/**
 * The revisions without the reader's own answers on a document (R15): a decision the document
 * asks about answered (and the person recorded as deciding it, made in the same revision) and a
 * task's status ticked (or its reply or later day set) by a person in one of its TaskChecklists. Answers are what the document asks for, not news that makes its words
 * out of date; anything else in those revisions (an agent changing the decision's title) still
 * counts.
 */
function withoutAnswers(
  revisions: LoggedRevision[],
  docs: ReportDoc[],
  matcherOn: (day: string) => FilterMatcher,
): LoggedRevision[] {
  const ticks = docs.map(checklistReads).reduce(mergeReads);
  // Only the decisions the document asks about: an answer to another one is news like any change.
  const asked = new Set(docs.flatMap((d) => [...docDecisionIds(d)]));
  const answer = (change: ChangeLike) => isAnswer(change) && asked.has(change.id);
  // Only the reader's own ticks: an agent moving a task is news too.
  const ticked = (change: ChangeLike, day: string, author: Author) =>
    author.kind === 'human' &&
    change.type === 'task' &&
    !!change.before &&
    !!change.after &&
    ticks.queries.length > 0 &&
    isTaskAnswer(change) &&
    changeTouches(ticks, change, matcherOn(day), { everything: false });
  return revisions.map((revision) => {
    const answers = revision.changes.filter(answer);
    const deciders = new Set(answers.map((c) => c.after?.decidedById).filter(Boolean));
    const day = localToday(revision.at);
    return {
      ...revision,
      changes: revision.changes.filter(
        (c) =>
          !answer(c) &&
          !(c.op === 'create' && c.type === 'assignee' && deciders.has(c.id)) &&
          !ticked(c, day, revision.author),
      ),
    };
  });
}

/**
 * Whether what an agent wrote on a page still matches the data it was written from. The page's
 * dependencies are what it read when it was built together with what it reads now, so removing
 * a block (or renaming the page) never makes old words fresh. A page that reads nothing has no
 * evidence anyone can check; a date-relative page written on an earlier day is stale once its
 * blocks select other items today, with or without a revision.
 */
function evidenceOf(
  store: Store,
  view: Entity<'view'>,
  current: BoardReads,
  revisions: LoggedRevision[],
  dataset: ProjectDataset,
  matcherOn: (day: string) => FilterMatcher,
  today: string,
): ViewFreshness['evidence'] {
  const evidenceRevision = view.data.evidenceRevision;
  if (evidenceRevision === undefined) return view.data.kind === 'answer' ? { unknown: true } : null;
  const built = builtVersion(store, view, evidenceRevision);
  const reads = built ? mergeReads(viewReads(built.view), current) : current;
  if (readsNothing(reads))
    return view.data.kind === 'answer' ? { unknown: true, reason: 'no_data' } : null;
  // A document asks the reader for answers (R15): giving them doesn't make it out of date.
  const docs = [view.data.doc, built?.view.data.doc].filter((d): d is ReportDoc => !!d);
  const counted = docs.length ? withoutAnswers(revisions, docs, matcherOn) : revisions;
  let stale = pageChanges(counted, view, reads, matcherOn, {
    since: evidenceRevision,
    page: false,
    everything: false,
    // Anyone's change to the data makes the written parts stale, the owner's included.
    skip: (a) => a.kind === 'system',
  });
  const day = built ? localToday(built.at) : undefined;
  if (
    reads.dates &&
    day &&
    day < today &&
    selectionOn(dataset, reads, day) !== selectionOn(dataset, reads, today)
  )
    stale = {
      ...(stale ?? { since: evidenceRevision, total: 0, recent: [] }),
      calendar: { from: day, to: today },
    };
  return {
    revision: evidenceRevision,
    at: store.revision(evidenceRevision)?.createdAt ?? null,
    stale,
  };
}

/** Every project's views that changed since the reader looked (for the sidebar and tabs). */
export function changedViews(store: Store): ChangedViews {
  const projects: Record<string, string[]> = {};
  const marksKey = `${JSON.stringify(store.setting<unknown>(SEEN_SETTING) ?? null)}|${localToday()}`;
  for (const project of store.list('project')) {
    if (project.data.status === 'archived') continue;
    // Reused until this project changes, the seen marks move or the day turns.
    const { views } = perProject(store, 'freshness', project.id, marksKey, () =>
      projectFreshness(store, project.id),
    );
    const changed = Object.values(views)
      .filter((v) => v.changed)
      .map((v) => v.viewId);
    if (changed.length) projects[project.id] = changed;
  }
  return { latest: store.latestRevisionId(), projects };
}

/**
 * Whether an agent-built view's written parts still match their data, for agents deciding whether
 * to reuse it (R11.6): fresh, stale, or unknown (no evidence revision, made before R11 or by a
 * person, or nothing on it reads the data). Worked out as an agent may see the data (R11 review,
 * gap 1), so it never varies with hidden files or fields agents can't read.
 */
export function evidenceState(store: Store, view: Entity<'view'>): 'fresh' | 'stale' | 'unknown' {
  if (view.data.evidenceRevision === undefined) return 'unknown';
  const evidence = projectFreshness(store, view.data.projectId, {
    view: view.id,
    files: new AgentFiles(store),
  }).views[view.id]?.evidence;
  if (!evidence || 'unknown' in evidence) return 'unknown';
  return evidence.stale ? 'stale' : 'fresh';
}
