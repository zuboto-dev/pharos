// R7.2 scan folders and serve files safely · Opus 5.5
// Every folder and file here is made up inside a temp directory; no test reads the owner's files.
import {
  chmodSync,
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
import {
  FOLDERS_SETTING,
  TEXT_PREVIEW_MAX_BYTES,
  type FileFolder,
  type FileInfo,
  type ScanStatus,
  type ScannedFile,
} from '@pharos/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { openDatabase } from '../store/database.js';
import { Store } from '../store/store.js';
import { folderIdentity, isAllowedDir, isAllowedName, isAllowedPath } from './safety.js';
import { FileService, contentDisposition } from './service.js';

const ROOT_ID = 'root_test01';
const ORIGIN = { origin: 'http://localhost' };
const keynote = Buffer.concat([Buffer.from('PK\u0003\u0004'), Buffer.alloc(20_000, 1)]);

let base: string;
let root: string;
let outside: string;
let store: Store;
let files: FileService;
let app: ReturnType<typeof createApp>;
let opened: string[][];
let logs: string[];
let projectId: string;

function write(rel: string, contents: string | Buffer = 'made-up contents') {
  const path = join(root, rel);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, contents);
}

function setFolders(folders: Partial<FileFolder>[]) {
  store.setSetting(
    FOLDERS_SETTING,
    folders.map((f) => ({
      id: ROOT_ID,
      path: root,
      label: 'Company',
      level: 'details',
      addedAt: '2026-10-01T00:00:00.000Z',
      ...f,
    })),
  );
}

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), 'pharos-files-'));
  root = join(base, 'Company Files');
  outside = join(base, 'Elsewhere');
  mkdirSync(root);
  mkdirSync(outside);
  write('Company/office lease.pdf', '%PDF-1.4 made up');
  write('notes.md', '# Notes\nmade up');
  write('page.html', '<script>alert(1)</script>');
  write('logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  write('run.sh', 'echo made up');
  write('big.txt', 'a'.repeat(TEXT_PREVIEW_MAX_BYTES + 10));
  write('계약서 "final".pdf', '%PDF-1.4 made up');
  write('deck.key', keynote);
  // Never scanned or served.
  write('.env', 'TOKEN=made-up');
  write('.ssh/id_ed25519', 'made-up key');
  write('id_rsa', 'made-up key');
  write('server.pem', '-----BEGIN PRIVATE KEY-----');
  write('server.key', '-----BEGIN PRIVATE KEY-----');
  write('prod.env', 'TOKEN=made-up');
  write('Config/credentials.json', '{}');
  write('.Report.pdf.icloud', 'placeholder');
  write('~$draft.docx', 'lock');
  write('node_modules/pkg/readme.txt', 'x');
  write('Tool.app/Contents/Info.txt', 'x');
  writeFileSync(join(outside, 'secret.txt'), 'outside the folder');
  symlinkSync(join(outside, 'secret.txt'), join(root, 'escape.txt'));
  symlinkSync(outside, join(root, 'linked-dir'));
  symlinkSync(join(root, '.env'), join(root, 'dot-link.txt'));
  symlinkSync(join(root, 'notes.md'), join(root, 'inner-link.md'));

  store = new Store(openDatabase(':memory:'));
  opened = [];
  logs = [];
  files = new FileService(store, {
    platform: 'darwin',
    opener: async (args) => {
      if (args.some((a) => a.endsWith('/fail')))
        throw Object.assign(new Error('boom'), { code: 1 });
      opened.push(args);
    },
    log: (m) => logs.push(m),
    batchSize: 3,
  });
  app = createApp(store, undefined, undefined, { files });
  setFolders([{}]);
  projectId = store.apply(
    { kind: 'human', name: 'me' },
    {
      message: 'Set up',
      operations: [{ op: 'create', type: 'project', ref: 'p', data: { name: 'Example Co' } }],
    },
  ).created.p!;
});

afterEach(() => rmSync(base, { recursive: true, force: true }));

async function scan(): Promise<ScanStatus> {
  files.scan(ROOT_ID);
  await files.scanner.idle(ROOT_ID);
  return files.scanner.status(ROOT_ID);
}

async function scannedPaths(): Promise<string[]> {
  const res = await app.request(`/api/projects/${projectId}/scanned-files?limit=500`, {
    headers: ORIGIN,
  });
  return ((await res.json()) as ScannedFile[]).map((f) => f.path);
}

