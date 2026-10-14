import type { EntityType } from './entities.js';
import type { Author, ChangeOp } from './revisions.js';

/**
 * Freshness (R11): what changed on a page since its reader last looked, and whether an answer's
 * written parts still match the data they were written from.
 *
 * - **Seen**: per view and per reader, the latest revision the reader had when they last opened
 *   it. An app setting (`SEEN_SETTING`), never a revision. Views the reader never opened count
 *   from the moment Pharos started keeping track (`baseline`), so an existing install starts calm.
 * - **Changed since you looked**: a later revision, by anyone but the reader, that changed the
 *   view itself or data one of its blocks reads (an item matching a block's query before or after
 *   the change, an item a block names, the project for a header; an activity feed reads all).
 * - **Evidence**: the revision an agent built a view from (`evidenceRevision`, set by Pharos
 *   when an agent creates a view, answers, or replaces a page's widgets; agents can't set it).
 *   Live blocks always show current data; the prose written at that time (Text, Callout,
 *   headlines) is a snapshot.
 * - **Stale**: a later revision by anyone changed data the page's blocks read. A view without
 *   evidence (made before R11, or by a person) is "evidence unknown". Refresh asks the
 *   answering agent to answer again in the same view (a request with mode "refresh").
 */
export const SEEN_SETTING = 'views.seen';

/** The stored seen marks for the one reader of a local install ("me"). */
export type SeenMarks = {
  /** The latest revision when Pharos started keeping track: never-opened views count from here. */
  baseline: number;
  /** viewId → the latest revision the reader had when they last opened it. */
  views: Record<string, number>;
};

export type ChangedItem = { type: EntityType; id: string; label: string | null; op: ChangeOp };

/** One revision that touched a page. */
export type PageChange = {
  revision: number;
  at: string;
  author: Author;
  message: string;
  /** The data items it changed that the page reads (at most 5). */
  items: ChangedItem[];
  /** It changed the page itself (its blocks, name, …). */
  page: boolean;
};

export type PageChanges = {
  /** Counted from after this revision. */
  since: number;
  /** How many revisions touched the page. */
  total: number;
  /** The latest ones first (at most 5). */
  recent: PageChange[];
};

export type ViewFreshness = {
  viewId: string;
  /** The reader's seen mark (or the baseline). */
  seen: number;
  /** What changed since the reader last looked; null when nothing did. */
  changed: PageChanges | null;
  /** For views built by an agent: what its written parts were based on, and what changed since. */
  evidence:
    { revision: number; at: string | null; stale: PageChanges | null } | { unknown: true } | null;
};

export type ProjectFreshness = {
  projectId: string;
  latest: number;
  views: Record<string, ViewFreshness>;
};

/** For the sidebar: which views changed since the reader looked, per project. */
export type ChangedViews = { latest: number; projects: Record<string, string[]> };
