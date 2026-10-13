import { randomUUID } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import {
  ENTITIES,
  ENTITY_TYPES,
  OWNER_DECISION_FIELDS,
  decisionIssues,
  decisionWarnings,
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
  SCAN_FILE_FIELDS,
  findOption,
  hasOrder,
  isProjectScoped,
  meaningOf,
  optionsFor,
  valueFor,
  type OptionKey,
  Board,
  checkBoardQueries,
  findRecordType,
  findingKey,
  formatFinding,
  recordFieldIssues,
  recordTypeIssues,
  resolvePath,
  toBoard,
  type QueryFinding,
  type RecordType,
  type ViewSpec,
} from '@pharos/schema';
import { AgentFiles, agentApplyIssue, prepareAgentOperations } from './agent-files.js';
import { PharosError, formatPath } from './errors.js';
import { agentBlockScopeIssue } from '../views/block-ask.js';

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
  /** Things worth fixing that didn't stop the save, e.g. a claim without a source. */
  warnings: string[];
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

/**
 * Warnings for a claim that doesn't show the reader what it rests on: no source for "Our reading"
 * (From-source and confirmed claims can't lack one), no quoted passage for "From source", no stated
 * assumption for "Our reading", or a quote credited to a source the claim doesn't list.
 */
export function claimWarnings(claim: Entity<'claim'>, project: Entity<'project'> | null): string[] {
  const { sourceIds, certainty, statement, quote, quoteSourceId, assumption } = claim.data;
  const meaning = meaningOf(project, 'claim.certainty', certainty);
  const label = findOption(project, 'claim.certainty', certainty)?.label ?? certainty;
  const text = statement.length > 60 ? `${statement.slice(0, 60)}…` : statement;
  const name = `claim ${claim.id} "${text}"`;
  const out: string[] = [];
  if (meaning === 'reading' && sourceIds.length === 0)
    out.push(`${name} has no source: add sourceIds so the reader can check it`);
  if (meaning === 'verified' && !quote)
    out.push(
      `${name} is "${label}" but quotes nothing: add quote, the exact passage from the source that supports it`,
    );
  if (meaning === 'reading' && !assumption)
    out.push(
      `${name} is "${label}" but states no assumption: add assumption, what this reading takes for granted`,
    );
  if (quoteSourceId && !sourceIds.includes(quoteSourceId))
    out.push(`${name} credits its quote to ${quoteSourceId}, which isn't in its sourceIds`);
  const { figure, weakBecause } = claim.data;
  if (meaning === 'verified' && figure && quote && !quoteHasNumber(quote, figure.value))
    out.push(
      `${name} is "${label}" but its figure ${figure.value} isn't in its quote: quote the passage that gives the number, or correct the figure`,
    );
  if (weakBecause === 'one-source' && sourceIds.length !== 1)
    out.push(
      `${name} says its evidence is weak because of one source, but it has ${sourceIds.length}: fix sourceIds or weakBecause`,
    );
  return out;
}

/** Whether a quote gives a number, written as 4800, 4,800, 4 800 or 82.8 (R4 figures). */
export function quoteHasNumber(quote: string, value: number): boolean {
  const plain = quote.replace(/(\d)[,\u00a0\u202f ](?=\d{3}(?!\d))/g, '$1');
  const form = String(value).replace('.', '\\.');
  return new RegExp(`(?<![\\d.])${form}(?!\\d|\\.\\d)`).test(plain);
}

