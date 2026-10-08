import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { ENTITY_TYPES, meaningOf, runQuery, type EntityType, type Where } from '@pharos/schema';
import { openDatabase } from './store/database.js';
import { Store } from './store/store.js';

const fixtureDirectory = fileURLToPath(new URL('../../../eval/fixtures/', import.meta.url));
const serverDirectory = fileURLToPath(new URL('../', import.meta.url));
const fixtureNames = ['catalog-delivery', 'workshop-renovation'];
const directories: string[] = [];
function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'pharos-eval-'));
  directories.push(directory);
  return directory;
}
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function invoke(fixture: string, database: string) {
  return spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--conditions=development',
      join(fixtureDirectory, 'load.ts'),
      fixture,
      database,
    ],
    { cwd: serverDirectory, encoding: 'utf8', timeout: 30_000 },
  );
}

type Result = {
  version: string;
  today: string;
  checksum: string;
  counts: Record<EntityType, number>;
  refs: Record<string, string>;
};
type Fixture = {
  version: string;
  today: string;
  expected: {
    counts: Partial<Record<EntityType, number>>;
    overdue: string[];
    dueWeek: string[];
    explicitlyBlocked: string[];
    dependencyObstructed: string[];
    emptyStage: string;
  };
  operations: { op: string; type: string; data: Record<string, unknown> }[];
};
function load(fixture: string, database: string): Result {
  const result = invoke(fixture, database);
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as Result;
}

describe('versioned evaluation fixtures', () => {
  it('contains only synthetic fixture text and records the evaluation date/version', () => {
    const files = readdirSync(fixtureDirectory).filter((file) => file.endsWith('.json'));
    expect(files.sort()).toEqual(fixtureNames.map((name) => `${name}.json`).sort());
    for (const file of files) {
      const text = readFileSync(join(fixtureDirectory, file), 'utf8');
      // Split the name so the denylist test itself does not copy a personal name into the repo.
      for (const forbidden of ['Chae' + 'eon', 'zu' + 'boto', '/Us' + 'ers/', '@']) {
        expect(text.toLowerCase(), file).not.toContain(forbidden.toLowerCase());
      }
      const fixture = JSON.parse(text) as Fixture;
      expect(fixture.version).toMatch(/\d/);
      expect(fixture.today).toBe('2026-10-07');
    }
  });

  it.each(fixtureNames)(
    '%s loads with stable checksums, counts, and evaluation controls',
    (name) => {
      const directory = temporaryDirectory();
      const fixturePath = join(fixtureDirectory, `${name}.json`);
      const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as Fixture;
      const database = join(directory, 'first.db');
      const first = load(fixturePath, database);
      const second = load(fixturePath, join(directory, 'second.db'));
      expect(first.checksum).toMatch(/^[a-f0-9]{64}$/);
      expect(first.checksum).toBe(second.checksum);
      expect(first.refs).not.toEqual(second.refs);
      expect(first.version).toBe(fixture.version);
      expect(first.today).toBe(fixture.today);
      const expectedCounts = Object.fromEntries(
        ENTITY_TYPES.map((type) => [type, fixture.expected.counts[type] ?? 0]),
      );
      expect(first.counts).toEqual(expectedCounts);

      // Refusal is non-destructive even for an already populated evaluation database.
      const before = readFileSync(database);
      const repeated = invoke(fixturePath, database);
      expect(repeated.status).toBe(1);
      expect(repeated.stderr).toContain('Refusing existing database');
      expect(readFileSync(database)).toEqual(before);

      const db = openDatabase(database);
      try {
        const store = new Store(db);
        expect(store.latestRevisionId()).toBe(1);
        for (const type of ENTITY_TYPES) expect(store.list(type)).toHaveLength(first.counts[type]);
        const project = store.list('project')[0]!;
        const data = store.dataset(project.id);
        const refsFor = (rows: { id: string }[]) =>
          rows
            .map((row) => {
              const entry = Object.entries(first.refs).find(([, id]) => id === row.id);
              expect(entry).toBeDefined();
              return entry![0];
            })
            .sort();
        const open = { not: ['done', 'cancelled'] };
        const query = (where: Where) => runQuery(data, 'task', { where }, { today: fixture.today });
        expect(refsFor(query({ status: open, dueDate: { lt: '$today' } }))).toEqual(
          [...fixture.expected.overdue].sort(),
        );
        expect(
          refsFor(query({ status: open, dueDate: { gte: '2026-10-05', lte: '2026-10-11' } })),
        ).toEqual([...fixture.expected.dueWeek].sort());
        expect(refsFor(query({ status: 'blocked' }))).toEqual(
          [...fixture.expected.explicitlyBlocked].sort(),
        );
        const obstructed = data.tasks.filter(
          (task) =>
            !['done', 'cancelled'].includes(meaningOf(project, 'task.status', task.data.status)!) &&
            task.data.dependsOn.some((id) => {
              const dependency = data.tasks.find((candidate) => candidate.id === id)!;
              return meaningOf(project, 'task.status', dependency.data.status) !== 'done';
            }),
        );
        expect(refsFor(obstructed)).toEqual([...fixture.expected.dependencyObstructed].sort());
        expect(query({ stageId: first.refs[fixture.expected.emptyStage]! })).toEqual([]);
        expect(query({ status: open, 'stage.status': 'done', dueDate: { lt: '$today' } })).toEqual(
          [],
        );
        expect(data.views.filter((view) => view.data.template === 'overview')).toHaveLength(1);
        expect(data.requests.map((request) => request.data.status).sort()).toEqual([
          'answered',
          'dismissed',
          'open',
        ]);
        expect(
          data.views.some(
            (view) =>
              view.data.kind === 'answer' &&
              view.data.expiresAt! < `${fixture.today}T00:00:00.000Z`,
          ),
        ).toBe(true);
      } finally {
        db.close();
      }

      // Prove the checksum covers stored data, not just the fixture name/version.
      const changed = structuredClone(fixture);
      changed.operations.find(
        (operation) => operation.type === 'task' && operation.op === 'create',
      )!.data.title = 'Changed evaluation control';
      const changedPath = join(directory, 'changed.json');
      writeFileSync(changedPath, JSON.stringify(changed));
      expect(load(changedPath, join(directory, 'changed.db')).checksum).not.toBe(first.checksum);
    },
    30_000,
  );

  it('refuses an unrelated existing file and leaves no database after invalid input', () => {
    const directory = temporaryDirectory();
    const target = join(directory, 'existing.db');
    writeFileSync(target, 'unrelated data');
    expect(invoke(join(fixtureDirectory, 'catalog-delivery.json'), target).status).toBe(1);
    expect(readFileSync(target, 'utf8')).toBe('unrelated data');
    const badFixture = join(directory, 'invalid.json');
    const fixture = JSON.parse(
      readFileSync(join(fixtureDirectory, 'catalog-delivery.json'), 'utf8'),
    ) as Fixture;
    fixture.operations.find((operation) => operation.type === 'task')!.data.stageId = '$missing';
    writeFileSync(badFixture, JSON.stringify(fixture));
    expect(invoke(badFixture, join(directory, 'failed.db')).status).toBe(1);
    expect(readdirSync(directory).some((file) => file.startsWith('failed.db'))).toBe(false);
  });
});
