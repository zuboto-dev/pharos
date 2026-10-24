import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { openDatabase } from './store/database.js';
import { Store } from './store/store.js';

let app: ReturnType<typeof createApp>;
beforeEach(() => {
  app = createApp(new Store(openDatabase(':memory:')));
});

async function connect(name = 'test-agent') {
  const client = new Client({ name, version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL('http://localhost:4300/mcp'), {
    fetch: async (url, init) => app.fetch(new Request(url, init)),
  });
  await client.connect(transport);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
  const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
  if (result.isError) throw new Error(text);
  return JSON.parse(text);
}

describe('MCP', () => {
  it('lists tools and explains itself', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'action_run',
      'apply',
      'ask_owner',
      'catalog_describe',
      'catalog_list',
      'changes_since',
      'desk_list',
      'file_read_text',
      'files_unadded',
      'folder_request',
      'folder_request_status',
      'get',
      'history_diff',
      'history_list',
      'history_revert',
      'list',
      'pack_apply',
      'pack_list',
      'project_brief',
      'project_snapshot',
      'report_asset_list',
      'report_asset_put',
      'report_guide',
      'routine_propose',
      'run_report',
      'view_answer',
      'view_create',
      'view_delete',
      'view_get',
      'view_list',
      'view_preview',
      'view_update',
    ]);
    // View editing lives in the view tools, keeping apply's schema small. Files (R7) added about
    // 2k: agents may only update a file's details.
    const apply = JSON.stringify(tools.find((t) => t.name === 'apply')!.inputSchema);
    expect(apply).not.toContain('"Board"');
    // R7.12 added about 2.1k on top of R7.13 (49.6k): agents add scanned files, and five types
    // link files (fileIds).
    // R8 added about 9.4k: the record entity (fields, interval) and project.recordTypes, and
    // R10.19 about 1.9k (decision options). C1 (v0.2) brought it from 62k to under 48k: option
    // lists, record types, intervals and decision options are shared once in definitions, and an
    // update's fields are described once, in the create of the same type.
    // Raised from 50 000 on 2026-10-23 for decision.dependsOn, task.goalIds and project.rules
    // (connections and the owner's standing rules).
    expect(apply.length).toBeLessThan(51_000);
    expect(apply).toContain('"#/definitions/ProjectOptions"');
    expect(client.getInstructions()).toContain('apply');
  });

  it('creates two projects in one repository and records history by client name', async () => {
    const client = await connect('claude-code');
    const setup = await call(client, 'apply', {
      message: 'Set up Pharos projects',
      operations: [
        {
          op: 'create',
          type: 'repository',
          ref: 'repo',
          data: { name: 'pharos', path: '/code/pharos' },
        },
        { op: 'create', type: 'project', ref: 'app', data: { name: 'App', repositoryId: '$repo' } },
        {
          op: 'create',
          type: 'project',
          ref: 'site',
          data: { name: 'Site', repositoryId: '$repo' },
        },
        { op: 'create', type: 'stage', ref: 's1', data: { projectId: '$app', name: 'M1' } },
        { op: 'create', type: 'task', data: { projectId: '$app', title: 'Store', stageId: '$s1' } },
      ],
    });
    expect(setup.revision).toMatchObject({ id: 1, author: { kind: 'agent', name: 'claude-code' } });

    const projects = await call(client, 'list', {
      type: 'project',
      where: { repositoryId: setup.created.repo },
    });
    expect(projects.map((p: { name: string }) => p.name)).toEqual(['App', 'Site']);

    const snapshot = await call(client, 'project_snapshot', { projectId: setup.created.app });
    expect(snapshot.stages[0]).toMatchObject({ name: 'M1', tasks: { todo: 1 } });

    const history = await call(client, 'history_list', { projectId: setup.created.site });
    expect(history).toHaveLength(1);
    expect(history[0].message).toBe('Set up Pharos projects');
  });

  it('returns readable errors for invalid input', async () => {
    const client = await connect();
    const result = (await client.callTool({
      name: 'apply',
      arguments: {
        message: 'x',
        operations: [{ op: 'update', type: 'task', id: 'task_missing', data: {} }],
      },
    })) as CallToolResult;
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      text: expect.stringContaining('task task_missing not found'),
    });
  });
});

