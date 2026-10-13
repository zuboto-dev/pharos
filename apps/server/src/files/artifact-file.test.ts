// R7.6 claim sources on disk open · Opus 5.5
// Every folder, path and document here is made up, in a temporary folder; no test reads the
// owner's files.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  type ArtifactFileMatch,
  type Author,
  FOLDERS_SETTING,
  type FileFolder,
} from '@pharos/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { RevisionFeed } from '../feed.js';
import { openDatabase } from '../store/database.js';
import { Store } from '../store/store.js';
import {
  artifactLinkOperations,
  linkArtifacts,
  localPathOf,
  matchArtifactFile,
} from './artifact-file.js';

const human: Author = { kind: 'human', name: 'me' };
const agent: Author = { kind: 'agent', name: 'test-agent' };

const LEASE = 'Office lease between Example Co and Made-up Landlord Ltd. Rent: 1,000 a month.\n';
const RECEIPT = 'Receipt 0001 from Example Supplier: 3 chairs.\n';

let dir: string;
let folderPath: string;
let outside: string;
let store: Store;
let projectId: string;

function folder(): FileFolder {
  return {
    id: 'root_fixture1',
    path: folderPath,
    label: 'Company',
    level: 'details',
    addedAt: '2026-10-01T00:00:00.000Z',
  };
}

function write(path: string, text: string): string {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
  return path;
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

beforeEach(() => {
  // Real paths, so the folder as typed and as resolved are the same (macOS /var → /private/var).
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'pharos-r76-')));
  folderPath = join(dir, 'Company');
  outside = join(dir, 'Downloads');
  write(join(folderPath, 'Leases/office-lease.pdf'), LEASE);
  write(join(folderPath, 'Receipts/2026/receipt-0001.pdf'), RECEIPT);
  write(join(outside, 'receipt from email.pdf'), RECEIPT);
  store = new Store(openDatabase(':memory:'));
  store.setSetting(FOLDERS_SETTING, [folder()]);
  const { created } = store.apply(human, {
    message: 'Set up',
    operations: [{ op: 'create', type: 'project', ref: 'p', data: { name: 'Example Co' } }],
  });
  projectId = created.p!;
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function addFile(path: string, text: string, withHash = true): string {
  const { created } = store.apply(human, {
    message: 'Add a file',
    operations: [
      {
        op: 'create',
        type: 'file',
        ref: 'f',
        data: {
          projectId,
          title: path,
          rootId: 'root_fixture1',
          path,
          size: Buffer.byteLength(text),
          modifiedAt: '2026-10-01T00:00:00.000Z',
          ...(withHash ? { sha256: sha(text) } : {}),
        },
      },
    ],
  });
  return created.f!;
}

function addSource(uri: string | undefined, title = 'A source'): string {
  const { created } = store.apply(human, {
    message: 'Add a source',
    operations: [
      {
        op: 'create',
        type: 'artifact',
        ref: 'a',
        data: { projectId, title, ...(uri ? { uri } : {}) },
      },
    ],
  });
  return created.a!;
}

describe('localPathOf', () => {
  it('reads absolute paths, file URLs and ~, and nothing else', () => {
    expect(localPathOf('/Users/someone/Docs/a.pdf')).toBe('/Users/someone/Docs/a.pdf');
    expect(localPathOf('/Users/someone/Docs/../Docs/a.pdf')).toBe('/Users/someone/Docs/a.pdf');
    expect(localPathOf(pathToFileURL('/tmp/made up/a.pdf').href)).toBe('/tmp/made up/a.pdf');
    expect(localPathOf('~/Docs/a.pdf')).toBe(join(homedir(), 'Docs/a.pdf'));
    expect(localPathOf('https://example.com/a.pdf')).toBeNull();
    expect(localPathOf('docs/a.md')).toBeNull();
    expect(localPathOf('')).toBeNull();
    expect(localPathOf(undefined)).toBeNull();
  });
});

