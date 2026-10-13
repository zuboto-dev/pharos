// R7.12 agents add files from approved folders and link them · Opus 5.5
// Every folder, file and word here is made up, written to a fresh temp folder; no test reads the
// owner's files or talks to a running server (MCP and REST go through app.fetch).
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  FOLDERS_SETTING,
  runQuery,
  type Author,
  type FileFolder,
  type FolderRequest,
  type MentionedFile,
} from '@pharos/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { RevisionFeed } from '../feed.js';
import { openDatabase } from '../store/database.js';
import { Store } from '../store/store.js';
import { matchArtifactFile } from './artifact-file.js';
import { savedFolders } from './folders.js';
import { FileService } from './service.js';

const human: Author = { kind: 'human', name: 'me' };
const BROWSER = { origin: 'http://localhost', 'sec-fetch-site': 'same-origin' };
const AGENT = { 'x-pharos-author': 'agent:Opus 5.5' };

let base: string;
let home: string;
let company: string;
let outside: string;
let store: Store;
let files: FileService;
let app: ReturnType<typeof createApp>;
let projectId: string;
let hiddenFileId: string;

function write(path: string, text: string) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

beforeEach(async () => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'pharos-r712-')));
  home = join(base, 'home');
  company = join(home, 'Company');
  outside = join(base, 'Elsewhere');
  write(join(company, 'certificate.pdf'), '%PDF-1.4 made-up certificate\n');
  write(join(company, 'tax-letter.pdf'), '%PDF-1.4 made-up tax letter\n');
  write(join(company, 'notes.md'), '# Made-up notes\n');
  write(join(company, 'seal.png'), 'not really a png');
  write(join(company, 'credentials.json'), '{"token": "made-up"}');
  write(join(company, 'archive.zip'), 'zip');
  write(join(home, 'Vault', 'plan-zeta.txt'), 'made-up hidden plan');
  write(join(outside, 'secret-target.txt'), 'outside the folder');
  mkdirSync(join(home, '.ssh'), { recursive: true });
  store = new Store(openDatabase(':memory:'));
  files = new FileService(store, { log: () => {} });
  app = createApp(store, new RevisionFeed(store, 0), undefined, { folders: { home }, files });
  const { created } = store.apply(human, {
    message: 'Set up',
    operations: [{ op: 'create', type: 'project', ref: 'p', data: { name: 'Example Co' } }],
  });
  projectId = created.p!;
  // The owner's own hidden folder, with one file added by the owner.
  const vault = await owner('POST', '/api/settings/folders', {
    path: join(home, 'Vault'),
    level: 'hidden',
  });
  const vaultId = ((await vault.json()) as FileFolder).id;
  await files.scanner.idle(vaultId);
  const added = await owner('POST', `/api/projects/${projectId}/files`, {
    files: [{ rootId: vaultId, path: 'plan-zeta.txt' }],
  });
  hiddenFileId = Object.values(
    ((await added.json()) as { created: Record<string, string> }).created,
  )[0]!;
});
afterEach(() => rmSync(base, { recursive: true, force: true }));

function owner(method: string, path: string, body?: unknown, headers = BROWSER) {
  return app.request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function connect(name = 'Opus 5.5') {
  const client = new Client({ name, version: '1.0.0' });
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

async function call<T = Record<string, unknown>>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { text, isError } = await raw(client, name, args);
  if (isError) throw new Error(text);
  return JSON.parse(text) as T;
}

/** The agent asks for the Company folder for the project; the owner approves it. */
async function approvedCompany(client: Client): Promise<string> {
  const asked = await call<{ id: string }>(client, 'folder_request', {
    path: company,
    reason: 'To keep the made-up company papers',
    projectId,
  });
  const res = await owner('POST', `/api/settings/folder-requests/${asked.id}/approve`);
  expect(res.status).toBe(200);
  const { folderId } = (await res.json()) as FolderRequest;
  await files.scanner.idle(folderId!);
  return folderId!;
}

const vaultId = () => savedFolders(store).find((f) => f.level === 'hidden')!.id;

async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
  return check();
}