/** A file record as a person would make one (bypassing the scan, to test serving). */
function record(path: string, rootId = ROOT_ID): string {
  const { created } = store.apply(
    { kind: 'human', name: 'me' },
    {
      message: 'Add a file',
      operations: [
        {
          op: 'create',
          type: 'file',
          ref: 'f',
          data: {
            projectId,
            title: path,
            rootId,
            path,
            size: 1,
            modifiedAt: '2026-10-01T00:00:00.000Z',
          },
        },
      ],
    },
  );
  return created.f!;
}

async function addFromScan(paths: string[], headers: Record<string, string> = ORIGIN) {
  return app.request(`/api/projects/${projectId}/files`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ files: paths.map((path) => ({ rootId: ROOT_ID, path })) }),
  });
}

describe('safety rules', () => {
  it('refuses dotfiles, keys and credentials by name', () => {
    for (const name of [
      '.env',
      '.DS_Store',
      '.Report.pdf.icloud',
      'id_rsa',
      'id_ed25519.pub',
      'server.pem',
      'cert.p12',
      'login.keychain-db',
      'vault.kdbx',
      'prod.env',
      'app.env.local',
      'credentials.json',
      'secrets.yaml',
      'service-account-prod.json',
      'my_private_key.txt',
      '~$draft.docx',
      'a\nb.pdf',
    ])
      expect(isAllowedName(name), name).toBe(false);
    for (const name of ['lease.pdf', 'Credentials for the bank.pdf', 'environment.md', 'tax.xlsx'])
      expect(isAllowedName(name), name).toBe(true);
    // ".key": Keynote documents are big, private keys small.
    expect(isAllowedName('deck.key', 200_000)).toBe(true);
    expect(isAllowedName('server.key', 1_700)).toBe(false);
    expect(isAllowedDir('.ssh')).toBe(false);
    expect(isAllowedDir('node_modules')).toBe(false);
    expect(isAllowedDir('Tool.app')).toBe(false);
    expect(isAllowedPath('2025/.ssh/notes.txt')).toBe(false);
  });

  it('refuses backups of secrets and credential names with any extension (R7.9)', () => {
    for (const name of [
      'credentials.json.bak',
      'server.pem.bak',
      'server.pem~',
      'id_rsa.orig',
      'prod.env.old',
      'terraform.tfstate.backup',
      'terraform.tfstate.1700000000.backup',
      'credentials.csv',
      'secrets.md',
      'passwords.xlsx',
      'config.env.json',
      'vault.kdbx.bak2',
    ])
      expect(isAllowedName(name), name).toBe(false);
    for (const name of ['notes.txt.bak', 'report.old', 'Secret plan.md', 'plan.txt~'])
      expect(isAllowedName(name), name).toBe(true);
    // A backup of a ".key" is a key or a Keynote document like the original.
    expect(isAllowedName('server.key.bak', 1_700)).toBe(false);
    expect(isAllowedName('deck.key.bak', 200_000)).toBe(true);
  });

  it('writes the real file name safely in Content-Disposition', () => {
    expect(contentDisposition('attachment', '계약서 "final";.pdf')).toBe(
      `attachment; filename="___ _final__.pdf"; filename*=UTF-8''${encodeURIComponent('계약서 "final";.pdf')}`,
    );
  });
});

