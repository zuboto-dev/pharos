import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { realpathSync } from 'node:fs';
import { lstat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import {
  type Entity,
  FOLDERS_SETTING,
  FileFolders,
  REPO_FILE_MAX_BYTES,
  REPO_IMAGE_MAX_BYTES,
  REPO_MEDIA_MAX_BYTES,
  REPO_MEDIA_TYPES,
  REPO_PATHS_MAX,
  type RepoFile,
  type RepoFileKind,
  type RepoPathsResult,
  repoPathProblem,
  repoRefProblem,
} from '@pharos/schema';
import { Hono, type Context } from 'hono';
import type { Store } from '../store/store.js';
import { folderOf } from './artifact-file.js';
import { sameOriginOnly } from './routes.js';
import { effectiveExtensionOf, isAllowedPath, openInside, PathRefused } from './safety.js';
import { byteRange, contentDisposition } from './service.js';

/**
 * Files of a project's code repository, for the owner's repo links (`repo:` in Markdown, see
 * packages/schema/src/repo-files.ts). Owner only: app.ts refuses agents before these routes, and
 * the routes answer the Pharos page only (`sameOriginOnly`), like the owner's file routes.
 *
 * - The working tree is read through the project-file reader (`openInside`): no dotfiles,
 *   secrets or `node_modules`, no link leaving the repository, no hard links.
 * - A ref is read with git: the ref is checked by name first (`repoRefProblem`: never starts with
 *   "-") and resolved with `rev-parse --verify --end-of-options`; the path goes after `--` with
 *   literal pathspecs; links (mode 120000) and submodules are refused.
 * The same name rules apply to both, so `.env`, `.git/…` and `secrets.json` are never served.
 */

export class RepoFileError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 413,
    readonly code: 'invalid' | 'forbidden' | 'not_found' | 'too_large',
    message: string,
  ) {
    super(message);
  }
}

const MARKDOWN = new Set(['md', 'markdown', 'mdx']);
const LANGUAGES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  sql: 'sql',
  json: 'json',
  jsonc: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  css: 'css',
  scss: 'scss',
  html: 'html',
  xml: 'xml',
  vue: 'vue',
  svelte: 'svelte',
  lua: 'lua',
  r: 'r',
  jl: 'julia',
  scala: 'scala',
  ex: 'elixir',
  exs: 'elixir',
  hs: 'haskell',
  ml: 'ocaml',
  dart: 'dart',
  tex: 'latex',
  ipynb: 'json',
};
const TEXT = new Set(['txt', 'csv', 'tsv', 'log', 'rst', 'adoc', 'ini', 'cfg', 'conf', 'lock']);
const CODE_NAMES: Record<string, string> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  justfile: 'makefile',
};

type Kind = { kind: RepoFileKind; language?: string; mime?: string };

function kindOf(path: string): Kind | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const ext = effectiveExtensionOf(name);
  if (MARKDOWN.has(ext)) return { kind: 'markdown', language: 'markdown' };
  const media = REPO_MEDIA_TYPES[ext];
  if (media) return { kind: media.kind, mime: media.mime };
  if (LANGUAGES[ext]) return { kind: 'code', language: LANGUAGES[ext] };
  if (CODE_NAMES[name.toLowerCase()])
    return { kind: 'code', language: CODE_NAMES[name.toLowerCase()] };
  if (TEXT.has(ext)) return { kind: 'text' };
  return null;
}

/** The most of a picture, video or sound that is served (0: none, it's too big), else null. */
function mediaCap(kind: Kind | null): number | null {
  if (kind?.kind === 'image') return REPO_IMAGE_MAX_BYTES;
  if (kind?.kind === 'video' || kind?.kind === 'audio') return REPO_MEDIA_MAX_BYTES;
  return null;
}

/** Text, or binary when a NUL byte shows up near the start. */
function looksBinary(bytes: Buffer): boolean {
  return bytes.subarray(0, 8000).includes(0);
}