describe('folder requests', () => {
  it('records a request once; only the owner, on the Pharos page, approves it', async () => {
    const client = await connect();
    const first = await call<{ id: string; status: string; next: string }>(
      client,
      'folder_request',
      { path: company, reason: 'To keep the made-up company papers', projectId },
    );
    expect(first).toMatchObject({ status: 'pending', path: company, level: 'details' });
    expect(first.next).toMatch(/Approve/);
    // Asking again collapses into the same request.
    const again = await call<{ id: string }>(client, 'folder_request', {
      path: `${company}/`,
      reason: 'Again',
    });
    expect(again.id).toBe(first.id);
    expect(await call<unknown[]>(client, 'folder_request_status', {})).toHaveLength(1);

    // Agents can't list, approve or decline over REST, whatever headers they send.
    const url = `/api/settings/folder-requests/${first.id}/approve`;
    expect(
      (await owner('GET', '/api/settings/folder-requests', undefined, { ...BROWSER, ...AGENT }))
        .status,
    ).toBe(403);
    expect((await owner('POST', url, undefined, { ...BROWSER, ...AGENT })).status).toBe(403);
    expect((await owner('POST', url, undefined, {} as typeof BROWSER)).status).toBe(403);
    expect(
      (
        await owner('POST', `/api/settings/folder-requests/${first.id}/decline`, undefined, {
          ...BROWSER,
          ...AGENT,
        })
      ).status,
    ).toBe(403);
    // There is no MCP tool to approve.
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).filter((n) => /approve|decline/.test(n))).toEqual([]);
    expect(savedFolders(store).map((f) => f.path)).not.toContain(company);

    const list = await owner('GET', '/api/settings/folder-requests');
    expect(((await list.json()) as FolderRequest[]).map((r) => r.status)).toEqual(['pending']);
    const approved = await owner('POST', url);
    expect(approved.status).toBe(200);
    const request = (await approved.json()) as FolderRequest;
    expect(request).toMatchObject({
      status: 'approved',
      folderId: expect.stringMatching(/^root_/),
    });
    // Added exactly like "Add folder": the level asked for, its identity pinned, then scanned.
    const folder = savedFolders(store).find((f) => f.id === request.folderId)!;
    expect(folder).toMatchObject({ path: company, level: 'details', label: 'Company' });
    expect(folder.identity).toMatch(/^\d+:\d+$/);
    await files.scanner.idle(folder.id);
    expect(files.scanner.status(folder.id).files).toBeGreaterThan(0);
    expect((await owner('POST', url)).status).toBe(409);
    const status = await call<{ status: string; folderId: string }[]>(
      client,
      'folder_request_status',
      { requestId: first.id },
    );
    expect(status[0]).toMatchObject({ status: 'approved', folderId: folder.id });
  });

  it('keeps a declined folder declined, and checks paths like "Add folder"', async () => {
    const client = await connect();
    const asked = await call<{ id: string }>(client, 'folder_request', {
      path: company,
      reason: 'To keep the made-up company papers',
    });
    const declined = await owner('POST', `/api/settings/folder-requests/${asked.id}/decline`);
    expect(((await declined.json()) as FolderRequest).status).toBe('declined');
    const again = await call<{ id: string; status: string }>(client, 'folder_request', {
      path: company,
      reason: 'Please?',
    });
    expect(again).toMatchObject({ id: asked.id, status: 'declined' });
    expect((await owner('POST', `/api/settings/folder-requests/${asked.id}/approve`)).status).toBe(
      409,
    );
    expect(savedFolders(store).some((f) => f.path === company)).toBe(false);

    const refused = async (path: string) =>
      (await raw(client, 'folder_request', { path, reason: 'x' })).text;
    expect(await refused('/usr')).toMatch(/system folder/);
    expect(await refused(home)).toMatch(/home folder is too broad/);
    expect(await refused(join(home, '.ssh'))).toMatch(/never shared/);
    expect(await refused(join(home, 'Nowhere'))).toMatch(/No folder/);
    expect(await refused(join(company, 'notes.md'))).toMatch(/not a folder/);
    expect(await refused('relative/path')).toMatch(/absolute/);
    // Inside a folder the owner hid: refused, never widened.
    expect(await refused(join(home, 'Vault'))).toMatch(/keeps this folder from agents/);
    expect(await refused(home.slice(0, home.lastIndexOf('/')))).toMatch(/home folder|contains/);
  });

  it('answers at once for a folder inside one the owner already shares', async () => {
    const shared = await owner('POST', '/api/settings/folders', { path: company });
    const folder = (await shared.json()) as FileFolder;
    mkdirSync(join(company, 'Sub'));
    const client = await connect();
    const asked = await call<{ status: string; folderId: string }>(client, 'folder_request', {
      path: join(company, 'Sub'),
      reason: 'Sub papers',
      projectId,
    });
    expect(asked).toMatchObject({ status: 'approved', folderId: folder.id });
    expect(savedFolders(store)).toHaveLength(2);
  });
});

