import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { FOLDERS_SETTING, SEEN_SETTING, type Author } from '@pharos/schema';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { RevisionFeed } from '../feed.js';
import { answerBrief } from '../guidance.js';
import { openDatabase } from '../store/database.js';
import { projectSnapshot } from '../store/snapshot.js';
import { Store } from '../store/store.js';
import { evidenceState, markSeen, projectFreshness, seenMarks } from './freshness.js';
import { answerView, createView, updateView } from './service.js';

// Independent review: synthetic data only; MCP fetches go to app.request, never a port.
const owner: Author = { kind: 'human', name: 'me' };
const agent: Author = { kind: 'agent', name: 'Synthetic reviewer' };
const headers = { 'x-pharos-author': 'agent:Synthetic reviewer' };
const PRIVATE_TITLE = 'SYNTHETIC_HIDDEN_NAME';
let dir: string;
let store: Store;
let app: ReturnType<typeof createApp>;
let projectId: string;
let taskId: string;
let fileId: string;
let clients: Client[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pharos-r11-review-'));
  writeFileSync(join(dir, 'note.md'), 'Synthetic owner text');
  store = new Store(openDatabase(':memory:'));
  store.setSetting(FOLDERS_SETTING, [
    {
      id: 'root_fixture',
      path: dir,
      label: 'Synthetic folder',
      level: 'hidden',
      addedAt: '2026-10-13T00:00:00Z',
    },
  ]);
  const seeded = store.apply(owner, {
    message: 'Synthetic fixtures',
    operations: [
      { op: 'create', type: 'project', ref: 'p', data: { name: 'Synthetic project' } },
      {
        op: 'create',
        type: 'task',
        ref: 't',
        data: { projectId: '$p', title: 'Blocked fixture', status: 'blocked' },
      },
      {
        op: 'create',
        type: 'file',
        ref: 'f',
        data: {
          projectId: '$p',
          rootId: 'root_fixture',
          path: 'note.md',
          title: PRIVATE_TITLE,
          size: 20,
          modifiedAt: '2026-10-13T00:00:00Z',
          mimeType: 'text/markdown',
        },
      },
    ],
  });
  projectId = seeded.created.p!;
  taskId = seeded.created.t!;
  fileId = seeded.created.f!;
  seenMarks(store); // Match index.ts startup, before any agent reads.
  app = createApp(store, new RevisionFeed(store, 0));
  clients = [];
});

afterEach(async () => {
  await Promise.all(clients.map((client) => client.close()));
  // Let the app's deferred source-linking callbacks finish before closing the fixture DB.
  await new Promise<void>((resolve) => setImmediate(resolve));
  store.database.close();
  rmSync(dir, { recursive: true, force: true });
});

const widgets = () => [
  { id: 'lead', node: { component: 'Text', content: 'One task is blocked.' } },
  { id: 'list', node: { component: 'TaskTable', filter: { where: { status: 'blocked' } } } },
];

function answer() {
  return answerView(store, agent, { projectId, question: 'What is blocked?', widgets: widgets() })
    .view.id;
}

function staleAnswer() {
  const id = answer();
  store.apply(owner, {
    message: 'Unblock fixture',
    operations: [{ op: 'update', type: 'task', id: taskId, data: { status: 'done' } }],
  });
  expect(evidenceState(store, store.getOfType('view', id))).toBe('stale');
  return id;
}

function askRefresh(viewId: string) {
  return store.apply(owner, {
    message: 'Refresh fixture answer',
    operations: [
      {
        op: 'create',
        type: 'request',
        data: { projectId, viewId, question: 'What is blocked?', mode: 'refresh' },
      },
    ],
  }).created['0']!;
}

async function mcp() {
  const client = new Client({ name: agent.name, version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://fixture.invalid/mcp'), {
      fetch: async (input, init) => {
        if (input instanceof Request) return app.request(input);
        const url = new URL(String(input));
        return app.request(url.pathname + url.search, init);
      },
    }),
  );
  clients.push(client);
  return client;
}

