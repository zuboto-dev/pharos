import {
  ENTITIES,
  KIND_OF_OP,
  OPTION_FIELDS,
  OPTION_KEYS,
  UPDATES_DEFAULT_DAYS,
  UPDATES_PAGE_REVISIONS,
  UPDATE_SESSION_GAP_MINUTES,
  emptyCounts,
  fileUrl,
  findOption,
  imageSource,
  type Author,
  type Change,
  type ChangeOp,
  type Entity,
  type EntityType,
  type OptionKey,
  type UpdateCounts,
  type UpdateEntity,
  type UpdateField,
  type UpdateLookup,
  type UpdateOption,
  type UpdateSession,
  type Updates,
  type UpdatesBucket,
} from '@pharos/schema';
import { LookupLog, type LookupRow } from './lookups.js';
import { PharosError } from './store/errors.js';
import { foldChanges, type Store } from './store/store.js';

/**
 * The Updates page's data (decision "Updates view: Pharos draws it"): revisions and read calls
 * grouped into work sessions (one author, one project, gaps under 30 minutes), with counts by
 * kind and entity type and each entity's before → after. Bounded: a page holds at most
 * UPDATES_PAGE_REVISIONS revisions; the tiles and timeline always cover the last week.
 */

export type UpdatesQuery = {
  /** ISO time, or a revision id (work after it). Default: a week ago. */
  since?: string;
  /** ISO time: only work before it (paging; the previous page's nextBefore). */
  before?: string;
  projectId?: string;
  /** An author's name. */
  author?: string;
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Entities per session, and lookups per session, shown at most. */
const ENTITIES_PER_SESSION = 60;
const LOOKUPS_PER_SESSION = 40;
const TEXT_MAX = 280;

type RevisionRow = {
  id: number;
  author_kind: string;
  author_name: string;
  message: string;
  created_at: string;
  revert_of: number | null;
};
type ChangeRow = {
  revision_id: number;
  seq: number;
  op: string;
  entity_type: string;
  entity_id: string;
  project_id: string | null;
  before: string | null;
  after: string | null;
};

/** A value small enough to show as is, or what it is and how big. */
export function compactValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string')
    return value.length > TEXT_MAX ? `${value.slice(0, TEXT_MAX - 1)}…` : value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const small = value.length <= 8 && value.every((v) => v === null || typeof v !== 'object');
    return small ? value.map(compactValue) : { $summary: 'list', size: value.length };
  }
  const text = JSON.stringify(value);
  return text.length <= 160 ? value : { $summary: 'object', size: Object.keys(value).length };
}

function optionKeyFor(type: EntityType, field: string): OptionKey | undefined {
  return OPTION_KEYS.find(
    (k) => OPTION_FIELDS[k].type === type && OPTION_FIELDS[k].field === field,
  );
}

function optionOf(
  project: Entity<'project'> | null,
  key: OptionKey,
  value: unknown,
): UpdateOption | null {
  if (typeof value !== 'string') return null;
  const found = findOption(project, key, value);
  return { value, label: found?.label ?? value, color: found?.color ?? 'neutral' };
}

function pictureUrl(value: unknown): string | undefined {
  const source = imageSource(value);
  if (source.kind === 'file') return fileUrl('content', source.fileId);
  if (source.kind === 'url' && source.safe) return source.url;
  return undefined;
}

const iso = (ms: number) => new Date(ms).toISOString();
const localDay = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** What the store says about a change's kind: create/update/delete as added/changed/removed. */
const kindOf = (op: ChangeOp) => KIND_OF_OP[op];

