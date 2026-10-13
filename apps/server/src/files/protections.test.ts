import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FOLDERS_SETTING, FilePath } from '@pharos/schema';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { RevisionFeed } from '../feed.js';
import { openDatabase } from '../store/database.js';
import { Store } from '../store/store.js';
import { FileService, contentDisposition } from './service.js';

// Deterministically schedule a disk change between resolution and open, without a timing loop.
const race = vi.hoisted(() => ({ beforeOpen: undefined as ((path: unknown) => void) | undefined }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    open: (...args: Parameters<typeof actual.open>) => {
      race.beforeOpen?.(args[0]);
      return actual.open(...args);
    },
  };
});

const ROOT = 'root_review01';
const headers = { origin: 'http://localhost', 'sec-fetch-site': 'same-origin' };
let base: string;
let root: string;
let outside: string;
let store: Store;
let files: FileService;
let app: ReturnType<typeof createApp>;
let projectId: string;
let opened: string[][];

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'pharos-protections-'));
  root = join(base, 'Allowed');
  outside = join(base, 'Outside');
  mkdirSync(join(root, 'Nested'), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(root, 'Nested', 'report.txt'), 'allowed example');
  writeFileSync(join(outside, 'report.txt'), 'outside example');
  store = new Store(openDatabase(':memory:'));
  store.setSetting(FOLDERS_SETTING, [
    { id: ROOT, path: root, label: 'Example', level: 'details', addedAt: '2026-10-01T00:00:00Z' },
  ]);
  projectId = store.apply(
    { kind: 'human', name: 'owner' },
    {
      message: 'Example project',
      operations: [{ op: 'create', type: 'project', ref: 'p', data: { name: 'Example' } }],
    },
  ).created.p!;
  opened = [];
  files = new FileService(store, {
    platform: 'darwin',
    opener: async (args) => {
      opened.push(args);
    },
    log: () => {},
  });
  app = createApp(store, new RevisionFeed(store, 0), undefined, {
    files,
    folders: { home: join(base, 'FakeHome') },
  });
});

afterEach(async () => {
  race.beforeOpen = undefined;
  for (const folder of files.folders()) await files.scanner.idle(folder.id);
  store.database.close();
  rmSync(base, { recursive: true, force: true });
});

function record(path: string, rootId = ROOT): string {
  return store.apply(
    { kind: 'human', name: 'owner' },
    {
      message: 'Example file',
      operations: [
        {
          op: 'create',
          type: 'file',
          ref: 'f',
          data: {
            projectId,
            title: 'Example file',
            rootId,
            path,
            size: 15,
            modifiedAt: '2026-10-01T00:00:00Z',
          },
        },
      ],
    },
  ).created.f!;
}

const request = (id: string, suffix = 'content') =>
  app.request(`/api/files/${id}/${suffix}`, { headers });