describe('declared agent boundaries', () => {
  it('refuses all three reader routes without moving marks or adding revisions', async () => {
    const id = answer();
    const before = store.setting(SEEN_SETTING);
    const revision = store.latestRevisionId();
    for (const path of ['/api/freshness', `/api/projects/${projectId}/freshness`])
      expect((await app.request(path, { headers })).status).toBe(403);
    expect(
      (await app.request(`/api/views/${id}/seen`, { method: 'PUT', headers, body: '{}' })).status,
    ).toBe(403);
    expect(store.setting(SEEN_SETTING)).toEqual(before);
    expect(store.latestRevisionId()).toBe(revision);
  });

  it('refuses forged evidence through REST and MCP apply', async () => {
    const id = answer();
    const input = {
      message: 'Forge evidence',
      operations: [
        { op: 'update', type: 'view', id, data: { evidenceRevision: store.latestRevisionId() } },
      ],
    };
    const before = store.getOfType('view', id);
    const response = await app.request('/api/apply', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    expect(response.status).toBe(400);
    const result = await (await mcp()).callTool({ name: 'apply', arguments: input });
    expect(result.isError).toBe(true);
    expect(store.getOfType('view', id)).toEqual(before);
  });

  it('does not let MCP evidence reveal a guessed hidden filename changing', async () => {
    // The agent guesses a title in a query. Its visible dataset contains no files.
    const id = createView(store, agent, {
      projectId,
      name: 'Synthetic probe',
      message: 'Check a guess',
      widgets: [
        {
          id: 'files',
          node: { component: 'FileList', filter: { where: { title: PRIVATE_TITLE } } },
        },
      ],
    }).view.id;
    const client = await mcp();
    const snapshot = async () => {
      const result = (await client.callTool({
        name: 'project_snapshot',
        arguments: { projectId },
      })) as CallToolResult;
      const text = result.content!.map((c) => (c.type === 'text' ? c.text : '')).join('');
      return JSON.parse(text) as { files: unknown[]; views: { id: string; evidence: string }[] };
    };
    expect((await snapshot()).files).toEqual([]);
    expect((await snapshot()).views.find((v) => v.id === id)?.evidence).toBe('fresh');
    store.apply(owner, {
      message: 'Synthetic private edit',
      operations: [
        { op: 'update', type: 'file', id: fileId, data: { title: 'SYNTHETIC_NEW_HIDDEN_NAME' } },
      ],
    });
    expect((await snapshot()).files).toEqual([]);
    expect((await snapshot()).views.find((v) => v.id === id)?.evidence).toBe('fresh');
  });

  it('keeps hidden names and ids out of Refresh change labels', () => {
    const id = answerView(store, agent, {
      projectId,
      question: 'What files exist?',
      widgets: [{ id: 'files', node: { component: 'FileList' } }],
    }).view.id;
    store.apply(owner, {
      message: 'Synthetic hidden change',
      operations: [
        { op: 'update', type: 'file', id: fileId, data: { notes: 'Synthetic private notes' } },
      ],
    });
    askRefresh(id);
    const brief = answerBrief(store, [projectId]);
    expect(brief).not.toContain(PRIVATE_TITLE);
    expect(brief).not.toContain(fileId);
    expect(brief).not.toContain(dir);
  });

  it('does not expose withheld note changes through snapshot evidence', () => {
    const folders = store.setting<Record<string, unknown>[]>(FOLDERS_SETTING)!;
    store.setSetting(
      FOLDERS_SETTING,
      folders.map((f) => ({ ...f, level: 'details' })),
    );
    const id = createView(store, agent, {
      projectId,
      name: 'Details',
      message: 'Details only',
      widgets: [{ id: 'files', node: { component: 'FileList' } }],
    }).view.id;
    store.apply(owner, {
      message: 'Owner notes only',
      operations: [
        { op: 'update', type: 'file', id: fileId, data: { notes: 'Synthetic withheld change' } },
      ],
    });
    expect(projectSnapshot(store, projectId).views.find((v) => v.id === id)?.evidence).toBe(
      'fresh',
    );
  });
});

describe('Refresh and evidence', () => {
  it('does not certify a prose-only answer as fresh after its underlying task changes', () => {
    const id = answerView(store, agent, {
      projectId,
      question: 'What is blocked?',
      widgets: [{ id: 'lead', node: { component: 'Text', content: 'One task is blocked.' } }],
    }).view.id;
    store.apply(owner, {
      message: 'Unblock fixture',
      operations: [{ op: 'update', type: 'task', id: taskId, data: { status: 'done' } }],
    });
    store.apply(owner, {
      message: 'Ask again',
      operations: [
        { op: 'create', type: 'request', data: { projectId, question: 'What is blocked?' } },
      ],
    });
    expect(answerBrief(store, [projectId]).includes(`answerViewId: "${id}"`)).toBe(false);
  });

  it('does not make old prose fresh by removing its evidence block with ops', () => {
    const id = staleAnswer();
    const before = store.getOfType('view', id).data.evidenceRevision;
    updateView(store, agent, {
      viewId: id,
      message: 'Remove evidence only',
      ops: [{ op: 'remove', id: 'list' }],
    });
    expect(store.getOfType('view', id).data.evidenceRevision).toBe(before);
    expect(JSON.stringify(store.getOfType('view', id).data.spec)).toContain('One task is blocked.');
    expect(evidenceState(store, store.getOfType('view', id))).not.toBe('fresh');
  });

  it('keeps a stale answer stale when Refresh only renames the tab', () => {
    const id = staleAnswer();
    const requestId = askRefresh(id);
    updateView(store, agent, {
      viewId: id,
      requestId,
      expectedRevision: store.getOfType('view', id).updatedRev,
      message: 'Rename only',
      name: 'Renamed fixture',
    });
    expect(JSON.stringify(store.getOfType('view', id).data.spec)).toContain('One task is blocked.');
    expect(evidenceState(store, store.getOfType('view', id))).toBe('stale');
    expect(answerBrief(store, [projectId])).not.toContain(`answerViewId: "${id}"`);
  });

  it('refuses view_answer creating a different page for a Refresh request', () => {
    const id = staleAnswer();
    const requestId = askRefresh(id);
    expect(() =>
      answerView(store, agent, {
        projectId,
        requestId,
        question: 'What is blocked?',
        widgets: [{ id: 'lead', node: { component: 'Text', content: 'Nothing is blocked.' } }],
      }),
    ).toThrow(/refresh|same view/i);
    expect(store.getOfType('request', requestId).data.status).toBe('open');
  });

  it('refuses linking a stale answer as the result of a Refresh through REST apply', async () => {
    const id = staleAnswer();
    const requestId = askRefresh(id);
    const response = await app.request('/api/apply', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: 'Reuse stale result',
        operations: [
          {
            op: 'update',
            type: 'request',
            id: requestId,
            data: { status: 'answered', answerViewId: id },
          },
        ],
      }),
    });
    expect(response.status).toBe(400);
    expect(store.getOfType('request', requestId).data.status).toBe('open');
  });

  it('refuses refreshing the wrong view through view_update', () => {
    const id = staleAnswer();
    const requestId = askRefresh(id);
    const other = answer();
    expect(() =>
      updateView(store, agent, {
        viewId: other,
        requestId,
        message: 'Wrong view',
        ops: [{ op: 'update', id: 'lead', set: { content: 'Nothing is blocked.' } }],
      }),
    ).toThrow(/refresh view/);
    expect(store.getOfType('request', requestId).data.status).toBe('open');
  });

  it('updates the same answer with a checked revision and preserves seen marks', () => {
    const id = staleAnswer();
    const requestId = askRefresh(id);
    const marks = store.setting(SEEN_SETTING);
    const before = store.latestRevisionId();
    updateView(store, agent, {
      viewId: id,
      requestId,
      expectedRevision: store.getOfType('view', id).updatedRev,
      message: 'Answer again',
      ops: [{ op: 'update', id: 'lead', set: { content: 'Nothing is blocked.' } }],
    });
    expect(store.getOfType('view', id).data.evidenceRevision).toBe(before);
    expect(evidenceState(store, store.getOfType('view', id))).toBe('fresh');
    expect(store.setting(SEEN_SETTING)).toEqual(marks);
    expect(store.getOfType('request', requestId).data.status).toBe('answered');
  });

  it('cannot use Refresh to escape an open block request', () => {
    const id = staleAnswer();
    const requestId = askRefresh(id);
    store.apply(owner, {
      message: 'Ask about one block',
      operations: [
        {
          op: 'create',
          type: 'request',
          data: {
            projectId,
            viewId: id,
            widgetId: 'list',
            question: 'Change this list',
            mode: 'block',
          },
        },
      ],
    });
    const before = store.getOfType('view', id);
    expect(() =>
      updateView(store, agent, {
        viewId: id,
        requestId,
        expectedRevision: before.updatedRev,
        message: 'Answer again',
        widgets: [{ id: 'lead', node: { component: 'Text', content: 'Nothing is blocked.' } }],
      }),
    ).toThrow();
    expect(store.getOfType('view', id)).toEqual(before);
  });

  it('allows replacing only the asked block without renewing evidence for the entire page', () => {
    const id = staleAnswer();
    const requestId = store.apply(owner, {
      message: 'Ask about the lead',
      operations: [
        {
          op: 'create',
          type: 'request',
          data: {
            projectId,
            viewId: id,
            widgetId: 'lead',
            question: 'Change this lead',
            mode: 'block',
          },
        },
      ],
    }).created['0']!;
    const before = store.getOfType('view', id);
    const next = widgets();
    next[0]!.node.content = 'Nothing is blocked.';
    expect(() =>
      updateView(store, agent, {
        viewId: id,
        requestId,
        expectedRevision: before.updatedRev,
        message: 'Only asked block',
        widgets: next,
      }),
    ).not.toThrow();
    expect(store.getOfType('view', id).data.evidenceRevision).toBe(before.data.evidenceRevision);
  });
});

