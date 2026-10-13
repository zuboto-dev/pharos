// R7.5 agents see file details only · Opus 5.5
// Every folder, file and word here is made up, written to a fresh temp folder; no test reads the
// owner's files.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  FILE_TEXT_REFUSAL,
  FOLDERS_SETTING,
  type Author,
  type FileFolder,
  type FolderLevel,
} from '@pharos/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { answerBrief } from './guidance.js';
import { HIDDEN_REVISION_MESSAGE, readAgentFileText } from './store/agent-files.js';
import { openDatabase } from './store/database.js';
import { projectSnapshot } from './store/snapshot.js';
import { Store } from './store/store.js';

const human: Author = { kind: 'human', name: 'me' };

const SHA = (c: string) => c.repeat(64);
// Strings that must never reach an agent: paths, folder ids and labels, hashes, notes, and
// everything about the hidden file.
const SECRETS = [
  'Lease/office-lease.pdf',
  'office-lease',
  'Notes/meeting-notes.md',
  'meeting-notes',
  'Notes/scan.pdf',
  'Private/plan-zeta.txt',
  'plan-zeta',
  'Plan Zeta',
  'root_shared01',
  'root_readable1',
  'root_vault0001',
  'Shared Things',
  'Readable Things',
  'Vault Things',
  SHA('a'),
  SHA('b'),
  SHA('c'),
  'Owner-only note about the lease',
  'Owner-only note about the vault',
  'Moved the zeta plan',
  'application/pdf',
];

let dir: string;
let store: Store;
let app: ReturnType<typeof createApp>;
let ids: {
  project: string;
  task: string;
  lease: string;
  notes: string;
  scan: string;
  escape: string;
  plan: string;
  artifact: string;
  request: string;
  addRevision: number;
  hiddenRevision: number;
};

