// R7.5 defensive regressions. All files and contents here are synthetic temp fixtures.
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { FOLDERS_SETTING, type Author, type FileFolder } from '@pharos/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { RevisionFeed } from '../feed.js';
import { FileService } from '../files/service.js';
import { openDatabase } from './database.js';
import { Store } from './store.js';

const human: Author = { kind: 'human', name: 'fixture owner' };
const DOTENV_CANARY = 'SYNTHETIC_DOTENV_CANARY';
const CREDENTIALS_CANARY = 'SYNTHETIC_CREDENTIALS_CANARY';
const HIDDEN_NAME = 'PRIVATE_DRAFT_CANARY';
const CLAIM_CANARY = 'PRIVATE_CLAIM_CONTENT_CANARY';
const QUOTE_CANARY = 'PRIVATE_QUOTE_CONTENT_CANARY';
const TERM_CANARY = 'PRIVATE_TERM_CONTENT_CANARY';

let dir: string;
let contentsDir: string;
let hiddenDir: string;
let detailsDir: string;
let store: Store;
let app: ReturnType<typeof createApp>;
let fileService: FileService;
let clients: Client[] = [];
let ids: {
  project: string;
  task: string;
  envAlias: string;
  credentialsAlias: string;
  detailsFile: string;
  unreadableFile: string;
  hiddenFile: string;
  artifact: string;
  claim: string;
  term: string;
  request: string;
  seededRevision: number;
};

async function inMemoryRequest(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  if (input instanceof Request) return await app.request(input);
  const url = new URL(input.toString());
  return await app.request(`${url.pathname}${url.search}`, init);
}

async function connect() {
  const client = new Client({ name: 'agent-file-protection-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
    fetch: inMemoryRequest,
  });
  await client.connect(transport);
  clients.push(client);
  return client;
}

