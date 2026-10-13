import { opendir, realpath, stat } from 'node:fs/promises';
import type { DatabaseSync } from 'node:sqlite';
import { setImmediate as yieldToEvents } from 'node:timers/promises';
import { FilePath, fileTypeOf, type FileFolder, type ScanStatus } from '@pharos/schema';
import { isAllowedDir, isAllowedName } from './safety.js';

/**
 * The scan cache (R7.2): what's in each folder the owner added, kept in the `file_scan` tables.
 * App data, not project data: never revisions. A scan only lists names, sizes and dates; it
 * never reads a file, so iCloud files that aren't downloaded stay in iCloud. Hashes are filled
 * later, when a file is read in full (`setHash`).
 */

export type ScanEntry = {
  rootId: string;
  path: string;
  size: number;
  modifiedAt: string;
  mimeType: string;
  sha256: string | null;
};

type ScanRow = {
  root_id: string;
  path: string;
  size: number;
  modified_at: string;
  mime_type: string;
  sha256: string | null;
};

type StatusRow = {
  root_id: string;
  started_at: string | null;
  finished_at: string | null;
  files: number | null;
  error: string | null;
};

export type ScanOptions = {
  /** Stop after this many files (a whole disk added by mistake). */
  maxFiles?: number;
  maxDepth?: number;
  /** Rows written per transaction; the event loop runs between batches. */
  batchSize?: number;
  log?: (message: string) => void;
};

const toEntry = (r: ScanRow): ScanEntry => ({
  rootId: r.root_id,
  path: r.path,
  size: r.size,
  modifiedAt: r.modified_at,
  mimeType: r.mime_type,
  sha256: r.sha256,
});

/** A folder error in plain words (never file contents; paths only the owner typed). */
export function folderProblem(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  switch (code) {
    case 'ENOENT':
      return "The folder isn't there: it was moved or renamed, or its disk isn't connected.";
    case 'ENOTDIR':
      return 'This is a file, not a folder.';
    case 'EACCES':
    case 'EPERM':
      return "Pharos isn't allowed to read this folder. In macOS System Settings, Privacy & Security, give the Pharos server (node) access to Files and Folders or Full Disk Access.";
    default:
      return `The folder couldn't be read (${code ?? 'unknown error'}).`;
  }
}

export class FileScanner {
  private readonly running = new Map<string, Promise<void>>();
  private readonly maxFiles: number;
  private readonly maxDepth: number;
  private readonly batchSize: number;
  private readonly log: (message: string) => void;

  constructor(
    private readonly db: DatabaseSync,
    options: ScanOptions = {},
  ) {
    this.maxFiles = options.maxFiles ?? 100_000;
    this.maxDepth = options.maxDepth ?? 32;
    this.batchSize = options.batchSize ?? 500;
    this.log =
      options.log ?? ((m) => console.error(`[pharos] ${new Date().toISOString()} files: ${m}`));
  }

  status(rootId: string): ScanStatus {
    const row = this.db.prepare('SELECT * FROM file_scan_status WHERE root_id = ?').get(rootId) as
      StatusRow | undefined;
    return {
      rootId,
      scanning: this.running.has(rootId),
      startedAt: row?.started_at ?? null,
      finishedAt: row?.finished_at ?? null,
      files: row?.files ?? null,
      error: row?.error ?? null,
    };
  }

  /**
   * Starts scanning `folder` in the background and returns at once (a scan already running is
   * left to finish). The scan catches and logs its own errors; it never rejects.
   */
  scan(folder: FileFolder): ScanStatus {
    if (!this.running.has(folder.id)) {
      const run = this.run(folder)
        .catch((error: unknown) => this.log(`scan of ${folder.id} failed: ${String(error)}`))
        .finally(() => this.running.delete(folder.id));
      this.running.set(folder.id, run);
    }
    return this.status(folder.id);
  }

  /** Resolves when the folder's current scan (if any) has finished. */
  async idle(rootId: string): Promise<void> {
    await this.running.get(rootId);
  }

  /** Drops a folder's cache, after it is removed in Settings (R7.3). */
  forget(rootId: string): void {
    this.db.prepare('DELETE FROM file_scan WHERE root_id = ?').run(rootId);
    this.db.prepare('DELETE FROM file_scan_status WHERE root_id = ?').run(rootId);
  }

  entry(rootId: string, path: string): ScanEntry | null {
    const row = this.db
      .prepare('SELECT * FROM file_scan WHERE root_id = ? AND path = ?')
      .get(rootId, path) as ScanRow | undefined;
    return row ? toEntry(row) : null;
  }

  /** Entries of these folders whose path contains `query` (case-insensitive), by path. */
  search(rootIds: string[], query: string, limit: number): ScanEntry[] {
    if (!rootIds.length) return [];
    const like = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = this.db
      .prepare(
        `SELECT * FROM file_scan WHERE root_id IN (${rootIds.map(() => '?').join(',')})
         AND path LIKE ? ESCAPE '\\' ORDER BY path LIMIT ?`,
      )
      .all(...rootIds, like, limit) as ScanRow[];
    return rows.map(toEntry);
  }

  /** Paths in a folder with this hash (a moved file). */
  findByHash(rootId: string, sha256: string): string[] {
    const rows = this.db
      .prepare('SELECT path FROM file_scan WHERE root_id = ? AND sha256 = ? ORDER BY path')
      .all(rootId, sha256) as { path: string }[];
    return rows.map((r) => r.path);
  }