describe('agents add files from approved folders', () => {
  it('lists what it may add: no secrets, no unknown types, nothing hidden, no contents', async () => {
    const client = await connect();
    expect(await call<unknown[]>(client, 'files_unadded', { projectId })).toEqual([]);
    const folderId = await approvedCompany(client);
    const listed = await call<{ folderId: string; path: string; type: string }[]>(
      client,
      'files_unadded',
      { projectId },
    );
    expect(listed.map((f) => f.path).sort()).toEqual([
      'certificate.pdf',
      'notes.md',
      'seal.png',
      'tax-letter.pdf',
    ]);
    expect(listed[0]).toMatchObject({ folderId, type: expect.any(String) });
    const text = JSON.stringify(listed);
    for (const never of ['credentials', 'archive.zip', 'plan-zeta', 'Vault', 'made-up certificate'])
      expect(text).not.toContain(never);
    expect((await raw(client, 'files_unadded', { projectId, folderId: vaultId() })).text).toMatch(
      /not found/,
    );
  });

  it('adds a scanned file with the scan fields from the scan, and links it in one apply', async () => {
    const client = await connect();
    const folderId = await approvedCompany(client);
    const result = await call<{ created: Record<string, string> }>(client, 'apply', {
      message: 'Add the certificate and the renewal',
      operations: [
        {
          op: 'create',
          type: 'file',
          ref: 'f1',
          data: {
            projectId,
            rootId: folderId,
            path: 'certificate.pdf',
            kind: 'certificate',
            tags: ['reg'],
          },
        },
        {
          op: 'update',
          type: 'file',
          id: '$f1',
          data: { issuer: 'Made-up Registry', expiryDate: '2027-01-31' },
        },
        {
          op: 'create',
          type: 'task',
          ref: 't',
          data: { projectId, title: 'Renew', fileIds: ['$f1'] },
        },
      ],
    });
    const file = store.getOfType('file', result.created.f1!);
    expect(file.data).toMatchObject({
      title: 'certificate',
      rootId: folderId,
      path: 'certificate.pdf',
      size: '%PDF-1.4 made-up certificate\n'.length,
      mimeType: 'application/pdf',
      issuer: 'Made-up Registry',
      tags: ['reg'],
    });
    expect(store.getOfType('task', result.created.t!).data.fileIds).toEqual([file.id]);
    // Queries find what a file is linked to.
    const linked = runQuery(store.dataset(projectId), 'task', { where: { fileIds: file.id } });
    expect(linked.map((t) => t.id)).toEqual([result.created.t]);
    // The owner deleting the file unsets the link.
    store.apply(human, {
      message: 'Remove',
      operations: [{ op: 'delete', type: 'file', id: file.id }],
    });
    expect(store.getOfType('task', result.created.t!).data.fileIds).toEqual([]);
  });

  it('refuses hidden folders, secrets, unscanned paths, links out, scan fields, removal and moves', async () => {
    const client = await connect();
    const folderId = await approvedCompany(client);
    const add = async (data: Record<string, unknown>) =>
      raw(client, 'apply', {
        message: 'Add',
        operations: [
          { op: 'create', type: 'file', data: { projectId, rootId: folderId, ...data } },
        ],
      });
    // A hidden folder reads as not found.
    const hidden = await raw(client, 'apply', {
      message: 'Add',
      operations: [
        {
          op: 'create',
          type: 'file',
          data: { projectId, rootId: vaultId(), path: 'plan-zeta.txt' },
        },
      ],
    });
    expect(hidden.text).toMatch(/not found/);
    expect(hidden.text).not.toContain('plan-zeta');
    expect((await add({ path: 'credentials.json' })).text).toMatch(/isn't a file Pharos found/);
    expect((await add({ path: 'archive.zip' })).text).toMatch(/isn't a file Pharos found/);
    write(join(company, 'new.pdf'), 'made up after the scan');
    expect((await add({ path: 'new.pdf' })).text).toMatch(/isn't a file Pharos found/);
    // Swapped for a link to a file outside after the scan.
    unlinkSync(join(company, 'tax-letter.pdf'));
    symlinkSync(join(outside, 'secret-target.txt'), join(company, 'tax-letter.pdf'));
    expect((await add({ path: 'tax-letter.pdf' })).text).toMatch(/doesn't read/);
    // Scan fields come from the scan only (the MCP schema doesn't even take them).
    expect((await add({ path: 'certificate.pdf', size: 1 })).isError).toBe(true);
    const rest = await owner(
      'POST',
      '/api/apply',
      {
        message: 'Add',
        operations: [
          {
            op: 'create',
            type: 'file',
            data: {
              projectId,
              rootId: folderId,
              path: 'certificate.pdf',
              title: 'C',
              size: 1,
              modifiedAt: '2026-01-01T00:00:00.000Z',
            },
          },
        ],
      },
      { ...AGENT } as unknown as typeof BROWSER,
    );
    expect(rest.status).toBe(400);
    expect(JSON.stringify(await rest.json())).toMatch(/scan fills in the rest/);

    const ok = await call<{ created: Record<string, string> }>(client, 'apply', {
      message: 'Add',
      operations: [
        {
          op: 'create',
          type: 'file',
          ref: 'f',
          data: { projectId, rootId: folderId, path: 'certificate.pdf' },
        },
      ],
    });
    const id = ok.created.f!;
    expect((await add({ path: 'certificate.pdf' })).text).toMatch(/already in this project/);
    const remove = await raw(client, 'apply', {
      message: 'Remove',
      operations: [{ op: 'delete', type: 'file', id }],
    });
    expect(remove.isError).toBe(true);
    const move = await raw(client, 'apply', {
      message: 'Move',
      operations: [{ op: 'update', type: 'file', id, data: { path: 'notes.md' } }],
    });
    expect(move.isError).toBe(true);
    // Deleting the project would remove the file by cascade: refused too.
    const project = await raw(client, 'apply', {
      message: 'Drop',
      operations: [{ op: 'delete', type: 'project', id: projectId }],
    });
    expect(project.text).toMatch(/only the owner removes files/);
    expect(store.get(id)).not.toBeNull();
  });

  it("can't undo its way around the rules", async () => {
    const client = await connect();
    const folderId = await approvedCompany(client);
    const added = store.apply(
      { kind: 'agent', name: 'Opus 5.5' },
      {
        message: 'Add',
        operations: [
          {
            op: 'create',
            type: 'file',
            ref: 'f',
            data: { projectId, rootId: folderId, path: 'notes.md' },
          },
        ],
      },
    );
    const id = added.created.f!;
    // Undoing the add would remove the file.
    const undoAdd = await raw(client, 'history_revert', { revision: added.revision!.id });
    expect(undoAdd.text).toMatch(/would remove one/);
    expect(store.get(id)).not.toBeNull();
    // Undoing the owner's removal brings it back while the folder is shared...
    const removed = store.apply(human, {
      message: 'Remove',
      operations: [{ op: 'delete', type: 'file', id }],
    });
    await call(client, 'history_revert', { revision: removed.revision!.id });
    expect(store.get(id)).not.toBeNull();
    // ...but not once the owner hid the folder.
    const again = store.apply(human, {
      message: 'Remove',
      operations: [{ op: 'delete', type: 'file', id }],
    });
    const hide = await owner('PATCH', `/api/settings/folders/${folderId}`, { level: 'hidden' });
    expect(hide.status).toBe(200);
    const undo = await raw(client, 'history_revert', { revision: again.revision!.id });
    expect(undo.isError).toBe(true);
    expect(store.get(id)).toBeNull();
  });

  it("can't bring back a removed file that changed on disk since", async () => {
    const client = await connect();
    const folderId = await approvedCompany(client);
    const added = store.apply(
      { kind: 'agent', name: 'Opus 5.5' },
      {
        message: 'Add',
        operations: [
          {
            op: 'create',
            type: 'file',
            ref: 'f',
            data: { projectId, rootId: folderId, path: 'notes.md' },
          },
        ],
      },
    );
    const id = added.created.f!;
    const removed = store.apply(human, {
      message: 'Remove',
      operations: [{ op: 'delete', type: 'file', id }],
    });
    write(join(company, 'notes.md'), '# Made-up notes, now longer than before\n');
    await owner('POST', `/api/settings/folders/${folderId}/scan`);
    await files.scanner.idle(folderId);
    const undo = await raw(client, 'history_revert', { revision: removed.revision!.id });
    expect(undo.text).toMatch(/changed on disk/);
    expect(store.get(id)).toBeNull();
  });

  it("links only files it can see, and keeps the owner's links to hidden ones", async () => {
    const client = await connect();
    const folderId = await approvedCompany(client);
    const made = await call<{ created: Record<string, string> }>(client, 'apply', {
      message: 'Add two',
      operations: [
        {
          op: 'create',
          type: 'file',
          ref: 'a',
          data: { projectId, rootId: folderId, path: 'certificate.pdf' },
        },
        {
          op: 'create',
          type: 'file',
          ref: 'b',
          data: { projectId, rootId: folderId, path: 'notes.md' },
        },
        {
          op: 'create',
          type: 'decision',
          ref: 'd',
          data: { projectId, title: 'Moved', fileIds: ['$a'] },
        },
      ],
    });
    const { a, b, d } = made.created as Record<'a' | 'b' | 'd', string>;
    const linkHidden = await raw(client, 'apply', {
      message: 'Link',
      operations: [{ op: 'update', type: 'decision', id: d, data: { fileIds: [a, hiddenFileId] } }],
    });
    expect(linkHidden.isError).toBe(true);
    expect(linkHidden.text).toMatch(/not found/);
    // The owner links the hidden file too; the agent never sees it, and can't drop it.
    store.apply(human, {
      message: 'Owner link',
      operations: [{ op: 'update', type: 'decision', id: d, data: { fileIds: [a, hiddenFileId] } }],
    });
    const seen = await call<{ data: { fileIds: string[] } }>(client, 'get', { id: d });
    expect(seen.data.fileIds).toEqual([a]);
    const snapshot = await call<{ decisions: { fileIds?: string[] }[] }>(
      client,
      'project_snapshot',
      { projectId },
    );
    expect(JSON.stringify(snapshot)).not.toContain(hiddenFileId);
    expect(snapshot.decisions[0]!.fileIds).toEqual([a]);
    await call(client, 'apply', {
      message: 'Relink',
      operations: [{ op: 'update', type: 'decision', id: d, data: { fileIds: [b] } }],
    });
    expect(store.getOfType('decision', d).data.fileIds).toEqual([b, hiddenFileId]);
    const data = await owner(
      'GET',
      `/api/projects/${projectId}/data`,
      undefined,
      AGENT as unknown as typeof BROWSER,
    );
    expect(JSON.stringify(await data.json())).not.toContain(hiddenFileId);
  });
});

describe('sources with relative paths, and what the project mentions (R7.12)', () => {
  const source = (uri: string, title = uri) =>
    store.apply(human, {
      message: 'Source',
      operations: [{ op: 'create', type: 'artifact', ref: 'a', data: { projectId, title, uri } }],
    }).created.a!;

  it('says which folder is needed, then resolves relative paths in the approved one', async () => {
    const client = await connect();
    const seal = source('seal.png', 'Company seal');
    expect(await matchArtifactFile(store, seal)).toEqual({
      state: 'not-in-folder',
      path: 'seal.png',
      folder: null,
      request: null,
    });
    const asked = await call<{ id: string }>(client, 'folder_request', {
      path: company,
      reason: 'Company papers',
      projectId,
    });
    expect(await matchArtifactFile(store, seal)).toMatchObject({
      state: 'not-in-folder',
      folder: company,
      request: { id: asked.id, status: 'pending', requestedBy: 'Opus 5.5' },
    });
    // An absolute path inside the requested folder names the request too.
    const absolute = source(join(company, 'certificate.pdf'));
    expect(await matchArtifactFile(store, absolute)).toMatchObject({
      state: 'not-in-folder',
      folder: company,
      request: { id: asked.id },
    });
    const approve = await owner('POST', `/api/settings/folder-requests/${asked.id}/approve`);
    const { folderId } = (await approve.json()) as FolderRequest;
    await files.scanner.idle(folderId!);
    expect(await matchArtifactFile(store, seal)).toEqual({
      state: 'in-folder',
      rootId: folderId,
      path: 'seal.png',
    });
    expect(await matchArtifactFile(store, source('nope/missing.pdf'))).toEqual({
      state: 'missing',
      rootId: folderId,
      path: 'nope/missing.pdf',
    });
    expect(await matchArtifactFile(store, source('credentials.json'))).toEqual({
      state: 'refused',
      rootId: folderId,
      path: 'credentials.json',
    });
    // The agent adds the file; Pharos links the source to it.
    await call(client, 'apply', {
      message: 'Add the seal',
      operations: [
        { op: 'create', type: 'file', data: { projectId, rootId: folderId, path: 'seal.png' } },
      ],
    });
    expect(await until(() => !!store.getOfType('artifact', seal).data.fileId)).toBe(true);
    // Agents see the relative path they wrote (no absolute path is ever shown).
    const seen = await call<{ data: { uri?: string } }>(client, 'get', { id: absolute });
    expect(seen.data.uri).toBeUndefined();
    expect((await call<{ data: { uri?: string } }>(client, 'get', { id: seal })).data.uri).toBe(
      'seal.png',
    );
  });

  it('lists mentioned documents not in Pharos yet, with why, to the owner only', async () => {
    const client = await connect();
    const folderId = await approvedCompany(client);
    source('nope/missing.pdf', 'Missing paper');
    source('credentials.json', 'Refused paper');
    source(join(outside, 'secret-target.txt'), 'Elsewhere paper');
    source('https://example.com/made-up', 'Web page');
    source('seal.png', 'Seal');
    const res = await owner('GET', `/api/projects/${projectId}/mentioned-files`);
    const mentioned = (await res.json()) as MentionedFile[];
    expect(Object.fromEntries(mentioned.map((m) => [m.title, m.match.state]))).toEqual({
      'Missing paper': 'missing',
      'Refused paper': 'refused',
      'Elsewhere paper': 'not-in-folder',
      Seal: 'in-folder',
    });
    expect(mentioned.find((m) => m.title === 'Seal')!.match).toMatchObject({ rootId: folderId });
    const agent = await owner('GET', `/api/projects/${projectId}/mentioned-files`, undefined, {
      ...BROWSER,
      ...AGENT,
    });
    expect(agent.status).toBe(403);
    expect(
      (
        await owner(
          'GET',
          `/api/projects/${projectId}/mentioned-files`,
          undefined,
          {} as typeof BROWSER,
        )
      ).status,
    ).toBe(403);
  });
});

describe('folder request storage', () => {
  it('never lets a request carry a hidden level, and stays out of revisions', async () => {
    const client = await connect();
    const before = store.latestRevisionId();
    const hidden = await raw(client, 'folder_request', {
      path: company,
      level: 'hidden',
      reason: 'x',
    });
    expect(hidden.isError).toBe(true);
    await call(client, 'folder_request', { path: company, reason: 'x' });
    expect(store.latestRevisionId()).toBe(before);
    expect(store.setting(FOLDERS_SETTING)).toBeTruthy();
  });
});
