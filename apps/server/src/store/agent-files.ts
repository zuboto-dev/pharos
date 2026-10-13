import { closeSync, openSync, readSync, realpathSync, statSync } from 'node:fs';
import { sep } from 'node:path';
import {
  AGENT_FILE_FIELDS,
  ENTITIES,
  FILE_TEXT_REFUSAL,
  FOLDERS_SETTING,
  FileFolders,
  SCAN_FILE_FIELDS,
  TEXT_PREVIEW_MAX_BYTES,
  fileTypeOf,
  type ApplyInput,
  type Change,
  type Entity,
  type EntityDiff,
  type FileFolder,
  type FolderLevel,
  type Operation,
  type ProjectDataset,
  type RevisionSummary,
} from '@pharos/schema';
import { PharosError } from './errors.js';
import type { Store } from './store.js';

/**
 * What agents see of project files (R7.5, docs/reframe/roadmap-2.md §3). Every agent read path
 * (MCP tools, the snapshot, the answer brief, view previews, results of agent writes) goes
 * through here:
 * - a file whose folder is `details` or `contents` shows AGENT_FILE_FIELDS only (no path,
 *   folder, hash, mime type, modified time or notes);
 * - a file whose folder is `hidden`, or no longer in Settings, doesn't exist for agents: it is
 *   left out of lists, `get` says not found, history leaves out its changes (and revisions that
 *   only changed it), and links to it from other items are dropped.
 */

type Data = Record<string, unknown>;

const AGENT_FIELDS = new Set<string>(AGENT_FILE_FIELDS);

/** Fields agents can't write on a file: the scan's, and the owner's notes (which they can't read). */
export const AGENT_READONLY_FILE_FIELDS = [...SCAN_FILE_FIELDS, 'notes'] as const;

/** The owner's folders by id, from the app settings (an unreadable setting counts as none). */
export function folders(store: Store): Map<string, FileFolder> {
  const parsed = FileFolders.safeParse(store.setting(FOLDERS_SETTING) ?? []);
  return new Map((parsed.success ? parsed.data : []).map((f) => [f.id, f]));
}

/**
 * Agents' view of the files, computed once per read (folders can change between calls). A file
 * whose folder was removed counts as hidden: Pharos no longer knows what the owner wants shared.
 */
export class AgentFiles {
  private readonly roots: Map<string, FileFolder>;
  private readonly levels = new Map<string, FolderLevel>();

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

  /** The folder of a file agents may see; null when the file is hidden or gone. */
  folderOf(file: Entity<'file'>): FileFolder | null {
    return this.visible(file.id) ? (this.roots.get(file.data.rootId) ?? null) : null;
  }

  /**
   * Whether agents may see this id: false only for a file in a hidden (or removed) folder. An id
   * not in the store or its history counts as hidden when it looks like a file id.
   */
  visible(id: string): boolean {
    const known = this.store.lastKnown(id);
    if (!known) return !id.startsWith(`${ENTITIES.file.prefix}_`);
    return known.type !== 'file' || this.levelOf(id) !== 'hidden';
  }

  /** A file's data as agents see it. */
  fileData(data: Data): Data {
    return Object.fromEntries(Object.entries(data).filter(([k]) => AGENT_FIELDS.has(k)));
  }

  /** Fields of `type` that can point at files (a request's aboutId points at any item). */
  private fileRefs(type: Entity['type']): string[] {
    return Object.entries(ENTITIES[type].refs as Record<string, { type: string }>)
      .filter(([, ref]) => ref.type === 'file')
      .map(([field]) => field)
      .concat(type === 'request' ? ['aboutId'] : []);
  }

  /** Data of any entity as agents see it: file details only, links to hidden files dropped. */
  data(type: Entity['type'], id: string, data: Data): Data {
    if (type === 'file') return this.fileData(data);
    const refs = this.fileRefs(type);
    if (!refs.length) return data;
    const out = { ...data };
    for (const field of refs) {
      const value = out[field];
      if (Array.isArray(value)) out[field] = value.filter((v) => this.visible(String(v)));
      else if (typeof value === 'string' && !this.visible(value)) delete out[field];
    }
    // A question asked from a hidden file: where it was asked from may name the file.
    if (type === 'request' && data.aboutId && !('aboutId' in out)) delete out.about;
    return out;
  }

  /** An entity as agents see it, or null when it is a hidden file. */
  entity<E extends Entity>(entity: E): E | null {
    if (entity.type === 'file' && !this.visible(entity.id)) return null;
    return { ...entity, data: this.data(entity.type, entity.id, entity.data as Data) } as E;
  }

  entities<E extends Entity>(entities: E[]): E[] {
    return entities.map((e) => this.entity(e)).filter((e): e is E => e !== null);
  }

  /** A project's data for agent previews. */
  dataset(dataset: ProjectDataset): ProjectDataset {
    return {
      ...dataset,
      artifacts: this.entities(dataset.artifacts),
      requests: this.entities(dataset.requests),
      files: this.entities(dataset.files),
    };
  }

