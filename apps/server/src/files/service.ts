import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { stat, type FileHandle } from 'node:fs/promises';
import { Readable } from 'node:stream';
import {
  AddFilesInput,
  FOLDERS_SETTING,
  FileFolders,
  TEXT_PREVIEW_MAX_BYTES,
  UNKNOWN_FILE_TYPE,
  fileTypeOf,
  SCAN_FILE_FIELDS,
  type ApplyInput,
  type Author,
  type Entity,
  type FileAction,
  type FileFolder,
  type FileInfo,
  type FileMissing,
  type Operation,
  type ScannedFile,
} from '@pharos/schema';
import { PharosError } from '../store/errors.js';
import type { ApplyResult, Store } from '../store/store.js';
import { FileScanner, type ScanOptions } from './scan.js';
import {
  PathRefused,
  isAllowedPath,
  openInside,
  resolveInside,
  type OpenedFile,
} from './safety.js';

/**
 * Project files on the owner's disk (R7.2): resolving a file id to a real path inside its folder,
 * serving its contents read-only, and the Finder actions. Pharos never writes, renames or deletes
 * a file, and never logs or passes on its contents.
 */

/** A file request that can't be served, with an HTTP status for the routes. */
export class FileError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 500 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Runs `/usr/bin/open` with these arguments; rejects when it fails. Replaced in tests. */
export type Opener = (args: string[]) => Promise<void>;

const OPEN_COMMAND = '/usr/bin/open';

export const macOpener: Opener = (args) =>
  new Promise((resolve, reject) => {
    // No shell: the resolved path is one argument, whatever characters it has.
    execFile(OPEN_COMMAND, args, { timeout: 15_000 }, (error) =>
      error ? reject(error) : resolve(),
    );
  });

export type FileServiceOptions = ScanOptions & {
  opener?: Opener;
  platform?: NodeJS.Platform;
};

type Located =
  | { ok: true; entity: Entity<'file'>; folder: FileFolder; real: string; resolvedPath: string }
  | {
      ok: false;
      entity: Entity<'file'>;
      folder: FileFolder | null;
      missing: FileMissing;
      refused?: boolean;
      error?: unknown;
    };

/** Errors reading a file that iCloud (or a network disk) hasn't brought down yet. */
const NOT_DOWNLOADED = new Set(['ETIMEDOUT', 'EDEADLK', 'EAGAIN', 'ENXIO', 'EIO', 'ECANCELED']);

/** Files hashed while adding them or looking for a moved file are at most this big. */
const HASH_LOCAL_MAX_BYTES = 64 * 1024 * 1024;
const MOVED_CANDIDATES = 20;

const codeOf = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code;