  /** Paths in a folder of this size not hashed yet (candidates for a moved file). */
  unhashedOfSize(rootId: string, size: number, limit: number): string[] {
    const rows = this.db
      .prepare(
        'SELECT path FROM file_scan WHERE root_id = ? AND size = ? AND sha256 IS NULL ORDER BY path LIMIT ?',
      )
      .all(rootId, size, limit) as { path: string }[];
    return rows.map((r) => r.path);
  }

  /** Records a hash computed while a file was read in full, if the file hasn't changed since. */
  setHash(rootId: string, path: string, sha256: string, size: number, modifiedAt: string): void {
    this.db
      .prepare(
        `UPDATE file_scan SET sha256 = ? WHERE root_id = ? AND path = ? AND size = ? AND modified_at = ?`,
      )
      .run(sha256, rootId, path, size, modifiedAt);
  }

  private async run(folder: FileFolder): Promise<void> {
    const startedAt = new Date().toISOString();
    // Marks rows seen by this scan; anything left with an older mark is gone from disk.
    const mark = `${startedAt}#${Math.random().toString(36).slice(2, 8)}`;
    this.db
      .prepare(
        `INSERT INTO file_scan_status (root_id, started_at, finished_at, files, error)
         VALUES (?, ?, NULL, NULL, NULL)
         ON CONFLICT(root_id) DO UPDATE SET started_at = excluded.started_at, finished_at = NULL`,
      )
      .run(folder.id, startedAt);
    const finish = (files: number | null, error: string | null) =>
      this.db
        .prepare(
          'UPDATE file_scan_status SET finished_at = ?, files = coalesce(?, files), error = ? WHERE root_id = ?',
        )
        .run(new Date().toISOString(), files, error, folder.id);

    let root: string;
    try {
      root = await realpath(folder.path);
      if (!(await stat(root)).isDirectory())
        throw Object.assign(new Error('Not a folder'), { code: 'ENOTDIR' });
    } catch (error) {
      finish(null, folderProblem(error));
      return;
    }

    let batch: ScanEntry[] = [];
    let count = 0;
    let skipped = 0;
    let stopped = false;
    const flush = async () => {
      if (batch.length) this.write(batch, mark);
      batch = [];
      await yieldToEvents();
    };

    const stack: { dir: string; rel: string; depth: number }[] = [{ dir: root, rel: '', depth: 0 }];
    try {
      while (stack.length && !stopped) {
        const { dir, rel, depth } = stack.pop()!;
        let handle;
        try {
          handle = await opendir(dir);
        } catch (error) {
          if (depth === 0) throw error;
          skipped++;
          continue;
        }
        for await (const dirent of handle) {
          const name = dirent.name;
          const relPath = rel ? `${rel}/${name}` : name;
          // Symlinks are never followed while scanning: a link can lead anywhere.
          if (dirent.isSymbolicLink()) continue;
          if (dirent.isDirectory()) {
            if (depth + 1 < this.maxDepth && isAllowedDir(name))
              stack.push({ dir: `${dir}/${name}`, rel: relPath, depth: depth + 1 });
            continue;
          }
          if (!dirent.isFile() || !isAllowedName(name)) continue;
          let info;
          try {
            info = await stat(`${dir}/${name}`);
          } catch {
            skipped++;
            continue;
          }
          if (!info.isFile() || !isAllowedName(name, info.size)) continue;
          if (!FilePath.safeParse(relPath).success) continue;
          batch.push({
            rootId: folder.id,
            path: relPath,
            size: info.size,
            modifiedAt: info.mtime.toISOString(),
            mimeType: fileTypeOf(name).mime,
            sha256: null,
          });
          count++;
          if (count >= this.maxFiles) {
            stopped = true;
            break;
          }
          if (batch.length >= this.batchSize) await flush();
        }
      }
      await flush();
    } catch (error) {
      // Keep what was found; the next scan tries again.
      finish(count, folderProblem(error));
      return;
    }
    if (!stopped) {
      this.db
        .prepare('DELETE FROM file_scan WHERE root_id = ? AND seen_at != ?')
        .run(folder.id, mark);
    }
    if (skipped) this.log(`scan of ${folder.id}: ${skipped} folders or files couldn't be read`);
    finish(
      count,
      stopped
        ? `Stopped after ${this.maxFiles.toLocaleString('en')} files. Add a smaller folder.`
        : null,
    );
  }

  /** Writes one batch in one transaction (synchronous, so nothing else interleaves). */
  private write(batch: ScanEntry[], mark: string): void {
    const insert = this.db.prepare(
      `INSERT INTO file_scan (root_id, path, size, modified_at, mime_type, sha256, seen_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?)
       ON CONFLICT(root_id, path) DO UPDATE SET
         sha256 = CASE WHEN file_scan.size = excluded.size
                        AND file_scan.modified_at = excluded.modified_at
                       THEN file_scan.sha256 END,
         size = excluded.size, modified_at = excluded.modified_at,
         mime_type = excluded.mime_type, seen_at = excluded.seen_at`,
    );
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const e of batch) insert.run(e.rootId, e.path, e.size, e.modifiedAt, e.mimeType, mark);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}
