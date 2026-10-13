import { randomBytes } from 'node:crypto';
import { lstatSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename } from 'node:path';
import {
  DEFAULT_FOLDER_LEVEL,
  FOLDERS_SETTING,
  FileFolders,
  FolderCreateInput,
  FolderPath,
  FolderUpdateInput,
  folderContains,
  type FileFolder,
  type FolderLevel,
  type FolderStatus,
} from '@pharos/schema';
import { Hono, type Context } from 'hono';
import { PharosError } from '../store/errors.js';
import type { Store } from '../store/store.js';
import { originMatches, sameOriginOnly } from './routes.js';
import { identityOf } from './safety.js';
import type { FileScanner } from './scan.js';

/**
 * Folders on the Settings page (R7.3, docs/reframe/roadmap-2.md §3): `/api/settings/folders*`.
 *
 * Folders are app settings (`Store.setSetting(FOLDERS_SETTING)`), never project data, and no MCP
 * tool reads or changes them. Only a person may widen what agents can reach: adding a folder,
 * raising its level, renaming or removing it. An agent (an `X-Pharos-Author: agent:…` request)
 * may only lower a level. That check is honest about its limit: a local process that leaves out
 * the author header and fakes the browser's headers looks like the Settings page, so the page
 * says plainly that a local `curl` can't be fully stopped.
 */

export type FolderRouteOptions = {
  /** The owner's home directory (tests pass a temp dir; never the real one). */
  home?: string;
  /** R7.2's scan cache: scans a folder once added, forgets it once removed, reports status. */
  scanner?: Pick<FileScanner, 'scan' | 'forget' | 'status'>;
};

const LEVEL_RANK: Record<FolderLevel, number> = { hidden: 0, details: 1, contents: 2 };

/**
 * Folders that are never allowed as a whole (system and volume roots). Anything inside the
 * system folders in SYSTEM_TREES is refused too; ordinary data under /private/var or /Volumes/…
 * is fine (temp folders, external drives).
 */
const SYSTEM_ROOTS = new Set([
  '/',
  '/Applications',
  '/Library',
  '/Network',
  '/System',
  '/Users',
  '/Volumes',
  '/bin',
  '/boot',
  '/cores',
  '/dev',
  '/etc',
  '/home',
  '/mnt',
  '/opt',
  '/private',
  '/private/tmp',
  '/private/var',
  '/proc',
  '/root',
  '/sbin',
  '/snap',
  '/srv',
  '/sys',
  '/tmp',
  '/usr',
  '/var',
]);
const SYSTEM_TREES = [
  '/System',
  '/Library',
  '/bin',
  '/sbin',
  '/usr',
  '/etc',
  '/private/etc',
  '/dev',
  '/proc',
  '/sys',
];

/** Lists the saved folders (an empty list before any is added). */
export function savedFolders(store: Store): FileFolder[] {
  return FileFolders.parse(store.setting<unknown>(FOLDERS_SETTING) ?? []);
}

/**
 * Escapes the characters gitignore patterns treat specially, so a rule matches the folder as
 * spelled. Claude Code's Read rules use gitignore syntax; parentheses need no escaping.
 */