export function updatesOf(
  store: Store,
  query: UpdatesQuery = {},
  options: { lookups?: LookupLog; now?: Date } = {},
): Updates {
  const now = options.now ?? new Date();
  const db = store.database;
  const lookups = options.lookups ?? new LookupLog(store, () => now);
  const weekAgo = now.getTime() - UPDATES_DEFAULT_DAYS * DAY;

  const since = resolveSince(store, query.since, weekAgo);
  const until = query.before ? parseTime(query.before, 'before') : iso(now.getTime() + 1);

  // ------------------------------------------------------------ the page's revisions
  const clauses = ['r.created_at >= ?', 'r.created_at < ?'];
  const params: (string | number)[] = [since, until];
  if (query.since && /^\d+$/.test(query.since)) {
    // A revision id: exactly the revisions after it, whatever their times.
    clauses.push('r.id > ?');
    params.push(Number(query.since));
  }
  if (query.author) {
    clauses.push('r.author_name = ?');
    params.push(query.author);
  }
  if (query.projectId) {
    clauses.push('r.id IN (SELECT revision_id FROM changes WHERE project_id = ?)');
    params.push(query.projectId);
  }
  let revisions = db
    .prepare(
      `SELECT r.* FROM revisions r WHERE ${clauses.join(' AND ')} ORDER BY r.id DESC LIMIT ?`,
    )
    .all(...params, UPDATES_PAGE_REVISIONS + 1) as RevisionRow[];
  let nextBefore: string | null = null;
  let pageSince = since;
  if (revisions.length > UPDATES_PAGE_REVISIONS) {
    const first = revisions[UPDATES_PAGE_REVISIONS]!.created_at;
    revisions = revisions.slice(0, UPDATES_PAGE_REVISIONS);
    // The page ends at its oldest revision's time. When the next one has that same time, all of
    // them go to the next page (unless that is all of this one), so none falls between pages.
    const oldest = revisions[revisions.length - 1]!.created_at;
    const kept = revisions.filter((r) => r.created_at > oldest);
    if (first === oldest && kept.length) revisions = kept;
    pageSince = revisions[revisions.length - 1]!.created_at;
    nextBefore = pageSince;
  }

  const changes = new Map<number, (Change & { revisionId: number })[]>();
  if (revisions.length) {
    const ids = revisions.map((r) => r.id);
    const rows = db
      .prepare(`SELECT * FROM changes WHERE revision_id BETWEEN ? AND ? ORDER BY revision_id, seq`)
      .all(Math.min(...ids), Math.max(...ids)) as ChangeRow[];
    const wanted = new Set(ids);
    for (const row of rows) {
      if (!wanted.has(row.revision_id)) continue;
      const list = changes.get(row.revision_id) ?? [];
      list.push({
        revisionId: row.revision_id,
        seq: row.seq,
        op: row.op as ChangeOp,
        type: row.entity_type as EntityType,
        id: row.entity_id,
        projectId: row.project_id,
        before: row.before ? JSON.parse(row.before) : null,
        after: row.after ? JSON.parse(row.after) : null,
      });
      changes.set(row.revision_id, list);
    }
  }
  const revertedBy = new Map<number, number>();
  if (revisions.length) {
    const rows = db
      .prepare('SELECT id, revert_of FROM revisions WHERE revert_of BETWEEN ? AND ?')
      .all(revisions[revisions.length - 1]!.id, revisions[0]!.id) as {
      id: number;
      revert_of: number;
    }[];
    for (const r of rows) revertedBy.set(r.revert_of, r.id);
  }

  // ------------------------------------------------------------ names
  const projects = new Map(store.list('project').map((p) => [p.id, p]));
  const projectName = (id: string | null): string | null => {
    if (!id) return null;
    const live = projects.get(id);
    if (live) return live.data.name;
    const gone = store.lastKnown(id);
    return gone ? String((gone.data as { name?: unknown }).name ?? id) : id;
  };
  const labels = new Map<string, string | null>();
  const labelOf = (id: string | null): string | null => {
    if (!id) return null;
    if (!labels.has(id)) {
      const known = store.lastKnown(id);
      const value = known
        ? (known.data as Record<string, unknown>)[ENTITIES[known.type].label]
        : null;
      labels.set(id, typeof value === 'string' ? value : null);
    }
    return labels.get(id) ?? null;
  };

  // ------------------------------------------------------------ units, then sessions
  type Unit =
    | {
        kind: 'revision';
        at: string;
        author: Author;
        projectId: string | null;
        row: RevisionRow;
        changes: Change[];
      }
    | { kind: 'lookup'; at: string; author: Author; projectId: string | null; row: LookupRow };
  const units: Unit[] = [];
  for (const row of revisions) {
    const all = changes.get(row.id) ?? [];
    // A revision that touches two projects counts in each; changes outside any project (an
    // assignee, a repository) go with the revision's only project, if it has one.
    const byProject = new Map<string | null, Change[]>();
    for (const c of all) {
      const list = byProject.get(c.projectId) ?? [];
      list.push(c);
      byProject.set(c.projectId, list);
    }
    const loose = byProject.get(null);
    const owned = [...byProject.keys()].filter((k): k is string => k !== null);
    if (loose && owned.length === 1) {
      byProject.get(owned[0]!)!.push(...loose);
      byProject.delete(null);
    }
    const author: Author = { kind: row.author_kind as Author['kind'], name: row.author_name };
    for (const [projectId, list] of byProject) {
      if (query.projectId && projectId !== query.projectId) continue;
      units.push({ kind: 'revision', at: row.created_at, author, projectId, row, changes: list });
    }
  }
  for (const row of lookups.list({
    since: pageSince,
    until,
    projectId: query.projectId,
    agent: query.author,
  })) {
    units.push({
      kind: 'lookup',
      at: row.at,
      author: { kind: 'agent', name: row.agent },
      projectId: row.projectId,
      row,
    });
  }
  units.sort((a, b) => a.at.localeCompare(b.at));

  type Building = {
    session: UpdateSession;
    changes: Change[];
    lookups: LookupRow[];
    endMs: number;
  };
  const open = new Map<string, Building>();
  const built: Building[] = [];
  const gap = UPDATE_SESSION_GAP_MINUTES * 60_000;
  const latestOpen = new Map<string, { key: string; endMs: number }>();
  for (const unit of units) {
    // Reads count under the agent's name whatever kind its writes have.
    const ms = Date.parse(unit.at);
    let key = `${unit.author.name}\u0000${unit.projectId ?? ''}`;
    // A read outside any project (desk_list) joins the agent's session going on at the time.
    if (unit.kind === 'lookup' && !unit.projectId) {
      const going = latestOpen.get(unit.author.name);
      if (going && ms - going.endMs < gap) key = going.key;
    }
    let b = open.get(key);
    if (!b || ms - b.endMs >= gap) {
      b = {
        session: {
          id: `${unit.author.name}:${unit.projectId ?? '-'}:${unit.at}`,
          author: unit.author,
          projectId: unit.projectId,
          project: projectName(unit.projectId),
          start: unit.at,
          end: unit.at,
          counts: emptyCounts(),
          byType: [],
          revisions: [],
          entities: [],
          moreEntities: 0,
          lookups: [],
        },
        changes: [],
        lookups: [],
        endMs: ms,
      };
      open.set(key, b);
      built.push(b);
    }
    b.endMs = ms;
    latestOpen.set(unit.author.name, { key, endMs: ms });
    b.session.end = unit.at;
    if (unit.kind === 'lookup') {
      b.lookups.push(unit.row);
      continue;
    }
    // A revision's author kind wins over a lookup's guess.
    b.session.author = unit.author;
    const net = foldChanges(unit.changes);
    const counts = { added: 0, changed: 0, removed: 0 };
    for (const d of net) counts[kindOf(d.op)] += 1;
    b.session.revisions.unshift({
      id: unit.row.id,
      message: unit.row.message,
      at: unit.row.created_at,
      revertOf: unit.row.revert_of,
      revertedBy: revertedBy.get(unit.row.id) ?? null,
      counts,
    });
    b.changes.push(...unit.changes);
  }

  // Reads outside any project made just before the agent went to a project join that session.
  const merged = built.filter((b) => {
    if (b.session.projectId || b.session.revisions.length) return true;
    const into = built.find(
      (o) =>
        o !== b &&
        o.session.projectId &&
        o.session.author.name === b.session.author.name &&
        Math.abs(Date.parse(o.session.start) - b.endMs) < gap,
    );
    if (!into) return true;
    into.lookups.unshift(...b.lookups);
    if (b.session.start < into.session.start) into.session.start = b.session.start;
    return false;
  });
  const sessions = merged.map((b) => finish(b, store, projects, labelOf));
  sessions.sort((a, b) => b.end.localeCompare(a.end));

  // ------------------------------------------------------------ tiles and timeline (a week)
  const stats = weekStats(store, lookups, now, query);

  return {
    since,
    until: query.before ? until : now.toISOString(),
    ...stats,
    sessions,
    projects: [...projects.values()].map((p) => ({ id: p.id, name: p.data.name })),
    nextBefore,
  };

  function finish(
    b: Building,
    s: Store,
    projectMap: Map<string, Entity<'project'>>,
    label: (id: string | null) => string | null,
  ): UpdateSession {
    const { session } = b;
    const project = session.projectId ? (projectMap.get(session.projectId) ?? null) : null;
    const diffs = foldChanges(b.changes);
    const byType = new Map<EntityType, UpdateSession['byType'][number]>();
    for (const d of diffs) {
      const kind = kindOf(d.op);
      session.counts[kind] += 1;
      const t = byType.get(d.type) ?? { type: d.type, added: 0, changed: 0, removed: 0 };
      t[kind] += 1;
      byType.set(d.type, t);
    }
    session.byType = [...byType.values()].sort(
      (x, y) => y.added + y.changed + y.removed - (x.added + x.changed + x.removed),
    );
    const assets = assetPictures(s, diffs, session);
    session.entities = diffs.slice(0, ENTITIES_PER_SESSION).map((d) => {
      const fields: UpdateField[] = [];
      for (const [field, diff] of Object.entries(d.fields)) {
        const key = optionKeyFor(d.type, field);
        const refSpec = (ENTITIES[d.type].refs as Record<string, unknown>)[field];
        const names = (v: unknown): string | string[] | null =>
          typeof v === 'string'
            ? (labelOf(v) ?? v)
            : Array.isArray(v)
              ? v.map((id) => (typeof id === 'string' ? (labelOf(id) ?? id) : String(id)))
              : null;
        fields.push({
          field,
          before: compactValue(diff.before),
          after: compactValue(diff.after),
          ...(key
            ? {
                option: {
                  before: optionOf(project, key, diff.before),
                  after: optionOf(project, key, diff.after),
                },
              }
            : {}),
          ...(refSpec ? { ref: { before: names(diff.before), after: names(diff.after) } } : {}),
        });
      }
      const entity: UpdateEntity = { op: d.op, type: d.type, id: d.id, label: d.label, fields };
      const pictures: NonNullable<UpdateEntity['pictures']> = [];
      const image = d.fields.image;
      if (image) {
        const before = pictureUrl(image.before);
        const after = pictureUrl(image.after);
        if (before || after) pictures.push({ before, after });
      }
      pictures.push(...(assets.get(d.id) ?? []).map((after) => ({ after })));
      if (pictures.length) entity.pictures = pictures.slice(0, 4);
      return entity;
    });
    session.moreEntities = Math.max(0, diffs.length - ENTITIES_PER_SESSION);
    // Lookups: the same thing read again counts once, with how many times; latest first.
    const grouped = new Map<string, UpdateLookup>();
    for (const row of b.lookups) {
      const k = `${row.tool}\u0000${row.targetId ?? row.targetType ?? ''}`;
      const entry = grouped.get(k) ?? {
        tool: row.tool,
        targetId: row.targetId,
        targetType: row.targetType,
        label: label(row.targetId),
        count: 0,
        at: row.at,
      };
      entry.count += 1;
      entry.at = row.at;
      grouped.set(k, entry);
    }
    session.counts.lookedUp = b.lookups.length;
    session.lookups = [...grouped.values()]
      .sort((x, y) => y.at.localeCompare(x.at))
      .slice(0, LOOKUPS_PER_SESSION);
    return session;
  }
}

