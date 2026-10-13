import { realpathSync } from 'node:fs';
import {
  AGENT_FILE_FIELDS,
  ENTITIES,
  FILE_TEXT_REFUSAL,
  FOLDERS_SETTING,
  FileFolders,
  SCAN_FILE_FIELDS,
  TEXT_PREVIEW_MAX_BYTES,
  fileTypeOf,
  folderContains,
  type ApplyInput,
  type Change,
  type Entity,
  type EntityDiff,
  type EntityType,
  type FileFolder,
  type FolderLevel,
  type Operation,
  type ProjectDataset,
  type RevisionSummary,
} from '@pharos/schema';
import { localPathOf } from '../files/artifact-file.js';
import { openInside, type OpenedFile } from '../files/safety.js';
import { PharosError } from './errors.js';
import type { Store } from './store.js';

/**
 * What agents see of project files (R7.5, docs/reframe/roadmap-2.md §3; R7.9). Every agent read
 * path (MCP tools, REST reads sent with `X-Pharos-Author: agent:…`, the snapshot, the answer
 * brief, view previews, results and errors of agent writes) goes through here:
 * - a file whose folder is `details` or `contents` shows AGENT_FILE_FIELDS only (no path,
 *   folder, hash, mime type, modified time or notes);
 * - a file whose folder is `hidden`, or no longer in Settings, doesn't exist for agents: it is
 *   left out of lists, `get` says not found, history leaves out its changes (and revisions that
 *   only changed it), and links to it from other items are dropped;
 * - the same holds for what was copied from such a file: an artifact linked to it (by `fileId`,
 *   or a local `uri` inside a hidden folder), a claim whose every source is such an artifact, and
 *   a term explained from one. A claim keeps its other sources but loses a quote taken from a
 *   hidden source, or from a `details` file (its words are the file's contents);
 * - no artifact shows a local `uri` (a path on the owner's disk);
 * - a revision that changed anything hidden shows a neutral message (its own may name it), and
 *   errors from agent writes never describe a hidden item.
 */

type Data = Record<string, unknown>;

const AGENT_FIELDS = new Set<string>(AGENT_FILE_FIELDS);

/** Types agents may not see when they come from (or are) an owner-only file. */
const HIDEABLE = new Set<EntityType>(['file', 'artifact', 'claim', 'term']);

/** Entity ids in text (`newId`: prefix, underscore, 12 hex digits). */
const ID_IN_TEXT = /\b[a-z]+_[0-9a-f]{12}\b/g;

/** Said instead of a revision message that may name something the agent can't see. */
export const HIDDEN_REVISION_MESSAGE =
  'Changes that include items only the owner can see (message not shown)';

/** Said instead of an error detail that names something the agent can't see. */
const HIDDEN_ISSUE =
  'An item only the owner can see is involved; ask the owner to do this in Pharos';

/** Fields agents can't write on a file: the scan's, and the owner's notes (which they can't read). */
export const AGENT_READONLY_FILE_FIELDS = [...SCAN_FILE_FIELDS, 'notes'] as const;

/** The owner's folders by id, from the app settings (an unreadable setting counts as none). */
export function folders(store: Store): Map<string, FileFolder> {
  const parsed = FileFolders.safeParse(store.setting(FOLDERS_SETTING) ?? []);
  return new Map((parsed.success ? parsed.data : []).map((f) => [f.id, f]));
}

const LEVEL_RANK: Record<FolderLevel, number> = { contents: 0, details: 1, hidden: 2 };

function realpathOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/**
 * Agents' view of the files, computed once per read (folders can change between calls). A file
 * whose folder was removed counts as hidden: Pharos no longer knows what the owner wants shared.
 */
export class AgentFiles {
  private readonly roots: Map<string, FileFolder>;
  private readonly levels = new Map<string, FolderLevel>();
  private readonly seen = new Map<string, boolean>();
  private readonly pathLevels = new Map<string, FolderLevel | null>();

  constructor(private readonly store: Store) {
    this.roots = folders(store);
  }

  /** The level of the folder a file (by id, current or deleted) sits in; `hidden` if unknown. */
  levelOf(fileId: string): FolderLevel {
    const cached = this.levels.get(fileId);
    if (cached) return cached;
    const known = this.store.lastKnown(fileId);
    const rootId = known?.type === 'file' ? known.data.rootId : undefined;
    const level = (typeof rootId === 'string' && this.roots.get(rootId)?.level) || 'hidden';
    this.levels.set(fileId, level);
    return level;
  }

