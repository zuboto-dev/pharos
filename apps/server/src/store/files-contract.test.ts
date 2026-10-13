// R7.1 contract: files in the store, the scan cache migration and the folder setting · Opus 5.5
// Every folder, path and document here is made up; no test reads the owner's files.
import {
  FOLDERS_SETTING,
  FileFolders,
  type Author,
  type FileFolder,
  type Operation,
} from '@pharos/schema';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from './database.js';
import { Store } from './store.js';

const human: Author = { kind: 'human', name: 'me' };
const agent: Author = { kind: 'agent', name: 'test-agent' };

let store: Store;
let projectId: string;
let taskId: string;
beforeEach(() => {
  store = new Store(openDatabase(':memory:'));
  const { created } = store.apply(human, {
    message: 'Set up',
    operations: [
      {
        op: 'create',
        type: 'project',
        ref: 'p',
        data: {
          name: 'Example Co',
          options: {
            'file.kind': [
              { value: 'paper', label: 'Paper', meaning: 'other' },
              { value: 'deal', label: 'Deal', meaning: 'contract' },
            ],
          },
        },
      },
      { op: 'create', type: 'task', ref: 't', data: { projectId: '$p', title: 'Renew lease' } },
    ],
  });
  projectId = created.p!;
  taskId = created.t!;
});

const fileData = () => ({
  projectId,
  title: 'Office lease',
  rootId: 'root_fixture1',
  path: 'Company/office-lease.pdf',
  size: 2048,
  modifiedAt: '2026-09-01T10:00:00.000Z',
  mimeType: 'application/pdf',
  taskIds: [taskId],
});

function addFile(): string {
  const { created } = store.apply(human, {
    message: 'Add the lease',
    operations: [{ op: 'create', type: 'file', ref: 'f', data: fileData() }],
  });
  return created.f!;
}

const run = (author: Author, ...operations: Operation[]) =>
  store.apply(author, { message: 'test', operations });

describe('files in the store', () => {
  it('adds a file as one revision, with the project value for the default kind', () => {
    const before = store.latestRevisionId();
    const id = addFile();
    expect(store.latestRevisionId()).toBe(before + 1);
    const file = store.getOfType('file', id);
    expect(file.data).toMatchObject({ kind: 'paper', tags: [], taskIds: [taskId] });
    expect(store.dataset(projectId).files.map((f) => f.id)).toEqual([id]);
  });

  it('checks the kind against the project options and the path against the schema', () => {
    expect(() =>
      run(human, { op: 'create', type: 'file', data: { ...fileData(), kind: 'invoice' } }),
    ).toThrow(/kind/);
    expect(() =>
      run(human, { op: 'create', type: 'file', data: { ...fileData(), path: '../x.pdf' } }),
    ).toThrow();
  });

  it('lets agents fill in details but never add, remove or move a file', () => {
    // Agents only see files in folders the owner shares with them (R7.5).
    store.setSetting(FOLDERS_SETTING, [
      {
        id: 'root_fixture1',
        path: '/tmp/pharos-fixture/Company',
        label: 'Company',
        level: 'details',
        addedAt: '2026-10-12T10:00:00.000Z',
      },
    ]);
    const id = addFile();
    run(agent, {
      op: 'update',
      type: 'file',
      id,
      data: { issuer: 'Sample Properties LLC', expiryDate: '2026-12-31', kind: 'deal' },
    });
    expect(store.getOfType('file', id).data).toMatchObject({
      issuer: 'Sample Properties LLC',
      kind: 'deal',
    });
    expect(() => run(agent, { op: 'create', type: 'file', data: fileData() })).toThrow(
      /agents can't add files/,
    );
    expect(() => run(agent, { op: 'delete', type: 'file', id })).toThrow(
      /agents can't remove files/,
    );
    expect(() =>
      run(agent, { op: 'update', type: 'file', id, data: { path: 'Elsewhere/x.pdf' } }),
    ).toThrow(/path come from the folder scan/);
    expect(store.getOfType('file', id).data.path).toBe('Company/office-lease.pdf');
  });

  it('unsets links when a task or a file is deleted', () => {
    const fileId = addFile();
    const { created } = run(human, {
      op: 'create',
      type: 'artifact',
      ref: 'a',
      data: { projectId, title: 'Lease', uri: '/x/Company/office-lease.pdf', fileId },
    });
    run(human, { op: 'delete', type: 'task', id: taskId });
    expect(store.getOfType('file', fileId).data.taskIds).toEqual([]);
    run(human, { op: 'delete', type: 'file', id: fileId });
    expect(store.getOfType('artifact', created.a!).data.fileId).toBeUndefined();
  });
});

describe('folders and the scan cache', () => {
  it('keeps folders as an app setting, not revisions', () => {
    const folders: FileFolder[] = [
      {
        id: 'root_fixture1',
        path: '/tmp/pharos-fixture/Company',
        label: 'Company',
        level: 'details',
        addedAt: '2026-10-12T10:00:00.000Z',
      },
    ];
    const before = store.latestRevisionId();
    store.setSetting(FOLDERS_SETTING, FileFolders.parse(folders));
    expect(FileFolders.parse(store.setting(FOLDERS_SETTING))).toEqual(folders);
    expect(store.latestRevisionId()).toBe(before);
  });

  it('creates the scan cache tables, keyed by folder and path', () => {
    const db = openDatabase(':memory:');
    db.prepare(
      `INSERT INTO file_scan (root_id, path, size, modified_at, mime_type, seen_at)
       VALUES ('root_fixture1', 'a.pdf', 1, '2026-01-01T00:00:00.000Z', 'application/pdf', '2026-01-01T00:00:00.000Z')`,
    ).run();
    expect(() =>
      db
        .prepare(
          `INSERT INTO file_scan (root_id, path, size, modified_at, mime_type, seen_at)
           VALUES ('root_fixture1', 'a.pdf', 2, '', '', '')`,
        )
        .run(),
    ).toThrow(/UNIQUE/);
    db.prepare(
      `INSERT INTO file_scan_status (root_id, started_at) VALUES ('root_fixture1', '')`,
    ).run();
    expect(db.prepare('SELECT sha256 FROM file_scan').get()).toEqual({ sha256: null });
  });
});
