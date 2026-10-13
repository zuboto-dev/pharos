import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FOLDERS_SETTING, type FolderStatus } from '@pharos/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { openDatabase } from '../store/database.js';
import { Store } from '../store/store.js';
import { denyRulesFor } from './folders.js';
import { FileService } from './service.js';

// Temp folders only: these tests never look at the owner's real home or files.
let base: string;
let home: string;
let store: Store;
let app: ReturnType<typeof createApp>;
let files: FileService;

const BROWSER = { origin: 'http://localhost:5173', 'sec-fetch-site': 'same-origin' };

function request(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = BROWSER,
) {
  return app.request(`http://localhost/api/settings/folders${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function add(path: string, extra: Record<string, unknown> = {}) {
  const res = await request('POST', '', { path, ...extra });
  return { status: res.status, body: (await res.json()) as FolderStatus & ErrorBody };
}
type ErrorBody = { error: { code: string; message: string } };

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'pharos-folders-')));
  home = join(base, 'home');
  mkdirSync(join(home, 'Company', 'Tax'), { recursive: true });
  mkdirSync(join(home, 'Library'), { recursive: true });
  mkdirSync(join(home, '.ssh'), { recursive: true });
  mkdirSync(join(home, 'Health'), { recursive: true });
  writeFileSync(join(home, 'note.txt'), 'hello');
  store = new Store(openDatabase(':memory:'));
  files = new FileService(store, { log: () => {} });
  app = createApp(store, undefined, undefined, { folders: { home }, files });
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe('folders in Settings', () => {
  it('adds a folder with a default label and level, and lists it', async () => {
    const { status, body } = await add(join(home, 'Company'));
    expect(status).toBe(201);
    expect(body).toMatchObject({
      path: join(home, 'Company'),
      label: 'Company',
      level: 'details',
      available: true,
      files: null,
      denyRules: [`Read(/${join(home, 'Company')}/**)`],
    });
    expect(body.id).toMatch(/^root_[a-z0-9]{10}$/);
    const list = (await (await request('GET', '')).json()) as FolderStatus[];
    expect(list.map((f) => f.id)).toEqual([body.id]);
    expect(store.setting<unknown[]>(FOLDERS_SETTING)).toHaveLength(1);
  });

  it('scans a folder once added and forgets its scan once removed', async () => {
    writeFileSync(join(home, 'Company', 'Tax', 'receipt.pdf'), '%PDF-1.4');
    const { body: folder } = await add(join(home, 'Company'));
    await files.scanner.idle(folder.id);
    const list = (await (await request('GET', '')).json()) as FolderStatus[];
    expect(list[0]).toMatchObject({ files: 1, scanning: false, error: null });
    expect(list[0]!.scannedAt).toEqual(expect.any(String));
    await request('DELETE', `/${folder.id}`);
    expect(files.scanner.status(folder.id).files).toBeNull();
  });

  it('accepts pasted paths: quotes, ~/ and a trailing slash', async () => {
    const { status, body } = await add(` "~/Health/" `, { label: 'Doctor', level: 'hidden' });
    expect(status).toBe(201);
    expect(body).toMatchObject({ path: join(home, 'Health'), label: 'Doctor', level: 'hidden' });
  });

  it('stores the real path behind a symlink', async () => {
    symlinkSync(join(home, 'Company'), join(base, 'link'));
    const { body } = await add(join(base, 'link'));
    expect(body.path).toBe(join(home, 'Company'));
  });

  it('refuses missing folders, files, roots, home, Library, dot-folders and overlaps', async () => {
    const cases: [string, RegExp][] = [
      [join(home, 'nope'), /No folder at/],
      [join(home, 'note.txt'), /is a file, not a folder/],
      ['/', /expected string to have >=2 characters/],
      ['/usr/bin', /system folder/],
      [home, /whole home folder/],
      [base, /contains your home folder/],
      [join(home, 'Library'), /Library/],
      [join(home, '.ssh'), /never shared/],
      ['relative/path', /absolute path/],
    ];
    for (const [path, message] of cases) {
      const { status, body } = await add(path);
      expect(status, path).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(body), path).toMatch(message);
    }

    expect((await add(join(home, 'Company'))).status).toBe(201);
    const inside = await add(join(home, 'Company', 'Tax'));
    expect([inside.status, inside.body.error.message]).toEqual([
      409,
      expect.stringMatching(/inside "Company"/),
    ]);
    expect((await add(join(home, 'Company'))).status).toBe(409);
    expect((await (await request('GET', '')).json()) as unknown[]).toHaveLength(1);
  });

  it('renames, changes the level and removes, leaving added files in place', async () => {
    const { body: folder } = await add(join(home, 'Company'));
    let res = await request('PATCH', `/${folder.id}`, { label: 'Work', level: 'contents' });
    expect(await res.json()).toMatchObject({ label: 'Work', level: 'contents', denyRules: [] });

    store.apply(
      { kind: 'human', name: 'me' },
      {
        message: 'Start',
        operations: [{ op: 'create', type: 'project', data: { name: 'Taxes' } }],
      },
    );
    const revisions = store.latestRevisionId();

    res = await request('DELETE', `/${folder.id}`);
    expect(await res.json()).toEqual({ removed: folder.id });
    expect((await (await request('GET', '')).json()) as unknown[]).toEqual([]);
    // Removing forgets the folder only: no revision, so files added from it stay (as missing).
    expect(store.latestRevisionId()).toBe(revisions);
    expect(store.list('project')).toHaveLength(1);

    res = await request('DELETE', `/${folder.id}`);
    expect(res.status).toBe(404);
  });

  it('lets only a person add folders or widen access; anyone may lower a level', async () => {
    const agent = { ...BROWSER, 'x-pharos-author': 'agent:Claude Code' };
    expect((await request('POST', '', { path: join(home, 'Company') }, agent)).status).toBe(403);
    // A request without a browser's headers (curl, a script) is refused too.
    expect((await request('POST', '', { path: join(home, 'Company') }, {})).status).toBe(403);
    expect((await request('GET', '')).status).toBe(200);

    const { body: folder } = await add(join(home, 'Company'), { level: 'details' });
    const raise = await request('PATCH', `/${folder.id}`, { level: 'contents' }, agent);
    expect(raise.status).toBe(403);
    expect(((await raise.json()) as ErrorBody).error.message).toMatch(/Only a person/);
    expect((await request('PATCH', `/${folder.id}`, { label: 'X' }, agent)).status).toBe(403);
    expect((await request('DELETE', `/${folder.id}`, undefined, agent)).status).toBe(403);

    const lower = await request('PATCH', `/${folder.id}`, { level: 'hidden' }, agent);
    expect(lower.status).toBe(200);
    expect(await lower.json()).toMatchObject({ level: 'hidden' });
    const list = (await (await request('GET', '')).json()) as FolderStatus[];
    expect(list[0]).toMatchObject({ label: 'Company', level: 'hidden' });
  });

  it('marks a folder that has gone missing as unavailable', async () => {
    const { body: folder } = await add(join(home, 'Health'));
    rmSync(join(home, 'Health'), { recursive: true });
    const list = (await (await request('GET', '')).json()) as FolderStatus[];
    expect(list).toMatchObject([{ id: folder.id, available: false }]);
  });
});

describe('Claude Code deny rules', () => {
  it('uses an absolute // pattern for every level but contents', () => {
    expect(denyRulesFor({ path: '/Users/me/Company', level: 'details' })).toEqual([
      'Read(//Users/me/Company/**)',
    ]);
    expect(denyRulesFor({ path: '/Users/me/Company', level: 'hidden' })).toEqual([
      'Read(//Users/me/Company/**)',
    ]);
    expect(denyRulesFor({ path: '/Users/me/Company', level: 'contents' })).toEqual([]);
  });

  it('escapes gitignore pattern characters, but not spaces or parentheses', () => {
    expect(denyRulesFor({ path: '/Users/me/[2024] Tax*', level: 'details' })).toEqual([
      'Read(//Users/me/\\[2024\\] Tax\\*/**)',
    ]);
    expect(denyRulesFor({ path: '/Users/me/Finance (2024)', level: 'details' })).toEqual([
      'Read(//Users/me/Finance (2024)/**)',
    ]);
  });
});