  /**
   * The level of the owner's folder a local path sits in (as written or as its real path), or
   * null when it is in none. When folders could both hold it, the stricter level wins.
   */
  private levelOfPath(path: string): FolderLevel | null {
    if (this.pathLevels.has(path)) return this.pathLevels.get(path)!;
    const candidates = [path, realpathOrNull(path)].filter((p): p is string => !!p);
    let level: FolderLevel | null = null;
    for (const folder of this.roots.values()) {
      const roots = [folder.path, realpathOrNull(folder.path)].filter((p): p is string => !!p);
      const inside = roots.some((root) => candidates.some((p) => folderContains(root, p)));
      if (inside && (!level || LEVEL_RANK[folder.level] > LEVEL_RANK[level])) level = folder.level;
    }
    this.pathLevels.set(path, level);
    return level;
  }

  /**
   * How far an artifact's contents may reach agents: the level of the file it is linked to or
   * the folder its local `uri` is in (the stricter), `hidden` when it is linked to a file agents
   * can't see, and null for a web source or a local path outside the owner's folders.
   */
  private artifactLevel(data: Data): FolderLevel | null {
    const levels: FolderLevel[] = [];
    if (typeof data.fileId === 'string') levels.push(this.levelOf(data.fileId));
    const local = localPathOf(typeof data.uri === 'string' ? data.uri : undefined);
    const pathLevel = local ? this.levelOfPath(local) : null;
    if (pathLevel) levels.push(pathLevel);
    if (!levels.length) return null;
    return levels.reduce((a, b) => (LEVEL_RANK[b] > LEVEL_RANK[a] ? b : a));
  }

  /** The level of an artifact by id (current or deleted); `hidden` for an unknown artifact id. */
  private sourceLevel(artifactId: unknown): FolderLevel | null {
    if (typeof artifactId !== 'string') return null;
    const known = this.store.lastKnown(artifactId);
    if (!known) return artifactId.startsWith(`${ENTITIES.artifact.prefix}_`) ? 'hidden' : null;
    return known.type === 'artifact' ? this.artifactLevel(known.data) : null;
  }

  /** The folder of a file agents may see; null when the file is hidden or gone. */
  folderOf(file: Entity<'file'>): FileFolder | null {
    return this.visible(file.id) ? (this.roots.get(file.data.rootId) ?? null) : null;
  }

  /**
   * Whether agents may see this id: false for a file in a hidden (or removed) folder and for
   * what was copied from one (see the top of this module). An id not in the store or its history
   * counts as hidden when it looks like a file id.
   */
  visible(id: string): boolean {
    const cached = this.seen.get(id);
    if (cached !== undefined) return cached;
    const known = this.store.lastKnown(id);
    if (!known) return !id.startsWith(`${ENTITIES.file.prefix}_`);
    if (!HIDEABLE.has(known.type)) return true;
    // Guards against a cycle of links; nothing can see itself through itself.
    this.seen.set(id, false);
    const visible = this.computeVisible(known.type, known.data);
    this.seen.set(id, visible);
    return visible;
  }

  private computeVisible(type: EntityType, data: Data): boolean {
    switch (type) {
      case 'file':
        return this.visibleFile(data);
      case 'artifact':
        return this.artifactLevel(data) !== 'hidden';
      case 'claim': {
        const sources = Array.isArray(data.sourceIds) ? data.sourceIds : [];
        return !sources.length || sources.some((s) => this.sourceLevel(s) !== 'hidden');
      }
      case 'term':
        return this.sourceLevel(data.sourceId) !== 'hidden';
      default:
        return true;
    }
  }

  private visibleFile(data: Data): boolean {
    const rootId = data.rootId;
    return typeof rootId === 'string' && (this.roots.get(rootId)?.level ?? 'hidden') !== 'hidden';
  }

  /** A file's data as agents see it. */
  fileData(data: Data): Data {
    return Object.fromEntries(Object.entries(data).filter(([k]) => AGENT_FIELDS.has(k)));
  }

  /**
   * Fields of `type` that can point at hideable items (a request's aboutId points at any item;
   * an artifact's `image` may be a file id, R7.13; a web address there always counts as visible).
   */
  private hideableRefs(type: Entity['type']): string[] {
    return Object.entries(ENTITIES[type].refs as Record<string, { type: EntityType }>)
      .filter(([, ref]) => HIDEABLE.has(ref.type))
      .map(([field]) => field)
      .concat(type === 'request' ? ['aboutId'] : [])
      .concat(type === 'artifact' ? ['image'] : []);
  }

