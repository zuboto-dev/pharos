import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { PharosError } from './store/errors.js';

// The owner picks a project folder on this computer from the web app ("Find folder", "New
// folder"), inside their home folder only. Names of folders, never file contents. Owner only:
// app.ts refuses any request that doesn't declare `human:…`, and MCP has no such tool.

export type DiskFolder = { name: string; path: string; repo: boolean };
export type DiskListing = {
  path: string;
  /** "~/chaeeon/apps" */
  display: string;
  parent: string | null;
  folders: DiskFolder[];
};

const MAX = 400;
/** A folder name the owner can create: letters, digits, spaces, dots, dashes, underscores. */
const NAME = /^(?!\.{1,2}$)[\w .\-]{1,80}$/u;

export class DiskFolders {
  constructor(private readonly home = homedir()) {}

  /** `~`, `~/x` or an absolute path, resolved and kept inside the home folder. */
  inside(raw: string | undefined): string {
    const home = realpathSync(this.home);
    const asked =
      !raw || raw === '~' ? home : raw.startsWith('~/') ? join(home, raw.slice(2)) : raw;
    if (!asked.startsWith('/')) throw new PharosError('invalid', 'Give a path like ~/code');
    const at = existsSync(asked) ? realpathSync(asked) : resolve(asked);
    if (at !== home && !at.startsWith(home + '/'))
      throw new PharosError('invalid', 'Folders can only be picked inside your home folder');
    return at;
  }

  display(path: string): string {
    const home = realpathSync(this.home);
    return path === home
      ? '~'
      : path.startsWith(home + '/')
        ? `~/${path.slice(home.length + 1)}`
        : path;
  }

  list(raw?: string): DiskListing {
    const path = this.inside(raw);
    if (!existsSync(path) || !lstatSync(path).isDirectory())
      throw new PharosError('not_found', 'No such folder');
    const home = realpathSync(this.home);
    let names: string[] = [];
    try {
      names = readdirSync(path);
    } catch {
      throw new PharosError('invalid', 'This folder can’t be read');
    }
    const folders = names
      .filter((n) => !n.startsWith('.') && n !== 'node_modules')
      .flatMap((name): DiskFolder[] => {
        const full = join(path, name);
        try {
          const st = lstatSync(full);
          if (!st.isDirectory()) return [];
          return [{ name, path: full, repo: existsSync(join(full, '.git')) }];
        } catch {
          return [];
        }
      })
      .sort((a, b) => Number(b.repo) - Number(a.repo) || a.name.localeCompare(b.name))
      .slice(0, MAX);
    return {
      path,
      display: this.display(path),
      parent: path === home ? null : dirname(path),
      folders,
    };
  }

  /** Makes a new folder inside `parent`; returns the listing of the new folder. */
  create(parentRaw: string, name: string): DiskListing {
    const parent = this.inside(parentRaw);
    const clean = name.trim();
    if (!NAME.test(clean) || clean !== basename(clean))
      throw new PharosError('invalid', 'Use letters, digits, spaces, dots, dashes or underscores');
    const target = join(parent, clean);
    if (existsSync(target)) throw new PharosError('invalid', `“${clean}” already exists here`);
    mkdirSync(target);
    return this.list(target);
  }
}
