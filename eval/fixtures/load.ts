import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ApplyInput, ENTITY_TYPES } from '../../packages/schema/src/index.js';
import { openDatabase } from '../../apps/server/src/store/database.js';
import { Store } from '../../apps/server/src/store/store.js';

// Sort object keys, preserve meaningful array order, and replace every generated entity ID.
function canonical(value: unknown, aliases: Map<string, string>): unknown {
  if (typeof value === 'string') return aliases.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => canonical(item, aliases));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item, aliases)]),
    );
  }
  return value;
}

/** Fresh files only: an existing target is refused without opening or modifying it. */
export function loadFixture(fixturePath: string, databasePath: string) {
  const raw = JSON.parse(readFileSync(fixturePath, 'utf8')) as Record<string, unknown>;
  if (typeof raw.version !== 'string' || !raw.version.trim() || raw.today !== '2026-10-07') {
    throw new Error('Fixture requires a nonempty version and frozen today: 2026-10-07');
  }
  const input = ApplyInput.parse(raw);
  const refs = new Set<string>();
  for (const operation of input.operations) {
    if (operation.op !== 'create') continue;
    if (!operation.ref || refs.has(operation.ref)) {
      throw new Error('Every create requires a unique fixture ref');
    }
    refs.add(operation.ref);
  }
  if (databasePath === ':memory:') throw new Error('Provide a fresh database file path');
  const target = resolve(databasePath);
  if (target.split(sep).includes('.pharos')) throw new Error('Live data paths are forbidden');
  if (['', '-wal', '-shm', '-journal'].some((suffix) => existsSync(target + suffix))) {
    throw new Error('Refusing existing database path or SQLite sidecar; use a fresh path');
  }
  mkdirSync(dirname(target), { recursive: true });
  // Exclusive creation also protects against two loaders racing for the same target.
  closeSync(openSync(target, 'wx', 0o600));
  let db: ReturnType<typeof openDatabase> | undefined;
  try {
    db = openDatabase(target);
    const store = new Store(db, () => `${raw.today}T12:00:00.000Z`);
    const result = store.apply({ kind: 'system', name: 'evaluation-fixture' }, input);
    const entities = ENTITY_TYPES.flatMap((type) => store.list(type));
    const aliases = new Map(Object.entries(result.created).map(([ref, id]) => [id, `$${ref}`]));
    // The Store creates one Overview implicitly for each project, outside result.created.
    for (const entity of store.list('view')) {
      if (aliases.has(entity.id)) continue;
      if (entity.data.template !== 'overview') {
        throw new Error(`Unmapped generated entity: ${entity.type}`);
      }
      const project = aliases.get(entity.data.projectId);
      if (!project) throw new Error('Unmapped Overview project');
      const alias = `${project}/default-overview`;
      if ([...aliases.values()].includes(alias)) throw new Error('Ambiguous default Overview');
      aliases.set(entity.id, alias);
    }
    if (entities.some((entity) => !aliases.has(entity.id))) {
      throw new Error('Unmapped generated entity');
    }
    const records = entities
      .map((entity) => ({ id: aliases.get(entity.id)!, type: entity.type, data: entity.data }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const checksum = createHash('sha256')
      .update(
        JSON.stringify(
          canonical({ version: raw.version, today: raw.today, entities: records }, aliases),
        ),
      )
      .digest('hex');
    const counts = Object.fromEntries(
      ENTITY_TYPES.map((type) => [type, entities.filter((entity) => entity.type === type).length]),
    );
    return { version: raw.version, today: raw.today, checksum, counts, refs: result.created };
  } catch (error) {
    db?.close();
    db = undefined;
    for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(target + suffix, { force: true });
    throw error;
  } finally {
    db?.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [fixturePath, databasePath, ...extra] = process.argv.slice(2);
    if (!fixturePath || !databasePath || extra.length) {
      throw new Error('Usage: load.ts <fixture.json> <fresh-database-path>');
    }
    console.error('Loading fixture (1/1)...');
    console.log(JSON.stringify(loadFixture(fixturePath, databasePath)));
    console.error('Fixture loaded (1/1).');
  } catch (error) {
    console.error(`Fixture load failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
