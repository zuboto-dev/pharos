import { createHash } from 'node:crypto';
import { createReadStream, realpathSync, statSync, type Stats } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type ArtifactFileMatch,
  type Author,
  type Entity,
  FOLDERS_SETTING,
  type FileFolder,
  FileFolders,
  FilePath,
  type MentionedFile,
  type Operation,
  folderContains,
} from '@pharos/schema';
import { Hono } from 'hono';
import type { RevisionFeed } from '../feed.js';
import { PharosError } from '../store/errors.js';
import type { Store } from '../store/store.js';
import { pendingRequestFor, projectBases, summaryOf } from './requests.js';
import { sameOriginOnly } from './routes.js';
import { plainFileInsideSync } from './safety.js';

/**
 * Claim sources on disk (R7.6, docs/reframe/roadmap-2.md §3). An artifact whose `uri` is a local
 * path points at a project file through `artifact.fileId`, so the web app opens it in the file
 * drawer instead of showing a path the browser can't open.
 *
 * Matching, in order: `fileId` when set; else a file of the same project at the same folder and
 * path; else a file of the same project with the same contents (SHA-256), which finds a source
 * that was moved or copied into a folder. Hashing reads a file only to compare it: a regular file,
 * no dot part in its path, at most HASH_MAX_BYTES, and only when a project file has the same size.
 * Nothing read is ever returned, logged or sent to agents.
 *
 * Who sets `fileId`: Pharos (when files are added or moved, see `watchArtifactLinks`) and the
 * owner. Agents can't set or change it (Store.apply refuses): a file id an agent picked could
 * point a claim at a file from a folder it can't see. An agent records the path in `uri`, and
 * Pharos links it.
 */

/** Files bigger than this are never hashed for matching. */
export const HASH_MAX_BYTES = 256 * 1024 * 1024;

const SYSTEM: Author = { kind: 'system', name: 'pharos' };

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** The absolute local path an artifact's `uri` names, or null (a web address, relative, none). */
export function localPathOf(uri: string | undefined): string | null {
  const value = uri?.trim();
  if (!value) return null;
  if (value.startsWith('file:')) {
    try {
      return normalize(fileURLToPath(value));
    } catch {
      return null;
    }
  }
  // Any other scheme (https:, mailto:, …) isn't a local file.
  if (SCHEME.test(value)) return null;
  if (value === '~' || value.startsWith('~/')) return normalize(join(homedir(), value.slice(1)));
  return isAbsolute(value) ? normalize(value) : null;
}

function folders(store: Store): FileFolder[] {
  const parsed = FileFolders.safeParse(store.setting(FOLDERS_SETTING) ?? []);
  return parsed.success ? parsed.data : [];
}