function toFile(
  path: string,
  ref: string | null,
  size: number,
  bytes: Buffer,
  extra: { commit?: string; fileId?: string } = {},
): RepoFile {
  const known = kindOf(path);
  const base = { path, ref, size, ...extra };
  if (known?.kind === 'image') {
    if (size > REPO_IMAGE_MAX_BYTES)
      return { ...base, kind: 'image', mime: known.mime, truncated: true };
    return {
      ...base,
      kind: 'image',
      mime: known.mime,
      content: `data:${known.mime};base64,${bytes.toString('base64')}`,
      truncated: false,
    };
  }
  // Videos and sounds: no contents here; the player reads them from `repoMediaUrl`.
  if (known?.kind === 'video' || known?.kind === 'audio')
    return { ...base, kind: known.kind, mime: known.mime, truncated: size > REPO_MEDIA_MAX_BYTES };
  if (looksBinary(bytes)) return { ...base, kind: 'binary', truncated: false };
  const truncated = size > REPO_FILE_MAX_BYTES;
  let text = bytes.subarray(0, REPO_FILE_MAX_BYTES).toString('utf8');
  // A cut through a multi-byte character leaves a replacement character at the end.
  if (truncated) text = text.replace(/�$/, '');
  return {
    ...base,
    kind: known?.kind ?? 'text',
    ...(known?.language ? { language: known.language } : {}),
    content: text,
    truncated,
  };
}

// ------------------------------------------------------------------ git

type GitResult = { code: number; stdout: Buffer };

/**
 * Runs git with arguments (never a shell), reading at most `limit` bytes of its output. The
 * environment keeps git from asking anything or taking locks, and treats paths literally.
 */
function git(cwd: string, args: string[], options: { limit?: number; input?: string } = {}) {
  const limit = options.limit ?? 1024 * 1024;
  return new Promise<GitResult>((resolve, reject) => {
    const child = spawn('git', ['-C', cwd, ...args], {
      stdio: ['pipe', 'pipe', 'ignore'],
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        HOME: process.env.HOME ?? '',
        GIT_TERMINAL_PROMPT: '0',
        GIT_OPTIONAL_LOCKS: '0',
        GIT_LITERAL_PATHSPECS: '1',
        GIT_CONFIG_NOSYSTEM: '1',
        LC_ALL: 'C',
      },
    });
    const chunks: Buffer[] = [];
    let length = 0;
    let done = false;
    const finish = (code: number) => {
      if (done) return;
      done = true;
      resolve({ code, stdout: Buffer.concat(chunks).subarray(0, limit) });
    };
    child.stdout.on('data', (chunk: Buffer) => {
      if (length >= limit) return;
      chunks.push(chunk);
      length += chunk.length;
      // Enough read: stop git (its exit code then doesn't matter).
      if (length >= limit) {
        child.kill();
        finish(0);
      }
    });
    child.on('error', (error) => {
      if (!done) {
        done = true;
        reject(error);
      }
    });
    child.on('close', (code) => finish(code ?? 1));
    child.stdin.on('error', () => {});
    child.stdin.end(options.input ?? '');
  });
}

/** The commit a ref names, or null when it names none. */
async function commitOf(root: string, ref: string): Promise<string | null> {
  if (repoRefProblem(ref) !== null) return null;
  const { code, stdout } = await git(root, [
    'rev-parse',
    '--verify',
    '--quiet',
    '--end-of-options',
    `${ref}^{commit}`,
  ]);
  const commit = stdout.toString('utf8').trim();
  return code === 0 && /^[0-9a-f]{40,64}$/.test(commit) ? commit : null;
}

/**
 * Where the repository folder sits inside its git work tree ("" at the top, "apps/web/" in a
 * subfolder): git names tree paths from the top, the links from the repository folder.
 */
async function prefixOf(root: string): Promise<string> {
  const { code, stdout } = await git(root, ['rev-parse', '--show-prefix']);
  return code === 0 ? stdout.toString('utf8').trim() : '';
}

/** The tree entry for `path` at `commit`: mode, type, object id and size; null when missing. */
async function treeEntry(root: string, commit: string, relative: string) {
  const path = (await prefixOf(root)) + relative;
  const { code, stdout } = await git(root, [
    'ls-tree',
    '-z',
    '-l',
    '--full-tree',
    commit,
    '--',
    path,
  ]);
  if (code !== 0) return null;
  for (const line of stdout.toString('utf8').split('\0')) {
    const m = /^(\d{6}) (\w+) ([0-9a-f]+) +(-|\d+)\t(.*)$/s.exec(line);
    if (m && m[5] === path)
      return { mode: m[1]!, type: m[2]!, object: m[3]!, size: m[4] === '-' ? 0 : Number(m[4]) };
  }
  return null;
}