function escapeGitignore(path: string): string {
  return path.replace(/[\\*?[\]!#]/g, (ch) => `\\${ch}`);
}

/**
 * The Claude Code permission deny rules that keep Claude Code's own file tools out of a folder;
 * none for `contents`, where reading is what the owner chose.
 *
 * Syntax checked against https://code.claude.com/docs/en/permissions#read-and-edit (2026-10-12):
 * Read rules use gitignore patterns, `//path` is an absolute path from the filesystem root (a
 * single leading `/` would be relative to the settings file), and `**` matches across
 * directories, so `Read(//Users/alice/Company/**)` covers everything in that folder. A Read deny
 * rule also blocks Edit and Write on the path, applies to file commands Claude Code recognizes in
 * Bash (`cat`, `head`, …), and is merged into the Bash sandbox when that is on
 * (https://code.claude.com/docs/en/sandboxing#permission-rules), but without the sandbox it
 * doesn't stop a script that opens files itself.
 */
export function denyRulesFor(folder: Pick<FileFolder, 'path' | 'level'>): string[] {
  if (folder.level === 'contents') return [];
  return [`Read(/${escapeGitignore(folder.path)}/**)`];
}

/** Accepts what people paste: surrounding quotes and spaces, `~/…`, a trailing "/". */
function cleanPath(raw: unknown, home: string): unknown {
  if (typeof raw !== 'string') return raw;
  let p = raw.trim().replace(/^(['"])(.*)\1$/, '$2');
  if (p === '~') p = home;
  else if (p.startsWith('~/')) p = `${home}${p.slice(1)}`;
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return p;
}

/** Where the folder really is (symlinks resolved), or a plain-words reason it can't be added. */
function checkFolder(path: string, home: string, existing: FileFolder[]): string {
  let real: string;
  try {
    real = realpathSync(path);
  } catch {
    throw new PharosError('invalid', `No folder at ${path}`);
  }
  const isDir = statSync(real, { throwIfNoEntry: false })?.isDirectory() ?? false;
  if (!isDir) throw new PharosError('invalid', `${path} is a file, not a folder`);

  let realHome = home;
  try {
    realHome = realpathSync(home);
  } catch {
    // A home that doesn't exist can't contain anything; compare as given.
  }
  if (SYSTEM_ROOTS.has(real) || SYSTEM_TREES.some((t) => folderContains(t, real)))
    throw new PharosError('invalid', `${path} is a system folder; choose a folder of your own`);
  if (folderContains(real, realHome))
    throw new PharosError(
      'invalid',
      real === realHome
        ? 'Your whole home folder is too broad; choose a folder inside it'
        : `${path} contains your home folder; choose a folder inside it`,
    );
  if (real === `${realHome}/Library` || folderContains(`${realHome}/Library`, real))
    throw new PharosError('invalid', 'Your Library folder holds app data; choose another folder');
  if (
    real
      .slice(1)
      .split('/')
      .some((part) => part.startsWith('.'))
  )
    throw new PharosError(
      'invalid',
      'Folders starting with "." (like .ssh) hold settings and keys, and are never shared',
    );
  for (const other of existing) {
    if (other.path === real) throw new PharosError('conflict', `${path} is already added`);
    if (folderContains(other.path, real))
      throw new PharosError('conflict', `${path} is inside "${other.label}", already added`);
    if (folderContains(real, other.path))
      throw new PharosError('conflict', `${path} contains "${other.label}", already added`);
  }
  return FolderPath.parse(real);
}

function newFolderId(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return `root_${[...randomBytes(10)].map((b) => alphabet[b % alphabet.length]).join('')}`;
}

/**
 * Why this request can't widen access, or null when it comes from a person on the Settings page:
 * no agent author, and the headers a browser sends with a same-origin `fetch`. MCP never reaches
 * these routes at all.
 */
function notAPerson(c: Context): string | null {
  if (isAgent(c))
    return 'Only a person can add folders or give agents more access, on the Settings page';
  return notThePage(c);
}

/** Whether the request declares an author other than a person. */
const isAgent = (c: Context) => {
  const author = c.req.header('x-pharos-author');
  return author !== undefined && !author.startsWith('human:');
};

/**
 * Why a folder write doesn't come from the Settings page, or null: a write needs both an `Origin`
 * naming this very origin and `Sec-Fetch-Site: same-origin`, as a browser's `fetch` sends them.
 */
function notThePage(c: Context): string | null {
  if (!originMatches(c) || c.req.header('sec-fetch-site') !== 'same-origin')
    return 'Add folders and change access on the Settings page in Pharos';
  return null;
}

const forbidden = (c: Context, message: string) =>
  c.json({ error: { code: 'forbidden', message } }, 403);

export function folderRoutes(store: Store, options: FolderRouteOptions = {}) {
  const home = options.home ?? homedir();
  const routes = new Hono();

  const status = (folder: FileFolder): FolderStatus => {
    let available: boolean;
    try {
      available = statSync(folder.path).isDirectory();
    } catch {
      available = false;
    }
    const scan = options.scanner?.status(folder.id);
    return {
      ...folder,
      available,
      files: scan?.files ?? null,
      scannedAt: scan?.finishedAt ?? null,
      scanning: scan?.scanning ?? false,
      error: scan?.error ?? null,
      denyRules: denyRulesFor(folder),
    };
  };

  const save = (folders: FileFolder[]) => {
    const parsed = FileFolders.parse(folders);
    store.setSetting(FOLDERS_SETTING, parsed);
  };

  const find = (folders: FileFolder[], id: string) => {
    const index = folders.findIndex((f) => f.id === id);
    if (index < 0) throw new PharosError('not_found', `Folder ${id} not found`);
    return index;
  };

  // Every folder route answers the Pharos page only (R7.9), reads included: the list names the
  // owner's folders and paths.
  routes.use('*', sameOriginOnly);

  routes.get('/', (c) => {
    // Agents learn about files through MCP (AgentFiles), never the folder list.
    if (isAgent(c)) return forbidden(c, 'Folders are shown on the Settings page in Pharos');
    return c.json(savedFolders(store).map(status));
  });

  routes.post('/', async (c) => {
    const refusal = notAPerson(c);
    if (refusal) return forbidden(c, refusal);
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const input = FolderCreateInput.parse(
      body && typeof body === 'object' ? { ...body, path: cleanPath(body.path, home) } : body,
    );
    const folders = savedFolders(store);
    const path = checkFolder(input.path, home, folders);
    const folder: FileFolder = {
      id: newFolderId(),
      path,
      label: input.label ?? basename(path),
      level: input.level ?? DEFAULT_FOLDER_LEVEL,
      addedAt: new Date().toISOString(),
      // Pinned: a folder later replaced at this path (moved, or a link put there) is refused.
      identity: identityOf(lstatSync(path, { bigint: true })),
    };
    save([...folders, folder]);
    options.scanner?.scan(folder); // in the background; it logs its own errors
    return c.json(status(folder), 201);
  });

  routes.patch('/:folderId', async (c) => {
    const input = FolderUpdateInput.parse(await c.req.json().catch(() => null));
    const folders = savedFolders(store);
    const index = find(folders, c.req.param('folderId'));
    const current = folders[index]!;
    const next: FileFolder = {
      ...current,
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.level !== undefined ? { level: input.level } : {}),
    };
    // Lowering a level only takes access away, so an agent may, from the Settings page like any
    // folder write (R7.9); anything else needs a person.
    const lowersOnly =
      input.label === undefined &&
      input.level !== undefined &&
      LEVEL_RANK[input.level] <= LEVEL_RANK[current.level];
    const refusal = lowersOnly ? notThePage(c) : notAPerson(c);
    if (refusal) return forbidden(c, refusal);
    folders[index] = next;
    save(folders);
    return c.json(status(next));
  });

  // Removing a folder forgets it; files added from it stay in their projects and show as missing.
  // Nothing on disk changes.
  routes.delete('/:folderId', (c) => {
    const refusal = notAPerson(c);
    if (refusal) return forbidden(c, refusal);
    const folders = savedFolders(store);
    const index = find(folders, c.req.param('folderId'));
    const [removed] = folders.splice(index, 1);
    save(folders);
    options.scanner?.forget(removed!.id);
    return c.json({ removed: removed!.id });
  });

  return routes;
}
