import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS, migrateLegacyDatabase, openDatabase } from './database.js';
import { Store } from './store.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function temp() {
  const dir = mkdtempSync(join(tmpdir(), 'pharos-db-'));
  dirs.push(dir);
  return dir;
}

describe('migrateLegacyDatabase', () => {
  it('moves the old database (with its WAL) to the new location once, keeping the data', () => {
    const dir = temp();
    const legacy = join(dir, '.mycel', 'mycel.db');
    const target = join(dir, '.pharos', 'pharos.db');
    mkdirSync(join(dir, '.mycel'));
    const old = new Store(openDatabase(legacy));
    old.apply(
      { kind: 'human', name: 'me' },
      { message: 'x', operations: [{ op: 'create', type: 'project', data: { name: 'Kept' } }] },
    );

    expect(migrateLegacyDatabase(target, legacy)).toBe(true);
    expect(existsSync(legacy)).toBe(false);
    expect(new Store(openDatabase(target)).list('project').map((p) => p.data.name)).toEqual([
      'Kept',
    ]);
    // Already moved: nothing more to do, and an existing target is never overwritten.
    expect(migrateLegacyDatabase(target, legacy)).toBe(false);
  });

  it('does nothing without an old database', () => {
    const dir = temp();
    expect(migrateLegacyDatabase(join(dir, 'pharos.db'), join(dir, 'missing.db'))).toBe(false);
    expect(migrateLegacyDatabase(':memory:')).toBe(false);
  });
});

describe('migrations', () => {
  it('gives existing repositories and projects sidebar positions in alphabetical order', () => {
    const file = join(temp(), 'v1.db');
    // A database from before sidebar ordering existed (schema version 1).
    const v1 = new DatabaseSync(file);
    v1.exec(MIGRATIONS[0]!);
    v1.exec(
      "INSERT INTO revisions (author_kind, author_name, message, created_at) VALUES ('human', 'me', 'x', '')",
    );
    const insert = v1.prepare(
      'INSERT INTO entities (id, type, project_id, data, created_at, updated_at, created_rev, updated_rev) VALUES (?, ?, ?, ?, ?, ?, 1, 1)',
    );
    for (const [id, type, name] of [
      ['prj_b', 'project', 'zeta'],
      ['prj_a', 'project', 'Alpha'],
      ['repo_1', 'repository', 'mycel'],
    ]) {
      insert.run(
        id!,
        type!,
        type === 'project' ? id! : null,
        JSON.stringify({ name, status: 'active' }),
        '',
        '',
      );
    }
    v1.exec('PRAGMA user_version = 1');
    v1.close();

    const store = new Store(openDatabase(file));
    expect(store.list('project').map((p) => [p.data.name, p.data.order])).toEqual([
      ['Alpha', 0],
      ['zeta', 1],
    ]);
    expect(store.list('repository')[0]!.data.order).toBe(0);
  });

  it('appends new projects and repositories after existing ones', () => {
    const store = new Store(openDatabase(':memory:'));
    const me = { kind: 'human', name: 'me' } as const;
    store.apply(me, {
      message: 'x',
      operations: [{ op: 'create', type: 'project', data: { name: 'A' } }],
    });
    store.apply(me, {
      message: 'x',
      operations: [{ op: 'create', type: 'project', data: { name: 'B' } }],
    });
    expect(store.list('project').map((p) => p.data.order)).toEqual([0, 1]);
  });
});