// ------------------------------------------------------------------ the repository

/** The real path of a project's repository folder; RepoFileError when it has none. */
export function repoRootOf(store: Store, projectId: string): string {
  const project = store.get(projectId);
  if (project?.type !== 'project') throw new RepoFileError(404, 'not_found', 'Project not found');
  const repositoryId = (project as Entity<'project'>).data.repositoryId;
  const repository = repositoryId ? store.get(repositoryId) : null;
  const path = (repository as Entity<'repository'> | null)?.data.path;
  if (!path || !isAbsolute(path))
    throw new RepoFileError(404, 'not_found', 'This project has no repository folder');
  try {
    return realpathSync(path);
  } catch {
    throw new RepoFileError(404, 'not_found', 'The repository folder isn’t on this computer');
  }
}

function checkPath(path: string): void {
  const problem = repoPathProblem(path);
  if (problem) throw new RepoFileError(400, 'invalid', problem);
  if (!isAllowedPath(path))
    throw new RepoFileError(
      403,
      'forbidden',
      'Pharos doesn’t show this file (a dotfile or a secret)',
    );
}

const notFoundOn = (ref: string | null) =>
  new RepoFileError(
    404,
    'not_found',
    ref ? `Not found on ${ref}` : 'Not found in the working tree',
  );

/** Reads a file of the repository at `root` (a real path): at `ref`, or from the working tree. */
export async function readRepoFile(
  root: string,
  path: string,
  ref: string | null,
  findFileId?: (absolute: string) => string | undefined,
): Promise<RepoFile> {
  checkPath(path);
  if (ref !== null) {
    const problem = repoRefProblem(ref);
    if (problem) throw new RepoFileError(400, 'invalid', problem);
    const commit = await commitOf(root, ref);
    if (!commit) throw new RepoFileError(404, 'not_found', `No branch, tag or commit “${ref}”`);
    const entry = await treeEntry(root, commit, path);
    if (!entry) throw notFoundOn(ref);
    // A link could name anything (`.env`, a file outside); submodules have no contents here.
    if (entry.mode === '120000' || entry.type !== 'blob')
      throw new RepoFileError(403, 'forbidden', 'Not a file Pharos shows (a link or a folder)');
    const kind = kindOf(path);
    const limit =
      kind?.kind === 'image'
        ? entry.size > REPO_IMAGE_MAX_BYTES
          ? 0
          : entry.size
        : kind?.kind === 'video' || kind?.kind === 'audio'
          ? 0
          : REPO_FILE_MAX_BYTES + 4;
    const { stdout } =
      limit > 0
        ? await git(root, ['cat-file', 'blob', entry.object], { limit })
        : { stdout: Buffer.alloc(0) };
    return toFile(path, ref, entry.size, stdout, { commit });
  }
  // The working tree, through the project-file reader (its id only pins the folder's identity).
  let opened;
  try {
    opened = await openInside({ id: `repo:${root}`, path: root, level: 'contents' }, path);
  } catch (error) {
    if (error instanceof PathRefused)
      throw new RepoFileError(403, 'forbidden', 'Not a file Pharos shows');
    throw notFoundOn(null);
  }
  try {
    const size = opened.stats.size;
    const kind = kindOf(path);
    const limit =
      kind?.kind === 'image'
        ? size > REPO_IMAGE_MAX_BYTES
          ? 0
          : size
        : kind?.kind === 'video' || kind?.kind === 'audio'
          ? 0
          : REPO_FILE_MAX_BYTES + 4;
    const buffer = Buffer.alloc(Math.min(limit, size));
    let read = 0;
    while (read < buffer.length) {
      const { bytesRead } = await opened.handle.read(buffer, read, buffer.length - read, read);
      if (!bytesRead) break;
      read += bytesRead;
    }
    const fileId = findFileId?.(opened.real);
    return toFile(path, null, size, buffer.subarray(0, read), fileId ? { fileId } : {});
  } finally {
    await opened.handle.close().catch(() => {});
  }
}

