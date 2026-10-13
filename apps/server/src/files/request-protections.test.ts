// Request protection checks use only made-up files under a temporary directory.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FOLDERS_SETTING } from '@pharos/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { RevisionFeed } from '../feed.js';
import { openDatabase } from '../store/database.js';
import { Store } from '../store/store.js';
import { FileService } from './service.js';

const BROWSER = { origin: 'http://localhost', 'sec-fetch-site': 'same-origin' };
const ROOT_ID = 'root_test01';
const FILE_DATE = '2026-10-01T00:00:00.000Z';
const INVALID_BROWSER_PROOF: Record<string, string>[] = [
  {},
  { origin: 'https://localhost' },
  { origin: 'http://localhost:5173' },
  { origin: 'not-an-origin' },
  { origin: 'http://evil.example', 'sec-fetch-site': 'cross-site' },
  { origin: 'http://127.0.0.1', 'sec-fetch-site': 'cross-site' },
  { origin: 'http://localhost', 'sec-fetch-site': 'cross-site' },
  { origin: 'http://localhost', 'sec-fetch-site': 'same-site' },
  { 'sec-fetch-site': 'cross-site' },
];

let base: string;
let home: string;
let root: string;
let store: Store;
let files: FileService;
let app: ReturnType<typeof createApp>;

function request(path: string, init?: RequestInit) {
  return app.request(`http://localhost${path}`, init);
}