describe('path and response protections', () => {
  it.each([
    '../Outside/report.txt',
    '/etc/passwd',
    'a/../../b',
    'a/./b',
    'a//b',
    'a\\b',
    'a\0b',
    '.env',
    'a/.ssh/id_rsa',
  ])('refuses the literal path %j', (path) => {
    expect(FilePath.safeParse(path).success).toBe(false);
    expect(() => record(path)).toThrow();
  });

  it.each([
    '%2e%2e/Outside/report.txt',
    '%252e%252e/Outside/report.txt',
    '%2Fetc%2Fpasswd',
    '%00.txt',
  ])('never URL-decodes a stored path %j', async (path) => {
    const response = await request(record(path));
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('outside example');
  });

  it('treats Unicode lookalikes as literal names and permits both composed spellings', async () => {
    mkdirSync(join(root, '．．'));
    writeFileSync(join(root, '．．', 'report.txt'), 'literal Unicode directory');
    const response = await request(record('．．/report.txt'));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('literal Unicode directory');
    for (const name of ['caf\u00e9.txt', 'cafe\u0301.txt']) {
      writeFileSync(join(root, name), 'Unicode example');
      const res = await request(record(name));
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('Unicode example');
    }
  });

  it.each(['file', 'folder'])('rejects a %s symlink changed after a scan', async (kind) => {
    files.scan(ROOT);
    await files.scanner.idle(ROOT);
    const id = record('Nested/report.txt');
    if (kind === 'file') {
      unlinkSync(join(root, 'Nested', 'report.txt'));
      symlinkSync(join(outside, 'report.txt'), join(root, 'Nested', 'report.txt'));
    } else {
      renameSync(join(root, 'Nested'), join(root, 'Saved'));
      symlinkSync(outside, join(root, 'Nested'));
    }
    const response = await request(id);
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('outside example');
  });

  it('keeps HTML disguised as text inert and quotes a hostile download filename', async () => {
    const name = 'quote"; café\'().txt';
    const payload = '<svg onload="alert(1)"><script>alert(1)</script></svg>';
    writeFileSync(join(root, name), payload);
    const id = record(name);
    const response = await request(id);
    expect(response.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toBe('sandbox');
    expect(await response.text()).toBe(payload);
    const download = await request(id, 'download');
    expect(download.headers.get('content-disposition')).toBe(
      contentDisposition('attachment', name),
    );
    expect(download.headers.get('content-disposition')).toContain('%27%28%29');
    await download.text();
  });

  it('uses octet-stream attachment for a document alias targeting HTML', async () => {
    writeFileSync(join(root, 'page.html'), '<script>alert(1)</script>');
    symlinkSync(join(root, 'page.html'), join(root, 'alias.pdf'));
    const response = await request(record('alias.pdf'));
    expect(response.headers.get('content-type')).toBe('application/octet-stream');
    expect(response.headers.get('content-disposition')).toMatch(/^attachment;/);
    await response.text();
  });

  it('passes shell metacharacters only as one absolute Reveal/Open argument', async () => {
    const name = '$(example);--args.txt';
    writeFileSync(join(root, name), 'made up');
    const id = record(name);
    for (const action of ['reveal', 'open'])
      expect(
        (await app.request(`/api/files/${id}/actions/${action}`, { method: 'POST', headers }))
          .status,
      ).toBe(200);
    const real = realpathSync(join(root, name));
    expect(opened).toEqual([['-R', real], [real]]);
  });
});

describe('confirmed gaps: expected protections remain failing until fixed', () => {
  it('does not scan new outside filenames after the approved root is replaced', async () => {
    files.scan(ROOT);
    await files.scanner.idle(ROOT);
    writeFileSync(join(outside, 'outside-only.txt'), 'made up');
    renameSync(root, join(base, 'SavedRoot'));
    symlinkSync(outside, root);
    files.scan(ROOT);
    await files.scanner.idle(ROOT);
    const response = await app.request(`/api/projects/${projectId}/scanned-files`, { headers });
    expect(await response.text()).not.toContain('outside-only.txt');
  });

  it('does not follow an approved root replaced by an outside symlink after scanning', async () => {
    store.setSetting(FOLDERS_SETTING, []);
    writeFileSync(join(root, 'report.txt'), 'allowed example');
    const added = await app.request('/api/settings/folders', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ path: root }),
    });
    expect(added.status).toBe(201);
    const folder = (await added.json()) as { id: string };
    await files.scanner.idle(folder.id);
    const id = record('report.txt', folder.id);
    renameSync(root, join(base, 'SavedRoot'));
    symlinkSync(outside, root);
    const response = await request(id);
    expect.soft(await response.text()).not.toBe('outside example');
    expect(response.status).toBe(403);
  });

  it('does not follow an ancestor swapped after resolution but before opening', async () => {
    const id = record('Nested/report.txt');
    const target = realpathSync(join(root, 'Nested', 'report.txt'));
    race.beforeOpen = (path) => {
      if (path !== target) return;
      race.beforeOpen = undefined;
      renameSync(join(root, 'Nested'), join(root, 'SavedNested'));
      symlinkSync(outside, join(root, 'Nested'));
    };
    const response = await request(id);
    const body = await response.text();
    expect(body).not.toBe('outside example');
    // A reader already anchored to the approved directory may safely return the original bytes.
    if (response.status === 200) expect(body).toBe('allowed example');
    else expect([403, 404]).toContain(response.status);
  });

  it('refuses a leaf swapped for a symlink immediately before opening', async () => {
    const id = record('Nested/report.txt');
    const target = realpathSync(join(root, 'Nested', 'report.txt'));
    race.beforeOpen = (path) => {
      if (path !== target) return;
      race.beforeOpen = undefined;
      unlinkSync(target);
      symlinkSync(join(outside, 'report.txt'), target);
    };
    const response = await request(id);
    expect(response.status).toBe(403);
    await response.text();
  });

  it.each([
    'credentials.json.bak',
    'server.pem.bak',
    'terraform.tfstate.backup',
    'credentials.csv',
  ])('never scans or serves credential backup/name %s', async (path) => {
    writeFileSync(join(root, path), 'TOKEN=made-up');
    files.scan(ROOT);
    await files.scanner.idle(ROOT);
    expect.soft(files.scanner.entry(ROOT, path)).toBeNull();
    const response = await request(record(path), 'download');
    await response.text();
    expect(response.status).toBe(403);
  });
});
