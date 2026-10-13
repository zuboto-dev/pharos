import { constants, lstatSync, realpathSync, type Stats } from 'node:fs';
import { lstat, open, realpath, type FileHandle } from 'node:fs/promises';
import { sep } from 'node:path';
import type { FileFolder, FolderLevel } from '@pharos/schema';

/**
 * Safety rules for project files (R7.2, docs/reframe/r6-methods.md B9–B12). Pharos only reads
 * files inside folders the owner added, never dotfiles or secrets, and never through a symlink
 * that leads outside the folder.
 */

/** Folders never entered while scanning: big and generated. */
const SKIPPED_DIRS = new Set(['node_modules', '__pycache__', '$RECYCLE.BIN']);

/** macOS packages (folders that are one document, library or app): never entered or listed. */
const PACKAGE_EXTENSIONS = new Set([
  'app',
  'bundle',
  'framework',
  'plugin',
  'kext',
  'pkg',
  'mpkg',
  'photoslibrary',
  'musiclibrary',
  'tvlibrary',
  'imovielibrary',
  'fcpbundle',
  'logicx',
  'band',
  'rtfd',
  'pages',
  'numbers',
  'key',
  'xcodeproj',
  'xcworkspace',
  'playground',
  'sparsebundle',
  'dsym',
]);

/** Key, keychain and credential files: never scanned or served, whatever the folder. */
const SECRET_EXTENSIONS = new Set([
  'pem',
  'p12',
  'pfx',
  'p8',
  'ppk',
  'jks',
  'keystore',
  'kdbx',
  'kdb',
  'keychain',
  'keychain-db',
  'gpg',
  'pgp',
  'asc',
  'ovpn',
  'env',
  'tfstate',
  'tfvars',
]);

const CONFIG_EXT = String.raw`(\.(json|txt|ya?ml|ini|toml|xml|conf|cfg))?$`;
const SECRET_NAMES = [
  /^id_(rsa|dsa|ecdsa|ed25519)(_sk)?(\.pub)?$/i,
  new RegExp(String.raw`^(authorized_keys|known_hosts|htpasswd|netrc|pgpass)` + CONFIG_EXT, 'i'),
  new RegExp(String.raw`^(credentials?|secrets?|tokens?|passwords?)` + CONFIG_EXT, 'i'),
  /^(service[-_]?account|client[-_]?secret).*\.json$/i,
  /\.env(\.[a-z0-9_-]+)?$/i,
  /(^|[._-])private[._-]?key/i,
];

/**
 * Names that hold credentials whatever comes after them: `credentials.csv`, `secrets.md`,
 * `terraform.tfstate.1700000000.backup`. Matched as the whole name or the name up to a dot.
 */
const SECRET_STEMS = [
  'credential',
  'credentials',
  'secret',
  'secrets',
  'password',
  'passwords',
  'passwd',
  'shadow',
  'token',
  'tokens',
  'htpasswd',
  'netrc',
  'pgpass',
  'authorized_keys',
  'known_hosts',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
  'terraform.tfstate',
  'terraform.tfvars',
];

/**
 * Backup and editor copies (`a.pem.bak`, `a.env~`, `a.json.orig`, `a.txt.swp`, `a.bak2`): their
 * names say what they are a copy of, so the secret rules apply to the name without them.
 */
const BACKUP_SUFFIX =
  /(~\d*~?|\.(bak|backup|bk|old|orig|save|sav|swp|swo|swn|tmp|temp|prev|previous|copy|rej|dist)\d*)$/i;

/** A name without its backup suffixes: `server.pem.bak.old` → `server.pem`. */
export function withoutBackupSuffixes(name: string): string {
  let current = name;
  for (let i = 0; i < 8; i++) {
    const next = current.replace(BACKUP_SUFFIX, '');
    if (next === current || !next) break;
    current = next;
  }
  return current;
}

/** Lowercase extension of a file name, or "" for none. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

/** The extension that says what a file is, past any backup suffix (`a.key.bak` → `key`). */
export function effectiveExtensionOf(name: string): string {
  return extensionOf(withoutBackupSuffixes(baseNameOf(name)));
}

const baseNameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);

const hasControl = (s: string) => [...s].some((c) => c.charCodeAt(0) < 0x20);

/** Whether a name (backup suffixes already removed) names a key, keychain or credential. */
function isSecretName(name: string): boolean {
  const lower = name.toLowerCase();
  if (SECRET_STEMS.some((stem) => lower === stem || lower.startsWith(`${stem}.`))) return true;
  if (SECRET_NAMES.some((re) => re.test(name))) return true;
  // Every extension part counts: `server.pem.2024`, `config.env.json`. (`.key` is Keynote too.)
  const parts = lower.split('.').slice(1);
  return parts.some((part) => SECRET_EXTENSIONS.has(part));
}

