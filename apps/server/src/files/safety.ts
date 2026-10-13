import { realpath } from 'node:fs/promises';
import { sep } from 'node:path';

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

/** Lowercase extension of a file name, or "" for none. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
}

const hasControl = (s: string) => [...s].some((c) => c.charCodeAt(0) < 0x20);

/**
 * Whether a file name (not a path) may be scanned and served: no dotfiles (`.env`, `.ssh`,
 * iCloud `.name.icloud` placeholders, `.DS_Store`), no Office lock files, no keys, keychains or
 * credentials.
 *
 * `.key` is both Keynote and a private key: the scan keeps `.key` files only from 16 KB up (keys
 * are a few KB, Keynote documents far bigger), and serving checks they are a Keynote zip.
 */
export function isAllowedName(name: string, size?: number): boolean {
  if (!name || name.startsWith('.') || name.startsWith('~$') || hasControl(name)) return false;
  const ext = extensionOf(name);
  if (SECRET_EXTENSIONS.has(ext)) return false;
  if (SECRET_NAMES.some((re) => re.test(name))) return false;
  if (ext === 'key' && size !== undefined && size < 16 * 1024) return false;
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

/** A path Pharos won't serve: outside its folder (a symlink), or a dotfile or secret. */
export class PathRefused extends Error {
  constructor(readonly reason: 'outside' | 'not-allowed') {
    super(reason === 'outside' ? 'Outside its folder' : 'Not a file Pharos serves');
  }
}

/**
 * The real path of `relPath` inside folder `rootPath`, following symlinks. Rejects with
 * PathRefused when it leads outside the folder or isn't allowed, and with the fs error (ENOENT,
 * EACCES, …) when it can't be resolved.
 */
export async function resolveInside(rootPath: string, relPath: string): Promise<string> {
  if (!isAllowedPath(relPath)) throw new PathRefused('not-allowed');
  const realRoot = await realpath(rootPath);
  const real = await realpath(`${realRoot}/${relPath}`);
  if (!isInside(realRoot, real)) throw new PathRefused('outside');
  // Where it really is must be allowed too (a symlink "notes.txt" → ".env" in the same folder).
  if (
    !isAllowedPath(
      real
        .slice(realRoot.length + 1)
        .split(sep)
        .join('/'),
    )
  )
    throw new PathRefused('not-allowed');
  return real;
}
