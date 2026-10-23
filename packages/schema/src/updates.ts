import type { EntityType } from './entities.js';
import type { OptionColor } from './options.js';
import type { Author, ChangeOp } from './revisions.js';

/**
 * The Updates page (decision "Updates view: Pharos draws it", 2026-10-23): what changed, was
 * added, removed and looked up, drawn by Pharos from its own history. Changes come from
 * revisions; "looked up" comes from the read log of agents' MCP read calls (an app table, never
 * a revision). Everything here is derived; nothing about it is stored apart from those two.
 */

export const UPDATE_KINDS = ['added', 'changed', 'removed', 'lookedUp'] as const;
export type UpdateKind = (typeof UPDATE_KINDS)[number];

/** The kind of change a revision operation is. */
export const KIND_OF_OP: Record<ChangeOp, Exclude<UpdateKind, 'lookedUp'>> = {
  create: 'added',
  update: 'changed',
  delete: 'removed',
};

export type UpdateCounts = Record<UpdateKind, number>;

/** Consecutive work by one author in one project with gaps under this joins one session. */
export const UPDATE_SESSION_GAP_MINUTES = 30;
/** The default window: the last week. */
export const UPDATES_DEFAULT_DAYS = 7;
/** Revisions per page; older ones come with `before`. */
export const UPDATES_PAGE_REVISIONS = 300;

/** An option value (a status, a priority) as the project names and colours it. */
export type UpdateOption = { value: string; label: string; color: OptionColor };

/** One field's before → after. Long text is cut; objects and long lists become a size. */
export type UpdateField = {
  field: string;
  before: unknown;
  after: unknown;
  /** For option fields: the labels and colours of both values. */
  option?: { before: UpdateOption | null; after: UpdateOption | null };
};

/** A value too big to show: what it is and how big. */
export type UpdateValueSummary = { $summary: 'object' | 'list' | 'text'; size: number };

export type UpdateEntity = {
  op: ChangeOp;
  type: EntityType;
  id: string;
  label: string | null;
  fields: UpdateField[];
  /** Pictures that changed: an artifact's image, or a report's picture files. Web addresses. */
  pictures?: { before?: string; after?: string }[];
};

export type UpdateRevision = {
  id: number;
  message: string;
  at: string;
  revertOf: number | null;
  revertedBy: number | null;
  counts: Omit<UpdateCounts, 'lookedUp'>;
};

export type UpdateLookup = {
  tool: string;
  targetId: string | null;
  targetType: string | null;
  label: string | null;
  /** How many times the same thing was looked up in this session. */
  count: number;
  /** The last time. */
  at: string;
};

export type UpdateSession = {
  /** Stable for a page: `<author>:<project>:<start>`. */
  id: string;
  author: Author;
  projectId: string | null;
  project: string | null;
  start: string;
  end: string;
  counts: UpdateCounts;
  /** Per entity type, busiest first. */
  byType: { type: EntityType; added: number; changed: number; removed: number }[];
  /** Newest first. */
  revisions: UpdateRevision[];
  /** Net change per entity across the session, in first-touched order. */
  entities: UpdateEntity[];
  /** Entities left out to keep the page small. */
  moreEntities: number;
  lookups: UpdateLookup[];
};

export type UpdatesBucket = { at: string } & UpdateCounts;

export type Updates = {
  /** The window this page covers (ISO). */
  since: string;
  until: string;
  /** The last 24 hours, for the tiles. */
  last24h: UpdateCounts;
  /** Per local day, oldest first, for the last 7 days (the tiles' sparklines). */
  days: UpdatesBucket[];
  /** Per hour, oldest first, over the last 7 days (the timeline). */
  hours: UpdatesBucket[];
  /** Newest first. */
  sessions: UpdateSession[];
  /** Everyone with work in the last 7 days, for the filter. */
  authors: Author[];
  projects: { id: string; name: string }[];
  /** Pass as `before` for older sessions; null when there are none. */
  nextBefore: string | null;
};

export const emptyCounts = (): UpdateCounts => ({ added: 0, changed: 0, removed: 0, lookedUp: 0 });