/** Report pictures uploaded to the views a session changed, while it ran (give or take). */
function assetPictures(
  store: Store,
  diffs: { type: EntityType; id: string; op: ChangeOp }[],
  session: UpdateSession,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const views = diffs.filter((d) => d.type === 'view' && d.op !== 'delete').map((d) => d.id);
  if (!views.length) return out;
  const from = iso(Date.parse(session.start) - 10 * 60_000);
  const to = iso(Date.parse(session.end) + 10 * 60_000);
  const rows = store.database
    .prepare(
      `SELECT view_id, path FROM report_assets
        WHERE view_id IN (${views.map(() => '?').join(',')}) AND updated_at BETWEEN ? AND ?
          AND mime LIKE 'image/%' ORDER BY updated_at DESC LIMIT 12`,
    )
    .all(...views, from, to) as { view_id: string; path: string }[];
  for (const row of rows) {
    // A document's pictures are served under assets/, a report page's under page/; a board has
    // none to show.
    const data = store.get(row.view_id)?.data as { doc?: unknown; page?: unknown } | undefined;
    const under = data?.doc ? 'assets' : data?.page ? 'page' : null;
    if (!under) continue;
    const list = out.get(row.view_id) ?? [];
    if (list.length < 3)
      list.push(
        `/api/views/${encodeURIComponent(row.view_id)}/${under}/${row.path.split('/').map(encodeURIComponent).join('/')}`,
      );
    out.set(row.view_id, list);
  }
  return out;
}