/** YYYY-MM-DD on the server's clock, like "$today" in queries. */
function localDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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

  /** The database, for app data kept beside revisions (the file scan cache, R7.2). */
  get database(): DatabaseSync {
    return this.db;
  }

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

  /** An entity's data, or its last recorded data if it was deleted (null if never seen). */
  lastKnown(id: string): { type: EntityType; data: Data } | null {
    const current = this.get(id);
    if (current) return { type: current.type, data: current.data as Data };
    const row = this.db
      .prepare(
        'SELECT entity_type, before FROM changes WHERE entity_id = ? AND before IS NOT NULL ORDER BY revision_id DESC, seq DESC LIMIT 1',
      )
      .get(id) as { entity_type: string; before: string } | undefined;
    return row ? { type: row.entity_type as EntityType, data: JSON.parse(row.before) } : null;
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
      claims: this.list('claim', { projectId }),
      terms: this.list('term', { projectId }),
      files: this.list('file', { projectId }),
      records: this.list('record', { projectId }),
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
  apply(author: Author, raw: ApplyInput): ApplyResult {
    let input = raw;
    if (author.kind === 'agent') {
      input.operations.forEach((op, index) => {
        const issue = agentFileIssue(op) ?? agentArtifactFileIssue(op);
        if (issue) throw new PharosError('invalid', `operations[${index}]: ${issue}`);
      });
      const issue = agentApplyIssue(this, input);
      if (issue)
        throw new PharosError(issue.includes('not found') ? 'not_found' : 'invalid', issue);
      // Files added from the scan (R7.12) and links to files the agent can't see kept.
      input = prepareAgentOperations(this, input);
    }
    const result = this.transaction(author, input.message, null, (tx) => {
      const created: Record<string, string> = {};
      const refs = new Map<string, string>();
      input.operations.forEach((op, index) => {
        tx.context = `operations[${index}]`;
        const id = tx.runOperation(op, refs, index);
        if (op.op === 'create') created[op.ref ?? String(index)] = id;
      });
      return created;
    });
    return this.forAuthor(author, result);
  }

  /** What an agent sees of its own write: file details only (R7.5). */
  private forAuthor(author: Author, result: ApplyResult): ApplyResult {
    if (author.kind !== 'agent') return result;
    const files = new AgentFiles(this);
    return {
      ...result,
      changes: files.diffs(result.changes),
      warnings: files.texts(result.warnings),
    };
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
    if (author.kind === 'agent') {
      const issue = new AgentFiles(this).revertIssue(revisionId, changes);
      if (issue)
        throw new PharosError(issue.endsWith('not found') ? 'not_found' : 'invalid', issue);
    }
    const result = this.transaction(
      author,
      message?.trim() || `Revert revision ${revisionId}: ${original.message}`,
      revisionId,
      (tx) => {
        tx.context = `Revert of revision ${revisionId}`;
        tx.revertChanges(changes);
        return {};
      },
    );
    return this.forAuthor(author, result);
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
      // Checked on everything the operations did, including what a delete cascaded to and what
      // an undo removes, not only on the operations an agent sent (R7.9).
      if (author.kind === 'agent') {
        const issue =
          new AgentFiles(this).changesIssue(tx.changes) ??
          agentDecisionIssue(this, tx.changes) ??
          agentOutcomeIssue(tx.changes) ??
          agentBlockScopeIssue(this, tx.changes);
        if (issue) throw new PharosError('invalid', issue);
      }
      tx.validate();
      if (tx.changes.length === 0) {
        this.db.exec('ROLLBACK');
        return { revision: null, created, changes: [], warnings: [] };
      }
      const warnings = tx.warnings();
      this.db.exec('COMMIT');
      for (const listener of this.commitListeners) listener();
      return { revision, created, changes: foldChanges(tx.changes), warnings };
    } catch (err) {
      this.db.exec('ROLLBACK');
      // Conflict and validation details name items by id and title; an agent's never name one
      // it can't see.
      if (author.kind === 'agent' && err instanceof PharosError)
        throw new AgentFiles(this).error(err);
      throw err;
    }
  }
}

/**
 * Files (R7) come from folders the owner approved in Settings: agents may fill in a file's details
 * (title, kind, issuer, dates, tags, tasks) and add scanned files (checked by
 * `prepareAgentOperations` and, on everything the revision does, `AgentFiles.changesIssue`), but
 * never remove one or change where it is on disk.
 */
function agentFileIssue(op: Operation): string | undefined {
  if (op.type !== 'file' || op.op === 'create') return undefined;
  if (op.op === 'delete') return "agents can't remove files; ask the owner";
  const scanned = SCAN_FILE_FIELDS.filter((f) => f in op.data);
  return scanned.length
    ? `${scanned.join(', ')} come from the folder scan; agents can't change them`
    : undefined;
}