function requestAs(path: string, method: string, headers: Record<string, string>, body?: unknown) {
  return request(path, {
    method,
    headers: body === undefined ? headers : { ...headers, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function addFolder(path: string, headers: Record<string, string> = BROWSER) {
  return requestAs('/api/settings/folders', 'POST', headers, { path });
}

function addProject(): string {
  return store.apply(
    { kind: 'human', name: 'test' },
    {
      message: 'Create made-up project for request protection test',
      operations: [
        {
          op: 'create',
          type: 'project',
          ref: 'project',
          data: { name: 'Request protection test' },
        },
      ],
    },
  ).created.project!;
}

function addFile(projectId: string, rootId: string, path: string): string {
  return store.apply(
    { kind: 'human', name: 'test' },
    {
      message: 'Add made-up file for request protection test',
      operations: [
        {
          op: 'create',
          type: 'file',
          ref: 'file',
          data: {
            projectId,
            title: path,
            rootId,
            path,
            size: 18,
            modifiedAt: FILE_DATE,
          },
        },
      ],
    },
  ).created.file!;
}

function setFileRoot() {
  store.setSetting(FOLDERS_SETTING, [
    {
      id: ROOT_ID,
      path: root,
      label: 'Made-up files',
      level: 'details',
      addedAt: FILE_DATE,
    },
  ]);
  const projectId = addProject();
  const fileId = addFile(projectId, ROOT_ID, 'notes.txt');
  return { projectId, fileId };
}

async function statusAfterRead(
  path: string,
  method: string,
  headers: Record<string, string>,
  body?: unknown,
) {
  const response = await requestAs(path, method, headers, body);
  // Drain file streams and JSON responses before the temp tree and database are removed.
  if (response.body) await response.arrayBuffer();
  return response.status;
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'pharos-request-protections-'));
  home = join(base, 'home');
  root = join(base, 'registered');
  mkdirSync(home);
  mkdirSync(root);
  writeFileSync(join(root, 'notes.txt'), 'made-up file contents');
  store = new Store(openDatabase(':memory:'));
  files = new FileService(store, { platform: 'linux', log: () => {} });
  app = createApp(store, new RevisionFeed(store, 0), undefined, { files, folders: { home } });
});

afterEach(async () => {
  const folders = store.setting<Array<{ id: string }>>(FOLDERS_SETTING) ?? [];
  await Promise.all(folders.map((folder) => files.scanner.idle(folder.id)));
  rmSync(base, { recursive: true, force: true });
});

describe('file route request boundary', () => {
  it('rejects missing and foreign Origin or Sec-Fetch-Site for every file route method', async () => {
    const { projectId, fileId } = setFileRoot();
    const guarded = [
      { method: 'GET', path: `/api/files/${fileId}` },
      { method: 'GET', path: `/api/files/${fileId}/content` },
      { method: 'GET', path: `/api/files/${fileId}/download` },
      { method: 'HEAD', path: `/api/files/${fileId}/content` },
      { method: 'POST', path: `/api/files/${fileId}/actions/reveal` },
      { method: 'GET', path: `/api/projects/${projectId}/scanned-files` },
      {
        method: 'POST',
        path: `/api/projects/${projectId}/files`,
        body: { files: [{ rootId: ROOT_ID, path: 'notes.txt' }] },
      },
      { method: 'POST', path: `/api/settings/folders/${ROOT_ID}/scan` },
    ];

    const denied: string[] = [];
    for (const route of guarded) {
      for (const headers of INVALID_BROWSER_PROOF) {
        const status = await statusAfterRead(route.path, route.method, headers, route.body);
        if (status !== 403)
          denied.push(`${route.method} ${route.path} with ${JSON.stringify(headers)} -> ${status}`);
      }
    }
    expect(denied).toEqual([]);
  });

  it('keeps the same-origin Sec-Fetch-Site fallback for GET requests without Origin', async () => {
    const { fileId } = setFileRoot();
    expect(
      await statusAfterRead(`/api/files/${fileId}/content`, 'GET', {
        'sec-fetch-site': 'same-origin',
      }),
    ).toBe(200);
    expect(
      await statusAfterRead(`/api/files/${fileId}/content`, 'GET', { 'sec-fetch-site': 'none' }),
    ).toBe(200);
  });
});

describe('folder route request boundary', () => {
  it('requires browser proof for folder list, create, update, delete and scan routes', async () => {
    const created = await addFolder(root);
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const routes = [
      { method: 'GET', path: '/api/settings/folders' },
      { method: 'HEAD', path: '/api/settings/folders' },
      { method: 'POST', path: '/api/settings/folders', body: { path: join(base, 'new-root') } },
      { method: 'PATCH', path: `/api/settings/folders/${id}`, body: { label: 'Renamed' } },
      { method: 'DELETE', path: `/api/settings/folders/${id}` },
      { method: 'POST', path: `/api/settings/folders/${id}/scan` },
    ];
    const denied: string[] = [];

    for (const route of routes) {
      for (const headers of INVALID_BROWSER_PROOF) {
        const status = await statusAfterRead(route.path, route.method, headers, route.body);
        if (status !== 403)
          denied.push(`${route.method} ${route.path} with ${JSON.stringify(headers)} -> ${status}`);
      }
    }

    // A level downgrade also needs browser proof, even though it only reduces agent access.
    const downgradeHeaders: Record<string, string>[] = [
      {},
      { origin: 'http://localhost' },
      { 'sec-fetch-site': 'same-origin' },
      { origin: 'http://127.0.0.1', 'sec-fetch-site': 'cross-site' },
      { origin: 'http://localhost', 'sec-fetch-site': 'cross-site' },
    ];
    for (const headers of downgradeHeaders) {
      const status = await statusAfterRead(`/api/settings/folders/${id}`, 'PATCH', headers, {
        level: 'hidden',
      });
      if (status !== 403)
        denied.push(`PATCH level downgrade with ${JSON.stringify(headers)} -> ${status}`);
    }
    expect(denied).toEqual([]);
  });

  it('allows same-origin GET fallback without Origin when Fetch Metadata proves the page', async () => {
    expect(
      await statusAfterRead('/api/settings/folders', 'GET', { 'sec-fetch-site': 'same-origin' }),
    ).toBe(200);
  });

  it('refuses agent and nonbrowser callers on the root-list route', async () => {
    expect((await addFolder(root)).status).toBe(201);
    const agentStatus = await statusAfterRead('/api/settings/folders', 'GET', {
      ...BROWSER,
      'x-pharos-author': 'agent:reviewer',
    });
    expect(agentStatus).toBe(403);
    expect(await statusAfterRead('/api/settings/folders', 'GET', {})).toBe(403);
  });

  it('keeps folder roots inside safe, canonical, non-overlapping directories', async () => {
    const company = join(home, 'Company');
    const tax = join(company, 'Tax');
    const library = join(home, 'Library');
    mkdirSync(tax, { recursive: true });
    mkdirSync(library);
    symlinkSync(company, join(base, 'company-link'));
    symlinkSync(tax, join(base, 'tax-link'));
    symlinkSync(home, join(base, 'home-link'));

    // Symlink aliases are resolved before saving or comparing roots.
    const alias = await addFolder(join(base, 'company-link'));
    expect(alias.status).toBe(201);
    expect(alias.headers.get('content-type')).toContain('application/json');
    expect(await alias.json()).toMatchObject({ path: realpathSync(company) });

    for (const path of [tax, join(base, 'tax-link')]) {
      expect((await addFolder(path)).status, path).toBe(409);
    }
    expect((await addFolder(company)).status).toBe(409);
    expect((await addFolder(join(base, 'company-link'))).status).toBe(409);

    // These are temporary test paths. The system path is checked by metadata only.
    for (const path of ['/usr/bin', home, base, join(base, 'home-link'), library]) {
      const response = await addFolder(path);
      expect(response.status, path).toBeGreaterThanOrEqual(400);
    }
  });

  it('rejects a nested root and its symlink alias when the parent was added first', async () => {
    const company = join(home, 'Company');
    const tax = join(company, 'Tax');
    mkdirSync(tax, { recursive: true });
    symlinkSync(tax, join(base, 'tax-link'));

    expect((await addFolder(company)).status).toBe(201);
    expect((await addFolder(tax)).status).toBe(409);
    expect((await addFolder(join(base, 'tax-link'))).status).toBe(409);
  });

  it('rejects a parent root and its symlink alias when the nested root was added first', async () => {
    const company = join(home, 'Company');
    const tax = join(company, 'Tax');
    mkdirSync(tax, { recursive: true });
    symlinkSync(company, join(base, 'company-link'));

    expect((await addFolder(tax)).status).toBe(201);
    expect((await addFolder(company)).status).toBe(409);
    expect((await addFolder(join(base, 'company-link'))).status).toBe(409);
  });

  it('requires a same-origin browser proof and a person for folder mutations', async () => {
    const created = await addFolder(root);
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const agent = { ...BROWSER, 'x-pharos-author': 'agent:reviewer' };
    const noBrowser = {};

    const mutationHeaders: Record<string, string>[] = [agent, noBrowser];
    for (const headers of mutationHeaders) {
      expect((await addFolder(join(base, 'another-root'), headers)).status).toBe(403);
      expect(
        await statusAfterRead(`/api/settings/folders/${id}`, 'PATCH', headers, {
          level: 'contents',
        }),
      ).toBe(403);
      expect(
        await statusAfterRead(`/api/settings/folders/${id}`, 'PATCH', headers, {
          label: 'Renamed',
        }),
      ).toBe(403);
      expect(await statusAfterRead(`/api/settings/folders/${id}`, 'DELETE', headers)).toBe(403);
    }

    // An agent may lower access when the request still comes from the Settings page.
    expect(
      await statusAfterRead(`/api/settings/folders/${id}`, 'PATCH', agent, { level: 'hidden' }),
    ).toBe(200);
  });
});

describe('artifact file matcher request boundary', () => {
  it('rejects missing and foreign Origin or Sec-Fetch-Site', async () => {
    const projectId = addProject();
    const artifactId = store.apply(
      { kind: 'human', name: 'test' },
      {
        message: 'Add made-up artifact for request protection test',
        operations: [
          {
            op: 'create',
            type: 'artifact',
            ref: 'artifact',
            data: { projectId, title: 'Made-up source', uri: join(base, 'made-up.pdf') },
          },
        ],
      },
    ).created.artifact!;
    const denied: string[] = [];

    for (const method of ['GET', 'HEAD']) {
      for (const headers of INVALID_BROWSER_PROOF) {
        const status = await statusAfterRead(`/api/artifacts/${artifactId}/file`, method, headers);
        if (status !== 403)
          denied.push(`${method} artifact file with ${JSON.stringify(headers)} -> ${status}`);
      }
    }
    expect(denied).toEqual([]);
  });

  it('allows same-origin GET fallback without Origin when Fetch Metadata proves the page', async () => {
    const projectId = addProject();
    const artifactId = store.apply(
      { kind: 'human', name: 'test' },
      {
        message: 'Add made-up artifact for request protection test',
        operations: [
          {
            op: 'create',
            type: 'artifact',
            ref: 'artifact',
            data: { projectId, title: 'Made-up source', uri: join(base, 'made-up.pdf') },
          },
        ],
      },
    ).created.artifact!;
    expect(
      await statusAfterRead(`/api/artifacts/${artifactId}/file`, 'GET', {
        'sec-fetch-site': 'same-origin',
      }),
    ).toBe(200);
  });
});