/** `Content-Disposition` with the real file name (RFC 6266 / 5987), safe for any name. */
export function contentDisposition(kind: 'inline' | 'attachment', name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]|["\\%;]/g, '_');
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

export class FileService {
  readonly scanner: FileScanner;
  private readonly opener: Opener;
  private readonly platform: NodeJS.Platform;
  private readonly log: (message: string) => void;

  constructor(
    private readonly store: Store,
    options: FileServiceOptions = {},
  ) {
    this.log =
      options.log ?? ((m) => console.error(`[pharos] ${new Date().toISOString()} files: ${m}`));
    this.scanner = new FileScanner(store.database, { ...options, log: this.log });
    this.opener = options.opener ?? macOpener;
    this.platform = options.platform ?? process.platform;
  }

  /** The folders in Settings (an unreadable setting counts as none). */
  folders(): FileFolder[] {
    const parsed = FileFolders.safeParse(this.store.setting(FOLDERS_SETTING) ?? []);
    if (!parsed.success) {
      this.log('the saved folder list is invalid; treating it as empty');
      return [];
    }
    return parsed.data;
  }

  folder(rootId: string): FileFolder | null {
    return this.folders().find((f) => f.id === rootId) ?? null;
  }

  /**
   * Rescans every folder in Settings, one after another (on server start, R7.9), so files moved
   * while Pharos was off are found. Never rejects: each scan logs its own errors.
   */
  async rescanAll(): Promise<void> {
    try {
      for (const folder of this.folders()) {
        this.scanner.scan(folder);
        await this.scanner.idle(folder.id);
      }
    } catch (error) {
      this.log(`rescanning folders failed: ${String(error)}`);
    }
  }

  /** `POST …/folders/:folderId/scan`: starts a background scan. */
  scan(rootId: string) {
    const folder = this.folder(rootId);
    if (!folder) throw new PharosError('not_found', `Folder ${rootId} not found`);
    return this.scanner.scan(folder);
  }

  /** Where a file is now, or why it can't be reached. */
  private async locate(fileId: string): Promise<Located> {
    const entity = this.store.getOfType('file', fileId);
    const folder = this.folder(entity.data.rootId);
    if (!folder) return { ok: false, entity, folder, missing: 'folder-removed' };
    try {
      if (!(await stat(folder.path)).isDirectory()) throw new Error('Not a folder');
    } catch (error) {
      return { ok: false, entity, folder, missing: 'folder-unavailable', error };
    }
    try {
      const { real, resolvedPath } = await resolveInside(folder, entity.data.path);
      return { ok: true, entity, folder, real, resolvedPath };
    } catch (error) {
      if (error instanceof PathRefused && error.reason === 'replaced')
        return { ok: false, entity, folder, missing: 'folder-unavailable', refused: true, error };
      return {
        ok: false,
        entity,
        folder,
        missing: 'file-gone',
        refused: error instanceof PathRefused,
        error,
      };
    }
  }

  /** `GET /api/files/:fileId`. */
  async info(fileId: string): Promise<FileInfo> {
    const at = await this.locate(fileId);
    const { entity, folder } = at;
    let movedTo: string | null = null;
    if (!at.ok && at.missing === 'file-gone' && !at.refused && folder) {
      const hash = entity.data.sha256 ?? this.scanner.entry(folder.id, entity.data.path)?.sha256;
      if (hash) movedTo = await this.findMoved(folder, entity.data.path, hash, entity.data.size);
    }
    return {
      id: entity.id,
      available: at.ok,
      missing: at.ok ? null : at.missing,
      movedTo,
      folder: folder ? { id: folder.id, label: folder.label, level: folder.level } : null,
      type: at.ok ? fileTypeOf(at.real) : fileTypeOf(entity.data.path),
      absolutePath: at.ok ? `${folder!.path}/${entity.data.path}` : null,
    };
  }

  /**
   * Where a file with this hash is now: a hashed scan entry, or else one of a few entries of the
   * same size, hashed now (local files only; iCloud files aren't downloaded for this).
   */
  private async findMoved(
    folder: FileFolder,
    path: string,
    hash: string,
    size: number,
  ): Promise<string | null> {
    const known = this.scanner.findByHash(folder.id, hash).find((p) => p !== path);
    if (known) return known;
    for (const candidate of this.scanner.unhashedOfSize(folder.id, size, MOVED_CANDIDATES)) {
      if (candidate !== path && (await this.hashLocal(folder, candidate)) === hash)
        return candidate;
    }
    return null;
  }

  /**
   * Hashes a file already on this disk (never one iCloud would have to download, never a big
   * one), and saves the hash in the scan cache. Null when it can't or shouldn't be read.
   */
  async hashLocal(folder: FileFolder, path: string): Promise<string | null> {
    let handle: FileHandle | undefined;
    try {
      const opened = await openInside(folder, path);
      handle = opened.handle;
      const info = opened.stats;
      // A size with no blocks on disk is an iCloud placeholder ("dataless" file).
      if (info.size > HASH_LOCAL_MAX_BYTES || (info.size > 0 && info.blocks === 0)) return null;
      const hash = createHash('sha256');
      for await (const chunk of handle.createReadStream({ start: 0, autoClose: false }))
        hash.update(chunk as Buffer);
      const sha256 = hash.digest('hex');
      this.scanner.setHash(folder.id, path, sha256, info.size, info.mtime.toISOString());
      return sha256;
    } catch {
      return null;
    } finally {
      await handle?.close().catch(() => {});
    }
  }

  private async reachable(fileId: string) {
    const at = await this.locate(fileId);
    if (at.ok) return at;
    if (at.refused && at.missing === 'folder-unavailable')
      throw new FileError(
        403,
        'forbidden',
        'Its folder was replaced since it was added; remove it and add it again in Settings',
      );
    if (at.refused) throw new FileError(403, 'forbidden', 'Pharos doesn\u2019t serve this file');
    if (at.missing === 'folder-removed')
      throw new FileError(404, 'folder-removed', 'Its folder was removed in Settings');
    if (at.missing === 'folder-unavailable')
      throw new FileError(404, 'folder-unavailable', "Its folder can't be read right now");
    throw new FileError(404, 'file-gone', "The file isn't at its path any more");
  }

  /** Opens a file through the safe reader (see `openInside`), as a FileError when refused. */
  private async openSafely(folder: FileFolder, path: string): Promise<OpenedFile> {
    try {
      return await openInside(folder, path);
    } catch (error) {
      if (error instanceof PathRefused)
        throw new FileError(403, 'forbidden', 'Pharos doesn\u2019t serve this file');
      throw this.readError(error);
    }
  }

  private readError(error: unknown): FileError {
    const code = codeOf(error);
    if (code && NOT_DOWNLOADED.has(code))
      return new FileError(
        503,
        'not-downloaded',
        "The file couldn't be read now; it may still be downloading from iCloud. Try again soon, or reveal it in Finder.",
      );
    if (code === 'EACCES' || code === 'EPERM')
      return new FileError(403, 'forbidden', "Pharos isn't allowed to read this file");
    if (code === 'ENOENT') return new FileError(404, 'file-gone', "The file isn't there any more");
    this.log(`reading a file failed (${code ?? 'unknown error'})`);
    return new FileError(500, 'internal', "The file couldn't be read");
  }

  /**
   * The file's contents: `content` inline when its type previews (PDF, images, text, Markdown;
   * text capped at TEXT_PREVIEW_MAX_BYTES), otherwise and for `download` as an attachment with
   * the real file name. HTML, SVG and anything off the allowlist only ever download, as
   * `application/octet-stream`.
   */
  async contents(fileId: string, mode: 'content' | 'download'): Promise<Response> {
    const { entity, folder } = await this.reachable(fileId);
    const { handle, stats: info, resolvedPath } = await this.openSafely(folder, entity.data.path);
    // The type of what is really there; a link named "a.pdf" to "b.html" is not a PDF.
    const type =
      fileTypeOf(resolvedPath).mime === fileTypeOf(entity.data.path).mime
        ? fileTypeOf(resolvedPath)
        : UNKNOWN_FILE_TYPE;
    const inline = mode === 'content' && type.preview !== 'none';
    const isText = type.preview === 'text' || type.preview === 'markdown';
    const truncated = inline && isText && info.size > TEXT_PREVIEW_MAX_BYTES;
    const length = truncated ? TEXT_PREVIEW_MAX_BYTES : info.size;

    const stream = handle.createReadStream({
      start: 0,
      ...(length > 0 ? { end: length - 1 } : {}),
      autoClose: true,
    });
    // Hash lazily, while the file is read in full anyway (finds it again after it moves).
    if (!truncated) {
      const hash = createHash('sha256');
      let read = 0;
      stream.on('data', (chunk: Buffer | string) => {
        hash.update(chunk);
        read += chunk.length;
      });
      stream.on('end', () => {
        try {
          if (read === info.size)
            this.scanner.setHash(
              entity.data.rootId,
              entity.data.path,
              hash.digest('hex'),
              info.size,
              info.mtime.toISOString(),
            );
        } catch (error) {
          this.log(`saving a file hash failed: ${String(error)}`);
        }
      });
    }
    stream.on('error', (error: unknown) =>
      this.log(`reading a file stopped (${codeOf(error) ?? 'unknown error'})`),
    );

    // `sandbox` stays on every file, PDFs too: Chrome's viewer shows a sandboxed PDF response in
    // a new tab and in a plain frame (checked in Chrome 154, R7.9). Only a frame with the
    // `sandbox` attribute stops it, so the drawer leaves that attribute off in Chromium.
    const headers = new Headers({
      'content-type': type.mime,
      'content-length': String(length),
      'content-disposition': contentDisposition(
        inline ? 'inline' : 'attachment',
        baseName(entity.data.path),
      ),
      'x-content-type-options': 'nosniff',
      'content-security-policy': 'sandbox',
      'cross-origin-resource-policy': 'same-origin',
      'referrer-policy': 'no-referrer',
      'cache-control': 'private, no-store',
    });
    if (truncated) headers.set('x-pharos-truncated', String(TEXT_PREVIEW_MAX_BYTES));
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { headers });
  }

  /**
   * Reveal in Finder (`open -R`) or open in the default app (`open`, documents on the allowlist
   * only, never scripts, apps or HTML). The only argument is the resolved real path.
   */
  async action(fileId: string, action: FileAction): Promise<void> {
    if (this.platform !== 'darwin')
      throw new FileError(400, 'unsupported', 'This works on macOS only');
    const { entity, folder, real } = await this.reachable(fileId);
    if (action === 'open') {
      if (!fileTypeOf(real).open || !fileTypeOf(entity.data.path).open)
        throw new FileError(403, 'forbidden', 'Pharos only opens documents; reveal it in Finder');
      // Same checks as reading it (a plain file; a ".key" must be Keynote).
      await (await this.openSafely(folder, entity.data.path)).handle.close();
    }
    try {
      await this.opener(action === 'reveal' ? ['-R', real] : [real]);
    } catch (error) {
      this.log(`${action} failed (${codeOf(error) ?? 'exit code'})`);
      throw new FileError(
        500,
        'action-failed',
        action === 'reveal' ? "Finder couldn't show the file" : "The file couldn't be opened",
      );
    }
  }

  /** `GET /api/projects/:projectId/scanned-files`: the scan cache, for "Add files". */
  scanned(projectId: string, query = '', limit = 100): ScannedFile[] {
    this.store.getOfType('project', projectId);
    const added = new Map<string, string[]>();
    for (const f of this.store.list('file', { projectId })) {
      const key = `${f.data.rootId}\u0000${f.data.path}`;
      added.set(key, [...(added.get(key) ?? []), f.id]);
    }
    const rootIds = this.folders().map((f) => f.id);
    return this.scanner
      .search(rootIds, query, Math.min(Math.max(limit, 1), 500))
      .filter((e) => isAllowedPath(e.path, e.size))
      .map((e) => ({
        rootId: e.rootId,
        path: e.path,
        size: e.size,
        modifiedAt: e.modifiedAt,
        mimeType: e.mimeType,
        addedAs: added.get(`${e.rootId}\u0000${e.path}`) ?? [],
      }));
  }

  /**
   * `POST /api/projects/:projectId/files`: adds files from the scan cache (never a path the
   * client made up) as one revision.
   */
  async add(projectId: string, raw: unknown, author: Author): Promise<ApplyResult> {
    const input = AddFilesInput.parse(raw);
    // The store refuses this too; refusing first means no file is read for it.
    if (author.kind !== 'human')
      throw new PharosError('invalid', "Agents can't add files; the owner adds them in Pharos");
    this.store.getOfType('project', projectId);
    const existing = new Set(
      this.store.list('file', { projectId }).map((f) => `${f.data.rootId}\u0000${f.data.path}`),
    );
    const issues: string[] = [];
    const records: (Record<string, unknown> & { rootId: string; path: string; sha256?: string })[] =
      [];
    input.files.forEach((file, i) => {
      const folder = this.folder(file.rootId);
      const entry = folder ? this.scanner.entry(file.rootId, file.path) : null;
      const key = `${file.rootId}\u0000${file.path}`;
      if (!folder) issues.push(`files.${i}: folder ${file.rootId} isn't in Settings`);
      else if (!entry || !isAllowedPath(entry.path, entry.size))
        issues.push(`files.${i}: "${file.path}" isn't in the last scan of ${folder.label}`);
      else if (existing.has(key))
        issues.push(`files.${i}: "${file.path}" is already in this project`);
      if (!entry || !folder || existing.has(key)) return;
      existing.add(key);
      const name = baseName(entry.path);
      const dot = name.lastIndexOf('.');
      records.push({
        projectId,
        title: (file.title ?? (dot > 0 ? name.slice(0, dot) : name)).slice(0, 200),
        rootId: entry.rootId,
        path: entry.path,
        size: entry.size,
        modifiedAt: entry.modifiedAt,
        mimeType: fileTypeOf(entry.path).mime,
        ...(entry.sha256 ? { sha256: entry.sha256 } : {}),
        ...(file.kind ? { kind: file.kind } : {}),
        ...(file.tags ? { tags: file.tags } : {}),
      });
    });
    if (issues.length) throw new PharosError('invalid', "Some files can't be added", issues);
    // Hash what is already on this disk, so the file can be found again after it moves.
    for (const data of records) {
      if (data.sha256) continue;
      const sha256 = await this.hashLocal(this.folder(data.rootId)!, data.path);
      if (sha256) data.sha256 = sha256;
    }
    const operations = records.map(
      (data): Operation => ({ op: 'create', type: 'file', data }) as Operation,
    );
    return this.store.apply(author, { message: input.message ?? 'Add files', operations });
  }

  /**
   * A person's `/api/apply` writes to files (R7.9). Where a file is on disk (`rootId`, `path`)
   * changes only to a path in the last scan of a folder in Settings that Pharos would serve (after
   * "Use the new path" for a moved file), never one the client made up; the other scan fields then
   * come from that scan. Size, date, hash and type are never set by hand, and files are only added
   * from the scan (`add`). Agents never get here: the store refuses their writes to these fields.
   */
  async checkPersonEdits(input: ApplyInput): Promise<ApplyInput> {
    const issues: string[] = [];
    const operations: Operation[] = [];
    for (const [i, op] of input.operations.entries()) {
      if (op.type !== 'file' || op.op === 'delete') {
        operations.push(op);
        continue;
      }
      const at = `operations[${i}]`;
      const byHand = BY_SCAN_ONLY.filter((f) => f in op.data);
      if (byHand.length) {
        issues.push(`${at}: ${byHand.join(', ')} come from the folder scan`);
        continue;
      }
      if (op.op === 'create') {
        issues.push(`${at}: add files from a folder in Settings ("Add files")`);
        continue;
      }
      if (!('rootId' in op.data) && !('path' in op.data)) {
        operations.push(op);
        continue;
      }
      const entity = op.id.startsWith('$') ? null : this.store.get(op.id);
      if (entity?.type !== 'file') {
        issues.push(`${at}: file ${op.id} not found`);
        continue;
      }
      const file = entity as Entity<'file'>;
      const rootId = op.data.rootId === undefined ? file.data.rootId : op.data.rootId;
      const path = op.data.path === undefined ? file.data.path : op.data.path;
      if (typeof rootId !== 'string' || typeof path !== 'string') {
        issues.push(`${at}: a file always has a folder and a path`);
        continue;
      }
      const folder = this.folder(rootId);
      if (!folder) {
        issues.push(`${at}: folder ${rootId} isn't in Settings`);
        continue;
      }
      const entry = this.scanner.entry(rootId, path);
      if (!entry || !isAllowedPath(entry.path, entry.size)) {
        issues.push(`${at}: "${path}" isn't in the last scan of ${folder.label}`);
        continue;
      }
      const taken = this.store
        .list('file', { projectId: file.data.projectId })
        .some((f) => f.id !== file.id && f.data.rootId === rootId && f.data.path === path);
      if (taken) {
        issues.push(`${at}: "${path}" is already in this project`);
        continue;
      }
      const unchanged = rootId === file.data.rootId && path === file.data.path;
      const sha256 =
        entry.sha256 ??
        (unchanged ? (file.data.sha256 ?? null) : await this.hashLocal(folder, path));
      operations.push({
        ...op,
        data: {
          ...op.data,
          rootId,
          path,
          size: entry.size,
          modifiedAt: entry.modifiedAt,
          mimeType: fileTypeOf(entry.path).mime,
          sha256,
        },
      });
    }
    if (issues.length) throw new PharosError('invalid', "Some file changes can't be saved", issues);
    return { ...input, operations };
  }
}

/** Scan fields set only by the scan; `rootId` and `path` are checked by `checkPersonEdits`. */
const BY_SCAN_ONLY = SCAN_FILE_FIELDS.filter((f) => f !== 'rootId' && f !== 'path');