  /** Whether a claim's quote was copied from a hidden or details-only source. */
  private quoteWithheld(data: Data): boolean {
    if (typeof data.quote !== 'string') return false;
    const sources = Array.isArray(data.sourceIds) ? data.sourceIds : [];
    const level = this.sourceLevel(data.quoteSourceId ?? sources[0]);
    return level === 'hidden' || level === 'details';
  }

  /** Data of any entity as agents see it: file details only, links to hidden items dropped. */
  data(type: Entity['type'], _id: string, data: Data): Data {
    if (type === 'file') return this.fileData(data);
    const out = { ...data };
    // A local path names a place on the owner's disk (and maybe a hidden folder).
    if (type === 'artifact' && localPathOf(typeof out.uri === 'string' ? out.uri : undefined))
      delete out.uri;
    if (type === 'claim' && this.quoteWithheld(data)) delete out.quote;
    for (const field of this.hideableRefs(type)) {
      const value = out[field];
      if (Array.isArray(value)) out[field] = value.filter((v) => this.visible(String(v)));
      else if (typeof value === 'string' && !this.visible(value)) delete out[field];
    }
    // A question asked from a hidden item: where it was asked from may name it.
    if (type === 'request' && data.aboutId && !('aboutId' in out)) delete out.about;
    return out;
  }

  /** An entity as agents see it, or null when it is hidden. */
  entity<E extends Entity>(entity: E): E | null {
    if (!this.visible(entity.id)) return null;
    return { ...entity, data: this.data(entity.type, entity.id, entity.data as Data) } as E;
  }

  entities<E extends Entity>(entities: E[]): E[] {
    return entities.map((e) => this.entity(e)).filter((e): e is E => e !== null);
  }

  /**
   * Entities of a type as agents see them, for `list` reads. Filtering on a file field agents
   * can't see is refused; a filter on a field the agent can't see on an item matches nothing.
   */
  list<T extends EntityType>(
    type: T,
    options: { projectId?: string; where?: Record<string, string | number | boolean> } = {},
  ): Entity<T>[] {
    const where = options.where ?? {};
    const unknown = Object.keys(where).filter((f) => type === 'file' && !AGENT_FIELDS.has(f));
    if (unknown.length)
      throw new PharosError(
        'invalid',
        `Unknown field "${unknown[0]}" for file. Fields: ${AGENT_FILE_FIELDS.join(', ')}`,
      );
    return this.entities(this.store.list(type, options)).filter((seen) =>
      Object.keys(where).every((f) => f in seen.data),
    );
  }

  /** A project's data as agents see it (previews, REST reads by agents). */
  dataset(dataset: ProjectDataset): ProjectDataset {
    return {
      ...dataset,
      artifacts: this.entities(dataset.artifacts),
      requests: this.entities(dataset.requests),
      claims: this.entities(dataset.claims),
      terms: this.entities(dataset.terms),
      files: this.entities(dataset.files),
    };
  }

  /** Net changes as agents see them: none for hidden items, file details only for the rest. */
  diffs(diffs: EntityDiff[]): EntityDiff[] {
    return diffs.flatMap((d) => {
      if (!this.visible(d.id)) return [];
      const refs = this.hideableRefs(d.type);
      const known = this.store.lastKnown(d.id)?.data;
      const keep = (f: string): boolean => {
        if (d.type === 'file') return AGENT_FIELDS.has(f);
        if (d.type === 'artifact' && f === 'uri') return !this.localUriIn(d, f);
        if (d.type === 'claim' && f === 'quote')
          return !this.quoteWithheld({ ...known, quote: '' }) && !this.quoteChangeWithheld(d);
        return !refs.includes(f) || this.diffRefVisible(d, f);
      };
      const fields = Object.fromEntries(Object.entries(d.fields).filter(([f]) => keep(f)));
      if (d.type === 'request' && this.askedFromHidden(d)) delete fields.about;
      if (d.op === 'update' && Object.keys(fields).length === 0) return [];
      return [{ ...d, fields }];
    });
  }

  /** Whether a claim's quote change involved a hidden or details-only quote source. */
  private quoteChangeWithheld(d: EntityDiff): boolean {
    const quoteSource = d.fields.quoteSourceId;
    const sources = d.fields.sourceIds;
    const ids = [
      quoteSource?.before,
      quoteSource?.after,
      ...(Array.isArray(sources?.before) ? sources.before.slice(0, 1) : []),
      ...(Array.isArray(sources?.after) ? sources.after.slice(0, 1) : []),
    ];
    return ids.some((id) => {
      const level = this.sourceLevel(id);
      return level === 'hidden' || level === 'details';
    });
  }