async function tool(client: Client, name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
  const text = result.content.map((block) => (block.type === 'text' ? block.text : '')).join('\n');
  return { text, isError: result.isError === true };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pharos-agent-file-protections-'));
  contentsDir = join(dir, 'Contents');
  hiddenDir = join(dir, 'OwnerOnly');
  detailsDir = join(dir, 'Details');
  mkdirSync(contentsDir, { recursive: true });
  mkdirSync(hiddenDir, { recursive: true });
  mkdirSync(detailsDir, { recursive: true });

  // The aliases begin as ordinary added files. Individual tests replace them with symlinks only
  // after their records exist, modeling a file being swapped after the owner adds it.
  writeFileSync(join(contentsDir, '.env'), `${DOTENV_CANARY}=made-up\n`);
  writeFileSync(
    join(contentsDir, 'credentials.json'),
    JSON.stringify({ token: CREDENTIALS_CANARY }),
  );
  writeFileSync(join(contentsDir, 'safe-env.txt'), 'ordinary safe text');
  writeFileSync(join(contentsDir, 'safe-credentials.txt'), 'ordinary safe text');
  writeFileSync(join(hiddenDir, 'owner-draft.md'), `${HIDDEN_NAME}: ${CLAIM_CANARY}\n`);
  writeFileSync(join(hiddenDir, 'Unadded owner note.md'), 'Made-up hidden scan entry');
  writeFileSync(join(detailsDir, 'details-note.md'), 'DETAILS_CONTENT_CANARY');
  writeFileSync(join(detailsDir, 'Unadded details note.md'), 'Made-up details scan entry');
  writeFileSync(join(contentsDir, 'Unadded contents note.md'), 'Made-up contents scan entry');
  writeFileSync(join(contentsDir, 'unreadable.txt'), 'SYNTHETIC_UNREADABLE_CANARY');

  store = new Store(openDatabase(':memory:'));
  const folders: FileFolder[] = [
    {
      id: 'root_content1',
      path: contentsDir,
      label: 'Synthetic shared files',
      level: 'contents',
      addedAt: '2026-10-12T12:00:00.000Z',
    },
    {
      id: 'root_hidden1',
      path: hiddenDir,
      label: 'Synthetic owner files',
      level: 'hidden',
      addedAt: '2026-10-12T12:00:00.000Z',
    },
    {
      id: 'root_details1',
      path: detailsDir,
      label: 'Synthetic details files',
      level: 'details',
      addedAt: '2026-10-12T12:00:00.000Z',
    },
  ];
  store.setSetting(FOLDERS_SETTING, folders);

  const seeded = store.apply(human, {
    message: 'Seed synthetic file fixtures',
    operations: [
      { op: 'create', type: 'project', ref: 'p', data: { name: 'Synthetic fixture project' } },
      {
        op: 'create',
        type: 'task',
        ref: 'task',
        data: { projectId: '$p', title: 'Synthetic visible task' },
      },
      {
        op: 'create',
        type: 'file',
        ref: 'env',
        data: {
          projectId: '$p',
          title: 'Synthetic text alias',
          rootId: 'root_content1',
          path: 'safe-env.txt',
          size: 32,
          modifiedAt: '2026-10-12T12:00:00.000Z',
          mimeType: 'text/plain',
        },
      },
      {
        op: 'create',
        type: 'file',
        ref: 'credentials',
        data: {
          projectId: '$p',
          title: 'Synthetic credential alias',
          rootId: 'root_content1',
          path: 'safe-credentials.txt',
          size: 64,
          modifiedAt: '2026-10-12T12:00:00.000Z',
          mimeType: 'text/plain',
        },
      },
      {
        op: 'create',
        type: 'file',
        ref: 'private',
        data: {
          projectId: '$p',
          title: HIDDEN_NAME,
          rootId: 'root_hidden1',
          path: 'owner-draft.md',
          size: 32,
          modifiedAt: '2026-10-12T12:00:00.000Z',
          mimeType: 'text/markdown',
        },
      },
      {
        op: 'create',
        type: 'file',
        ref: 'details',
        data: {
          projectId: '$p',
          title: 'Synthetic details note',
          rootId: 'root_details1',
          path: 'details-note.md',
          size: 24,
          modifiedAt: '2026-10-12T12:00:00.000Z',
          mimeType: 'text/markdown',
        },
      },
      {
        op: 'create',
        type: 'file',
        ref: 'unreadable',
        data: {
          projectId: '$p',
          title: 'Synthetic unreadable note',
          rootId: 'root_content1',
          path: 'unreadable.txt',
          size: 30,
          modifiedAt: '2026-10-12T12:00:00.000Z',
          mimeType: 'text/plain',
        },
      },
      {
        op: 'create',
        type: 'artifact',
        ref: 'source',
        data: {
          projectId: '$p',
          title: 'Synthetic local source',
          uri: join(hiddenDir, 'owner-draft.md'),
          fileId: '$private',
        },
      },
      {
        op: 'create',
        type: 'claim',
        ref: 'claim',
        data: {
          projectId: '$p',
          statement: `${CLAIM_CANARY} came from an owner-only file`,
          checkedOn: '2026-10-12',
          sourceIds: ['$source'],
          quote: `${QUOTE_CANARY} copied from the owner-only file`,
          quoteSourceId: '$source',
          order: 1,
        },
      },
      {
        op: 'create',
        type: 'term',
        ref: 'term',
        data: {
          projectId: '$p',
          word: 'Synthetic private term',
          explanation: `${TERM_CANARY} copied from the owner-only file`,
          alsoCalled: [],
          sourceId: '$source',
        },
      },
    ],
  });
  const request = store.apply(human, {
    message: 'Ask a synthetic question about a file',
    operations: [
      {
        op: 'create',
        type: 'request',
        ref: 'request',
        data: {
          projectId: seeded.created.p!,
          question: 'Synthetic question about an owner-only file',
          about: `Question about ${HIDDEN_NAME}`,
          aboutId: seeded.created.private!,
        },
      },
    ],
  });
  ids = {
    project: seeded.created.p!,
    task: seeded.created.task!,
    envAlias: seeded.created.env!,
    credentialsAlias: seeded.created.credentials!,
    detailsFile: seeded.created.details!,
    unreadableFile: seeded.created.unreadable!,
    hiddenFile: seeded.created.private!,
    artifact: seeded.created.source!,
    claim: seeded.created.claim!,
    term: seeded.created.term!,
    request: request.created.request!,
    seededRevision: seeded.revision!.id,
  };
  fileService = new FileService(store);
  app = createApp(store, new RevisionFeed(store, 0), undefined, { files: fileService });
});

afterEach(async () => {
  await Promise.all(clients.map((client) => client.close()));
  clients = [];
  rmSync(dir, { recursive: true, force: true });
});

