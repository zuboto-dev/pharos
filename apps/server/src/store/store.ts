import { randomUUID } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import {
  ENTITIES,
  ENTITY_TYPES,
  type ApplyInput,
  type Author,
  type Change,
  type ChangeOp,
  type Entity,
  type EntityDiff,
  type EntityType,
  type FieldDiff,
  type Operation,
  type ProjectDataset,
  type RefSpec,
  type Revision,
  type RevisionSummary,
  OPTION_FIELDS,
  OPTION_KEYS,
  hasOrder,
  isProjectScoped,
  optionsFor,
  valueFor,
  type OptionKey,
} from '@pharos/schema';
import { PharosError, formatPath } from './errors.js';

type Data = Record<string, unknown>;

type EntityRow = {
  id: string;
  type: string;
  project_id: string | null;
  data: string;
  created_at: string;
  updated_at: string;
  created_rev: number;
  updated_rev: number;
};

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

export type ApplyResult = {
  /** Null when the operations changed nothing. */
  revision: Revision | null;
  /** Ids of created entities, by `ref` (or by operation index when no ref was given). */
  created: Record<string, string>;
  changes: EntityDiff[];
};

export type HistoryQuery = {
  projectId?: string;
  entityId?: string;
  limit?: number;
  /** Only revisions with an id lower than this (for paging). */
  before?: number;
  /** Only revisions with an id higher than this (what happened since). */
  after?: number;
  /** Only revisions by this kind of author, e.g. "human" for what people did. */
  authorKind?: Author['kind'];
  /** Leave out revisions by this author name (e.g. the asking agent's own changes). */
  excludeAuthor?: string;
};

function optionKeysOf(type: EntityType): OptionKey[] {
  return OPTION_KEYS.filter((k) => OPTION_FIELDS[k].type === type);
}

const SYSTEM: Author = { kind: 'system', name: 'pharos' };

/** Views every new project starts with. */
const DEFAULT_VIEWS = [{ name: 'Overview', template: 'overview', pinned: true }];

/** For each entity type, the fields on other types that reference it. */
const INCOMING_REFS = new Map<EntityType, { type: EntityType; field: string; spec: RefSpec }[]>();
for (const type of ENTITY_TYPES) {
  for (const [field, spec] of Object.entries(ENTITIES[type].refs as Record<string, RefSpec>)) {
    const list = INCOMING_REFS.get(spec.type) ?? [];
    list.push({ type, field, spec });
    INCOMING_REFS.set(spec.type, list);
  }
}