describe('claims over MCP and REST', () => {
  const post = (body: unknown) =>
    app.request('/api/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('stores findings, warns about missing sources, and leaves confirming to the owner', async () => {
    const client = await connect('claude-code');
    const { created, warnings } = await call(client, 'apply', {
      message: 'Record findings',
      operations: [
        { op: 'create', type: 'project', ref: 'p', data: { name: 'Map' } },
        {
          op: 'create',
          type: 'artifact',
          ref: 'src',
          data: { projectId: '$p', title: 'Report', uri: 'https://example.com/report' },
        },
        {
          op: 'create',
          type: 'decision',
          ref: 'd',
          // Decisions default to accepted; one for the owner to accept starts as proposed.
          data: { projectId: '$p', title: 'Keep our own format', status: 'proposed' },
        },
        {
          op: 'create',
          type: 'claim',
          ref: 'read',
          data: { projectId: '$p', statement: 'Nobody offers layer 5', checkedOn: '2026-10-01' },
        },
        {
          op: 'create',
          type: 'claim',
          ref: 'sourced',
          data: {
            projectId: '$p',
            statement: 'The report covers five layers',
            certainty: 'verified',
            checkedOn: '2026-10-01',
            sourceIds: ['$src'],
          },
        },
        {
          op: 'create',
          type: 'term',
          data: { projectId: '$p', word: 'recipe', explanation: 'What a view is drawn from' },
        },
      ],
    });
    expect(warnings).toEqual([
      `claim ${created.read} "Nobody offers layer 5" has no source: add sourceIds so the reader can check it`,
      `claim ${created.read} "Nobody offers layer 5" is "Our reading" but states no assumption: add assumption, what this reading takes for granted`,
      `claim ${created.sourced} "The report covers five layers" is "From source" but quotes nothing: add quote, the exact passage from the source that supports it`,
    ]);

    const confirm = {
      message: 'Confirm',
      operations: [
        {
          op: 'update',
          type: 'claim',
          id: created.read,
          data: { certainty: 'confirmed', confirmedById: created.d },
        },
      ],
    };
    // An agent can't accept the decision and confirm the claim itself...
    const refused = (await client.callTool({
      name: 'apply',
      arguments: {
        ...confirm,
        operations: [
          { op: 'update', type: 'decision', id: created.d, data: { status: 'accepted' } },
          ...confirm.operations,
        ],
      },
    })) as CallToolResult;
    expect(refused.isError).toBe(true);
    expect(refused.content[0]).toMatchObject({
      text: expect.stringContaining('not set by a person'),
    });

    // ...but once the owner accepts it in the app, the claim can say "Confirmed by you".
    const accept = await post({
      message: 'Accept',
      operations: [{ op: 'update', type: 'decision', id: created.d, data: { status: 'accepted' } }],
    });
    expect(accept.status).toBe(200);
    expect((await call(client, 'apply', confirm)).warnings).toEqual([]);

    const data = (await (await app.request(`/api/projects/${created.p}/data`)).json()) as {
      claims: { data: { certainty: string } }[];
      terms: { data: { word: string } }[];
    };
    expect(data.claims.map((c) => c.data.certainty)).toEqual(['confirmed', 'verified']);
    expect(data.terms.map((t) => t.data.word)).toEqual(['recipe']);
    const snapshot = await call(client, 'project_snapshot', { projectId: created.p });
    expect(snapshot.claims).toHaveLength(2);
    expect(snapshot.terms).toEqual([{ id: expect.any(String), word: 'recipe' }]);
  });

  it('refuses a From-source claim without a link over REST', async () => {
    const project = (await (
      await post({
        message: 'Project',
        operations: [{ op: 'create', type: 'project', ref: 'p', data: { name: 'Map' } }],
      })
    ).json()) as { created: { p: string } };
    const res = await post({
      message: 'Claim',
      operations: [
        {
          op: 'create',
          type: 'claim',
          data: {
            projectId: project.created.p,
            statement: 'It is open source',
            certainty: 'verified',
            checkedOn: '2026-10-01',
          },
        },
      ],
    });
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: { issues: string[] } };
    expect(error.issues[0]).toContain('"From source" needs sourceIds');
  });
});