/**
 * Whether a file name (not a path) may be scanned and served: no dotfiles (`.env`, `.ssh`,
 * iCloud `.name.icloud` placeholders, `.DS_Store`), no Office lock files, no keys, keychains or
 * credentials, nor backup copies of them (`credentials.json.bak`, `server.pem~`).
 *
 * `.key` is both Keynote and a private key: the scan keeps `.key` files only from 16 KB up (keys
 * are a few KB, Keynote documents far bigger), and reading checks they are a Keynote zip.
 */
export function isAllowedName(name: string, size?: number): boolean {
  if (!name || name.startsWith('.') || name.startsWith('~$') || hasControl(name)) return false;
  const original = withoutBackupSuffixes(name);
  if (original.startsWith('.')) return false;
  if (isSecretName(name) || isSecretName(original)) return false;
  if (extensionOf(original) === 'key' && size !== undefined && size < 16 * 1024) return false;
  return true;
}

/** Whether a folder may be entered while scanning. */
export function isAllowedDir(name: string): boolean {
  if (!name || name.startsWith('.') || hasControl(name) || SKIPPED_DIRS.has(name)) return false;
  return !PACKAGE_EXTENSIONS.has(extensionOf(name));
}

/** Every part of a relative path is allowed (its folders and its file name). */
export function isAllowedPath(path: string, size?: number): boolean {
  const parts = path.split('/');
  const name = parts.pop()!;
  return parts.every(isAllowedDir) && isAllowedName(name, size);
}

/** Whether real path `child` is inside real path `root` (not `root` itself). */
export function isInside(root: string, child: string): boolean {
  return child !== root && child.startsWith(root.endsWith(sep) ? root : root + sep);
}

/** A path Pharos won't read: outside its folder, a dotfile or secret, or its folder was replaced. */
export class PathRefused extends Error {
  constructor(readonly reason: 'outside' | 'not-allowed' | 'replaced') {
    super(
      reason === 'outside'
        ? 'Outside its folder'
        : reason === 'replaced'
          ? 'Its folder was replaced since it was added'
          : 'Not a file Pharos serves',
    );
  }
}

// ------------------------------------------------------------------ the safe reader (R7.9)
//
// Every read of a project file goes through here: serving, hashing, the scan's folder checks and
// the agents' text tool. Node has no `openat`, so a file can't be opened relative to a directory
// descriptor. Instead:
// 1. The folder's identity (device and inode of its real path, `FileFolder.identity`) is pinned
//    when it is added; a folder replaced since (moved away, a link put in its place) is refused.
// 2. Aliases inside the folder are resolved once (realpath); the result must stay inside the
//    folder, and both the recorded and the resolved names must pass the name rules.
// 3. The resolved path is walked without following anything: every folder on the way must be a
//    real folder (lstat), and the file is opened with O_NOFOLLOW (and O_NONBLOCK, so a FIFO can't
//    hang the server).
// 4. After opening, the chain is checked again: the opened file is what its path names, and every
//    folder on the way and the root are still the ones walked.
// Residual race: someone who can write inside the folder, swaps a parent folder for a link after
// step 3's checks and swaps it back between step 4's checks, could still have one outside file
// read. That needs two renames timed within a few system calls; any single swap is caught.

/** Device and inode as one string ("dev:ino"), from bigint stats so large inodes stay exact. */
export function identityOf(stats: { dev: bigint; ino: bigint }): string {
  return `${stats.dev}:${stats.ino}`;
}

/** The identity of a folder's real path now (rejects with the fs error when it can't be read). */
export async function folderIdentity(realPath: string): Promise<string> {
  return identityOf(await lstat(realPath, { bigint: true }));
}

/** The parts of a folder the reader needs. */
export type ReadableFolder = Pick<FileFolder, 'id' | 'path' | 'level' | 'identity'>;

/**
 * Pins for folders saved before identities were recorded (R7.3): the first identity this process
 * sees. Folders added since R7.9 carry their identity in the setting.
 */
const firstSeen = new Map<string, string>();

/** The folder's real path, after checking it is still the folder the owner added. */
export async function approvedRoot(folder: ReadableFolder): Promise<string> {
  // The folder itself must not have become a link (its parents may be links, like /var).
  if ((await lstat(folder.path)).isSymbolicLink()) throw new PathRefused('replaced');
  const real = await realpath(folder.path);
  const stats = await lstat(real, { bigint: true });
  if (!stats.isDirectory()) throw Object.assign(new Error('Not a folder'), { code: 'ENOTDIR' });
  const identity = identityOf(stats);
  const key = `${folder.id}\u0000${folder.path}`;
  const pinned = folder.identity ?? firstSeen.get(key);
  if (!pinned) firstSeen.set(key, identity);
  else if (pinned !== identity) throw new PathRefused('replaced');
  return real;
}

/** Checks that `path` is (still) a real folder, not a link; returns its identity. */
export async function plainDir(path: string): Promise<string> {
  const stats = await lstat(path, { bigint: true });
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new PathRefused('outside');
  return identityOf(stats);
}

export type Resolved = {
  /** The folder's real path. */
  root: string;
  /** The file's real path. */
  real: string;
  /** Its path inside the folder, as resolved ("/" separated). */
  resolvedPath: string;
  /** The folders walked from the root to the file's folder, with their identities. */
  chain: { path: string; identity: string }[];
};

