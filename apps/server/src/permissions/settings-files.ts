import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { PermissionLists } from '@pharos/schema';

/**
 * Claude Code settings files: reading `permissions.allow / deny / ask`, and the one write Pharos
 * makes (adding a rule to allow or deny, moving it out of the other lists), with a backup next to
 * the file first (`settings.local.json.pharos-backup-<timestamp>`, the last five kept).
 */

export const BACKUPS_KEPT = 5;
const BACKUP_MARK = '.pharos-backup-';

export type SettingsRead = {
  path: string;
  exists: boolean;
  /** The file's text as read ('' when missing), and its hash: what a write checks first. */
  text: string;
  hash: string;
  lists: PermissionLists;
  /** The file isn't valid JSON (or its permissions aren't lists): Pharos won't write it. */
  error?: string;
};

export const hashText = (text: string) =>
  createHash('sha256').update(text).digest('hex').slice(0, 32);

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** Reads a settings file's permission lists; a missing file has empty lists. */
export function readSettings(path: string): SettingsRead {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const empty = { allow: [], deny: [], ask: [] };
    if (code === 'ENOENT' || code === 'ENOTDIR')
      return { path, exists: false, text: '', hash: hashText(''), lists: empty };
    return {
      path,
      exists: true,
      text: '',
      hash: hashText(''),
      lists: empty,
      error: 'Couldn’t read the file',
    };
  }
  const read: SettingsRead = {
    path,
    exists: true,
    text,
    hash: hashText(text),
    lists: { allow: [], deny: [], ask: [] },
  };
  if (!text.trim()) return read;
  try {
    const json = JSON.parse(text) as unknown;
    if (!json || typeof json !== 'object' || Array.isArray(json))
      return { ...read, error: 'The file isn’t a JSON object' };
    const permissions = (json as Record<string, unknown>).permissions;
    if (
      permissions !== undefined &&
      (typeof permissions !== 'object' || permissions === null || Array.isArray(permissions))
    )
      return { ...read, error: '“permissions” isn’t an object' };
    const p = (permissions ?? {}) as Record<string, unknown>;
    for (const key of ['allow', 'deny', 'ask'] as const)
      if (p[key] !== undefined && !Array.isArray(p[key]))
        return { ...read, error: `“permissions.${key}” isn’t a list` };
    read.lists = { allow: strings(p.allow), deny: strings(p.deny), ask: strings(p.ask) };
    return read;
  } catch {
    return { ...read, error: 'The file isn’t valid JSON' };
  }
}

export type PlannedChange = {
  addTo: 'allow' | 'deny';
  removeFrom: ('allow' | 'deny' | 'ask')[];
  after: PermissionLists;
  unchanged: boolean;
  /** The new file text. */
  text: string;
};

/** The change that allows or denies `rule`: added to one list, taken out of the others. */
export function planChange(
  read: SettingsRead,
  rule: string,
  action: 'allow' | 'deny',
): PlannedChange {
  const addTo = action;
  const removeFrom = (['allow', 'deny', 'ask'] as const).filter(
    (list) => list !== addTo && read.lists[list].includes(rule),
  );
  const after: PermissionLists = {
    allow: read.lists.allow.filter((r) => r !== rule || addTo === 'allow'),
    deny: read.lists.deny.filter((r) => r !== rule || addTo === 'deny'),
    ask: read.lists.ask.filter((r) => r !== rule),
  };
  if (!after[addTo].includes(rule)) after[addTo] = [...after[addTo], rule];
  const unchanged = !removeFrom.length && read.lists[addTo].includes(rule);
  const json = (read.text.trim() ? JSON.parse(read.text) : {}) as Record<string, unknown>;
  const permissions = { ...((json.permissions as Record<string, unknown> | undefined) ?? {}) };
  for (const list of ['allow', 'deny', 'ask'] as const) {
    if (after[list].length || permissions[list] !== undefined) permissions[list] = after[list];
  }
  const text = `${JSON.stringify({ ...json, permissions }, null, 2)}\n`;
  return { addTo, removeFrom, after, unchanged, text };
}

function stamp(date: Date): string {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.(\d{3})Z$/, '$1Z');
}

/** Backups of a settings file, oldest first. */
export function backupsOf(path: string): string[] {
  const prefix = `${basename(path)}${BACKUP_MARK}`;
  try {
    return readdirSync(dirname(path))
      .filter((n) => n.startsWith(prefix))
      .sort()
      .map((n) => join(dirname(path), n));
  } catch {
    return [];
  }
}

/**
 * Writes the new text: copies the current file to a backup first (when it exists), writes to a
 * temp file and renames it into place, then keeps only the last five backups.
 */
export function writeSettings(path: string, text: string, now = new Date()): { backup?: string } {
  mkdirSync(dirname(path), { recursive: true });
  let backup: string | undefined;
  if (existsSync(path)) {
    backup = `${path}${BACKUP_MARK}${stamp(now)}`;
    let n = 1;
    while (existsSync(backup)) backup = `${path}${BACKUP_MARK}${stamp(now)}-${n++}`;
    writeFileSync(backup, readFileSync(path), { flag: 'wx', mode: statSync(path).mode & 0o777 });
  }
  const temp = `${path}.pharos-tmp-${process.pid}`;
  writeFileSync(temp, text, { mode: 0o644 });
  renameSync(temp, path);
  const all = backupsOf(path);
  for (const old of all.slice(0, Math.max(0, all.length - BACKUPS_KEPT)))
    rmSync(old, { force: true });
  return { backup };
}

/** Puts a backup back (or removes a file Pharos created). */
export function restoreSettings(path: string, backup: string | undefined): void {
  if (backup === undefined) {
    rmSync(path, { force: true });
    return;
  }
  const temp = `${path}.pharos-tmp-${process.pid}`;
  writeFileSync(temp, readFileSync(backup));
  renameSync(temp, path);
}