describe('MCP file content protection', () => {
  it('does not read a safe alias whose real path is a dotfile', async () => {
    rmSync(join(contentsDir, 'safe-env.txt'));
    symlinkSync(join(contentsDir, '.env'), join(contentsDir, 'safe-env.txt'));
    const client = await connect();
    const result = await tool(client, 'file_read_text', { fileId: ids.envAlias });
    expect({ rejected: result.isError, disclosed: result.text.includes(DOTENV_CANARY) }).toEqual({
      rejected: true,
      disclosed: false,
    });
  });

  it('does not read a safe alias whose real path is a credentials file', async () => {
    rmSync(join(contentsDir, 'safe-credentials.txt'));
    symlinkSync(join(contentsDir, 'credentials.json'), join(contentsDir, 'safe-credentials.txt'));
    const client = await connect();
    const result = await tool(client, 'file_read_text', { fileId: ids.credentialsAlias });
    expect({
      rejected: result.isError,
      disclosed: result.text.includes(CREDENTIALS_CANARY),
    }).toEqual({
      rejected: true,
      disclosed: false,
    });
  });

  it('does not include an absolute path when the added text file cannot be opened', async () => {
    const path = join(contentsDir, 'unreadable.txt');
    chmodSync(path, 0);
    try {
      const client = await connect();
      let message = '';
      try {
        const result = await tool(client, 'file_read_text', { fileId: ids.unreadableFile });
        message = result.text;
      } catch (error) {
        message = String(error);
      }
      expect({
        disclosesPath: message.includes(path) || message.includes(contentsDir),
        disclosesContents: message.includes('SYNTHETIC_UNREADABLE_CANARY'),
      }).toEqual({ disclosesPath: false, disclosesContents: false });
    } finally {
      chmodSync(path, 0o600);
    }
  });
});

describe('MCP hidden-file references', () => {
  it('does not expose a hidden local path through artifact reads, history, or snapshots', async () => {
    const client = await connect();
    const outputs = [
      await tool(client, 'get', { id: ids.artifact }),
      await tool(client, 'list', { type: 'artifact', projectId: ids.project }),
      await tool(client, 'project_snapshot', { projectId: ids.project }),
      await tool(client, 'history_diff', { from: 0, projectId: ids.project }),
    ];
    const text = outputs.map((output) => output.text).join('\n');
    expect({
      disclosesPath: text.includes(join(hiddenDir, 'owner-draft.md')),
      disclosesId: text.includes(ids.hiddenFile),
    }).toEqual({ disclosesPath: false, disclosesId: false });
  });

  it('does not return explicitly source-linked claim and term text copied from a hidden file', async () => {
    const client = await connect();
    const outputs = [
      await tool(client, 'get', { id: ids.claim }),
      await tool(client, 'list', { type: 'claim', projectId: ids.project }),
      await tool(client, 'get', { id: ids.term }),
      await tool(client, 'project_snapshot', { projectId: ids.project }),
      await tool(client, 'view_preview', {
        projectId: ids.project,
        widgets: [{ id: 'private-claim', node: { component: 'ClaimCard', claim: ids.claim } }],
      }),
    ];
    const text = outputs.map((output) => output.text).join('\n');
    expect({
      leaksCopiedClaim: text.includes(CLAIM_CANARY),
      leaksCopiedQuote: text.includes(QUOTE_CANARY),
      leaksCopiedTerm: text.includes(TERM_CANARY),
    }).toEqual({ leaksCopiedClaim: false, leaksCopiedQuote: false, leaksCopiedTerm: false });
  });

  it('does not preserve a hidden filename in a mixed revision message', async () => {
    store.apply(human, {
      message: `Review ${HIDDEN_NAME} with the visible task`,
      operations: [
        { op: 'update', type: 'file', id: ids.hiddenFile, data: { issuer: 'Synthetic issuer' } },
        { op: 'update', type: 'task', id: ids.task, data: { status: 'done' } },
      ],
    });
    const client = await connect();
    const history = await tool(client, 'history_list', { projectId: ids.project });
    const changes = await tool(client, 'changes_since', { projectId: ids.project, mark: false });
    expect(history.text).not.toContain(HIDDEN_NAME);
    expect(changes.text).not.toContain(HIDDEN_NAME);
  });

  it('does not reveal the hidden file named by an open request', async () => {
    const client = await connect();
    const request = await tool(client, 'get', { id: ids.request });
    const snapshot = await tool(client, 'project_snapshot', { projectId: ids.project });
    expect(request.text).not.toContain(HIDDEN_NAME);
    expect(snapshot.text).not.toContain(HIDDEN_NAME);
  });

  it('does not let an agent delete a project and remove its file records as a cascade', async () => {
    const client = await connect();
    const result = await tool(client, 'apply', {
      message: 'Try to remove the project',
      operations: [{ op: 'delete', type: 'project', id: ids.project }],
    });
    expect({
      rejected: result.isError,
      fileRecordRemains: store.get(ids.hiddenFile) !== null,
    }).toEqual({
      rejected: true,
      fileRecordRemains: true,
    });
  });

  it('does not name a hidden file in a REST project-revert conflict', async () => {
    const project = store.apply(human, {
      message: 'Create a second synthetic project',
      operations: [{ op: 'create', type: 'project', ref: 'p', data: { name: 'Second fixture' } }],
    });
    store.apply(human, {
      message: 'Add an owner-only file to the second project',
      operations: [
        {
          op: 'create',
          type: 'file',
          data: {
            projectId: project.created.p!,
            title: HIDDEN_NAME,
            rootId: 'root_hidden1',
            path: 'revert-target.md',
            size: 32,
            modifiedAt: '2026-10-12T12:00:00.000Z',
            mimeType: 'text/markdown',
          },
        },
      ],
    });
    const response = await app.request(`/api/revisions/${project.revision!.id}/revert`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-pharos-author': 'agent:synthetic-reader',
      },
      body: JSON.stringify({ message: 'Try reverting the synthetic project' }),
    });
    const text = await response.text();
    expect({ status: response.status, leaksHiddenTitle: text.includes(HIDDEN_NAME) }).toEqual({
      status: 409,
      leaksHiddenTitle: false,
    });
  });
});