describe('MCP views', () => {
  async function setup() {
    const client = await connect('claude-code');
    const { created } = await call(client, 'apply', {
      message: 'Set up',
      operations: [
        { op: 'create', type: 'project', ref: 'p', data: { name: 'App' } },
        { op: 'create', type: 'stage', ref: 's', data: { projectId: '$p', name: 'Build' } },
        { op: 'update', type: 'project', id: '$p', data: { currentStageId: '$s' } },
      ],
    });
    return { client, projectId: created.p as string };
  }

  it('describes the catalog for agents', async () => {
    const client = await connect();
    const list = await call(client, 'catalog_list', {});
    expect(list.board).toMatch(/12-column grid/);
    expect(list.components.find((c: { name: string }) => c.name === 'KanbanBoard')).toMatchObject({
      minColumns: 4,
      category: 'work',
    });
    const [tabs, kanban] = await call(client, 'catalog_describe', {
      names: ['Tabs', 'KanbanBoard'],
    });
    expect(JSON.stringify(tabs.schema).length).toBeLessThan(3000); // children summarised, not the whole catalog
    expect(kanban.schema.properties.groupBy.enum).toEqual([
      'status',
      'stage',
      'assignee',
      'priority',
    ]);
    expect(kanban.example.component).toBe('KanbanBoard');
    await expect(call(client, 'catalog_describe', { names: ['Kanban'] })).rejects.toThrow(
      /Unknown component: Kanban/,
    );
  });

  it('creates and edits a view with widget ops, recording revisions by the agent', async () => {
    const { client, projectId } = await setup();
    const [overview] = await call(client, 'view_list', { projectId });
    expect(overview).toMatchObject({ name: 'Overview', layout: 'template "overview"' });

    const { view } = await call(client, 'view_create', {
      projectId,
      name: 'This stage',
      message: 'Focus view for the current stage',
      widgets: [
        {
          id: 'progress',
          w: 4,
          node: { component: 'ProgressRing', where: { stageId: '$currentStage' } },
        },
        {
          id: 'work',
          w: 8,
          node: { component: 'KanbanBoard', filter: { where: { stageId: '$currentStage' } } },
        },
      ],
    });
    expect(view.widgets.map((w: { id: string }) => w.id)).toEqual(['progress', 'work']);

    const updated = await call(client, 'view_update', {
      viewId: view.id,
      message: 'Add a checklist, regroup the board',
      ops: [
        {
          op: 'add',
          widget: { id: 'mine', w: 6, node: { component: 'TaskChecklist', assigneeKind: 'human' } },
          after: 'progress',
        },
        { op: 'update', id: 'work', w: 6, set: { groupBy: 'assignee', title: 'By person' } },
        { op: 'move', id: 'progress', after: 'work' },
      ],
    });
    expect(updated.revision.author).toEqual({ kind: 'agent', name: 'claude-code' });
    expect(updated.view.widgets).toEqual([
      { id: 'mine', component: 'TaskChecklist', w: 6 },
      { id: 'work', component: 'KanbanBoard', title: 'By person', w: 6 },
      { id: 'progress', component: 'ProgressRing', w: 4 },
    ]);

    const full = await call(client, 'view_get', { viewId: view.id });
    expect(full.board.widgets[1].node).toEqual({
      component: 'KanbanBoard',
      title: 'By person',
      groupBy: 'assignee',
      filter: { where: { stageId: '$currentStage' } },
    });
  });

  it('customizes and resets a template view', async () => {
    const { client, projectId } = await setup();
    const [overview] = await call(client, 'view_list', { projectId });
    const edited = await call(client, 'view_update', {
      viewId: overview.id,
      message: 'Drop activity',
      ops: [{ op: 'remove', id: 'activity' }],
    });
    expect(edited.view.layout).toBe('customized from template "overview"');
    expect(edited.view.widgets.some((w: { id: string }) => w.id === 'activity')).toBe(false);
    const reset = await call(client, 'view_update', {
      viewId: overview.id,
      message: 'Back to default',
      resetToTemplate: true,
    });
    expect(reset.view.layout).toBe('template "overview"');
  });

  it('answers a question with an answer view that can be kept', async () => {
    const { client, projectId } = await setup();
    const answer = await call(client, 'view_answer', {
      projectId,
      question: "What's left in the current stage?",
      widgets: [
        {
          id: 'list',
          node: {
            component: 'DataList',
            query: { type: 'task', where: { stageId: '$currentStage' } },
          },
        },
      ],
    });
    expect(answer.revision.message).toBe("Answer: What's left in the current stage?");
    expect(answer.view).toMatchObject({
      kind: 'answer',
      question: "What's left in the current stage?",
      name: "What's left in the current stage?",
    });
    expect(answer.view.url).toBe(
      `http://localhost:5173/projects/${projectId}/views/${answer.view.id}`,
    );
    const days = (Date.parse(answer.view.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);

    const snapshot = await call(client, 'project_snapshot', { projectId });
    expect(snapshot.views.find((v: { id: string }) => v.id === answer.view.id)).toMatchObject({
      kind: 'answer',
    });

    const kept = await call(client, 'view_update', {
      viewId: answer.view.id,
      message: 'Keep it',
      keep: true,
    });
    expect(kept.view).not.toHaveProperty('kind');
    expect(kept.view).not.toHaveProperty('expiresAt');
    expect(kept.view.description).toBe("What's left in the current stage?");
    await expect(
      call(client, 'view_update', { viewId: answer.view.id, message: 'again', keep: true }),
    ).rejects.toThrow(/not an answer view/);
  });

  it('answers a request a person asked from the UI, resolving it', async () => {
    const { client, projectId } = await setup();
    // The web app creates requests through REST, as the human user.
    const asked = await app.request('/api/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: 'Ask: is the build stage on track?',
        operations: [
          {
            op: 'create',
            type: 'request',
            ref: 'r',
            data: {
              projectId,
              question: 'Is the build stage on track?',
              about: 'Stages widget in Overview',
            },
          },
        ],
      }),
    });
    const requestId = ((await asked.json()) as { created: { r: string } }).created.r;

    const before = await call(client, 'project_snapshot', { projectId });
    expect(before.requests).toEqual([
      expect.objectContaining({
        id: requestId,
        question: 'Is the build stage on track?',
        about: 'Stages widget in Overview',
      }),
    ]);

    const answer = await call(client, 'view_answer', {
      projectId,
      requestId,
      question: 'Is the build stage on track?',
      widgets: [{ id: 'a', node: { component: 'Text', content: 'Yes.' } }],
    });
    const request = await call(client, 'get', { id: requestId });
    expect(request.data).toMatchObject({ status: 'answered', answerViewId: answer.view.id });
    expect((await call(client, 'project_snapshot', { projectId })).requests).toEqual([]);
  });

  it('tells an agent what others changed since it last looked', async () => {
    const { client, projectId } = await setup(); // set up by "claude-code"
    const first = await call(client, 'changes_since', { projectId });
    expect(first).toMatchObject({ since: null, count: 0 }); // its own setup doesn't count

    const tasks = await app.request('/api/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: 'Add a task by hand',
        operations: [{ op: 'create', type: 'task', data: { projectId, title: 'Write docs' } }],
      }),
    });
    expect(tasks.status).toBe(200);
    expect((await call(client, 'project_snapshot', { projectId })).unseenChanges).toBe(1);

    const changes = await call(client, 'changes_since', { projectId });
    expect(changes.count).toBe(1);
    expect(changes.revisions[0]).toMatchObject({
      author: 'human:me',
      message: 'Add a task by hand',
      changes: [{ op: 'create', type: 'task', label: 'Write docs' }],
    });
    expect((await call(client, 'changes_since', { projectId })).count).toBe(0);

    // Another agent has its own place.
    const other = await connect('cursor');
    expect((await call(other, 'changes_since', { projectId, mark: false })).count).toBe(2); // setup + the person's change
    expect((await call(other, 'changes_since', { projectId, onlyPeople: true })).count).toBe(1);
  });

  it('explains mistakes precisely', async () => {
    const { client, projectId } = await setup();
    const [overview] = await call(client, 'view_list', { projectId });
    await expect(
      call(client, 'view_update', {
        viewId: overview.id,
        message: 'x',
        ops: [{ op: 'update', id: 'tasks', set: { groupBy: 'colour' } }],
      }),
    ).rejects.toThrow(/ops\[0\]\.set\.groupBy: Invalid option/);
    await expect(
      call(client, 'view_update', {
        viewId: overview.id,
        message: 'x',
        ops: [{ op: 'remove', id: 'nope' }],
      }),
    ).rejects.toThrow(/ops\[0\]: no widget "nope" on this board/);
    await expect(
      call(client, 'view_create', {
        projectId,
        name: 'Bad',
        message: 'x',
        widgets: [{ id: 'a', node: { component: 'Pie' } }],
      }),
    ).rejects.toThrow(/\[0\]\.node\.component: Invalid discriminator/);
    // Views can't be written through apply any more.
    const res = (await client.callTool({
      name: 'apply',
      arguments: { message: 'x', operations: [{ op: 'delete', type: 'view', id: overview.id }] },
    })) as CallToolResult;
    expect(res.isError).toBe(true);
  });
});