const tooLarge = (size: number, cap: number) =>
  new RepoFileError(
    413,
    'too_large',
    `Too big to show here (${Math.round(size / 1024 / 1024)} MB; at most ${Math.round(cap / 1024 / 1024)} MB)`,
  );

/**
 * A picture, video or sound of the repository as its bytes, for `<img>`, `<video>` and
 * `<audio>`: the same path, ref and name checks as `readRepoFile`, at most REPO_IMAGE_MAX_BYTES
 * for a picture and REPO_MEDIA_MAX_BYTES for a video or sound. One byte range ("bytes=a-b")
 * answers 206 with Content-Range, so players can seek (Safari won't play without it).
 */
export async function repoMediaResponse(
  root: string,
  path: string,
  ref: string | null,
  range: string | undefined,
): Promise<Response> {
  checkPath(path);
  const kind = kindOf(path);
  const cap = mediaCap(kind);
  if (cap === null || !kind?.mime)
    throw new RepoFileError(400, 'invalid', 'Not a picture, video or sound');
  const headersFor = (size: number, part: { start: number; end: number } | undefined) => {
    const length = part ? part.end - part.start + 1 : size;
    const headers = new Headers({
      'content-type': kind.mime!,
      'content-length': String(length),
      'content-disposition': contentDisposition('inline', path.slice(path.lastIndexOf('/') + 1)),
      'accept-ranges': 'bytes',
      'x-content-type-options': 'nosniff',
      // An SVG opened on its own runs no script.
      'content-security-policy': 'sandbox',
      'cross-origin-resource-policy': 'same-origin',
      'referrer-policy': 'no-referrer',
      'cache-control': 'private, no-store',
    });
    if (part) headers.set('content-range', `bytes ${part.start}-${part.end}/${size}`);
    return headers;
  };
  const unsatisfiable = (size: number) =>
    new Response(null, {
      status: 416,
      headers: { 'content-range': `bytes */${size}`, 'cache-control': 'private, no-store' },
    });

  if (ref !== null) {
    const problem = repoRefProblem(ref);
    if (problem) throw new RepoFileError(400, 'invalid', problem);
    const commit = await commitOf(root, ref);
    if (!commit) throw new RepoFileError(404, 'not_found', `No branch, tag or commit “${ref}”`);
    const entry = await treeEntry(root, commit, path);
    if (!entry) throw notFoundOn(ref);
    if (entry.mode === '120000' || entry.type !== 'blob')
      throw new RepoFileError(403, 'forbidden', 'Not a file Pharos shows (a link or a folder)');
    if (entry.size > cap) throw tooLarge(entry.size, cap);
    const part = byteRange(range, entry.size);
    if (part === 'unsatisfiable') return unsatisfiable(entry.size);
    // git writes the blob from the start: read up to the range's end, then cut its start off.
    const end = part ? part.end : entry.size - 1;
    const { stdout } =
      entry.size > 0
        ? await git(root, ['cat-file', 'blob', entry.object], { limit: end + 1 })
        : { stdout: Buffer.alloc(0) };
    const bytes = stdout.subarray(part ? part.start : 0, end + 1);
    return new Response(new Uint8Array(bytes), {
      status: part ? 206 : 200,
      headers: headersFor(entry.size, part),
    });
  }

  let opened;
  try {
    opened = await openInside({ id: `repo:${root}`, path: root, level: 'contents' }, path);
  } catch (error) {
    if (error instanceof PathRefused)
      throw new RepoFileError(403, 'forbidden', 'Not a file Pharos shows');
    throw notFoundOn(null);
  }
  const size = opened.stats.size;
  const part = size > cap ? undefined : byteRange(range, size);
  if (size > cap || part === 'unsatisfiable') {
    await opened.handle.close().catch(() => {});
    if (size > cap) throw tooLarge(size, cap);
    return unsatisfiable(size);
  }
  if (size === 0) {
    await opened.handle.close().catch(() => {});
    return new Response(new Uint8Array(0), { status: 200, headers: headersFor(0, undefined) });
  }
  const stream = opened.handle.createReadStream({
    start: part ? part.start : 0,
    end: part ? part.end : size - 1,
    autoClose: true,
  });
  stream.on('error', () => {});
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    status: part ? 206 : 200,
    headers: headersFor(size, part),
  });
}