export function newId(type: EntityType): string {
  return `${ENTITIES[type].prefix}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

function labelOf(type: EntityType, data: Data | null | undefined): string | null {
  const value = data?.[ENTITIES[type].label];
  return typeof value === 'string' ? value : null;
}

function describe(type: EntityType, id: string, data?: Data | null): string {
  const label = labelOf(type, data);
  return label ? `${type} ${id} ("${label}")` : `${type} ${id}`;
}

function toEntity(row: EntityRow): Entity {
  return {
    id: row.id,
    type: row.type as EntityType,
    data: JSON.parse(row.data),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdRev: row.created_rev,
    updatedRev: row.updated_rev,
  };
}

function toRevision(row: RevisionRow): Revision {
  return {
    id: row.id,
    author: { kind: row.author_kind as Author['kind'], name: row.author_name },
    message: row.message,
    createdAt: row.created_at,
    revertOf: row.revert_of,
  };
}

function toChange(row: ChangeRow): Change & { revisionId: number } {
  return {
    revisionId: row.revision_id,
    seq: row.seq,
    op: row.op as ChangeOp,
    type: row.entity_type as EntityType,
    id: row.entity_id,
    projectId: row.project_id,
    before: row.before ? JSON.parse(row.before) : null,
    after: row.after ? JSON.parse(row.after) : null,
  };
}

function fieldDiffs(before: Data | null, after: Data | null): Record<string, FieldDiff> {
  const fields: Record<string, FieldDiff> = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const key of keys) {
    const b = before?.[key] ?? null;
    const a = after?.[key] ?? null;
    if (!isDeepStrictEqual(b, a)) fields[key] = { before: b, after: a };
  }
  return fields;
}

type NetChange = { type: EntityType; before: Data | null; after: Data | null };

/** Net before/after per entity across a sequence of changes, in first-touched order. */
function netChanges(changes: Change[]): Map<string, NetChange> {
  const net = new Map<string, NetChange>();
  for (const change of changes) {
    const entry = net.get(change.id);
    if (entry) entry.after = change.after;
    else net.set(change.id, { type: change.type, before: change.before, after: change.after });
  }
  return net;
}

/** Folds a sequence of changes into the net effect per entity. */
function foldChanges(changes: Change[]): EntityDiff[] {
  const diffs: EntityDiff[] = [];
  for (const [id, { type, before, after }] of netChanges(changes)) {
    if (!before && !after) continue;
    const op: ChangeOp = !before ? 'create' : !after ? 'delete' : 'update';
    const fields = fieldDiffs(before, after);
    if (op === 'update' && Object.keys(fields).length === 0) continue;
    diffs.push({ op, type, id, label: labelOf(type, after ?? before), fields });
  }
  return diffs;
}

export class Store {
  private readonly commitListeners = new Set<() => void>();

  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /** Calls `listener` after every committed revision in this process. Returns an unsubscribe. */
  onCommit(listener: () => void): () => void {
    this.commitListeners.add(listener);
    return () => this.commitListeners.delete(listener);
  }

  /** Revisions after `afterId`, with the projects each one touched (for change feeds). */
  revisionsSince(afterId: number): { id: number; projectIds: string[] }[] {
    const rows = this.db
      .prepare(
        `SELECT r.id AS id, GROUP_CONCAT(DISTINCT c.project_id) AS projects
         FROM revisions r LEFT JOIN changes c ON c.revision_id = r.id
         WHERE r.id > ? GROUP BY r.id ORDER BY r.id`,
      )
      .all(afterId) as { id: number; projects: string | null }[];
    return rows.map((r) => ({ id: r.id, projectIds: r.projects ? r.projects.split(',') : [] }));
  }

  // ---------------------------------------------------------------- reads

  get(id: string): Entity | null {
    const row = this.db.prepare('SELECT * FROM entities WHERE id = ?').get(id) as
      EntityRow | undefined;
    return row ? toEntity(row) : null;
  }

  getOfType<T extends EntityType>(type: T, id: string): Entity<T> {
    const entity = this.get(id);
    if (!entity || entity.type !== type) {
      throw new PharosError('not_found', `${type} ${id} not found`);
    }
    return entity as Entity<T>;
  }

  /** Lists entities of a type, optionally within a project and filtered by field equality. */
  list<T extends EntityType>(
    type: T,
    options: { projectId?: string; where?: Record<string, string | number | boolean> } = {},
  ): Entity<T>[] {
    const clauses = ['type = ?'];
    const params: SQLInputValue[] = [type];
    if (options.projectId !== undefined) {
      if (!isProjectScoped(type)) {
        throw new PharosError('invalid', `${type} is not project-scoped; omit projectId`);
      }
      clauses.push('project_id = ?');
      params.push(options.projectId);
    }
    const shape = ENTITIES[type].data.shape as Record<string, unknown>;
    for (const [field, value] of Object.entries(options.where ?? {})) {
      if (!(field in shape)) {
        throw new PharosError('invalid', `Unknown field "${field}" for ${type}`, [
          `Fields: ${Object.keys(shape).join(', ')}`,
        ]);
      }
      clauses.push('json_extract(data, ?) = ?');
      // json_extract returns JSON booleans as 1/0.
      params.push(`$.${field}`, typeof value === 'boolean' ? Number(value) : value);
    }
    const order = hasOrder(type) ? "json_extract(data, '$.order'), " : '';
    const rows = this.db
      .prepare(`SELECT * FROM entities WHERE ${clauses.join(' AND ')} ORDER BY ${order}created_rev`)
      .all(...params) as EntityRow[];
    return rows.map(toEntity) as Entity<T>[];
  }

  revision(id: number): RevisionSummary | null {
    const row = this.db.prepare('SELECT * FROM revisions WHERE id = ?').get(id) as
      RevisionRow | undefined;
    if (!row) return null;
    return this.summarize(row);
  }

  private summarize(row: RevisionRow): RevisionSummary {
    const reverted = this.db.prepare('SELECT id FROM revisions WHERE revert_of = ?').get(row.id) as
      { id: number } | undefined;
    return {
      ...toRevision(row),
      changes: foldChanges(this.changesOf(row.id)),
      revertedBy: reverted?.id ?? null,
    };
  }

  history(query: HistoryQuery = {}): RevisionSummary[] {
    const clauses: string[] = [];
    const params: SQLInputValue[] = [];
    if (query.projectId) {
      clauses.push('id IN (SELECT revision_id FROM changes WHERE project_id = ?)');
      params.push(query.projectId);
    }
    if (query.entityId) {
      clauses.push('id IN (SELECT revision_id FROM changes WHERE entity_id = ?)');
      params.push(query.entityId);
    }
    if (query.before !== undefined) {
      clauses.push('id < ?');
      params.push(query.before);
    }
    if (query.after !== undefined) {
      clauses.push('id > ?');
      params.push(query.after);
    }
    if (query.authorKind) {
      clauses.push('author_kind = ?');
      params.push(query.authorKind);
    }
    if (query.excludeAuthor) {
      clauses.push('author_name != ?');
      params.push(query.excludeAuthor);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.db
      .prepare(`SELECT * FROM revisions ${where} ORDER BY id DESC LIMIT ?`)
      .all(...params, Math.min(query.limit ?? 20, 200)) as RevisionRow[];
    return rows.map((row) => this.summarize(row));
  }

  /** Net changes made after revision `from` up to and including revision `to`. */
  diff(options: { from: number; to?: number; projectId?: string }): EntityDiff[] {
    const to = options.to ?? this.latestRevisionId();
    const clauses = ['revision_id > ?', 'revision_id <= ?'];
    const params: SQLInputValue[] = [options.from, to];
    if (options.projectId) {
      clauses.push('project_id = ?');
      params.push(options.projectId);
    }
    const rows = this.db
      .prepare(`SELECT * FROM changes WHERE ${clauses.join(' AND ')} ORDER BY revision_id, seq`)
      .all(...params) as ChangeRow[];
    return foldChanges(rows.map(toChange));
  }

  /** All of a project's data, for rendering views. */
  dataset(projectId: string): ProjectDataset {
    const project = this.getOfType('project', projectId);
    const { repositoryId } = project.data;
    return {
      project,
      repository: repositoryId ? this.getOfType('repository', repositoryId) : null,
      assignees: this.list('assignee'),
      goals: this.list('goal', { projectId }),
      scopeItems: this.list('scope_item', { projectId }),
      stages: this.list('stage', { projectId }),
      tasks: this.list('task', { projectId }),
      artifacts: this.list('artifact', { projectId }),
      decisions: this.list('decision', { projectId }),
      views: this.list('view', { projectId }),
      requests: this.list('request', { projectId }),
    };
  }

  /** The last revision an agent has looked at in a project (0 if it never has). */
  agentCursor(agent: string, projectId: string): number {
    const row = this.db
      .prepare('SELECT revision_id FROM agent_cursors WHERE agent = ? AND project_id = ?')
      .get(agent, projectId) as { revision_id: number } | undefined;
    return row?.revision_id ?? 0;
  }

  /** An app setting saved from the web app, or undefined when it was never set. */
  setting<T>(key: string): T | undefined {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
      { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : undefined;
  }

  setSetting(key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(value), this.now());
  }

  setAgentCursor(agent: string, projectId: string, revisionId: number): void {
    this.db
      .prepare(
        `INSERT INTO agent_cursors (agent, project_id, revision_id, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (agent, project_id) DO UPDATE SET revision_id = excluded.revision_id, updated_at = excluded.updated_at`,
      )
      .run(agent, projectId, revisionId, this.now());
  }

  latestRevisionId(): number {
    const row = this.db.prepare('SELECT MAX(id) AS id FROM revisions').get() as {
      id: number | null;
    };
    return row.id ?? 0;
  }

  private changesOf(revisionId: number): (Change & { revisionId: number })[] {
    const rows = this.db
      .prepare('SELECT * FROM changes WHERE revision_id = ? ORDER BY seq')
      .all(revisionId) as ChangeRow[];
    return rows.map(toChange);
  }

  // ---------------------------------------------------------------- writes

  /** Applies operations atomically as one revision. */
  apply(author: Author, input: ApplyInput): ApplyResult {
    return this.transaction(author, input.message, null, (tx) => {
      const created: Record<string, string> = {};
      const refs = new Map<string, string>();
      input.operations.forEach((op, index) => {
        tx.context = `operations[${index}]`;
        const id = tx.runOperation(op, refs, index);
        if (op.op === 'create') created[op.ref ?? String(index)] = id;
      });
      return created;
    });
  }

  /** Gives projects created before default views existed their default views. */
  ensureDefaultViews(): ApplyResult {
    const missing = this.list('project').filter(
      (p) => this.list('view', { projectId: p.id }).length === 0,
    );
    return this.transaction(SYSTEM, 'Add default views', null, (tx) => {
      for (const project of missing) {
        tx.context = `default views for ${describe('project', project.id, project.data)}`;
        tx.createDefaultViews(project.id);
      }
      return {};
    });
  }

  /** Undoes a revision by applying its inverse as a new revision. */
  revert(revisionId: number, author: Author, message?: string): ApplyResult {
    const original = this.db.prepare('SELECT * FROM revisions WHERE id = ?').get(revisionId) as
      RevisionRow | undefined;
    if (!original) throw new PharosError('not_found', `Revision ${revisionId} not found`);
    const reverted = this.db
      .prepare('SELECT id FROM revisions WHERE revert_of = ?')
      .get(revisionId) as { id: number } | undefined;
    if (reverted) {
      throw new PharosError(
        'conflict',
        `Revision ${revisionId} was already reverted by revision ${reverted.id}`,
      );
    }
    const changes = this.changesOf(revisionId);
    return this.transaction(
      author,
      message?.trim() || `Revert revision ${revisionId}: ${original.message}`,
      revisionId,
      (tx) => {
        tx.context = `Revert of revision ${revisionId}`;
        tx.revertChanges(changes);
        return {};
      },
    );
  }

  private transaction(
    author: Author,
    message: string,
    revertOf: number | null,
    body: (tx: Transaction) => Record<string, string>,
  ): ApplyResult {
    const createdAt = this.now();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const { lastInsertRowid } = this.db
        .prepare(
          'INSERT INTO revisions (author_kind, author_name, message, created_at, revert_of) VALUES (?, ?, ?, ?, ?)',
        )
        .run(author.kind, author.name, message, createdAt, revertOf);
      const revision: Revision = {
        id: Number(lastInsertRowid),
        author,
        message,
        createdAt,
        revertOf,
      };
      const tx = new Transaction(this.db, this, revision);
      const created = body(tx);
      tx.validate();
      if (tx.changes.length === 0) {
        this.db.exec('ROLLBACK');
        return { revision: null, created, changes: [] };
      }
      this.db.exec('COMMIT');
      for (const listener of this.commitListeners) listener();
      return { revision, created, changes: foldChanges(tx.changes) };
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }
}

/** One in-progress revision. Writes go straight to the DB inside the SQL transaction. */
class Transaction {
  readonly changes: Change[] = [];
  /** Entities written in this transaction, with the context that last wrote them. */
  private readonly touched = new Map<string, string>();
  context = '';

  constructor(
    private readonly db: DatabaseSync,
    private readonly store: Store,
    private readonly revision: Revision,
  ) {}

  runOperation(op: Operation, refs: Map<string, string>, index: number): string {
    const resolve = (value: unknown, path: string): unknown => {
      if (typeof value !== 'string' || !value.startsWith('$')) return value;
      const id = refs.get(value.slice(1));
      if (!id) throw new PharosError('invalid', `${path}: unknown ref "${value}"`);
      return id;
    };
    const resolveRefs = (type: EntityType, data: Data): Data => {
      const out = { ...data };
      for (const field of Object.keys(ENTITIES[type].refs)) {
        const value = out[field];
        if (value === undefined || value === null) continue;
        const path = `${this.context}.data.${field}`;
        out[field] = Array.isArray(value)
          ? value.map((v, i) => resolve(v, `${path}[${i}]`))
          : resolve(value, path);
      }
      return out;
    };

    switch (op.op) {
      case 'create': {
        if (op.ref && refs.has(op.ref)) {
          throw new PharosError('invalid', `${this.context}.ref: "${op.ref}" is already used`);
        }
        const id = newId(op.type);
        this.create(op.type, id, this.withDefaults(op.type, resolveRefs(op.type, op.data)));
        if (op.type === 'project') this.createDefaultViews(id);
        refs.set(op.ref ?? `${index}`, id);
        return id;
      }
      case 'update': {
        const id = resolve(op.id, `${this.context}.id`) as string;
        const entity = this.require(op.type, id);
        const next: Data = { ...entity.data };
        for (const [key, value] of Object.entries(resolveRefs(op.type, op.data))) {
          if (value === null) delete next[key];
          else if (value !== undefined) next[key] = value;
        }
        this.update(entity, next);
        return id;
      }
      case 'delete': {
        const id = resolve(op.id, `${this.context}.id`) as string;
        this.delete([this.require(op.type, id)]);
        return id;
      }
    }
  }

  /**
   * Restores what the changes deleted, rolls back the fields they updated, and deletes what they
   * created. Fails if anything involved was changed afterwards.
   */
  createDefaultViews(projectId: string): void {
    for (const view of DEFAULT_VIEWS) {
      this.create('view', newId('view'), this.withDefaults('view', { ...view, projectId }));
    }
  }

  revertChanges(changes: Change[]): void {
    const recreate: [string, NetChange][] = [];
    const rollback: [Entity, NetChange][] = [];
    const remove: Entity[] = [];
    const conflicts: string[] = [];

    for (const [id, net] of netChanges(changes)) {
      const current = this.store.get(id);
      const what = describe(net.type, id, net.after ?? net.before);
      if (!net.before && !net.after) continue;
      if (!net.before) {
        if (!current) continue;
        if (!isDeepStrictEqual(current.data, net.after))
          conflicts.push(`${what} was modified later`);
        else remove.push(current);
      } else if (!net.after) {
        if (current) conflicts.push(`${what} exists again`);
        else recreate.push([id, net]);
      } else if (!current) {
        conflicts.push(`${what} was deleted later`);
      } else {
        for (const [field, diff] of Object.entries(fieldDiffs(net.before, net.after))) {
          if (!isDeepStrictEqual((current.data as Data)[field] ?? null, diff.after)) {
            conflicts.push(`${what}: ${field} was changed later`);
          }
        }
        rollback.push([current, net]);
      }
    }

    const removeIds = new Set(remove.map((e) => e.id));
    const extra = remove.length
      ? this.deletionClosure(remove).filter((e) => !removeIds.has(e.id))
      : [];
    for (const e of extra)
      conflicts.push(`${describe(e.type, e.id, e.data)} was added later and depends on this`);
    if (conflicts.length)
      throw new PharosError('conflict', `${this.context}: conflicts`, conflicts);

    for (const [id, net] of recreate) this.create(net.type, id, net.before!);
    for (const [current, net] of rollback) {
      const next: Data = { ...current.data };
      for (const [field, diff] of Object.entries(fieldDiffs(net.before, net.after))) {
        if (diff.before === null) delete next[field];
        else next[field] = diff.before;
      }
      this.update(current, next);
    }
    if (remove.length) this.delete(remove);
  }

  // ---------------------------------------------------------------- primitives

  private require(type: EntityType, id: string): Entity {
    const entity = this.store.get(id);
    if (!entity || entity.type !== type) {
      throw new PharosError('not_found', `${this.context}: ${type} ${id} not found`);
    }
    return entity;
  }

  private withDefaults(type: EntityType, data: Data): Data {
    const defaults: Data = structuredClone(ENTITIES[type].defaults);
    // Default statuses etc. are meanings; use the project's option for that meaning.
    const project = typeof data.projectId === 'string' ? this.store.get(data.projectId) : null;
    for (const key of optionKeysOf(type)) {
      const { field } = OPTION_FIELDS[key];
      if (typeof defaults[field] === 'string' && project?.type === 'project') {
        defaults[field] = valueFor(project as Entity<'project'>, key, defaults[field] as string);
      }
    }
    const out: Data = { ...defaults, ...data };
    if (hasOrder(type) && out.order === undefined) {
      // Items inside a project are ordered per project; projects and workspace-wide items
      // (sections, repositories) are ordered among all of their type.
      const scoped = isProjectScoped(type) && type !== 'project';
      const row = (
        scoped
          ? this.db
              .prepare(
                "SELECT MAX(json_extract(data, '$.order')) AS max FROM entities WHERE type = ? AND project_id IS ?",
              )
              .get(type, (out.projectId as string | undefined) ?? null)
          : this.db
              .prepare(
                "SELECT MAX(json_extract(data, '$.order')) AS max FROM entities WHERE type = ?",
              )
              .get(type)
      ) as { max: number | null };
      out.order = (row.max ?? -1) + 1;
    }
    return out;
  }

  private parse(type: EntityType, data: Data): Data {
    const result = ENTITIES[type].data.safeParse(data);
    if (!result.success) {
      throw new PharosError(
        'invalid',
        `${this.context}: invalid ${type}`,
        result.error.issues.map((i) => `${formatPath(['data', ...i.path])}: ${i.message}`),
      );
    }
    return result.data as Data;
  }

  private projectIdOf(type: EntityType, id: string, data: Data): string | null {
    if (type === 'project') return id;
    return isProjectScoped(type) ? (data.projectId as string) : null;
  }

  private record(
    op: ChangeOp,
    type: EntityType,
    id: string,
    projectId: string | null,
    before: Data | null,
    after: Data | null,
  ) {
    const seq = this.changes.length;
    this.changes.push({ seq, op, type, id, projectId, before, after });
    this.db
      .prepare(
        'INSERT INTO changes (revision_id, seq, op, entity_type, entity_id, project_id, before, after) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        this.revision.id,
        seq,
        op,
        type,
        id,
        projectId,
        before && JSON.stringify(before),
        after && JSON.stringify(after),
      );
    if (after) this.touched.set(id, this.context);
    else this.touched.delete(id);
  }

  private create(type: EntityType, id: string, raw: Data): void {
    const data = this.parse(type, raw);
    const projectId = this.projectIdOf(type, id, data);
    const { id: rev, createdAt } = this.revision;
    this.db
      .prepare(
        'INSERT INTO entities (id, type, project_id, data, created_at, updated_at, created_rev, updated_rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, type, projectId, JSON.stringify(data), createdAt, createdAt, rev, rev);
    this.record('create', type, id, projectId, null, data);
  }

  private update(entity: Entity, raw: Data): void {
    const data = this.parse(entity.type, raw);
    if (isDeepStrictEqual(data, entity.data)) return;
    this.db
      .prepare('UPDATE entities SET data = ?, updated_at = ?, updated_rev = ? WHERE id = ?')
      .run(JSON.stringify(data), this.revision.createdAt, this.revision.id, entity.id);
    const projectId = this.projectIdOf(entity.type, entity.id, data);
    this.record('update', entity.type, entity.id, projectId, entity.data, data);
  }

  /** Deletes entities, everything that cascades from them, and clears references to them. */
  private delete(roots: Entity[]): void {
    const doomed = this.deletionClosure(roots);
    const doomedIds = new Set(doomed.map((e) => e.id));
    for (const entity of doomed) {
      for (const { type, field, spec } of INCOMING_REFS.get(entity.type) ?? []) {
        if (spec.onDelete !== 'unset') continue;
        for (const referrer of this.referrers(type, field, spec, entity.id)) {
          if (doomedIds.has(referrer.id)) continue;
          const current = this.store.get(referrer.id)!;
          const next: Data = { ...current.data };
          if (spec.many) {
            next[field] = (next[field] as string[]).filter((id) => id !== entity.id);
          } else {
            delete next[field];
          }
          this.update(current, next);
        }
      }
    }
    for (const entity of doomed) {
      this.db.prepare('DELETE FROM entities WHERE id = ?').run(entity.id);
      const projectId = this.projectIdOf(entity.type, entity.id, entity.data);
      this.record('delete', entity.type, entity.id, projectId, entity.data, null);
    }
  }

  /** The entities plus everything that would be cascade-deleted with them, parents first. */
  private deletionClosure(roots: Entity[]): Entity[] {
    const result: Entity[] = [];
    const seen = new Set<string>();
    const queue = [...roots];
    while (queue.length) {
      const entity = queue.shift()!;
      if (seen.has(entity.id)) continue;
      seen.add(entity.id);
      result.push(entity);
      for (const { type, field, spec } of INCOMING_REFS.get(entity.type) ?? []) {
        if (spec.onDelete === 'cascade')
          queue.push(...this.referrers(type, field, spec, entity.id));
      }
    }
    return result;
  }

  private referrers(type: EntityType, field: string, spec: RefSpec, id: string): Entity[] {
    const sql = spec.many
      ? 'SELECT * FROM entities WHERE type = ? AND EXISTS (SELECT 1 FROM json_each(data, ?) WHERE value = ?)'
      : 'SELECT * FROM entities WHERE type = ? AND json_extract(data, ?) = ?';
    return (this.db.prepare(sql).all(type, `$.${field}`, id) as EntityRow[]).map(toEntity);
  }

  // ---------------------------------------------------------------- validation

  /** Checks references and cycles for every entity written in this transaction. */
  validate(): void {
    const issues: string[] = [];
    for (const [id, context] of this.touched) {
      const entity = this.store.get(id);
      if (!entity) continue;
      const projectId = this.projectIdOf(entity.type, entity.id, entity.data);
      const prefix = `${context}: ${describe(entity.type, entity.id, entity.data)}`;
      for (const [field, spec] of Object.entries(
        ENTITIES[entity.type].refs as Record<string, RefSpec>,
      )) {
        const value = (entity.data as Data)[field];
        const ids = value === undefined ? [] : spec.many ? (value as string[]) : [value as string];
        for (const refId of ids) {
          const target = this.store.get(refId);
          if (!target || target.type !== spec.type) {
            issues.push(`${prefix}: ${field} → ${spec.type} ${refId} not found`);
          } else if (
            isProjectScoped(spec.type) &&
            this.projectIdOf(target.type, target.id, target.data) !== projectId
          ) {
            issues.push(`${prefix}: ${field} → ${spec.type} ${refId} belongs to another project`);
          } else if (refId === id) {
            issues.push(`${prefix}: ${field} can't reference itself`);
          }
        }
      }
      if (
        entity.type === 'goal' &&
        this.hasCycle(id, (e) => (e.data as Data).parentId as string | undefined)
      ) {
        issues.push(`${prefix}: parentId creates a cycle`);
      }
      if (entity.type === 'task' && this.dependsOnCycle(id)) {
        issues.push(`${prefix}: dependsOn creates a cycle`);
      }
      issues.push(...this.optionIssues(entity, prefix));
    }
    if (issues.length) throw new PharosError('invalid', 'Invalid changes', issues);
  }

  /** Option fields must use the project's options; a project's options must cover what's in use. */
  private optionIssues(entity: Entity, prefix: string): string[] {
    const issues: string[] = [];
    const projectId = this.projectIdOf(entity.type, entity.id, entity.data);
    const project = projectId ? (this.store.get(projectId) as Entity<'project'> | null) : null;
    if (!project) return issues;
    for (const key of optionKeysOf(entity.type)) {
      const { field, label } = OPTION_FIELDS[key];
      const value = (entity.data as Data)[field] as string;
      const values = optionsFor(project, key).map((o) => o.value);
      if (!values.includes(value)) {
        issues.push(
          `${prefix}: ${field} "${value}" isn't one of this project's ${label.toLowerCase()} options (${values.join(', ')})`,
        );
      }
    }
    if (entity.type === 'project') {
      for (const key of OPTION_KEYS) {
        const { type, field, label } = OPTION_FIELDS[key];
        const values = new Set(optionsFor(project, key).map((o) => o.value));
        const orphans = new Map<string, number>();
        for (const e of this.store.list(type, { projectId: project.id })) {
          const value = (e.data as Data)[field] as string;
          if (!values.has(value)) orphans.set(value, (orphans.get(value) ?? 0) + 1);
        }
        for (const [value, count] of orphans) {
          issues.push(
            `${prefix}: ${count} ${type.replace('_', ' ')}${count === 1 ? ' still uses' : 's still use'} ${label.toLowerCase()} "${value}", which isn't an option anymore; move them to another option in the same change`,
          );
        }
      }
    }
    return issues;
  }

  private hasCycle(startId: string, next: (e: Entity) => string | undefined): boolean {
    const seen = new Set<string>();
    let current: string | undefined = startId;
    while (current) {
      if (seen.has(current)) return true;
      seen.add(current);
      const entity = this.store.get(current);
      current = entity ? next(entity) : undefined;
    }
    return false;
  }

  private dependsOnCycle(startId: string): boolean {
    const visiting = new Set<string>();
    const done = new Set<string>();
    const visit = (id: string): boolean => {
      if (done.has(id)) return false;
      if (visiting.has(id)) return true;
      visiting.add(id);
      const task = this.store.get(id);
      const deps = ((task?.data as Data | undefined)?.dependsOn as string[] | undefined) ?? [];
      const cyclic = deps.some(visit);
      visiting.delete(id);
      done.add(id);
      return cyclic;
    };
    return visit(startId);
  }
}