  /** Whether either side of a field change is a local path. */
  private localUriIn(d: EntityDiff, field: string): boolean {
    const { before, after } = d.fields[field]!;
    return [before, after].some((v) => typeof v === 'string' && localPathOf(v) !== null);
  }

  /** Whether a request was (or is) asked from a hidden item; its `about` may name it. */
  private askedFromHidden(d: EntityDiff): boolean {
    const known = this.store.lastKnown(d.id)?.data.aboutId;
    const ids = [d.fields.aboutId?.before, d.fields.aboutId?.after, known];
    return ids.some((v) => typeof v === 'string' && !this.visible(v));
  }

  /** Whether a change to a link shows no hidden item on either side. */
  private diffRefVisible(d: EntityDiff, field: string): boolean {
    const { before, after } = d.fields[field]!;
    const ids = [before, after].flatMap((v) => (Array.isArray(v) ? v : [v]));
    return ids.every(
      (v) => v === null || v === undefined || (typeof v === 'string' && this.visible(v)),
    );
  }

  /**
   * Revisions as agents see them. A revision whose every change was to hidden items disappears;
   * the rest keep only what agents may see, and a revision that also changed hidden items gets a
   * neutral message (its own may name them).
   */
  revisions(revisions: RevisionSummary[]): RevisionSummary[] {
    return revisions.flatMap((r) => {
      const changes = this.diffs(r.changes);
      if (r.changes.length && !changes.length) return [];
      const touchesHidden = r.changes.some((c) => !this.visible(c.id));
      return [{ ...r, ...(touchesHidden ? { message: HIDDEN_REVISION_MESSAGE } : {}), changes }];
    });
  }

  /** Whether a text (an error detail, a warning) names an item agents can't see. */
  private names(text: string): boolean {
    return [...text.matchAll(ID_IN_TEXT)].some(([id]) => !this.visible(id));
  }

  /** Error details or warnings for an agent: one neutral line instead of any naming a hidden item. */
  texts(lines: string[]): string[] {
    return [...new Set(lines.map((line) => (this.names(line) ? HIDDEN_ISSUE : line)))];
  }

  /**
   * An error for an agent: its message and details never describe an item the agent can't see
   * (a conflict or validation detail names items by id and title).
   */
  error(err: PharosError): PharosError {
    // The message ends with the issues, one per line (PharosError).
    const base = err.issues.length ? err.message.split('\n')[0]! : err.message;
    const issues = this.texts(err.issues);
    const message = this.names(base) ? HIDDEN_ISSUE : base;
    if (message === base && issues.join('\n') === err.issues.join('\n')) return err;
    return new PharosError(err.code, message, issues);
  }

  /** Why an agent may not run this operation, or undefined. Hidden items read as not found. */
  operationIssue(op: Operation): string | undefined {
    if (op.op !== 'create' && HIDEABLE.has(op.type) && !this.visible(op.id))
      return `${op.type} ${op.id} not found`;
    if (op.type === 'file' && op.op === 'update' && 'notes' in op.data)
      return "notes are the owner's; agents can't change them";
    if (op.op === 'delete') return undefined;
    for (const field of this.hideableRefs(op.type)) {
      const value = (op.data as Data)[field];
      const ids = Array.isArray(value) ? value : [value];
      for (const id of ids)
        if (typeof id === 'string' && !id.startsWith('$') && !this.visible(id))
          return `data.${field}: ${id} not found`;
    }
    return undefined;
  }

  /**
   * Why an agent may not make these changes (checked inside the transaction, so it covers what
   * cascades from a delete and what an undo does), or undefined: agents never add or remove a
   * file record, nor remove an item they can't see.
   */
  changesIssue(changes: Change[]): string | undefined {
    const files = changes.filter((c) => c.type === 'file' && (!c.before || !c.after));
    if (files.length)
      return `This would ${files.some((c) => !c.after) ? 'remove' : 'add'} files the owner added in Pharos; only the owner adds or removes files, so ask them`;
    if (changes.some((c) => !c.after && !this.visible(c.id))) return HIDDEN_ISSUE;
    return undefined;
  }