describe('matching a claim source to a project file', () => {
  it('matches by folder and path', async () => {
    const fileId = addFile('Leases/office-lease.pdf', LEASE);
    const artifactId = addSource(join(folderPath, 'Leases/office-lease.pdf'));
    expect(await matchArtifactFile(store, artifactId)).toEqual({ state: 'linked', fileId });
  });

  it('finds a moved source by its contents, with or without a stored hash', async () => {
    const artifactId = addSource(join(outside, 'receipt from email.pdf'));
    const withHash = addFile('Receipts/2026/receipt-0001.pdf', RECEIPT);
    expect(await matchArtifactFile(store, artifactId)).toEqual({
      state: 'linked',
      fileId: withHash,
    });
    store.apply(human, {
      message: 'Remove it',
      operations: [{ op: 'delete', type: 'file', id: withHash }],
    });
    // The scan hasn't hashed this one yet: it's hashed on disk, inside its folder.
    const withoutHash = addFile('Receipts/2026/receipt-0001.pdf', RECEIPT, false);
    expect(await matchArtifactFile(store, artifactId)).toEqual({
      state: 'linked',
      fileId: withoutHash,
    });
  });

  it('says where an unmatched source is: in a folder but not added, or not in a folder', async () => {
    addFile('Leases/office-lease.pdf', LEASE);
    const inFolder = addSource(join(folderPath, 'Receipts/2026/receipt-0001.pdf'));
    expect(await matchArtifactFile(store, inFolder)).toEqual({
      state: 'in-folder',
      rootId: 'root_fixture1',
      path: 'Receipts/2026/receipt-0001.pdf',
    } satisfies ArtifactFileMatch);
    expect(
      await matchArtifactFile(store, addSource(join(outside, 'receipt from email.pdf'))),
    ).toEqual({ state: 'not-in-folder' });
    expect(await matchArtifactFile(store, addSource('/nowhere/made-up.pdf'))).toEqual({
      state: 'not-in-folder',
    });
    expect(await matchArtifactFile(store, addSource('notes/made-up.md'))).toEqual({
      state: 'not-in-folder',
    });
    expect(await matchArtifactFile(store, addSource('https://example.com/a'))).toEqual({
      state: 'none',
    });
    expect(await matchArtifactFile(store, addSource(undefined))).toEqual({ state: 'none' });
  });

  it('never matches a dotfile, and only files of the same project', async () => {
    write(join(folderPath, '.secret/key.txt'), LEASE);
    expect(await matchArtifactFile(store, addSource(join(folderPath, '.secret/key.txt')))).toEqual({
      state: 'not-in-folder',
    });
    addFile('Leases/office-lease.pdf', LEASE);
    const { created } = store.apply(human, {
      message: 'Another project',
      operations: [
        { op: 'create', type: 'project', ref: 'q', data: { name: 'Other Co' } },
        {
          op: 'create',
          type: 'artifact',
          ref: 'a',
          data: {
            projectId: '$q',
            title: 'Lease',
            uri: join(folderPath, 'Leases/office-lease.pdf'),
          },
        },
      ],
    });
    expect(await matchArtifactFile(store, created.a!)).toMatchObject({ state: 'in-folder' });
  });
});

describe('linking artifact.fileId', () => {
  it('links matched sources in one revision and leaves the rest', async () => {
    const lease = addSource(join(folderPath, 'Leases/office-lease.pdf'), 'Lease');
    const receipt = addSource(join(outside, 'receipt from email.pdf'), 'Receipt');
    const web = addSource('https://example.com/a', 'Web');
    expect(await artifactLinkOperations(store, projectId)).toEqual([]);
    const leaseFile = addFile('Leases/office-lease.pdf', LEASE);
    const receiptFile = addFile('Receipts/2026/receipt-0001.pdf', RECEIPT);
    const before = store.latestRevisionId();
    expect(await linkArtifacts(store, projectId)).toBe(2);
    expect(store.latestRevisionId()).toBe(before + 1);
    expect(store.getOfType('artifact', lease).data.fileId).toBe(leaseFile);
    expect(store.getOfType('artifact', receipt).data.fileId).toBe(receiptFile);
    expect(store.getOfType('artifact', web).data.fileId).toBeUndefined();
    expect(await linkArtifacts(store, projectId)).toBe(0);
  });

  it('links sources as soon as a file is added, through the revision feed', async () => {
    const app = createApp(store, new RevisionFeed(store, 0));
    const lease = addSource(join(folderPath, 'Leases/office-lease.pdf'));
    const fileId = addFile('Leases/office-lease.pdf', LEASE);
    await expect
      .poll(() => store.getOfType('artifact', lease).data.fileId, { timeout: 2000 })
      .toBe(fileId);
    const page = { headers: { 'sec-fetch-site': 'same-origin' } };
    const res = await app.request(`/api/artifacts/${lease}/file`, page);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ state: 'linked', fileId });
    expect((await app.request('/api/artifacts/artifact_missing/file', page)).status).toBe(404);
  });

  it("doesn't let agents set fileId", () => {
    const fileId = addFile('Leases/office-lease.pdf', LEASE);
    const artifactId = addSource(join(folderPath, 'Leases/office-lease.pdf'));
    expect(() =>
      store.apply(agent, {
        message: 'Link',
        operations: [{ op: 'update', type: 'artifact', id: artifactId, data: { fileId } }],
      }),
    ).toThrow(/agents can't set fileId/);
    expect(() =>
      store.apply(agent, {
        message: 'Add',
        operations: [{ op: 'create', type: 'artifact', data: { projectId, title: 'x', fileId } }],
      }),
    ).toThrow(/agents can't set fileId/);
    // Everything else about an artifact stays theirs to edit.
    store.apply(agent, {
      message: 'Retitle',
      operations: [{ op: 'update', type: 'artifact', id: artifactId, data: { title: 'Lease' } }],
    });
  });
});
