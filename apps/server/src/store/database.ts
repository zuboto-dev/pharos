import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function defaultDatabasePath(): string {
  return process.env.PHAROS_DB ?? join(homedir(), '.pharos', 'pharos.db');
}

/** Where the database lived before the project was renamed from Mycel to Pharos. */
export const LEGACY_DATABASE_PATH = join(homedir(), '.mycel', 'mycel.db');

/**
 * Moves a database from its pre-rename location, once: only when the new file doesn't exist yet.
 * The -wal and -shm files move with it so recent writes aren't lost.
 */
export function migrateLegacyDatabase(
  target: string,
  legacy: string = LEGACY_DATABASE_PATH,
): boolean {
  if (target === ':memory:' || existsSync(target) || !existsSync(legacy)) return false;
  mkdirSync(dirname(target), { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(legacy + suffix)) renameSync(legacy + suffix, target + suffix);
  }
  return true;
}

/** Migrations run in order; `PRAGMA user_version` records how many have been applied. */
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author_kind TEXT NOT NULL,
    author_name TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL,
    revert_of INTEGER REFERENCES revisions(id)
  );

  CREATE TABLE entities (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    project_id TEXT,
    data TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    created_rev INTEGER NOT NULL REFERENCES revisions(id),
    updated_rev INTEGER NOT NULL REFERENCES revisions(id)
  );
  CREATE INDEX entities_project_type ON entities(project_id, type);
  CREATE INDEX entities_type ON entities(type);

  CREATE TABLE changes (
    revision_id INTEGER NOT NULL REFERENCES revisions(id),
    seq INTEGER NOT NULL,
    op TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    project_id TEXT,
    before TEXT,
    after TEXT,
    PRIMARY KEY (revision_id, seq)
  );
  CREATE INDEX changes_entity ON changes(entity_id, revision_id);
  CREATE INDEX changes_project ON changes(project_id, revision_id);
  `,
  // v2: sidebar ordering. Existing repositories and projects get positions in their current
  // (alphabetical) order so the sidebar looks the same after the upgrade.
  `
  UPDATE entities
  SET data = json_set(data, '$.order', ranked.position)
  FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY type ORDER BY lower(json_extract(data, '$.name'))) - 1 AS position
    FROM entities
    WHERE type IN ('repository', 'project')
  ) AS ranked
  WHERE entities.id = ranked.id AND json_extract(entities.data, '$.order') IS NULL;
  `,
  // v3: where each agent last looked in each project, for "what changed since".
  `
  CREATE TABLE agent_cursors (
    agent TEXT NOT NULL,
    project_id TEXT NOT NULL,
    revision_id INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (agent, project_id)
  );
  `,
  // v4: app settings changed from the web app (not project data, so not revisions).
  `
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  `,
  // v5: the folder scan cache (R7): what each folder in Settings holds, so the owner can add files
  // to a project. A cache, not project data: rebuilt by scanning, never revisions. Folders
  // themselves are a setting (FOLDERS_SETTING), so root_id has no foreign key. sha256 is filled
  // lazily (on first read) and cleared when size or modified_at change.
  `
  CREATE TABLE file_scan (
    root_id TEXT NOT NULL,
    path TEXT NOT NULL,
    size INTEGER NOT NULL,
    modified_at TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    sha256 TEXT,
    seen_at TEXT NOT NULL,
    PRIMARY KEY (root_id, path)
  );
  CREATE INDEX file_scan_sha256 ON file_scan(sha256);

  CREATE TABLE file_scan_status (
    root_id TEXT PRIMARY KEY,
    started_at TEXT,
    finished_at TEXT,
    files INTEGER,
    error TEXT
  );
  `,
  // Record-form actions (R10): one row per idempotency key, so a retried submission returns its
  // first result instead of writing again. App data beside revisions, not project data.
  `
  CREATE TABLE action_submissions (
    key TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    result TEXT,
    created_at TEXT NOT NULL
  );
  `,
  // Report pages (R13): pictures, fonts and scripts a page ships, by view and relative path. Page
  // files, not project data (never revisions); they go when their view goes, however it goes (a
  // delete, a cascade, a revert), so a trigger removes them.
  `
  CREATE TABLE report_assets (
    view_id TEXT NOT NULL,
    path TEXT NOT NULL,
    mime TEXT NOT NULL,
    bytes BLOB NOT NULL,
    size INTEGER NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (view_id, path)
  );
  CREATE TRIGGER report_assets_view_deleted AFTER DELETE ON entities
  WHEN OLD.type = 'view'
  BEGIN
    DELETE FROM report_assets WHERE view_id = OLD.id;
  END;
  `,
  // R13.5: a view's assets outlive its delete, so undoing the delete (a revert) brings the whole
  // page back. Routes serve them only while the view exists; ReportAssets.purgeGone removes the
  // assets of views gone for 30 days.
  `
  DROP TRIGGER report_assets_view_deleted;
  `,
  // R13.5: the change feed polls for new uploads by time; this index answers without reading
  // the files themselves.
  `
  CREATE INDEX report_assets_updated ON report_assets(updated_at, view_id);
  `,
  // R13.6: uploads check the size of a page's files and of all of them; this index answers
  // without reading the files themselves (size comes after the bytes in each row).
  `
  CREATE INDEX report_assets_sizes ON report_assets(view_id, path, size);
  `,
  // R16: runs that happened without the owner (night runs, routines, the answering agent), for
  // the desk. An operational log like presence, not project data: no revisions.
  `
  CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    agent TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    outcome TEXT NOT NULL,
    summary TEXT,
    counts TEXT,
    view_id TEXT,
    seen_at TEXT
  );
  CREATE INDEX runs_name ON runs(name);
  `,
  // Notifications: what Pharos told the owner (desk items, failed runs, agents that finished, pages
  // out of date, hand-backs nobody picked up). An operational log like runs: no revisions. `key`
  // makes each one happen once, across restarts.
  `
  CREATE TABLE notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    detail TEXT,
    project_id TEXT,
    href TEXT,
    action TEXT,
    gate INTEGER NOT NULL DEFAULT 0,
    modal INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    read_at TEXT
  );
  CREATE INDEX notifications_unread ON notifications(read_at, kind);
  `,
];

export function openDatabase(file: string = defaultDatabasePath()): DatabaseSync {
  if (file === defaultDatabasePath() && !process.env.PHAROS_DB && migrateLegacyDatabase(file)) {
    console.error(`Moved your data from ${LEGACY_DATABASE_PATH} to ${file}`);
  }
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync): void {
  const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let version = user_version; version < MIGRATIONS.length; version++) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(MIGRATIONS[version]!);
      db.exec(`PRAGMA user_version = ${version + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}