describe('R7.9 source and history follow-ups', () => {
  it('hides a source whose local path is in a hidden folder, without a file link', async () => {
    const created = store.apply(human, {
      message: 'Add a synthetic source by path only',
      operations: [
        {
          op: 'create',
          type: 'artifact',
          ref: 'a',
          data: {
            projectId: ids.project,
            title: 'Synthetic path-only source',
            uri: join(hiddenDir, 'Unadded owner note.md'),
          },
        },
        {
          op: 'create',
          type: 'term',
          ref: 't',
          data: {
            projectId: ids.project,
            word: 'Synthetic path term',
            explanation: `${TERM_CANARY} from a path-only source`,
            alsoCalled: [],
            sourceId: '$a',
          },
        },
      ],
    });
    const client = await connect();
    const outputs = [
      await tool(client, 'get', { id: created.created.a! }),
      await tool(client, 'list', { type: 'term', projectId: ids.project }),
      await tool(client, 'history_list', { projectId: ids.project }),
    ];
    const text = outputs.map((output) => output.text).join('\n');
    expect(outputs[0]!.isError).toBe(true);
    expect(text).not.toContain(hiddenDir);
    expect(text).not.toContain(TERM_CANARY);
  });

  it('keeps a claim with a visible source but drops a quote copied from a details file', async () => {
    const created = store.apply(human, {
      message: 'Add a synthetic details-sourced claim',
      operations: [
        {
          op: 'create',
          type: 'artifact',
          ref: 'a',
          data: {
            projectId: ids.project,
            title: 'Synthetic details source',
            uri: join(detailsDir, 'details-note.md'),
            fileId: ids.detailsFile,
          },
        },
        {
          op: 'create',
          type: 'claim',
          ref: 'c',
          data: {
            projectId: ids.project,
            statement: 'Synthetic visible statement',
            checkedOn: '2026-10-12',
            sourceIds: ['$a'],
            quote: 'DETAILS_CONTENT_CANARY quoted word for word',
          },
        },
      ],
    });
    const client = await connect();
    const claim = await tool(client, 'get', { id: created.created.c! });
    const source = await tool(client, 'get', { id: created.created.a! });
    expect(claim.isError).toBe(false);
    expect(claim.text).toContain('Synthetic visible statement');
    expect(claim.text).not.toContain('DETAILS_CONTENT_CANARY');
    expect(source.text).toContain(ids.detailsFile);
    expect(source.text).not.toContain(detailsDir);
  });

  it('refuses an agent undo that would remove a file record', async () => {
    const added = store.apply(human, {
      message: 'Add a synthetic visible file',
      operations: [
        {
          op: 'create',
          type: 'file',
          ref: 'f',
          data: {
            projectId: ids.project,
            title: 'Synthetic visible file',
            rootId: 'root_content1',
            path: 'Unadded contents note.md',
            size: 10,
            modifiedAt: '2026-10-12T12:00:00.000Z',
          },
        },
      ],
    });
    const client = await connect();
    const result = await tool(client, 'history_revert', { revision: added.revision!.id });
    expect(result.isError).toBe(true);
    expect(store.get(added.created.f!)).not.toBeNull();
  });

  it('refuses a REST write declared as the system author', async () => {
    const response = await app.request('/api/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-pharos-author': 'system:pharos' },
      body: JSON.stringify({
        message: 'Try to write as Pharos',
        operations: [{ op: 'delete', type: 'project', id: ids.project }],
      }),
    });
    expect(response.status).toBe(400);
    expect(store.get(ids.project)).not.toBeNull();
  });
});