/**
 * An artifact's `fileId` (R7.6) is set by Pharos, which links a local source to the project file
 * at its path (or with its contents), and by the owner. Agents record the path in `uri` instead,
 * so they can't point a claim at a file from a folder they can't see.
 */
function agentArtifactFileIssue(op: Operation): string | undefined {
  if (op.type !== 'artifact' || op.op === 'delete' || !('fileId' in op.data)) return undefined;
  return "agents can't set fileId; put the local path in uri and Pharos links it to the project file";
}

/**
 * A decision with options is the owner's to make (R10.19): agents propose it (options, their
 * recommendation and why) but never choose, answer, defer or accept it, and can't change the
 * options once the owner chose. Checked on everything a revision does, undos included.
 */
function agentDecisionIssue(store: Store, changes: Change[]): string | undefined {
  for (const change of changes) {
    if (change.type !== 'decision') continue;
    if (!change.after) {
      // v0.2 review, gap 5: deleting it would erase the owner's choice, answer or deferral.
      const set = OWNER_DECISION_FIELDS.find((f) => (change.before?.[f] ?? null) !== null);
      if (set)
        return `${describe('decision', change.id, change.before ?? {})}: the owner already answered it (${set}); only they can remove it, in Pharos`;
      continue;
    }
    const before: Data = change.before ?? {};
    const after = change.after;
    const what = describe('decision', change.id, after);
    const changed = (field: string) => !isDeepStrictEqual(before[field], after[field]);
    const owner = OWNER_DECISION_FIELDS.find(changed);
    if (owner)
      return `${what}: only the owner chooses, answers or defers a decision (${owner}); they do it in Pharos on a page with a DecisionBlock`;
    const options = after.options as unknown[] | undefined;
    if (!options?.length) continue;
    if (
      before.chosenOptionId &&
      ['options', 'recommendedOptionId', 'recommendationReason'].some(changed)
    )
      return `${what}: the owner already chose; its options and recommendation can't change`;
    const project = store.get(after.projectId as string) as Entity<'project'> | null;
    if (
      changed('status') &&
      meaningOf(project, 'decision.status', after.status as string) === 'accepted'
    )
      return `${what}: a decision with options is accepted when the owner chooses one in Pharos; keep its status "proposed"`;
  }
  return undefined;
}

/**
 * Marking a repeating record done (its `interval.lastDate` or `lastMeter`: a bill paid, a service
 * done) says something happened in the owner's life, so it is the owner's to record (v0.2 review,
 * gap 5). Agents may set them on records they create, but never move them on an existing record:
 * not with apply, not through an action (Mark paid, or Log a service marking its reminder done),
 * and not by undoing the owner's revision.
 */
function agentOutcomeIssue(changes: Change[]): string | undefined {
  for (const change of changes) {
    if (change.type !== 'record' || !change.before || !change.after) continue;
    const was = (change.before.interval ?? {}) as Data;
    const now = (change.after.interval ?? {}) as Data;
    const field = (['lastDate', 'lastMeter'] as const).find(
      (f) => !isDeepStrictEqual(was[f] ?? null, now[f] ?? null),
    );
    if (field)
      return `${describe('record', change.id, change.after)}: only the owner marks it done (interval.${field}), with the page's action in Pharos; tell them what to record instead`;
  }
  return undefined;
}