function parseTime(value: string, name: string): string {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new PharosError('invalid', `${name} must be an ISO time`);
  return iso(ms);
}

/** `since` as an ISO time: a revision id becomes that revision's time. */
function resolveSince(store: Store, since: string | undefined, fallback: number): string {
  if (!since) return iso(fallback);
  if (/^\d+$/.test(since)) {
    const id = Number(since);
    if (id === 0) return iso(0);
    const row = store.database.prepare('SELECT created_at FROM revisions WHERE id = ?').get(id) as
      { created_at: string } | undefined;
    if (!row) throw new PharosError('not_found', `Revision ${id} not found`);
    // Strictly after it: a millisecond later.
    return iso(Date.parse(row.created_at) + 1);
  }
  return parseTime(since, 'since');
}

/**
 * The last week, per hour and per local day, and the last 24 hours: counts of changes (each
 * change row by its op) and lookups, with the page's project and author filters. One grouped
 * query each, so the tiles never depend on paging.
 */
function weekStats(store: Store, lookups: LookupLog, now: Date, query: UpdatesQuery) {
  const nowMs = now.getTime();
  const firstHour = Math.floor((nowMs - UPDATES_DEFAULT_DAYS * DAY) / HOUR) * HOUR + HOUR;
  const start = iso(firstHour);
  const clauses = ['r.created_at >= ?'];
  const params: string[] = [start];
  if (query.author) {
    clauses.push('r.author_name = ?');
    params.push(query.author);
  }
  if (query.projectId) {
    clauses.push('c.project_id = ?');
    params.push(query.projectId);
  }
  const rows = store.database
    .prepare(
      `SELECT r.created_at AS at, c.op AS op, COUNT(*) AS n
         FROM revisions r JOIN changes c ON c.revision_id = r.id
        WHERE ${clauses.join(' AND ')}
        GROUP BY r.id, c.op`,
    )
    .all(...params) as { at: string; op: ChangeOp; n: number }[];
  const reads = lookups.list({ since: start, projectId: query.projectId, agent: query.author });
  const authorRows = store.database
    .prepare(
      `SELECT DISTINCT author_kind AS kind, author_name AS name FROM revisions WHERE created_at >= ?`,
    )
    .all(start) as Author[];

  const hours: UpdatesBucket[] = [];
  for (let h = firstHour; h <= nowMs; h += HOUR) hours.push({ at: iso(h), ...emptyCounts() });
  const dayStarts: number[] = [];
  const today = localDay(nowMs);
  for (let i = UPDATES_DEFAULT_DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dayStarts.push(d.getTime());
  }
  const days: UpdatesBucket[] = dayStarts.map((d) => ({ at: iso(d), ...emptyCounts() }));
  const last24h: UpdateCounts = emptyCounts();
  const add = (atIso: string, kind: keyof UpdateCounts, n: number) => {
    const ms = Date.parse(atIso);
    const hi = Math.floor((ms - firstHour) / HOUR);
    if (hi >= 0 && hi < hours.length) hours[hi]![kind] += n;
    const day = localDay(ms);
    const di = dayStarts.indexOf(day);
    if (di >= 0) days[di]![kind] += n;
    if (ms > nowMs - DAY) last24h[kind] += n;
  };
  for (const row of rows) add(row.at, kindOf(row.op), row.n);
  for (const row of reads) add(row.at, 'lookedUp', 1);

  const authors = new Map<string, Author>();
  for (const a of authorRows) authors.set(a.name, a);
  const readers = store.database
    .prepare('SELECT DISTINCT agent FROM lookups WHERE at >= ?')
    .all(start) as { agent: string }[];
  for (const r of readers)
    if (!authors.has(r.agent)) authors.set(r.agent, { kind: 'agent', name: r.agent });
  return {
    last24h,
    days,
    hours,
    authors: [...authors.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}