function realpath(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/** The folder a path sits in and its path inside it, comparing as written and as real paths. */
export function folderOf(
  path: string,
  list: readonly FileFolder[],
): { folder: FileFolder; path: string } | null {
  const real = realpath(path);
  for (const folder of list) {
    for (const root of [folder.path, realpath(folder.path)]) {
      for (const candidate of [path, real]) {
        if (!root || !candidate || candidate === root || !folderContains(root, candidate)) continue;
        const relative = candidate.slice(root === '/' ? 1 : root.length + 1);
        // Dotfiles and dot-folders are never files in Pharos.
        return FilePath.safeParse(relative).success ? { folder, path: relative } : null;
      }
    }
  }
  return null;
}

function regularFile(path: string): Stats | null {
  try {
    const stats = statSync(path);
    return stats.isFile() ? stats : null;
  } catch {
    return null;
  }
}

const hashes = new Map<string, string>();

/** SHA-256 of a regular file, cached by path, size and modified time; null when not read. */
async function sha256Of(path: string, stats: Stats): Promise<string | null> {
  if (stats.size > HASH_MAX_BYTES) return null;
  if (path.split('/').some((part) => part.startsWith('.'))) return null;
  const key = `${path}\0${stats.size}\0${stats.mtimeMs}`;
  const cached = hashes.get(key);
  if (cached) return cached;
  try {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
    const digest = hash.digest('hex');
    if (hashes.size >= 1000) hashes.clear();
    hashes.set(key, digest);
    return digest;
  } catch {
    return null;
  }
}

type FileEntity = Entity<'file'>;
type ArtifactEntity = Entity<'artifact'>;

/** Where a project file is on disk now, when its folder is still there. */
function diskPathOf(file: FileEntity, list: readonly FileFolder[]): string | null {
  const folder = list.find((f) => f.id === file.data.rootId);
  if (!folder) return null;
  const root = realpath(folder.path);
  const real = realpath(join(folder.path, file.data.path));
  return root && real && folderContains(root, real) ? real : null;
}

/** A project file with the same contents as the file at `path`, or undefined. */
async function sameContents(
  path: string,
  files: readonly FileEntity[],
  list: readonly FileFolder[],
): Promise<FileEntity | undefined> {
  const stats = regularFile(path);
  if (!stats) return undefined;
  const candidates = files.filter((f) => f.data.size === stats.size);
  if (!candidates.length) return undefined;
  const wanted = await sha256Of(path, stats);
  if (!wanted) return undefined;
  for (const file of candidates) {
    let hash = file.data.sha256;
    if (!hash) {
      const onDisk = diskPathOf(file, list);
      const fileStats = onDisk ? regularFile(onDisk) : null;
      hash = (onDisk && fileStats && (await sha256Of(onDisk, fileStats))) || undefined;
    }
    if (hash === wanted) return file;
  }
  return undefined;
}

/**
 * A `uri` relative to the project's folder (R7.12), e.g. "records/2024/certificate.pdf" or
 * "./brand/mark.png", as a folder-relative path; null for anything else (absolute, `~`, a web
 * address, or a path that climbs out or names a dotfile).
 */
export function relativePathOf(uri: string | undefined): string | null {
  const value = uri?.trim();
  if (!value || SCHEME.test(value) || value.startsWith('/') || value.startsWith('~')) return null;
  const path = value.replace(/^(\.\/)+/, '');
  return FilePath.safeParse(path).success ? path : null;
}

/** Whether a `uri` names a place on the owner's disk (absolute or relative), not a web address. */
export function isLocalUri(uri: string | undefined): boolean {
  const value = uri?.trim();
  return !!value && (localPathOf(value) !== null || !SCHEME.test(value));
}

/** Not inside any Pharos folder: where it is, and the folder (and request) that would open it. */
function notInFolder(store: Store, path: string, absolute: boolean, projectId: string) {
  const request = absolute
    ? pendingRequestFor(store, { path })
    : pendingRequestFor(store, { projectId });
  return {
    state: 'not-in-folder' as const,
    path,
    folder: request?.path ?? (absolute ? dirname(path) : null),
    request: request ? summaryOf(request) : null,
  };
}

/**
 * Where an artifact's local source is: a project file, a folder path not added yet, a path in a
 * folder where nothing (or nothing Pharos reads) is, or outside every folder. A relative `uri`
 * resolves against the folders approved for its project (R7.12).
 */
export async function matchArtifact(
  store: Store,
  artifact: ArtifactEntity,
): Promise<ArtifactFileMatch> {
  const { fileId, uri, projectId } = artifact.data;
  if (fileId && store.get(fileId)?.type === 'file') return { state: 'linked', fileId };
  const value = uri?.trim();
  if (!value) return { state: 'none' };
  const absolute = localPathOf(value);
  // A web address isn't a local source.
  if (!absolute && SCHEME.test(value)) return { state: 'none' };
  const list = folders(store);
  let paths: string[];
  if (absolute) paths = [absolute];
  else {
    const relative = relativePathOf(value);
    const bases = projectBases(store, projectId, list);
    if (!relative || !bases.length) return notInFolder(store, value, false, projectId);
    paths = bases.map((b) => `${b.base}/${relative}`);
  }
  const files = store.list('file', { projectId }) as FileEntity[];
  let firstInFolder: { folder: FileFolder; path: string } | null = null;
  for (const path of paths) {
    const inFolder = folderOf(path, list);
    if (!inFolder) continue;
    const byPath = files.find(
      (f) => f.data.rootId === inFolder.folder.id && f.data.path === inFolder.path,
    );
    if (byPath) return { state: 'linked', fileId: byPath.id };
    firstInFolder ??= inFolder;
  }
  for (const path of paths) {
    const byHash = await sameContents(path, files, list);
    if (byHash) return { state: 'linked', fileId: byHash.id };
  }
  if (firstInFolder) {
    const { folder, path } = firstInFolder;
    const state = plainFileInsideSync(folder, path);
    if (state === 'ok') return { state: 'in-folder', rootId: folder.id, path };
    return { state, rootId: folder.id, path };
  }
  // Inside a folder, but at a path Pharos never uses (a dotfile or dot-folder).
  for (const path of paths) {
    const real = realpath(path) ?? path;
    const holder = list.find((f) =>
      [f.path, realpath(f.path)].some(
        (root) => !!root && [path, real].some((p) => p !== root && folderContains(root, p)),
      ),
    );
    if (holder) return { state: 'refused', rootId: holder.id, path: value };
  }
  return notInFolder(store, absolute ?? value, !!absolute, projectId);
}

/**
 * `GET /api/projects/:projectId/mentioned-files` (R7.12): the project's artifacts whose local
 * source isn't a project file yet, with why, for the Files page.
 */
export async function mentionedFiles(store: Store, projectId: string): Promise<MentionedFile[]> {
  store.getOfType('project', projectId);
  const out: MentionedFile[] = [];
  for (const artifact of store.list('artifact', { projectId }) as ArtifactEntity[]) {
    const { uri, title } = artifact.data;
    if (!uri || !isLocalUri(uri)) continue;
    const match = await matchArtifact(store, artifact);
    if (match.state === 'linked' || match.state === 'none') continue;
    out.push({ artifactId: artifact.id, title, uri, match });
  }
  return out;
}

/** `GET /api/artifacts/:artifactId/file` (read-only: a match found here isn't saved). */
export async function matchArtifactFile(
  store: Store,
  artifactId: string,
): Promise<ArtifactFileMatch> {
  const entity = store.get(artifactId);
  if (entity?.type !== 'artifact')
    throw new PharosError('not_found', `Artifact ${artifactId} not found`);
  return matchArtifact(store, entity as ArtifactEntity);
}

/** Updates setting `fileId` on the project's artifacts whose local source is a project file. */
export async function artifactLinkOperations(
  store: Store,
  projectId: string,
): Promise<Operation[]> {
  const artifacts = store.list('artifact', { projectId }) as ArtifactEntity[];
  const ops: Operation[] = [];
  for (const artifact of artifacts) {
    if (artifact.data.fileId || !isLocalUri(artifact.data.uri)) continue;
    const match = await matchArtifact(store, artifact);
    if (match.state === 'linked')
      ops.push({ op: 'update', type: 'artifact', id: artifact.id, data: { fileId: match.fileId } });
  }
  return ops;
}

/** Links the project's artifacts to its files in one revision; returns how many it linked. */
export async function linkArtifacts(store: Store, projectId: string): Promise<number> {
  const operations = await artifactLinkOperations(store, projectId);
  if (!operations.length) return 0;
  store.apply(SYSTEM, { message: 'Link claim sources to the project files they are', operations });
  return operations.length;
}

/** Projects where a revision added a file or changed where one is. */
function projectsWithNewFiles(store: Store, revisionId: number): Set<string> {
  const projects = new Set<string>();
  const revision = store.revision(revisionId);
  if (!revision || revision.author.kind === 'system') return projects;
  for (const change of revision.changes) {
    if (change.type !== 'file' || change.op === 'delete') continue;
    if (change.op === 'update' && !('path' in change.fields) && !('rootId' in change.fields))
      continue;
    const file = store.get(change.id);
    if (file?.type === 'file') projects.add((file as FileEntity).data.projectId);
  }
  return projects;
}

/**
 * Links artifacts whenever a revision adds or moves a file, from any route or process, so the
 * add route (R7.2) needs no call into this module. It runs after the revision is announced, never
 * inside it, and catches its own errors: a background callback must never stop the server.
 */
export function watchArtifactLinks(store: Store, feed: RevisionFeed): () => void {
  return feed.subscribe((event) => {
    setImmediate(() => {
      void (async () => {
        for (const projectId of projectsWithNewFiles(store, event.id))
          await linkArtifacts(store, projectId);
      })().catch((error: unknown) => {
        console.error('[pharos] Could not link claim sources to files:', error);
      });
    });
  });
}

/**
 * The route, mounted under `/api`. It answers with ids and the source's own path, never contents,
 * and only to the Pharos page (the same browser guard as the file routes, R7.9).
 */
export function artifactFileRoutes(store: Store): Hono {
  const routes = new Hono();
  routes.use('/artifacts/:artifactId/file', sameOriginOnly);
  routes.get('/artifacts/:artifactId/file', async (c) =>
    c.json(await matchArtifactFile(store, c.req.param('artifactId'))),
  );
  routes.use('/projects/:projectId/mentioned-files', sameOriginOnly);
  routes.get('/projects/:projectId/mentioned-files', async (c) =>
    c.json(await mentionedFiles(store, c.req.param('projectId'))),
  );
  return routes;
}