describe('seen setting robustness', () => {
  it('refuses malformed JSON instead of silently marking the page seen', async () => {
    const id = staleAnswer();
    const before = store.setting(SEEN_SETTING);
    const response = await app.request(`/api/views/${id}/seen`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    expect(response.status).toBe(400);
    expect(store.setting(SEEN_SETTING)).toEqual(before);
  });

  it('clamps future marks, refuses invalid revisions, and does not create revisions', async () => {
    const id = answer();
    const latest = store.latestRevisionId();
    expect(markSeen(store, id, latest + 1000)).toBe(latest);
    for (const revision of [-1, 1.5, 'wrong'])
      expect(
        (
          await app.request(`/api/views/${id}/seen`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ revision }),
          })
        ).status,
      ).toBe(400);
    expect(store.latestRevisionId()).toBe(latest);
  });

  it('prunes marks for deleted views and rejects a deleted view or project', async () => {
    const id = answer();
    markSeen(store, id);
    store.apply(owner, {
      message: 'Delete fixture page',
      operations: [{ op: 'delete', type: 'view', id }],
    });
    const other = answer();
    markSeen(store, other);
    expect(
      store.setting<{ views: Record<string, number> }>(SEEN_SETTING)?.views,
    ).not.toHaveProperty(id);
    expect((await app.request(`/api/views/${id}/seen`, { method: 'PUT', body: '{}' })).status).toBe(
      404,
    );
    store.apply(owner, {
      message: 'Delete fixture project',
      operations: [{ op: 'delete', type: 'project', id: projectId }],
    });
    expect((await app.request(`/api/projects/${projectId}/freshness`)).status).toBe(404);
  });

  it('recovers a malformed stored view mark instead of suppressing future changes', () => {
    const id = answer();
    store.setSetting(SEEN_SETTING, {
      baseline: store.latestRevisionId(),
      views: { [id]: 'not a revision' },
    });
    store.apply(agent, {
      message: 'Relevant fixture change',
      operations: [{ op: 'update', type: 'task', id: taskId, data: { title: 'Changed fixture' } }],
    });
    expect(projectFreshness(store, projectId).views[id]?.changed).not.toBeNull();
    expect(Number.isFinite(markSeen(store, id))).toBe(true);
  });
});