describe('REST', () => {
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  it('applies changes as the human user by default and reverts them', async () => {
    const res = await post('/api/apply', {
      message: 'Add project',
      operations: [{ op: 'create', type: 'project', data: { name: 'From UI' } }],
    });
    expect(res.status).toBe(200);
    const { revision } = (await res.json()) as { revision: { id: number; author: unknown } };
    expect(revision.author).toEqual({ kind: 'human', name: 'me' });

    expect(await (await app.request('/api/entities/project')).json()).toHaveLength(1);
    expect((await post(`/api/revisions/${revision.id}/revert`, {})).status).toBe(200);
    expect(await (await app.request('/api/entities/project')).json()).toHaveLength(0);
    expect((await post(`/api/revisions/${revision.id}/revert`, {})).status).toBe(409);
  });

  it('reports validation errors with paths', async () => {
    const res = await post('/api/apply', {
      message: 'Bad',
      operations: [{ op: 'create', type: 'project', data: { name: 'X', status: 'nope' } }],
    });
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as { error: { issues: string[] } };
    expect(error.issues[0]).toMatch(/^operations\[0\]\.data\.status: Invalid option/);
  });

  it('rejects non-local hosts and origins', async () => {
    expect((await app.request('http://evil.example/api/health')).status).toBe(403);
    expect(
      (
        await app.request('http://localhost/api/health', {
          headers: { origin: 'https://evil.example' },
        })
      ).status,
    ).toBe(403);
    expect((await app.request('http://localhost:4300/api/health')).status).toBe(200);
  });

  it('also trusts the host and exact origin of a non-local web address, and nothing else', async () => {
    const hosted = createApp(new Store(openDatabase(':memory:')), undefined, undefined, {
      webUrl: 'https://pharos.example.com',
    });
    const status = async (url: string, origin?: string, method = 'GET') =>
      (
        await hosted.request(url, {
          method,
          headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
          ...(method === 'POST' ? { body: '{}' } : {}),
        })
      ).status;
    expect(await status('https://pharos.example.com/api/health')).toBe(200);
    expect(await status('http://localhost:4300/api/health', 'https://pharos.example.com')).toBe(
      200,
    );
    // A browser write from that page reaches the route (400: the empty body is invalid), not 403.
    expect(
      await status('https://pharos.example.com/api/apply', 'https://pharos.example.com', 'POST'),
    ).toBe(400);
    expect(await status('http://evil.example/api/health')).toBe(403);
    expect(await status('https://pharos.example.com/api/health', 'https://evil.example')).toBe(403);
    // The origin must match exactly: another scheme or port is a different site.
    expect(await status('https://pharos.example.com/api/health', 'http://pharos.example.com')).toBe(
      403,
    );
    expect(
      await status('https://pharos.example.com/api/health', 'https://pharos.example.com:8443'),
    ).toBe(403);
    expect(await status('https://sub.pharos.example.com/api/health')).toBe(403);
  });

  it('adds nothing when the web address is local or not a web address', async () => {
    for (const webUrl of ['http://localhost:4300', 'not a url', 'file:///tmp/x']) {
      const local = createApp(new Store(openDatabase(':memory:')), undefined, undefined, {
        webUrl,
      });
      expect((await local.request('http://evil.example/api/health')).status).toBe(403);
      expect((await local.request('http://localhost:4300/api/health')).status).toBe(200);
    }
  });
});