describe('scanning', () => {
  it('lists allowed files only, without reading them, and keeps the cache out of revisions', async () => {
    const before = store.latestRevisionId();
    const started = files.scan(ROOT_ID);
    // Returns at once; the scan runs in the background.
    expect(started.scanning).toBe(true);
    const status = await scan();
    expect(status).toMatchObject({ scanning: false, error: null, files: 8 });
    expect((await scannedPaths()).sort()).toEqual(
      [
        'Company/office lease.pdf',
        'big.txt',
        'deck.key',
        'logo.svg',
        'notes.md',
        'page.html',
        'run.sh',
        '계약서 "final".pdf',
      ].sort(),
    );
    expect(store.latestRevisionId()).toBe(before);
    // Hashing is lazy: nothing was read.
    expect(files.scanner.entry(ROOT_ID, 'notes.md')).toMatchObject({
      sha256: null,
      mimeType: 'text/markdown; charset=utf-8',
    });
  });

  it('forgets removed files on the next scan and keeps hashes of unchanged ones', async () => {
    await scan();
    files.scanner.setHash(
      ROOT_ID,
      'notes.md',
      'a'.repeat(64),
      15,
      files.scanner.entry(ROOT_ID, 'notes.md')!.modifiedAt,
    );
    unlinkSync(join(root, 'run.sh'));
    await scan();
    expect(await scannedPaths()).not.toContain('run.sh');
    expect(files.scanner.entry(ROOT_ID, 'notes.md')!.sha256).toBe('a'.repeat(64));
  });

  it('reports a missing folder in plain words, never throwing', async () => {
    setFolders([{ path: join(base, 'Not There') }]);
    const status = await scan();
    expect(status.error).toMatch(/isn't there/);
    expect(status.scanning).toBe(false);
  });

  it('skips folders it may not read, and refuses files it may not read', async () => {
    write('Locked/inside.pdf', 'made up');
    write('locked.pdf', 'made up');
    chmodSync(join(root, 'Locked'), 0o000);
    chmodSync(join(root, 'locked.pdf'), 0o000);
    try {
      const status = await scan();
      expect(status.error).toBeNull();
      expect(await scannedPaths()).not.toContain('Locked/inside.pdf');
      expect(logs.join('\n')).toMatch(/couldn't be read/);
      const id = record('locked.pdf');
      const res = await app.request(`/api/files/${id}/content`, { headers: ORIGIN });
      expect(res.status).toBe(403);
    } finally {
      chmodSync(join(root, 'Locked'), 0o755);
      chmodSync(join(root, 'locked.pdf'), 0o644);
    }
  });

  it('stops at the file limit and says so', async () => {
    const small = new FileService(store, { maxFiles: 2, log: () => {} });
    small.scanner.scan(small.folder(ROOT_ID)!);
    await small.scanner.idle(ROOT_ID);
    expect(small.scanner.status(ROOT_ID)).toMatchObject({ files: 2 });
    expect(small.scanner.status(ROOT_ID).error).toMatch(/Stopped after 2 files/);
  });

  it('starts a scan over the route and finds unknown folders', async () => {
    const res = await app.request(`/api/settings/folders/${ROOT_ID}/scan`, {
      method: 'POST',
      headers: ORIGIN,
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as ScanStatus).rootId).toBe(ROOT_ID);
    await files.scanner.idle(ROOT_ID);
    const missing = await app.request('/api/settings/folders/root_nothere/scan', {
      method: 'POST',
      headers: ORIGIN,
    });
    expect(missing.status).toBe(404);
  });
});

describe('adding files', () => {
  it('adds files from the scan as one revision with the scan fields filled', async () => {
    await scan();
    const before = store.latestRevisionId();
    const res = await addFromScan(['Company/office lease.pdf', 'notes.md']);
    expect(res.status).toBe(200);
    expect(store.latestRevisionId()).toBe(before + 1);
    const added = store.list('file', { projectId });
    expect(added.map((f) => f.data.title).sort()).toEqual(['notes', 'office lease']);
    expect(added.find((f) => f.data.path === 'notes.md')!.data).toMatchObject({
      rootId: ROOT_ID,
      size: 15,
      mimeType: 'text/markdown; charset=utf-8',
      kind: 'other',
    });
    const listed = await (
      await app.request(`/api/projects/${projectId}/scanned-files?q=notes`, { headers: ORIGIN })
    ).json();
    expect(listed).toEqual([
      expect.objectContaining({
        path: 'notes.md',
        addedAs: [added.find((f) => f.data.path === 'notes.md')!.id],
      }),
    ]);
  });

  it('refuses paths not in the scan, dotfiles, made-up paths, duplicates and agents', async () => {
    await scan();
    expect((await addFromScan(['.env'])).status).toBe(400);
    expect((await addFromScan(['../Elsewhere/secret.txt'])).status).toBe(400);
    expect((await addFromScan(['escape.txt'])).status).toBe(400);
    expect((await addFromScan(['Company/not-scanned.pdf'])).status).toBe(400);
    expect((await addFromScan(['notes.md', 'notes.md'])).status).toBe(400);
    // Adding files is an owner-only route; a declared agent is refused before it (R7.9).
    const agent = await addFromScan(['notes.md'], { ...ORIGIN, 'x-pharos-author': 'agent:test' });
    expect(agent.status).toBe(403);
    expect(store.list('file')).toHaveLength(0);
  });
});

describe('serving', () => {
  it('shows a PDF inline with safe headers and hashes it lazily', async () => {
    await scan();
    await addFromScan(['Company/office lease.pdf']);
    const id = store.list('file')[0]!.id;
    const res = await app.request(`/api/files/${id}/content`, { headers: ORIGIN });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBe('sandbox');
    expect(res.headers.get('content-disposition')).toMatch(/^inline; /);
    expect(await res.text()).toBe('%PDF-1.4 made up');
    expect(files.scanner.entry(ROOT_ID, 'Company/office lease.pdf')!.sha256).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  it('only downloads HTML, SVG and unknown types, as octet-stream with the real name', async () => {
    for (const path of ['page.html', 'logo.svg', 'run.sh']) {
      const id = record(path);
      const res = await app.request(`/api/files/${id}/content`, { headers: ORIGIN });
      expect(res.status, path).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/octet-stream');
      expect(res.headers.get('content-disposition')).toMatch(/^attachment; /);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    }
    const id = record('계약서 "final".pdf');
    const res = await app.request(`/api/files/${id}/download`, { headers: ORIGIN });
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe(
      contentDisposition('attachment', '계약서 "final".pdf'),
    );
  });

  it('caps text previews, but downloads the whole file', async () => {
    const id = record('big.txt');
    const preview = await app.request(`/api/files/${id}/content`, { headers: ORIGIN });
    expect((await preview.text()).length).toBe(TEXT_PREVIEW_MAX_BYTES);
    expect(preview.headers.get('x-pharos-truncated')).toBe(String(TEXT_PREVIEW_MAX_BYTES));
    const download = await app.request(`/api/files/${id}/download`, { headers: ORIGIN });
    expect((await download.text()).length).toBe(TEXT_PREVIEW_MAX_BYTES + 10);
  });

  it('refuses symlinks out of the folder or to dotfiles, and serves links inside it', async () => {
    for (const path of ['escape.txt', 'linked-dir/secret.txt', 'dot-link.txt']) {
      const id = record(path);
      const res = await app.request(`/api/files/${id}/content`, { headers: ORIGIN });
      expect(res.status, path).toBe(403);
      expect(await res.text()).not.toContain('outside the folder');
      const info = (await (
        await app.request(`/api/files/${id}`, { headers: ORIGIN })
      ).json()) as FileInfo;
      expect(info).toMatchObject({ available: false, absolutePath: null });
    }
    const inner = record('inner-link.md');
    const res = await app.request(`/api/files/${inner}/content`, { headers: ORIGIN });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('# Notes\nmade up');
  });

  it('refuses a private key named .key and serves a Keynote document', async () => {
    const key = record('server.key');
    expect((await app.request(`/api/files/${key}/download`, { headers: ORIGIN })).status).toBe(403);
    const deck = record('deck.key');
    expect((await app.request(`/api/files/${deck}/download`, { headers: ORIGIN })).status).toBe(
      200,
    );
  });

  it('refuses a folder replaced by another real folder since it was added (R7.9)', async () => {
    write('pinned.txt', 'inside the folder');
    writeFileSync(join(outside, 'pinned.txt'), 'outside the folder');
    const real = realpathSync(root);
    setFolders([{ identity: await folderIdentity(real) }]);
    const id = record('pinned.txt');
    expect((await app.request(`/api/files/${id}/content`, { headers: ORIGIN })).status).toBe(200);
    renameSync(root, join(base, 'Moved away'));
    renameSync(outside, root);
    const res = await app.request(`/api/files/${id}/content`, { headers: ORIGIN });
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('outside the folder');
    expect((await scan()).error).toMatch(/replaced/);
  });

  it('can never be given a path that climbs out', () => {
    expect(() => record('../Elsewhere/secret.txt')).toThrow();
    expect(() => record('/etc/passwd')).toThrow();
    expect(() => record('a/./b.txt')).toThrow();
  });

  it('explains missing files and finds moved ones by hash', async () => {
    await scan();
    await addFromScan(['notes.md']);
    const id = store.list('file')[0]!.id;
    const ok = (await (
      await app.request(`/api/files/${id}`, { headers: ORIGIN })
    ).json()) as FileInfo;
    expect(ok).toMatchObject({
      available: true,
      missing: null,
      absolutePath: `${root}/notes.md`,
      folder: { id: ROOT_ID, label: 'Company', level: 'details' },
    });
    // Hashed when added (it is on this disk), so it can be found after a move.
    expect(store.getOfType('file', id).data.sha256).toMatch(/^[0-9a-f]{64}$/);
    mkdirSync(join(root, 'Archive'));
    renameSync(join(root, 'notes.md'), join(root, 'Archive/notes.md'));
    await scan();
    const gone = (await (
      await app.request(`/api/files/${id}`, { headers: ORIGIN })
    ).json()) as FileInfo;
    expect(gone).toMatchObject({
      available: false,
      missing: 'file-gone',
      movedTo: 'Archive/notes.md',
    });
    expect((await app.request(`/api/files/${id}/content`, { headers: ORIGIN })).status).toBe(404);

    setFolders([{ path: join(base, 'Unplugged') }]);
    expect(
      ((await (await app.request(`/api/files/${id}`, { headers: ORIGIN })).json()) as FileInfo)
        .missing,
    ).toBe('folder-unavailable');
    setFolders([]);
    const removed = await app.request(`/api/files/${id}/content`, { headers: ORIGIN });
    expect(removed.status).toBe(404);
    expect(((await removed.json()) as { error: { code: string } }).error.code).toBe(
      'folder-removed',
    );
  });
});

describe('who may ask', () => {
  it('needs this origin, or a same-origin browser GET', async () => {
    const id = record('notes.md');
    const url = `/api/files/${id}/content`;
    const status = async (headers: Record<string, string>, method = 'GET') =>
      (
        await app.request(
          url.replace('/content', method === 'POST' ? '/actions/reveal' : '/content'),
          { method, headers },
        )
      ).status;
    expect(await status({})).toBe(403);
    expect(await status({ origin: 'https://evil.example' })).toBe(403);
    expect(await status({ origin: 'http://localhost:3000' })).toBe(403);
    expect(await status({ origin: 'null' })).toBe(403);
    expect(await status({ 'sec-fetch-site': 'cross-site' })).toBe(403);
    expect(await status({ 'sec-fetch-site': 'same-site' })).toBe(403);
    expect(await status({ ...ORIGIN, 'sec-fetch-site': 'cross-site' })).toBe(403);
    expect(await status({ 'sec-fetch-site': 'same-origin' })).toBe(200);
    expect(await status({ 'sec-fetch-site': 'none' })).toBe(200);
    expect(await status(ORIGIN)).toBe(200);
    // Actions always need the Origin.
    expect(await status({ 'sec-fetch-site': 'same-origin' }, 'POST')).toBe(403);
    expect(await status(ORIGIN, 'POST')).toBe(200);
    for (const path of [`/api/files/${id}`, `/api/projects/${projectId}/scanned-files`])
      expect((await app.request(path)).status, path).toBe(403);
    expect(
      (await app.request(`/api/projects/${projectId}/files`, { method: 'POST', body: '{}' }))
        .status,
    ).toBe(403);
    expect(
      (await app.request(`/api/settings/folders/${ROOT_ID}/scan`, { method: 'POST' })).status,
    ).toBe(403);
    // Other routes keep their rules.
    expect((await app.request('/api/health')).status).toBe(200);
  });
});

describe('actions', () => {
  const act = (id: string, action: string) =>
    app.request(`/api/files/${id}/actions/${action}`, { method: 'POST', headers: ORIGIN });

  it('reveals in Finder with the real path as the only argument', async () => {
    const id = record('Company/office lease.pdf');
    expect((await act(id, 'reveal')).status).toBe(200);
    expect(opened).toEqual([['-R', realpathSync(join(root, 'Company/office lease.pdf'))]]);
  });

  it('opens documents in their app, never HTML, scripts, keys or unknown actions', async () => {
    expect((await act(record('notes.md'), 'open')).status).toBe(200);
    expect(opened).toEqual([[realpathSync(join(root, 'notes.md'))]]);
    for (const path of ['page.html', 'logo.svg', 'run.sh', 'server.key'])
      expect((await act(record(path), 'open')).status, path).toBe(403);
    expect((await act(record('escape.txt'), 'reveal')).status).toBe(403);
    expect((await act(record('deck.key'), 'delete')).status).toBe(400);
    expect(opened).toHaveLength(1);
  });

  it('works on macOS only and survives a failing open', async () => {
    write('fail', 'made up');
    const id = record('fail');
    const res = await act(id, 'reveal');
    expect(res.status).toBe(500);
    expect(logs.join('\n')).not.toContain('made up');
    const linux = createApp(store, undefined, undefined, {
      files: new FileService(store, { platform: 'linux', log: () => {} }),
    });
    const res2 = await linux.request(`/api/files/${id}/actions/reveal`, {
      method: 'POST',
      headers: ORIGIN,
    });
    expect(res2.status).toBe(400);
  });
});
