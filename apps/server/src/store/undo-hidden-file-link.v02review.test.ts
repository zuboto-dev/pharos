import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { RevisionFeed } from '../feed.js';
import { openDatabase } from './database.js';
import { Store } from './store.js';
import { FileService } from '../files/service.js';

const BROWSER = { origin: 'http://localhost', 'sec-fetch-site': 'same-origin' };

let base: string;
let home: string;
let privateFolder: string;
let store: Store;
let files: FileService;
let app: ReturnType<typeof createApp>;
let projectId: string;
let taskId: string;

beforeEach(async () => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'pharos-v02review-undo-')));
  home = join(base, 'home');
  privateFolder = join(home, 'Private');
  mkdirSync(privateFolder, { recursive: true });
  writeFileSync(join(privateFolder, 'private-note.md'), '# Made-up private note\n');

  store = new Store(openDatabase(':memory:'));
  files = new FileService(store, { log: () => {} });
  app = createApp(store, new RevisionFeed(store, 0), undefined, { folders: { home }, files });
  const human = { kind: 'human' as const, name: 'me' };
  const project = store.apply(human, {
    message: 'Set up made-up project',
    operations: [{ op: 'create', type: 'project', ref: 'p', data: { name: 'Example Co' } }],
  });
  projectId = project.created.p!;
  const task = store.apply(human, {
    message: 'Add made-up task',
    operations: [
      { op: 'create', type: 'task', ref: 't', data: { projectId, title: 'Review the plan' } },
    ],
  });
  taskId = task.created.t!;
});

afterEach(() => rmSync(base, { recursive: true, force: true }));

function owner(method: string, path: string, body?: unknown) {
  return app.request(`http://localhost${path}`, {
    method,
    headers: { ...BROWSER, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function connect() {
  const client = new Client({ name: 'Made-up undo reviewer', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
    fetch: async (url, init) => app.fetch(new Request(url, init)),
  });
  await client.connect(transport);
  return client;
}

async function call<T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
  const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
  const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
  if (result.isError) throw new Error(text);
  return JSON.parse(text) as T;
}

async function raw(client: Client, name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
  return {
    isError: result.isError === true,
    text: result.content[0]?.type === 'text' ? result.content[0].text : '',
  };
}

describe('agent undo of hidden file links', () => {
  it('refuses to revert a visible entity change that adds an owner-only fileId', async () => {
    const folderResponse = await owner('POST', '/api/settings/folders', {
      path: privateFolder,
      level: 'hidden',
    });
    const folder = (await folderResponse.json()) as { id: string };
    await files.scanner.idle(folder.id);
    const addResponse = await owner('POST', `/api/projects/${projectId}/files`, {
      files: [{ rootId: folder.id, path: 'private-note.md' }],
    });
    const added = (await addResponse.json()) as { created: Record<string, string> };
    const hiddenFileId = Object.values(added.created)[0]!;

    const linkRevision = store.apply(
      { kind: 'human', name: 'me' },
      {
        message: 'Link the private note',
        operations: [{ op: 'update', type: 'task', id: taskId, data: { fileIds: [hiddenFileId] } }],
      },
    );
    const agent = await connect();
    const seen = await call<{ data: { fileIds: string[] } }>(agent, 'get', { id: taskId });
    expect(seen.data.fileIds).toEqual([]);

    const undo = await raw(agent, 'history_revert', { revision: linkRevision.revision!.id });
    expect(undo.isError).toBe(true);
    expect(store.getOfType('task', taskId).data.fileIds).toEqual([hiddenFileId]);
  });

  it('refuses to revert a visible owner change that restores an owner-only fileId', async () => {
    const folderResponse = await owner('POST', '/api/settings/folders', {
      path: privateFolder,
      level: 'hidden',
    });
    const folder = (await folderResponse.json()) as { id: string };
    await files.scanner.idle(folder.id);
    const addResponse = await owner('POST', `/api/projects/${projectId}/files`, {
      files: [{ rootId: folder.id, path: 'private-note.md' }],
    });
    const added = (await addResponse.json()) as { created: Record<string, string> };
    const hiddenFileId = Object.values(added.created)[0]!;
    const human = { kind: 'human' as const, name: 'me' };

    store.apply(human, {
      message: 'Link a private note',
      operations: [
        {
          op: 'update',
          type: 'task',
          id: taskId,
          data: { title: 'Linked task', fileIds: [hiddenFileId] },
        },
      ],
    });
    const unlink = store.apply(human, {
      message: 'Unlink a private note',
      operations: [
        { op: 'update', type: 'task', id: taskId, data: { title: 'Unlinked task', fileIds: [] } },
      ],
    });

    const agent = await connect();
    const history = await call<{ id: number }[]>(agent, 'history_list', { projectId });
    expect(history.some((revision) => revision.id === unlink.revision!.id)).toBe(true);
    expect(JSON.stringify(history)).not.toContain(hiddenFileId);

    const undo = await raw(agent, 'history_revert', { revision: unlink.revision!.id });
    expect(undo.isError).toBe(true);
    expect(store.getOfType('task', taskId).data.fileIds).toEqual([]);
  });
});