/** Which of `paths` exist: at `ref` when it names a commit and has the file, else in the tree. */
export async function findInRepo(
  root: string,
  paths: string[],
  ref: string | null,
): Promise<RepoPathsResult> {
  const found: RepoPathsResult['found'] = {};
  const asked = [
    ...new Set(paths.filter((p) => repoPathProblem(p) === null && isAllowedPath(p))),
  ].slice(0, REPO_PATHS_MAX);
  const commit = ref ? await commitOf(root, ref) : null;
  let left = asked;
  if (commit && ref) {
    // One `cat-file --batch-check` for all of them: "<object> blob <size>" or "… missing".
    const prefix = await prefixOf(root);
    const input = asked.map((p) => `${commit}:${prefix}${p}\n`).join('');
    const { code, stdout } = await git(root, ['cat-file', '--batch-check'], { input });
    if (code === 0) {
      const lines = stdout.toString('utf8').split('\n');
      asked.forEach((p, i) => {
        if (/^[0-9a-f]+ blob \d+$/.test(lines[i] ?? '')) found[p] = { ref };
      });
      left = asked.filter((p) => !found[p]);
    }
  }
  await Promise.all(
    left.map(async (p) => {
      try {
        const s = await lstat(join(root, p));
        if (s.isFile()) found[p] = { ref: null };
      } catch {
        // Not there.
      }
    }),
  );
  return { found };
}

// ------------------------------------------------------------------ routes

function repoError(c: Context, error: unknown) {
  if (error instanceof RepoFileError)
    return c.json({ error: { code: error.code, message: error.message } }, error.status);
  throw error;
}

/** The project file at an absolute path (the owner added it), for "Show in folder". */
function fileIdFinder(store: Store, projectId: string) {
  return (absolute: string): string | undefined => {
    const parsed = FileFolders.safeParse(store.setting(FOLDERS_SETTING) ?? []);
    if (!parsed.success) return undefined;
    const at = folderOf(absolute, parsed.data);
    if (!at) return undefined;
    return store
      .list('file')
      .find(
        (f) =>
          f.data.projectId === projectId &&
          f.data.rootId === at.folder.id &&
          f.data.path === at.path,
      )?.id;
  };
}

/** Mounted under `/api`; app.ts refuses agents before these (agentRefusal). */
export function repoFileRoutes(store: Store): Hono {
  const api = new Hono();
  api.use('/projects/:projectId/repo-file', sameOriginOnly);
  api.use('/projects/:projectId/repo-paths', sameOriginOnly);
  api.use('/projects/:projectId/repo-media', sameOriginOnly);

  api.get('/projects/:projectId/repo-file', async (c) => {
    const projectId = c.req.param('projectId');
    const path = c.req.query('path') ?? '';
    const ref = c.req.query('ref') || null;
    try {
      const root = repoRootOf(store, projectId);
      return c.json(await readRepoFile(root, path, ref, fileIdFinder(store, projectId)));
    } catch (error) {
      return repoError(c, error);
    }
  });

  api.get('/projects/:projectId/repo-media', async (c) => {
    try {
      const root = repoRootOf(store, c.req.param('projectId'));
      return await repoMediaResponse(
        root,
        c.req.query('path') ?? '',
        c.req.query('ref') || null,
        c.req.header('range'),
      );
    } catch (error) {
      return repoError(c, error);
    }
  });

  api.get('/projects/:projectId/repo-paths', async (c) => {
    const paths = c.req.queries('path') ?? [];
    if (paths.length > REPO_PATHS_MAX)
      return c.json(
        { error: { code: 'invalid', message: `At most ${REPO_PATHS_MAX} paths at once` } },
        400,
      );
    try {
      const root = repoRootOf(store, c.req.param('projectId'));
      return c.json(await findInRepo(root, paths, c.req.query('ref') || null));
    } catch (error) {
      return repoError(c, error);
    }
  });

  return api;
}