/**
 * Where `relPath` really is inside `folder`, without opening it: resolves aliases inside the
 * folder, checks both names, and walks the result with no link followed. Rejects with
 * PathRefused, or with the fs error (ENOENT, EACCES, …).
 */
export async function resolveInside(folder: ReadableFolder, relPath: string): Promise<Resolved> {
  if (!isAllowedPath(relPath)) throw new PathRefused('not-allowed');
  const root = await approvedRoot(folder);
  const real = await realpath(`${root}/${relPath}`);
  if (!isInside(root, real)) throw new PathRefused('outside');
  const resolvedPath = real
    .slice(root.length + 1)
    .split(sep)
    .join('/');
  // Where it really is must be allowed too (a link "notes.txt" → ".env" in the same folder).
  if (!isAllowedPath(resolvedPath)) throw new PathRefused('not-allowed');
  const chain = [{ path: root, identity: await plainDir(root) }];
  for (const part of resolvedPath.split('/').slice(0, -1)) {
    const path = `${chain[chain.length - 1]!.path}/${part}`;
    chain.push({ path, identity: await plainDir(path) });
  }
  const leaf = await lstat(real);
  if (leaf.isSymbolicLink()) throw new PathRefused('outside');
  if (!leaf.isFile()) throw new PathRefused('not-allowed');
  return { root, real, resolvedPath, chain };
}

/**
 * A synchronous check for writes (R7.12: an agent adding a file runs inside `Store.apply`, which
 * is synchronous): whether `relPath` is now a plain, allowed file inside the folder the owner
 * approved (not replaced since), with no link anywhere on the way and no secret or backup name.
 * Reading still goes through `openInside`; this only decides whether a file record may be made.
 */
export function plainFileInsideSync(
  folder: ReadableFolder,
  relPath: string,
): 'ok' | 'missing' | 'refused' {
  if (!isAllowedPath(relPath)) return 'refused';
  let root: string;
  try {
    if (lstatSync(folder.path).isSymbolicLink()) return 'refused';
    root = realpathSync(folder.path);
    const stats = lstatSync(root, { bigint: true });
    if (!stats.isDirectory()) return 'missing';
    if (folder.identity && identityOf(stats) !== folder.identity) return 'refused';
  } catch {
    return 'missing';
  }
  try {
    // Every folder on the way is a real folder, and the file a plain file: nothing is followed.
    let at = root;
    for (const part of relPath.split('/').slice(0, -1)) {
      at = `${at}/${part}`;
      const dir = lstatSync(at);
      if (dir.isSymbolicLink() || !dir.isDirectory()) return 'refused';
    }
    const full = `${root}/${relPath}`;
    const leaf = lstatSync(full);
    if (leaf.isSymbolicLink() || !leaf.isFile()) return 'refused';
    if (!isInside(root, realpathSync(full))) return 'refused';
    return isAllowedPath(relPath, leaf.size) ? 'ok' : 'refused';
  } catch {
    return 'missing';
  }
}

export type OpenedFile = Resolved & { handle: FileHandle; stats: Stats };

const KEYNOTE_MAGIC = 'PK\u0003\u0004';

/**
 * Opens a project file read-only through the steps above; the caller closes `handle`. Pass
 * `level` to require the folder's access level (agents read text from `contents` folders only).
 */
export async function openInside(
  folder: ReadableFolder,
  relPath: string,
  options: { level?: FolderLevel } = {},
): Promise<OpenedFile> {
  if (options.level && folder.level !== options.level) throw new PathRefused('not-allowed');
  const resolved = await resolveInside(folder, relPath);
  let handle: FileHandle;
  try {
    handle = await open(
      resolved.real,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    // The file was swapped for a link after it was resolved.
    if ((error as NodeJS.ErrnoException).code === 'ELOOP') throw new PathRefused('outside');
    throw error;
  }
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile()) throw new PathRefused('not-allowed');
    // What was opened is what the path names now, and nothing on the way changed.
    const named = await lstat(resolved.real, { bigint: true });
    if (named.isSymbolicLink() || identityOf(named) !== identityOf(opened))
      throw new PathRefused('outside');
    for (const dir of [...resolved.chain].reverse())
      if ((await plainDir(dir.path)) !== dir.identity) throw new PathRefused('outside');
    await approvedRoot(folder);
    // ".key" is Keynote (a zip) or a private key: only a Keynote document is read.
    if (effectiveExtensionOf(resolved.resolvedPath) === 'key') {
      const { buffer, bytesRead } = await handle.read(Buffer.alloc(4), 0, 4, 0);
      if (bytesRead < 4 || buffer.toString('latin1') !== KEYNOTE_MAGIC)
        throw new PathRefused('not-allowed');
    }
    return { ...resolved, handle, stats: await handle.stat() };
  } catch (error) {
    await handle.close().catch(() => {});
    throw error;
  }
}