function setFolders(levels: Partial<Record<'shared' | 'readable' | 'vault', FolderLevel>>) {
  const all: FileFolder[] = [
    {
      id: 'root_shared01',
      path: join(dir, 'Shared'),
      label: 'Shared Things',
      level: levels.shared ?? 'details',
      addedAt: '2026-10-12T10:00:00.000Z',
    },
    {
      id: 'root_readable1',
      path: join(dir, 'Readable'),
      label: 'Readable Things',
      level: levels.readable ?? 'contents',
      addedAt: '2026-10-12T10:00:00.000Z',
    },
    {
      id: 'root_vault0001',
      path: join(dir, 'Vault'),
      label: 'Vault Things',
      level: levels.vault ?? 'hidden',
      addedAt: '2026-10-12T10:00:00.000Z',
    },
  ];
  store.setSetting(FOLDERS_SETTING, all);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pharos-r75-'));
  for (const d of ['Shared/Lease', 'Readable/Notes', 'Vault/Private', 'Outside'])
    mkdirSync(join(dir, d), { recursive: true });
  writeFileSync(join(dir, 'Shared/Lease/office-lease.pdf'), '%PDF-1.4 made up');
  writeFileSync(join(dir, 'Readable/Notes/meeting-notes.md'), '# Kickoff\n\nWe chose blue.\n');
  writeFileSync(join(dir, 'Readable/Notes/scan.pdf'), '%PDF-1.4 made up');
  writeFileSync(join(dir, 'Outside/escape.md'), 'Outside the folder');
  symlinkSync(join(dir, 'Outside/escape.md'), join(dir, 'Readable/Notes/escape.md'));
  writeFileSync(join(dir, 'Vault/Private/plan-zeta.txt'), 'Vault text');

  store = new Store(openDatabase(':memory:'));
  setFolders({});
  const file = (rootId: string, path: string, title: string, extra: object = {}) => ({
    op: 'create' as const,
    type: 'file' as const,
    data: {
      projectId: '$p',
      title,
      rootId,
      path,
      size: 16,
      modifiedAt: '2026-09-01T10:00:00.000Z',
      mimeType: 'application/pdf',
      ...extra,
    },
  });
  const setup = store.apply(human, {
    message: 'Add the files',
    operations: [
      { op: 'create', type: 'project', ref: 'p', data: { name: 'Example Co' } },
      { op: 'create', type: 'task', ref: 't', data: { projectId: '$p', title: 'Renew lease' } },
      {
        ...file('root_shared01', 'Lease/office-lease.pdf', 'Lease agreement', {
          sha256: SHA('a'),
          notes: 'Owner-only note about the lease',
          issuer: 'Sample Properties',
          expiryDate: '2027-01-31',
          taskIds: ['$t'],
        }),
        ref: 'lease',
      },
      { ...file('root_readable1', 'Notes/meeting-notes.md', 'Kickoff notes'), ref: 'notes' },
      { ...file('root_readable1', 'Notes/scan.pdf', 'Scanned form'), ref: 'scan' },
      { ...file('root_readable1', 'Notes/escape.md', 'Linked note'), ref: 'escape' },
      {
        ...file('root_vault0001', 'Private/plan-zeta.txt', 'Plan Zeta', {
          sha256: SHA('c'),
          notes: 'Owner-only note about the vault',
        }),
        ref: 'plan',
      },
    ],
  });
  const c = setup.created;
  const more = store.apply(human, {
    message: 'Link the sources',
    operations: [
      {
        op: 'create',
        type: 'artifact',
        ref: 'a',
        data: { projectId: c.p!, title: 'Source', fileId: c.plan! },
      },
      {
        op: 'create',
        type: 'request',
        ref: 'r',
        data: {
          projectId: c.p!,
          question: 'What is in this?',
          about: 'File "Plan Zeta"',
          aboutId: c.plan!,
        },
      },
    ],
  });
  const hidden = store.apply(human, {
    message: 'Moved the zeta plan',
    operations: [{ op: 'update', type: 'file', id: c.plan!, data: { sha256: SHA('b') } }],
  });
  ids = {
    project: c.p!,
    task: c.t!,
    lease: c.lease!,
    notes: c.notes!,
    scan: c.scan!,
    escape: c.escape!,
    plan: c.plan!,
    artifact: more.created.a!,
    request: more.created.r!,
    addRevision: setup.revision!.id,
    hiddenRevision: hidden.revision!.id,
  };
  app = createApp(store);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function connect(name = 'test-agent') {
  const client = new Client({ name, version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('http://localhost:4300/mcp'), {
    fetch: async (url, init) => app.fetch(new Request(url, init)),
  });
  await client.connect(transport);
  return client;
}

async function raw(client: Client, name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
  const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
  return { text, isError: result.isError === true };
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const { text, isError } = await raw(client, name, args);
  if (isError) throw new Error(text);
  return JSON.parse(text);
}

function expectNoSecrets(text: string) {
  for (const secret of [...SECRETS, dir, ids.plan]) expect(text).not.toContain(secret);
}

describe('what agents see of files over MCP', () => {
  it('never shows a path, folder, hash, notes or a hidden file in any read', async () => {
    const client = await connect();
    const { project: projectId } = ids;
    const outputs: string[] = [];
    const read = async (name: string, args: Record<string, unknown>) => {
      const { text } = await raw(client, name, args);
      outputs.push(text);
      return text;
    };

    await read('project_snapshot', { projectId });
    for (const type of ['file', 'artifact', 'request', 'task'])
      await read('list', { type, projectId });
    for (const id of Object.values(ids))
      if (typeof id === 'string' && id !== ids.plan) await read('get', { id });
    await read('history_list', { projectId, limit: 200 });
    await read('history_list', { entityId: ids.plan });
    await read('history_list', { entityId: ids.lease });
    await read('history_diff', { from: 0 });
    await read('history_diff', { from: 0, projectId });
    await read('changes_since', { projectId, mark: false });
    await read('view_preview', {
      projectId,
      widgets: [
        { id: 'list', node: { component: 'DataList', query: { type: 'file' } } },
        { id: 'paths', node: { component: 'CountChart', query: { type: 'file' }, by: 'path' } },
        { id: 'roots', node: { component: 'CountChart', query: { type: 'file' }, by: 'rootId' } },
        {
          id: 'table',
          node: {
            component: 'DataTable',
            query: { type: 'file', where: { path: { exists: true } } },
            columns: [{ field: 'title' }, { field: 'path' }, { field: 'notes' }],
          },
        },
      ],
    });
    const resource = await client.readResource({
      uri: `pharos://projects/${projectId}/snapshot`,
    });
    outputs.push(JSON.stringify(resource));
    outputs.push(client.getInstructions() ?? '');
    outputs.push(answerBrief(store, [projectId]));

    for (const text of outputs) expectNoSecrets(text);

    // And they do see the details.
    const all = outputs.join('\n');
    for (const seen of ['Lease agreement', 'Sample Properties', '2027-01-31', 'Kickoff notes'])
      expect(all).toContain(seen);
  });

  it('lists the details of files in shared folders in the snapshot, with canReadText', async () => {
    const client = await connect();
    const snapshot = await call(client, 'project_snapshot', { projectId: ids.project });
    expect(snapshot.files).toEqual([
      {
        id: ids.lease,
        title: 'Lease agreement',
        kind: 'other',
        issuer: 'Sample Properties',
        expiryDate: '2027-01-31',
        tags: [],
        size: 16,
        taskIds: [ids.task],
        canReadText: false,
      },
      expect.objectContaining({ id: ids.notes, title: 'Kickoff notes', canReadText: true }),
      expect.objectContaining({ id: ids.scan, canReadText: true }),
      expect.objectContaining({ id: ids.escape, canReadText: true }),
    ]);
    expect(snapshot.requests).toEqual([
      expect.not.objectContaining({ aboutId: expect.anything() }),
    ]);
    // Both revisions also changed the hidden file, so their messages (which may name it) aren't
    // shown (R7.9).
    expect(snapshot.recentRevisions.map((r: { message: string }) => r.message)).toEqual([
      HIDDEN_REVISION_MESSAGE,
      HIDDEN_REVISION_MESSAGE,
    ]);
    expect(snapshot.unseenChanges).toBe(2);
  });

  it('shows files as only details in get and list, and hides the hidden file', async () => {
    const client = await connect();
    const lease = await call(client, 'get', { id: ids.lease });
    expect(Object.keys(lease.data).sort()).toEqual(
      ['expiryDate', 'issuer', 'kind', 'projectId', 'size', 'tags', 'taskIds', 'title'].sort(),
    );
    await expect(call(client, 'get', { id: ids.plan })).rejects.toThrow(`${ids.plan} not found`);
    // A source linked to a hidden file is hidden too (R7.9).
    await expect(call(client, 'get', { id: ids.artifact })).rejects.toThrow(
      `${ids.artifact} not found`,
    );

    const files = await call(client, 'list', { type: 'file', projectId: ids.project });
    expect(files.map((f: { id: string }) => f.id)).toEqual([
      ids.lease,
      ids.notes,
      ids.scan,
      ids.escape,
    ]);
    // No filtering by fields agents can't see, and links to hidden files match nothing.
    await expect(
      call(client, 'list', { type: 'file', where: { path: 'Private/plan-zeta.txt' } }),
    ).rejects.toThrow(/Unknown field "path"/);
    await expect(call(client, 'list', { type: 'file', where: { notes: 'x' } })).rejects.toThrow(
      /Unknown field "notes"/,
    );
    expect(await call(client, 'list', { type: 'artifact', where: { fileId: ids.plan } })).toEqual(
      [],
    );
    expect(
      await call(client, 'list', { type: 'file', where: { title: 'Lease agreement' } }),
    ).toHaveLength(1);
  });

  it('leaves hidden files out of history, and file details only in the rest', async () => {
    const client = await connect();
    const history = await call(client, 'history_list', { projectId: ids.project });
    expect(history.map((r: { message: string }) => r.message)).toEqual([
      HIDDEN_REVISION_MESSAGE,
      HIDDEN_REVISION_MESSAGE,
    ]);
    const added = history[1].changes.filter((c: { type: string }) => c.type === 'file');
    expect(added).toHaveLength(4);
    for (const change of added)
      expect(Object.keys(change.fields)).not.toEqual(
        expect.arrayContaining(['path', 'rootId', 'sha256', 'notes', 'mimeType', 'modifiedAt']),
      );
    expect(await call(client, 'history_list', { entityId: ids.plan })).toEqual([]);
    // The source linked to the hidden file is hidden with it (R7.9).
    expect(history[0].changes.map((c: { type: string }) => c.type)).toEqual(['request']);

    const changes = await call(client, 'changes_since', { projectId: ids.project });
    expect(changes.count).toBe(2);
  });

  it('previews views against file details only', async () => {
    const client = await connect();
    const preview = await call(client, 'view_preview', {
      projectId: ids.project,
      widgets: [
        { id: 'list', node: { component: 'DataList', query: { type: 'file' } } },
        {
          id: 'filtered',
          node: {
            component: 'DataList',
            query: { type: 'file', where: { path: { exists: true } } },
          },
        },
      ],
    });
    expect(preview.widgets[0].shows).toMatch(/^4 files/);
    expect(preview.widgets[1].empty).toBe(true);
  });
});

describe(`file_read_text`, () => {
  it('reads the text of a text file in a contents folder', async () => {
    const client = await connect();
    const result = await call(client, 'file_read_text', { fileId: ids.notes });
    expect(result).toEqual({
      id: ids.notes,
      title: 'Kickoff notes',
      text: '# Kickoff\n\nWe chose blue.\n',
      bytes: 26,
      truncated: false,
    });
  });

  it('refuses files in details folders, other types, hidden files and links out', async () => {
    const client = await connect();
    const refused = await raw(client, 'file_read_text', { fileId: ids.lease });
    expect(refused).toEqual({ isError: true, text: FILE_TEXT_REFUSAL });
    const pdf = await raw(client, 'file_read_text', { fileId: ids.scan });
    expect(pdf.isError).toBe(true);
    expect(pdf.text).toMatch(/isn't a text file/);
    const hidden = await raw(client, 'file_read_text', { fileId: ids.plan });
    expect(hidden).toEqual({ isError: true, text: `file ${ids.plan} not found` });
    const escape = await raw(client, 'file_read_text', { fileId: ids.escape });
    expect(escape.isError).toBe(true);
    expect(escape.text).toMatch(/can't be read now/);
    expect(escape.text).not.toContain('Outside');
    const task = await raw(client, 'file_read_text', { fileId: ids.task });
    expect(task.isError).toBe(true);
    for (const r of [refused, pdf, escape, task]) expectNoSecrets(r.text);
  });

  it('follows the folder level as the owner changes it', async () => {
    const client = await connect();
    setFolders({ readable: 'details' });
    expect(await raw(client, 'file_read_text', { fileId: ids.notes })).toEqual({
      isError: true,
      text: FILE_TEXT_REFUSAL,
    });
    setFolders({ readable: 'hidden', vault: 'contents' });
    expect((await call(client, 'file_read_text', { fileId: ids.plan })).text).toBe('Vault text');
    const files = await call(client, 'list', { type: 'file', projectId: ids.project });
    expect(files.map((f: { id: string }) => f.id)).toEqual([ids.lease, ids.plan]);
  });

  it('stops at the size limit and says so', async () => {
    const result = await readAgentFileText(store, ids.notes, 9);
    expect(result).toMatchObject({ text: '# Kickoff', bytes: 26, truncated: true });
  });

  it('treats files whose folder was removed as hidden', async () => {
    const client = await connect();
    store.setSetting(FOLDERS_SETTING, []);
    expect(await call(client, 'list', { type: 'file', projectId: ids.project })).toEqual([]);
    expect(projectSnapshot(store, ids.project).files).toEqual([]);
    expect((await raw(client, 'file_read_text', { fileId: ids.notes })).isError).toBe(true);
  });
});

describe('agent writes to files', () => {
  it('fills in details and gets back details only', async () => {
    const client = await connect();
    const result = await call(client, 'apply', {
      message: 'Fill in the issuer',
      operations: [
        { op: 'update', type: 'file', id: ids.notes, data: { issuer: 'Example board' } },
      ],
    });
    expect(result.changes).toEqual([
      expect.objectContaining({
        id: ids.notes,
        fields: { issuer: { before: null, after: 'Example board' } },
      }),
    ]);
    expectNoSecrets(JSON.stringify(result));
  });

  it("can't touch a hidden file, write notes, or link a hidden file", async () => {
    const client = await connect();
    const apply = (operations: unknown[]) => raw(client, 'apply', { message: 'Try', operations });
    const hidden = await apply([
      { op: 'update', type: 'file', id: ids.plan, data: { tags: ['x'] } },
    ]);
    expect(hidden.text).toMatch(/file .* not found/);
    const notes = await raw(client, 'apply', {
      message: 'Try',
      operations: [{ op: 'update', type: 'file', id: ids.lease, data: { notes: 'Overwrite' } }],
    });
    expect(notes.isError).toBe(true);
    // The store refuses notes from agents through REST as well.
    expect(() =>
      store.apply(
        { kind: 'agent', name: 'rest-agent' },
        {
          message: 'Try',
          operations: [{ op: 'update', type: 'file', id: ids.lease, data: { notes: 'x' } }],
        },
      ),
    ).toThrow(/notes are the owner's/);
    const link = await apply([
      { op: 'update', type: 'artifact', id: ids.artifact, data: { fileId: ids.plan } },
    ]);
    expect(link.text).toMatch(/can't set fileId/);
    // Deleting a task unlinks it from files; the agent sees that, but no path.
    const deleted = await call(client, 'apply', {
      message: 'Drop the task',
      operations: [{ op: 'delete', type: 'task', id: ids.task }],
    });
    expect(deleted.changes).toContainEqual(
      expect.objectContaining({ id: ids.lease, fields: { taskIds: expect.anything() } }),
    );
    expectNoSecrets(JSON.stringify(deleted));
  });

  it("can't recreate, remove or move a file, or touch a hidden one, with history_revert", async () => {
    const client = await connect();
    const removed = store.apply(human, {
      message: 'Remove the scan',
      operations: [{ op: 'delete', type: 'file', id: ids.scan }],
    });
    const recreate = await raw(client, 'history_revert', { revision: removed.revision!.id });
    expect(recreate.text).toMatch(/removed a file that can't come back/);
    expect(store.get(ids.scan)).toBeNull();

    const remove = await raw(client, 'history_revert', { revision: ids.addRevision });
    expect(remove.isError).toBe(true);
    expect(store.get(ids.lease)).not.toBeNull();

    const hidden = await raw(client, 'history_revert', { revision: ids.hiddenRevision });
    expect(hidden).toEqual({ isError: true, text: `Revision ${ids.hiddenRevision} not found` });

    const moved = store.apply(human, {
      message: 'Rescanned',
      operations: [{ op: 'update', type: 'file', id: ids.lease, data: { path: 'Lease/new.pdf' } }],
    });
    const move = await raw(client, 'history_revert', { revision: moved.revision!.id });
    expect(move.text).toMatch(/where a file is on disk/);

    // Only Pharos links a source to a file (R7.6): a revert can't set or drop the link.
    const linked = store.apply(
      { kind: 'system', name: 'pharos' },
      {
        message: 'Link the source to its file',
        operations: [
          { op: 'update', type: 'artifact', id: ids.artifact, data: { fileId: ids.lease } },
        ],
      },
    );
    const unlink = await raw(client, 'history_revert', { revision: linked.revision!.id });
    expect(unlink.text).toMatch(/which file a source is linked to/);
    expect(store.getOfType('artifact', ids.artifact).data.fileId).toBe(ids.lease);
    const dropped = store.apply(human, {
      message: 'Drop the source',
      operations: [{ op: 'delete', type: 'artifact', id: ids.artifact }],
    });
    const relink = await raw(client, 'history_revert', { revision: dropped.revision!.id });
    expect(relink.text).toMatch(/which file a source is linked to/);
    expect(store.get(ids.artifact)).toBeNull();

    // An agent can still undo a details edit.
    const edit = await call(client, 'apply', {
      message: 'Tag it',
      operations: [{ op: 'update', type: 'file', id: ids.lease, data: { tags: ['lease'] } }],
    });
    await call(client, 'history_revert', { revision: edit.revision.id });
    expect(store.getOfType('file', ids.lease).data.tags).toEqual([]);

    // People can still revert anything.
    store.revert(removed.revision!.id, human);
    expect(store.get(ids.scan)).not.toBeNull();
  });

  it('filters agent-authored REST writes the same way', async () => {
    const res = await app.fetch(
      new Request('http://localhost:4300/api/apply', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-pharos-author': 'agent:Claude Code',
          origin: 'http://localhost:5173',
        },
        body: JSON.stringify({
          message: 'Fill in a tag',
          operations: [{ op: 'update', type: 'file', id: ids.lease, data: { tags: ['lease'] } }],
        }),
      }),
    );
    expect(res.status).toBe(200);
    expectNoSecrets(await res.text());
    const revert = await app.fetch(
      new Request(`http://localhost:4300/api/revisions/${ids.hiddenRevision}/revert`, {
        method: 'POST',
        headers: { 'x-pharos-author': 'agent:Claude Code', origin: 'http://localhost:5173' },
      }),
    );
    expect(revert.status).toBe(404);
  });
});