describe('serving the built web app', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('compresses text for a browser that accepts it, never the live feed', async () => {
    const store = new Store(openDatabase(':memory:'));
    store.apply(
      { kind: 'agent', name: 'a' },
      {
        message: 'many tasks',
        operations: [
          { op: 'create', type: 'project', ref: 'p', data: { name: 'Garden' } },
          ...Array.from({ length: 40 }, (_, i) => ({
            op: 'create' as const,
            type: 'task' as const,
            data: { projectId: '$p', title: `Water bed ${i}` },
          })),
        ],
      },
    );
    const app = createApp(store);
    const gz = { 'accept-encoding': 'gzip' };
    const list = await app.request('/api/entities/task', { headers: gz });
    expect(list.headers.get('content-encoding')).toBe('gzip');
    const events = new AbortController();
    const feed = await app.request('/api/events', { headers: gz, signal: events.signal });
    expect(feed.headers.get('content-encoding')).toBeNull();
    events.abort();
  });

  it('serves files, answers page routes with index.html, and keeps the API separate', async () => {
    const webDir = mkdtempSync(join(tmpdir(), 'pharos-web-'));
    dirs.push(webDir);
    mkdirSync(join(webDir, 'assets'));
    writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>Pharos</title>');
    writeFileSync(join(webDir, 'assets', 'app.js'), 'console.log(1)');
    const served = createApp(new Store(openDatabase(':memory:')), undefined, undefined, { webDir });

    const home = await served.request('/');
    expect(home.status).toBe(200);
    expect(await home.text()).toContain('<title>Pharos</title>');
    const page = await served.request('/projects/prj_1/views/view_2');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<title>Pharos</title>');
    const asset = await served.request('/assets/app.js');
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toMatch(/javascript/);
    // Named by content: kept for good. The page itself is asked for each time.
    expect(asset.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(home.headers.get('cache-control') ?? '').not.toContain('immutable');
    // The app's pages may frame only Pharos addresses (R13.6); other files carry no such header.
    expect(home.headers.get('content-security-policy')).toContain("frame-src 'self'");
    expect(page.headers.get('content-security-policy')).toContain("frame-src 'self'");
    expect(asset.headers.get('content-security-policy')).toBeNull();
    // And no other site may frame the app (R13.6 finding 6).
    expect(home.headers.get('content-security-policy')).toContain("frame-ancestors 'self'");
    expect(home.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(page.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    const api = await served.request('/api/health');
    expect(api.headers.get('content-type')).toMatch(/json/);
    expect(api.headers.get('content-security-policy')).toBeNull();
    expect((await served.request('/api/nothing')).status).toBe(404);
  });

  it('is off unless a web directory is given', async () => {
    expect((await app.request('/')).status).toBe(404);
  });
});