  /** Net changes as agents see them: none for hidden files, file details only for the rest. */
  diffs(diffs: EntityDiff[]): EntityDiff[] {
    return diffs.flatMap((d) => {
      if (d.type === 'file' && !this.visible(d.id)) return [];
      const keep =
        d.type === 'file'
          ? (f: string) => AGENT_FIELDS.has(f)
          : (f: string) => !this.fileRefs(d.type).includes(f) || this.diffRefVisible(d, f);
      const fields = Object.fromEntries(Object.entries(d.fields).filter(([f]) => keep(f)));
      if (d.type === 'request' && this.askedFromHiddenFile(d)) delete fields.about;
      if (d.op === 'update' && Object.keys(fields).length === 0) return [];
      return [{ ...d, fields }];
    });
  }

  /** Whether a request was (or is) asked from a hidden file; its `about` may name the file. */
  private askedFromHiddenFile(d: EntityDiff): boolean {
    const known = this.store.lastKnown(d.id)?.data.aboutId;
    const ids = [d.fields.aboutId?.before, d.fields.aboutId?.after, known];
    return ids.some((v) => typeof v === 'string' && !this.visible(v));
  }

  /** Whether a change to a file link shows no hidden file on either side. */
  private diffRefVisible(d: EntityDiff, field: string): boolean {
    const { before, after } = d.fields[field]!;
    return [before, after].every(
      (v) => v === null || v === undefined || (typeof v === 'string' && this.visible(v)),
    );
  }

  /**
   * Revisions as agents see them. A revision whose every change was to hidden files disappears
   * (its message may name them); the rest keep only what agents may see.
   */
  revisions(revisions: RevisionSummary[]): RevisionSummary[] {
    return revisions.flatMap((r) => {
      const changes = this.diffs(r.changes);
      return r.changes.length && !changes.length ? [] : [{ ...r, changes }];
    });
  }

  /** Why an agent may not run this operation, or undefined. Hidden files read as not found. */
  operationIssue(op: Operation): string | undefined {
    if (op.type === 'file' && op.op !== 'create' && !this.visible(op.id))
      return `file ${op.id} not found`;
    if (op.type === 'file' && op.op === 'update' && 'notes' in op.data)
      return "notes are the owner's; agents can't change them";
    if (op.op === 'delete') return undefined;
    for (const field of this.fileRefs(op.type)) {
      const value = (op.data as Data)[field];
      const ids = Array.isArray(value) ? value : [value];
      for (const id of ids)
        if (typeof id === 'string' && !id.startsWith('$') && !this.visible(id))
          return `data.${field}: file ${id} not found`;
    }
    return undefined;
  }

  /**
   * Why an agent may not revert these changes, or undefined: reverting must not add, remove or
   * move a file (agents can't do that with apply either), nor touch a file they can't see.
   */
  revertIssue(revisionId: number, changes: Change[]): string | undefined {
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
    const hidden = files.filter((c) => !this.visible(c.id));
    if (hidden.length)
      return hidden.length === changes.length
        ? `Revision ${revisionId} not found`
        : `Revision ${revisionId} changes files only the owner can see; ask the owner to revert it in Pharos`;
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
 * of a text type (by extension), at most TEXT_PREVIEW_MAX_BYTES. The real path must stay inside
 * the folder's real path (symlinks). Never logs the contents or the path.
 */
export function readAgentFileText(
  store: Store,
  fileId: string,
  maxBytes = TEXT_PREVIEW_MAX_BYTES,
): { id: string; title: string; text: string; bytes: number; truncated: boolean } {
  const entity = store.get(fileId);
  const file = entity?.type === 'file' ? (entity as Entity<'file'>) : null;
  const folder = file ? new AgentFiles(store).folderOf(file) : null;
  if (!file || !folder) throw new PharosError('not_found', `file ${fileId} not found`);
  if (folder.level !== 'contents') throw new PharosError('invalid', FILE_TEXT_REFUSAL);
  const { preview } = fileTypeOf(file.data.path);
  if (preview !== 'text' && preview !== 'markdown')
    throw new PharosError(
      'invalid',
      `"${file.data.title}" isn't a text file; agents can read the text of .txt, .csv and .md files only. Its details are in project_snapshot.`,
    );
  const unreadable = new PharosError(
    'not_found',
    `"${file.data.title}" can't be read now (its folder or the file is missing); ask the owner to check it in Pharos.`,
  );
  let real: string;
  let size: number;
  try {
    const root = realpathSync(folder.path);
    real = realpathSync(`${folder.path}/${file.data.path}`);
    const stat = statSync(real);
    if (!real.startsWith(root + sep) || !stat.isFile()) throw unreadable;
    size = stat.size;
  } catch {
    throw unreadable;
  }
  const length = Math.min(size, maxBytes);
  const buffer = Buffer.alloc(length);
  const fd = openSync(real, 'r');
  let read = 0;
  try {
    while (read < length) {
      const n = readSync(fd, buffer, read, length - read, read);
      if (n === 0) break;
      read += n;
    }
  } finally {
    closeSync(fd);
  }
  return {
    id: file.id,
    title: file.data.title,
    // A cut in the middle of a character decodes as U+FFFD instead of failing.
    text: new TextDecoder('utf-8').decode(buffer.subarray(0, read)),
    bytes: size,
    truncated: size > maxBytes,
  };
}