/** A decision option's sources (R10.19) may name a claim created in the same apply as "$ref". */
function resolveOptionClaims(
  data: Data,
  resolve: (value: unknown, path: string) => unknown,
  context: string,
): Data {
  if (!Array.isArray(data.options)) return data;
  const options = (data.options as Data[]).map((o, i) =>
    Array.isArray(o?.claimIds)
      ? {
          ...o,
          claimIds: o.claimIds.map((id, j) =>
            resolve(id, `${context}.data.options[${i}].claimIds[${j}]`),
          ),
        }
      : o,
  );
  return { ...data, options };
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
        let data = resolveRefs(op.type, op.data);
        if (op.type === 'record') data = this.resolveRecordRefs(data, resolve);
        if (op.type === 'decision') data = resolveOptionClaims(data, resolve, this.context);
        this.create(op.type, id, this.withDefaults(op.type, data));
        // A project started from a pack (it has record types) brings its own pages instead of
        // the project-management Overview.
        if (op.type === 'project' && !(op.data.recordTypes as unknown[] | undefined)?.length)
          this.createDefaultViews(id);
        refs.set(op.ref ?? `${index}`, id);
        return id;
      }
      case 'update': {
        const id = resolve(op.id, `${this.context}.id`) as string;
        const entity = this.require(op.type, id);
        const next: Data = { ...entity.data };
        let patch = resolveRefs(op.type, op.data);
        if (op.type === 'decision') patch = resolveOptionClaims(patch, resolve, this.context);
        if (op.type === 'record') {
          const rest = this.resolveRecordRefs(
            {
              recordType: (entity.data as Data).recordType,
              ...patch,
              projectId: (entity.data as Data).projectId,
            },
            resolve,
          );
          delete rest.projectId; // only needed to look up the record types
          // Fields merge, so "log the odometer" sends only the odometer.
          if (rest.fields)
            rest.fields = { ...((entity.data as Data).fields as Data), ...(rest.fields as Data) };
          patch = rest;
        }
        for (const [key, value] of Object.entries(patch)) {
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
   * A record's reference and file fields may name another create in the same apply as "$ref"
   * (a pack's examples do); other fields keep their text, even when it starts with "$".
   */
  private resolveRecordRefs(data: Data, resolve: (value: unknown, path: string) => unknown): Data {
    const fields = data.fields as Data | undefined;
    if (!fields || typeof data.projectId !== 'string') return data;
    const project = this.store.get(data.projectId) as Entity<'project'> | null;
    const type = findRecordType(project, String(data.recordType));
    if (!type) return data;
    const out: Data = { ...fields };
    for (const def of type.fields) {
      if ((def.kind === 'reference' || def.kind === 'file') && typeof out[def.key] === 'string')
        out[def.key] = resolve(out[def.key], `${this.context}.data.fields.${def.key}`);
    }
    return { ...data, fields: out };
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
    // A decision with options waits for the owner's choice (R10.19).
    if (
      type === 'decision' &&
      (data.options as unknown[] | undefined)?.length &&
      project?.type === 'project'
    )
      defaults.status = valueFor(project as Entity<'project'>, 'decision.status', 'proposed');
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
    // Record fields (R8) point at records and files by the project's record types, not ENTITIES.
    for (const entity of doomed) {
      if (entity.type !== 'record' && entity.type !== 'file') continue;
      const pointing = this.db
        .prepare(
          "SELECT * FROM entities WHERE type = 'record' AND EXISTS (SELECT 1 FROM json_each(data, '$.fields') WHERE value = ?)",
        )
        .all(entity.id) as EntityRow[];
      for (const row of pointing) {
        if (doomedIds.has(row.id)) continue;
        const current = this.store.get(row.id)!;
        const fields = { ...((current.data as Data).fields as Data) };
        for (const [key, value] of Object.entries(fields))
          if (value === entity.id) delete fields[key];
        this.update(current, { ...current.data, fields });
      }
    }
    // An artifact's picture may be a project file (R7.13): it goes with the file.
    for (const entity of doomed) {
      if (entity.type !== 'file') continue;
      const pictured = this.db
        .prepare(
          "SELECT * FROM entities WHERE type = 'artifact' AND json_extract(data, '$.image') = ?",
        )
        .all(entity.id) as EntityRow[];
      for (const row of pictured) {
        if (doomedIds.has(row.id)) continue;
        const current = this.store.get(row.id)!;
        const next: Data = { ...current.data };
        delete next.image;
        this.update(current, next);
      }
    }
    // A decision option's sources (R10.19) are claims inside its options.
    for (const entity of doomed) {
      if (entity.type !== 'claim') continue;
      const citing = this.db
        .prepare(
          "SELECT * FROM entities WHERE type = 'decision' AND EXISTS (SELECT 1 FROM json_each(data, '$.options') AS o, json_each(o.value, '$.claimIds') AS c WHERE c.value = ?)",
        )
        .all(entity.id) as EntityRow[];
      for (const row of citing) {
        if (doomedIds.has(row.id)) continue;
        const current = this.store.get(row.id) as Entity<'decision'>;
        const options = (current.data.options ?? []).map((o) => {
          if (!o.claimIds?.includes(entity.id)) return o;
          const rest = { ...o, claimIds: o.claimIds.filter((id) => id !== entity.id) };
          if (!rest.claimIds.length) delete (rest as { claimIds?: string[] }).claimIds;
          return rest;
        });
        this.update(current, { ...current.data, options });
      }
    }
    // request.aboutId can point at any entity type, so it isn't a typed ref; clear it by hand.
    for (const entity of doomed) {
      const asked = this.db
        .prepare(
          "SELECT * FROM entities WHERE type = 'request' AND json_extract(data, '$.aboutId') = ?",
        )
        .all(entity.id) as EntityRow[];
      for (const row of asked) {
        if (doomedIds.has(row.id)) continue;
        const current = this.store.get(row.id)!;
        const next: Data = { ...current.data };
        delete next.aboutId;
        this.update(current, next);
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
      if (entity.type === 'term') issues.push(...this.termIssues(entity as Entity<'term'>, prefix));
      if (entity.type === 'record')
        issues.push(...this.recordIssues(entity as Entity<'record'>, prefix));
      if (entity.type === 'project') {
        const types = (entity as Entity<'project'>).data.recordTypes ?? [];
        issues.push(...recordTypeIssues(types).map((i) => `${prefix}: recordTypes: ${i}`));
        // Its records must still fit the types (a type in use can't go, a field can't change kind).
        for (const record of this.store.list('record', { projectId: entity.id }))
          if (!this.touched.has(record.id))
            issues.push(
              ...this.recordIssues(
                record,
                `${prefix}: ${describe('record', record.id, record.data)}`,
              ),
            );
      }
      if (entity.type === 'view')
        issues.push(...this.viewQueryIssues(entity as Entity<'view'>, prefix));
      if (entity.type === 'decision')
        issues.push(...this.decisionChoiceIssues(entity as Entity<'decision'>, prefix));
    }
    for (const [id, context] of this.claimsToCheck()) {
      const claim = this.store.get(id) as Entity<'claim'>;
      const prefix = `${context}: ${describe('claim', id, claim.data)}`;
      issues.push(...this.certaintyIssues(claim, prefix));
    }
    if (issues.length) throw new PharosError('invalid', 'Invalid changes', issues);
  }

  /**
   * Claims written in this transaction, claims resting on an artifact or decision written in it,
   * and every claim of a project written in it (its options decide what a certainty means).
   */
  private claimsToCheck(): Map<string, string> {
    const claims = new Map<string, string>();
    const add = (related: Entity[], context: string) => {
      for (const claim of related) if (!claims.has(claim.id)) claims.set(claim.id, context);
    };
    for (const [id, context] of this.touched) {
      const entity = this.store.get(id);
      if (!entity) continue;
      if (entity.type === 'claim') claims.set(id, context);
      else if (entity.type === 'project') add(this.store.list('claim', { projectId: id }), context);
      else if (entity.type === 'artifact')
        add(this.referrers('claim', 'sourceIds', ENTITIES.claim.refs.sourceIds, id), context);
      else if (entity.type === 'decision')
        add(
          this.referrers('claim', 'confirmedById', ENTITIES.claim.refs.confirmedById, id),
          context,
        );
    }
    return claims;
  }

  /** A claim's certainty must be earned: see the rules in docs/reframe/slice-1.md §3. */
  private certaintyIssues(claim: Entity<'claim'>, prefix: string): string[] {
    const { certainty, checkedOn, sourceIds, confirmedById } = claim.data;
    const project = this.store.get(claim.data.projectId) as Entity<'project'> | null;
    const meaning = meaningOf(project, 'claim.certainty', certainty);
    const quoted = `"${findOption(project, 'claim.certainty', certainty)?.label ?? certainty}"`;
    if (meaning === 'verified') {
      const issues: string[] = [];
      const linked = sourceIds.some((id) => {
        const uri = (this.store.get(id)?.data as Data | undefined)?.uri;
        return typeof uri === 'string' && /^https?:\/\//i.test(uri);
      });
      if (!linked) {
        issues.push(
          `${prefix}: ${quoted} needs sourceIds with at least one artifact whose uri starts with http:// or https://`,
        );
      }
      const today = localDate(this.revision.createdAt);
      if (checkedOn > today) {
        issues.push(
          `${prefix}: ${quoted} needs checkedOn no later than today (${today}), but it is ${checkedOn}`,
        );
      }
      return issues;
    }
    if (meaning === 'confirmed') {
      const fix = 'confirmedById → a decision the owner accepted in Pharos';
      if (!confirmedById) return [`${prefix}: ${quoted} needs ${fix}`];
      const target = this.store.get(confirmedById);
      if (target?.type !== 'decision') return []; // the reference check reports it
      const decision = target as Entity<'decision'>;
      const status = decision.data.status;
      if (meaningOf(project, 'decision.status', status) !== 'accepted') {
        const statusLabel = findOption(project, 'decision.status', status)?.label ?? status;
        return [
          `${prefix}: ${quoted} needs ${fix}, but ${describe('decision', decision.id, decision.data)} is "${statusLabel}"`,
        ];
      }
      if (this.lastStatusAuthorKind(decision.id) !== 'human') {
        return [
          `${prefix}: ${quoted} needs ${fix}, but the status of ${describe('decision', decision.id, decision.data)} was not set by a person; ask the owner to accept it in the app`,
        ];
      }
    }
    return [];
  }

  /** Who last changed an entity's status (or created it); changes of this call are included. */
  private lastStatusAuthorKind(entityId: string): string | undefined {
    const row = this.db
      .prepare(
        `SELECT r.author_kind AS kind FROM changes c JOIN revisions r ON r.id = c.revision_id
         WHERE c.entity_id = ? AND c.after IS NOT NULL
           AND (c.before IS NULL OR json_extract(c.before, '$.status') IS NOT json_extract(c.after, '$.status'))
         ORDER BY c.revision_id DESC, c.seq DESC LIMIT 1`,
      )
      .get(entityId) as { kind: string } | undefined;
    return row?.kind;
  }

  /** Options must be consistent (R10.19) and cite claims of the same project. */
  private decisionChoiceIssues(decision: Entity<'decision'>, prefix: string): string[] {
    const issues = decisionIssues(decision.data).map((i) => `${prefix}: ${i}`);
    for (const option of decision.data.options ?? []) {
      for (const id of option.claimIds ?? []) {
        const claim = this.store.get(id);
        if (claim?.type !== 'claim')
          issues.push(`${prefix}: options "${option.id}".claimIds → claim ${id} not found`);
        else if ((claim.data as Data).projectId !== decision.data.projectId)
          issues.push(
            `${prefix}: options "${option.id}".claimIds → claim ${id} belongs to another project`,
          );
      }
    }
    return issues;
  }

  /** Two terms in a project can't share a word or another form, ignoring case. */
  private termIssues(term: Entity<'term'>, prefix: string): string[] {
    const forms = (t: Entity<'term'>) =>
      [t.data.word, ...t.data.alsoCalled].map((f) => f.toLowerCase());
    const mine = new Set(forms(term));
    const issues: string[] = [];
    for (const other of this.store.list('term', { projectId: term.data.projectId })) {
      if (other.id === term.id) continue;
      const shared = forms(other).filter((f) => mine.has(f));
      if (shared.length) {
        issues.push(
          `${prefix}: "${[...new Set(shared)].join('", "')}" is already used by ${describe('term', other.id, other.data)}`,
        );
      }
    }
    return issues;
  }

  /**
   * Warnings for what this transaction wrote: claims that don't show what they rest on, and the
   * warn-level query findings of views (R8.5).
   */
  warnings(): string[] {
    const out: string[] = [];
    for (const id of this.touched.keys()) {
      const entity = this.store.get(id);
      if (entity?.type === 'view') {
        out.push(
          ...this.viewFindings(entity as Entity<'view'>)
            .filter((f) => f.level === 'warn')
            .map(
              (f) => `view ${id} ("${(entity.data as Data).name as string}"): ${formatFinding(f)}`,
            ),
        );
        continue;
      }
      if (entity?.type === 'decision') {
        const data = (entity as Entity<'decision'>).data;
        if (data.options && !data.chosenOptionId && !data.answer)
          out.push(...decisionWarnings(data).map((w) => `decision ${id} ("${data.title}") ${w}`));
        continue;
      }
      if (entity?.type !== 'claim') continue;
      const project = this.store.get((entity.data as Data).projectId as string);
      out.push(...claimWarnings(entity as Entity<'claim'>, project as Entity<'project'> | null));
    }
    return out;
  }

  /** Query findings of a view's own spec (templates are built in and trusted). */
  private viewFindings(view: Entity<'view'>, spec = view.data.spec): QueryFinding[] {
    if (!spec) return [];
    const project = this.store.get(view.data.projectId) as Entity<'project'> | null;
    const parsed = Board.safeParse(toBoard(spec as ViewSpec));
    return parsed.success ? checkBoardQueries(parsed.data, project) : [];
  }

  /**
   * Query checks on every view write (R8.8): a write may not add a reject-level finding. Findings
   * the view already had don't block an unrelated edit such as a resize.
   */
  private viewQueryIssues(view: Entity<'view'>, prefix: string): string[] {
    const rejects = this.viewFindings(view).filter((f) => f.level === 'reject');
    if (!rejects.length) return [];
    const first = this.changes.find((c) => c.id === view.id);
    const before = first?.before as Entity<'view'>['data'] | null | undefined;
    const old = new Set(before ? this.viewFindings({ ...view, data: before }).map(findingKey) : []);
    return rejects
      .filter((f) => !old.has(findingKey(f)))
      .map((f) => `${prefix}: ${formatFinding(f)}`);
  }

  /**
   * A record must fit its type (R8): the type exists in its project, fields have the right kind,
   * references point at records of the right type and files at files in the same project.
   */
  private recordIssues(record: Entity<'record'>, prefix: string): string[] {
    const project = this.store.get(record.data.projectId) as Entity<'project'> | null;
    const types: RecordType[] = project?.data.recordTypes ?? [];
    const type = findRecordType(project, record.data.recordType);
    if (!type)
      return [
        `${prefix}: recordType "${record.data.recordType}" isn't one of this project's record types (${types.map((t) => t.key).join(', ') || 'none; add recordTypes to the project or apply a pack'})`,
      ];
    const issues = recordFieldIssues(type, record.data.fields, !!record.data.interval).map(
      (i) => `${prefix}: ${i}`,
    );
    for (const def of type.fields) {
      const value = record.data.fields[def.key];
      if (typeof value !== 'string' || (def.kind !== 'reference' && def.kind !== 'file')) continue;
      const target = this.store.get(value);
      const expected = def.kind === 'file' ? 'file' : 'record';
      if (!target || target.type !== expected)
        issues.push(`${prefix}: fields.${def.key} → ${expected} ${value} not found`);
      else if ((target.data as Data).projectId !== record.data.projectId)
        issues.push(`${prefix}: fields.${def.key} → ${value} belongs to another project`);
      else if (target.id === record.id)
        issues.push(`${prefix}: fields.${def.key} can't point at itself`);
      else if (def.kind === 'reference' && (target as Entity<'record'>).data.recordType !== def.to)
        issues.push(
          `${prefix}: fields.${def.key} must point at a ${def.to} record, not a ${(target as Entity<'record'>).data.recordType}`,
        );
    }
    const from = record.data.interval?.meter?.from;
    if (from) {
      const at = resolvePath(project, { type: 'record', recordType: type }, from);
      if (!at.ok || !['meter', 'number'].includes(at.info.kind))
        issues.push(
          `${prefix}: interval.meter.from "${from}" must name a number or meter field, e.g. "fields.vehicle.fields.odometer"`,
        );
    }
    return issues;
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