  /**
   * Why an agent may not revert these changes, or undefined: reverting must not add, remove or
   * move a file (agents can't do that with apply either), nor touch an item they can't see.
   */
  revertIssue(revisionId: number, changes: Change[]): string | undefined {
    const hidden = changes.filter((c) => !this.visible(c.id));
    if (hidden.length)
      return hidden.length === changes.length
        ? `Revision ${revisionId} not found`
        : `Revision ${revisionId} changes items only the owner can see; ask the owner to revert it in Pharos`;
    // Only Pharos links an artifact to a file (R7.6); a revert must not set or change the link.
    const relinks = changes.some((c) => {
      if (c.type !== 'artifact' || !c.before) return false;
      const before = c.before.fileId ?? null;
      return c.after ? before !== (c.after.fileId ?? null) : before !== null;
    });
    if (relinks)
      return `Revision ${revisionId} changes which file a source is linked to; only Pharos links them, so ask the owner`;
    const files = changes.filter((c) => c.type === 'file');
    if (!files.length) return undefined;
    if (files.some((c) => !c.before || !c.after))
      return `Revision ${revisionId} adds or removes a file; only the owner adds or removes files, so ask them`;
    const scanned = files.some((c) =>
      AGENT_READONLY_FILE_FIELDS.some(
        (f) => JSON.stringify(c.before?.[f]) !== JSON.stringify(c.after?.[f]),
      ),
    );
    return scanned
      ? `Revision ${revisionId} changes where a file is on disk or the owner's notes; agents can't, so ask the owner`
      : undefined;
  }
}

/** Apply input checks for agents (on top of the store's own file rules). */
export function agentApplyIssue(store: Store, input: ApplyInput): string | undefined {
  const files = new AgentFiles(store);
  for (const [index, op] of input.operations.entries()) {
    const issue = files.operationIssue(op);
    if (issue) return `operations[${index}]: ${issue}`;
  }
  return undefined;
}

/**
 * The text of a file for `file_read_text`: only a file agents can see, in a `contents` folder,
 * of a text type, at most TEXT_PREVIEW_MAX_BYTES. It reads through the same safe reader as the
 * file drawer (`openInside`, R7.9): the folder must still be the one the owner added, the
 * recorded and the resolved names must pass the secret rules, the resolved file must be text
 * too, and nothing on the way may be a link out. Any failure is one path-free refusal; it never
 * logs the contents or the path.
 */
export async function readAgentFileText(
  store: Store,
  fileId: string,
  maxBytes = TEXT_PREVIEW_MAX_BYTES,
): Promise<{ id: string; title: string; text: string; bytes: number; truncated: boolean }> {
  const entity = store.get(fileId);
  const file = entity?.type === 'file' ? (entity as Entity<'file'>) : null;
  const folder = file ? new AgentFiles(store).folderOf(file) : null;
  if (!file || !folder) throw new PharosError('not_found', `file ${fileId} not found`);
  if (folder.level !== 'contents') throw new PharosError('invalid', FILE_TEXT_REFUSAL);
  const isText = (path: string) => {
    const { preview } = fileTypeOf(path);
    return preview === 'text' || preview === 'markdown';
  };
  const notText = new PharosError(
    'invalid',
    `"${file.data.title}" isn't a text file; agents can read the text of .txt, .csv and .md files only. Its details are in project_snapshot.`,
  );
  if (!isText(file.data.path)) throw notText;
  const unreadable = new PharosError(
    'not_found',
    `"${file.data.title}" can't be read now (its folder or the file is missing, or Pharos doesn't read it); ask the owner to check it in Pharos.`,
  );
  let opened: OpenedFile;
  try {
    opened = await openInside(folder, file.data.path, { level: 'contents' });
  } catch {
    throw unreadable;
  }
  const { handle, stats, resolvedPath } = opened;
  try {
    // A link "notes.txt" → "notes.pdf" is not text.
    if (!isText(resolvedPath)) throw notText;
    const size = stats.size;
    const length = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const { bytesRead } = await handle.read(buffer, read, length - read, read);
      if (bytesRead === 0) break;
      read += bytesRead;
    }
    return {
      id: file.id,
      title: file.data.title,
      // A cut in the middle of a character decodes as U+FFFD instead of failing.
      text: new TextDecoder('utf-8').decode(buffer.subarray(0, read)),
      bytes: size,
      truncated: size > maxBytes,
    };
  } catch (error) {
    throw error === notText ? notText : unreadable;
  } finally {
    await handle.close().catch(() => {});
  }
}