const browserAgentHeaders = {
  'x-pharos-author': 'agent:synthetic-reader',
  origin: 'http://localhost',
  'sec-fetch-site': 'same-origin',
};

describe('agent-labeled REST reads', () => {
  const entityReadCases: [string, () => string, number][] = [
    ['file entity list', () => `/api/entities/file?projectId=${ids.project}`, 200],
    ['hidden file entity get', () => `/api/entities/file/${ids.hiddenFile}`, 404],
    ['dataset', () => `/api/projects/${ids.project}/data`, 200],
    ['snapshot', () => `/api/projects/${ids.project}/snapshot`, 200],
    ['history', () => `/api/history?projectId=${ids.project}`, 200],
    ['revision', () => `/api/revisions/${ids.seededRevision}`, 200],
    ['diff', () => `/api/diff?from=0&projectId=${ids.project}`, 200],
  ];
  const fileReadCases: [string, () => string, number, () => string[]][] = [
    ['hidden file info', () => `/api/files/${ids.hiddenFile}`, 404, () => [hiddenDir, HIDDEN_NAME]],
    [
      'hidden file content',
      () => `/api/files/${ids.hiddenFile}/content`,
      404,
      () => [HIDDEN_NAME, CLAIM_CANARY],
    ],
    [
      'details-level file content',
      () => `/api/files/${ids.detailsFile}/content`,
      403,
      () => ['DETAILS_CONTENT_CANARY'],
    ],
  ];

  it.each(entityReadCases)(
    'filters hidden data from GET %s',
    async (_label, getPath, expectedStatus) => {
      const path = getPath();
      const response = await app.request(path, { headers: browserAgentHeaders });
      const text = await response.text();
      const leaks = [
        HIDDEN_NAME,
        join(hiddenDir, 'owner-draft.md'),
        'safe-env.txt',
        'safe-credentials.txt',
        DOTENV_CANARY,
        CREDENTIALS_CANARY,
        ids.hiddenFile,
        CLAIM_CANARY,
        QUOTE_CANARY,
        TERM_CANARY,
      ].filter((marker) => text.includes(marker));
      expect({ status: response.status, leaks }).toEqual({ status: expectedStatus, leaks: [] });
    },
  );

  it.each(fileReadCases)(
    'enforces folder visibility on %s',
    async (_label, getPath, expectedStatus, getMarkers) => {
      const path = getPath();
      const response = await app.request(path, { headers: browserAgentHeaders });
      const text = await response.text();
      const leaks = getMarkers().filter((marker) => text.includes(marker));
      expect({ status: response.status, leaks }).toEqual({ status: expectedStatus, leaks: [] });
    },
  );

  it('refuses scanned-file suggestions, naming no unadded file', async () => {
    for (const rootId of ['root_hidden1', 'root_details1', 'root_content1']) {
      fileService.scan(rootId);
      await fileService.scanner.idle(rootId);
    }
    const response = await app.request(`/api/projects/${ids.project}/scanned-files`, {
      headers: browserAgentHeaders,
    });
    // R7.9: scan suggestions are an owner-only route (the review's fix for gap 1), so a declared
    // agent is refused outright rather than served an empty list.
    expect(response.status).toBe(403);
    const text = await response.text();
    const leaks = [
      'Unadded owner note.md',
      'Unadded details note.md',
      'Unadded contents note.md',
      'owner-draft.md',
    ].filter((marker) => text.includes(marker));
    expect(leaks).toEqual([]);
  });
});
