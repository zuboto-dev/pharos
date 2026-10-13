import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { FolderRequest } from '@pharos/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { RevisionFeed } from '../feed.js';
import { openDatabase } from '../store/database.js';
import { Store } from '../store/store.js';
import { FileService } from './service.js';

const BROWSER = { origin: 'http://localhost', 'sec-fetch-site': 'same-origin' };

let base: string;
let home: string;
let company: string;
let store: Store;
let files: FileService;
let app: ReturnType<typeof createApp>;
let projectId: string;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'pharos-v02review-hardlink-')));
  home = join(base, 'home');
  company = join(home, 'Company');
  mkdirSync(company, { recursive: true });
  writeFileSync(join(company, '.env'), 'MADE_UP_TOKEN=made-up-secret-canary\n');
  // The allowed extension masks the fact that this is the same inode as the excluded .env.
  linkSync(join(company, '.env'), join(company, 'shared-notes.md'));

  store = new Store(openDatabase(':memory:'));
  files = new FileService(store, { log: () => {} });
  app = createApp(store, new RevisionFeed(store, 0), undefined, { folders: { home }, files });
  const { created } = store.apply(
    { kind: 'human', name: 'me' },
    {
      message: 'Set up made-up project',
      operations: [{ op: 'create', type: 'project', ref: 'p', data: { name: 'Example Co' } }],
    },
  );
  projectId = created.p!;
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
  const client = new Client({ name: 'Made-up reviewer agent', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
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

async function call<T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
  const result = await raw(client, name, args);
  if (result.isError) throw new Error(result.text);
  return JSON.parse(result.text) as T;
}

describe('secret hard-link boundary', () => {
  it('never exposes a secret through an allowed alias in an approved contents folder', async () => {
    const agent = await connect();
    const request = await call<{ id: string }>(agent, 'folder_request', {
      path: company,
      level: 'contents',
      reason: 'Made-up notes for the made-up project',
      projectId,
    });
    const response = await owner('POST', `/api/settings/folder-requests/${request.id}/approve`);
    expect(response.status).toBe(200);
    const approved = (await response.json()) as FolderRequest;
    const folderId = approved.folderId!;
    await files.scanner.idle(folderId);

    const unadded = await call<{ path: string }[]>(agent, 'files_unadded', { projectId });
    expect(unadded.map((file) => file.path)).not.toContain('.env');

    const add = await raw(agent, 'apply', {
      message: 'Add made-up notes',
      operations: [
        {
          op: 'create',
          type: 'file',
          ref: 'f',
          data: { projectId, rootId: folderId, path: 'shared-notes.md' },
        },
      ],
    });
    // Excluding the alias in the scan or refusing it at add time are both valid protections.
    // If it gets added, reading it must still refuse the secret contents.
    if (add.isError) {
      expect(add.text).not.toContain('made-up-secret-canary');
      return;
    }
    const added = JSON.parse(add.text) as { created: Record<string, string> };
    const read = await raw(agent, 'file_read_text', { fileId: added.created.f! });
    expect(read.text).not.toContain('made-up-secret-canary');
    expect(read.isError).toBe(true);
  });
});

describe('folder request approval boundary', () => {
  it('does not approve a different folder placed at the requested path afterward', async () => {
    const privateFolder = join(home, 'Private');
    mkdirSync(privateFolder, { recursive: true });
    writeFileSync(join(privateFolder, 'unapproved-plan.md'), '# Made-up private plan\n');

    const agent = await connect();
    const request = await call<{ id: string }>(agent, 'folder_request', {
      path: company,
      level: 'contents',
      reason: 'Made-up notes for the made-up project',
      projectId,
    });

    rmSync(company, { recursive: true, force: true });
    symlinkSync(privateFolder, company);
    const approval = await owner('POST', `/api/settings/folder-requests/${request.id}/approve`);
    expect.soft(approval.status).toBeGreaterThanOrEqual(400);
    expect.soft(approval.status).toBeLessThan(500);
    if (approval.ok) {
      const approved = (await approval.json()) as FolderRequest;
      if (approved.folderId) await files.scanner.idle(approved.folderId);
    }

    const unadded = await call<{ path: string }[]>(agent, 'files_unadded', { projectId });
    expect(unadded.map((file) => file.path)).not.toContain('unapproved-plan.md');
  });
});
