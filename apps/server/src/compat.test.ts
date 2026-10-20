// The agent-compatibility kit (eval/compat): its guards, its agent commands, and its checkers
// against hand-made states and against a real in-process server driven by a scripted "agent"
// over MCP. No real agent runs here.
import { serve, type ServerType } from '@hono/node-server';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ENTITY_TYPES } from '@pharos/schema';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { DOC_EXAMPLE } from './guidance.js';
import { openDatabase } from './store/database.js';
import { Store } from './store/store.js';

type Check = { id: string; pass: boolean; note: string };
type Entity = { id: string; type: string; data: Record<string, unknown> };
type State = {
  before: Entity[];
  after: Entity[];
  revisions: Array<{
    id: number;
    author: { kind: string; name: string };
    message: string;
    changes?: Array<{ id: string; fields?: Record<string, unknown> }>;
  }>;
  folderRequests: Array<Record<string, unknown>>;
  previews: Record<string, unknown>;
  finalMessage: string;
};
type Ctx = { tag: string; ids: Record<string, string>; folderPath?: string };
type Scenario = {
  id: string;
  projectName: (ctx: Ctx) => string;
  seed?: (ctx: Ctx) => unknown;
  prompt: (ctx: Ctx) => string;
  needsFolder?: boolean;
  previewIds?: (state: State, ctx: Ctx) => string[];
  check: (state: State, ctx: Ctx) => Check[];
};
type Api = ReturnType<RunModule['restClient']>;
type RunModule = {
  ENTITY_TYPES: string[];
  checkUrl: (raw: string) => string;
  parseArgs: (argv: string[]) => Record<string, unknown>;
  agentCommand: (
    agent: string,
    options: { url: string; prompt: string; dir: string; model?: string },
  ) => { command: string; args: string[] } | undefined;
  restClient: (base: string) => {
    get: (path: string) => Promise<unknown>;
    apply: (input: unknown) => Promise<{ created: Record<string, string> }>;
    folderRequests: () => Promise<unknown[]>;
  };
  allEntities: (api: Api) => Promise<Entity[]>;
  prepare: (api: Api, scenario: Scenario, run: { tag: string; scratch: string }) => Promise<Ctx>;
  collect: (
    api: Api,
    base: string,
    scenario: Scenario,
    ctx: Ctx,
    before: Entity[],
    start: number,
    finalMessage?: string,
  ) => Promise<State>;
  table: (rows: unknown[]) => string;
  main: (argv: string[]) => Promise<number>;
};
type ChecksModule = {
  changedEntities: (state: Pick<State, 'before' | 'after'>) => Array<{ op: string }>;
  commonChecks: (state: State, projectId?: string, options?: object) => Check[];
  meaningOf: (project: unknown, key: string, value: string) => string;
  componentsOf: (view: unknown) => string[];
  previewProblems: (preview: unknown) => string[];
  docLiveReads: (doc: unknown) => string[];
};

const compat = resolve(process.cwd(), '../../eval/compat');
const load = async <T>(name: string) => (await import(pathToFileURL(join(compat, name)).href)) as T;
const runner = await load<RunModule>('run.mjs');
const checks = await load<ChecksModule>('checks.mjs');
const { SCENARIOS } = await load<{ SCENARIOS: Scenario[] }>('scenarios.mjs');
const scenario = (id: string) => SCENARIOS.find((s) => s.id === id)!;
const failed = (results: Check[]) => results.filter((c) => !c.pass).map((c) => c.id);

describe('compat runner guards', () => {
  it('keeps its entity types in step with the schema', () => {
    expect(runner.ENTITY_TYPES).toEqual([...ENTITY_TYPES]);
  });

  it('refuses port 4300, non-local hosts and missing ports', () => {
    expect(runner.checkUrl('http://127.0.0.1:4391/')).toBe('http://127.0.0.1:4391');
    expect(runner.checkUrl('http://localhost:5000')).toBe('http://localhost:5000');
    expect(() => runner.checkUrl('http://127.0.0.1:4300')).toThrow(/4300/);
    expect(() => runner.checkUrl('http://localhost:4300/mcp')).toThrow(/4300/);
    expect(() => runner.checkUrl('http://example.com:4391')).toThrow(/this machine/);
    expect(() => runner.checkUrl('http://192.168.1.5:4391')).toThrow(/this machine/);
    expect(() => runner.checkUrl('https://localhost:4391')).toThrow(/http/);
    expect(() => runner.checkUrl('http://localhost')).toThrow(/port/);
  });

  it('parses its options and refuses unknown agents and scenarios', () => {
    expect(
      runner.parseArgs(['--agent', 'codex', '--url', 'http://127.0.0.1:4391', '--only', 'pack']),
    ).toMatchObject({ agent: 'codex', url: 'http://127.0.0.1:4391', only: ['pack'] });
    expect(() => runner.parseArgs(['--agent', 'gemini', '--url', 'http://127.0.0.1:1'])).toThrow(
      /--agent/,
    );
    expect(() => runner.parseArgs(['--agent', 'claude'])).toThrow(/--url/);
    expect(() =>
      runner.parseArgs(['--agent', 'claude', '--url', 'http://127.0.0.1:1', '--only', 'nope']),
    ).toThrow(/Unknown scenario/);
  });

  it('connects each agent only to the test server, with per-run flags', () => {
    const dir = mkdtempSync(join(tmpdir(), 'compat-cmd-'));
    try {
      const url = 'http://127.0.0.1:4391';
      const claude = runner.agentCommand('claude', { url, prompt: 'hi', dir })!;
      expect(claude.command).toBe('claude');
      expect(claude.args).toEqual(
        expect.arrayContaining(['--strict-mcp-config', '--allowedTools', 'mcp__pharos__*']),
      );
      expect(claude.args[claude.args.indexOf('--tools') + 1]).toBe('');
      expect(JSON.parse(readFileSync(join(dir, 'mcp.json'), 'utf8'))).toEqual({
        mcpServers: { pharos: { type: 'http', url: `${url}/mcp` } },
      });
      const codex = runner.agentCommand('codex', { url, prompt: 'hi', dir })!;
      expect(codex.args.slice(0, 2)).toEqual(['exec', '--skip-git-repo-check']);
      expect(codex.args).toEqual(
        expect.arrayContaining([
          '--ignore-user-config',
          `mcp_servers.pharos.url="${url}/mcp"`,
          'mcp_servers.pharos.default_tools_approval_mode="approve"',
        ]),
      );
      expect(codex.args.at(-1)).toBe('hi');
      expect(runner.agentCommand('opencode', { url, prompt: 'hi', dir })).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports OpenCode as not supported yet, without contacting the server', async () => {
    const lines: string[] = [];
    const log = console.log;
    console.log = (line: string) => lines.push(line);
    try {
      expect(await runner.main(['--agent', 'opencode', '--url', 'http://127.0.0.1:1'])).toBe(2);
    } finally {
      console.log = log;
    }
    expect(lines.join('\n')).toMatch(/not supported yet/);
  });

  it('prints a results table', () => {
    expect(
      runner.table([
        { scenario: 'setup', pass: true, seconds: 12, notes: '' },
        { scenario: 'pack', pass: false, seconds: 30, notes: 'vehicle-record: 0 | 1' },
      ]),
    ).toBe(
      [
        '| Scenario | Result | Seconds | Notes |',
        '| --- | --- | --- | --- |',
        '| setup | pass | 12 |  |',
        '| pack | FAIL | 30 | vehicle-record: 0 / 1 |',
      ].join('\n'),
    );
  });
});

// ------------------------------------------------------------------ hand-made states

const project = (id: string, data: Record<string, unknown> = {}): Entity => ({
  id,
  type: 'project',
  data: { name: id, status: 'active', ...data },
});
const task = (id: string, projectId: string, status = 'todo'): Entity => ({
  id,
  type: 'task',
  data: { projectId, title: id, status },
});
const rev = (id: number, kind = 'agent', message = 'Because') => ({
  id,
  author: { kind, name: kind === 'agent' ? 'claude-code' : 'me' },
  message,
});
const state = (over: Partial<State>): State => ({
  before: [],
  after: [],
  revisions: [],
  folderRequests: [],
  previews: {},
  finalMessage: '',
  ...over,
});

describe('compat checks on hand-made states', () => {
  it('finds created, updated and deleted entities', () => {
    const ops = checks
      .changedEntities({
        before: [task('a', 'p'), task('b', 'p'), task('c', 'p')],
        after: [task('a', 'p'), task('b', 'p', 'done'), task('d', 'p')],
      })
      .map((c) => c.op)
      .sort();
    expect(ops).toEqual(['create', 'delete', 'update']);
  });

  it('fails a person’s revision, a change outside the project and a missing message', () => {
    const before = [project('p'), project('q'), task('t', 'p'), task('u', 'q')];
    const ok = state({
      before,
      after: [project('p'), project('q'), task('t', 'p', 'done'), task('u', 'q')],
      revisions: [rev(5)],
    });
    expect(failed(checks.commonChecks(ok, 'p'))).toEqual([]);
    const bad = state({
      before,
      after: [project('p'), project('q'), task('t', 'p', 'done'), task('u', 'q', 'done')],
      revisions: [rev(5), rev(6, 'human'), rev(7, 'agent', ' ')],
    });
    expect(failed(checks.commonChecks(bad, 'p'))).toEqual([
      'author-is-agent',
      'revision-messages',
      'nothing-outside-changed',
    ]);
    expect(failed(checks.commonChecks(state({}), 'p'))).toEqual(['agent-wrote']);
    expect(failed(checks.commonChecks(state({}), 'p', { expectRevisions: false }))).toEqual([]);
  });

  it('allows an agent to add an assignee for itself, and nothing else outside', () => {
    const agent = { id: 'asg_1', type: 'assignee', data: { name: 'Claude', kind: 'agent' } };
    const human = { id: 'asg_2', type: 'assignee', data: { name: 'Sam', kind: 'human' } };
    const ok = state({ after: [agent], revisions: [rev(1)] });
    expect(failed(checks.commonChecks(ok, 'p'))).toEqual([]);
    const bad = state({ after: [agent, human], revisions: [rev(1)] });
    expect(failed(checks.commonChecks(bad, 'p'))).toEqual(['nothing-outside-changed']);
  });

  it('reads option values by meaning, custom lists included', () => {
    const custom = project('p', {
      options: { 'task.status': [{ value: 'shipped', label: 'Shipped', meaning: 'done' }] },
    });
    expect(checks.meaningOf(custom, 'task.status', 'shipped')).toBe('done');
    expect(checks.meaningOf(project('q'), 'task.status', 'done')).toBe('done');
  });

  it('marks a task done only by meaning, and leaves the other tasks alone', () => {
    const markDone = scenario('mark-done');
    const ctx = { tag: 't', ids: { project: 'p', order: 'o', paint: 'x', labels: 'l' } };
    const custom = project('p', {
      options: { 'task.status': [{ value: 'shipped', label: 'Shipped', meaning: 'done' }] },
    });
    const before = [custom, task('o', 'p'), task('x', 'p'), task('l', 'p', 'in_progress')];
    const good = state({
      before,
      after: [custom, task('o', 'p'), task('x', 'p', 'shipped'), task('l', 'p', 'in_progress')],
      revisions: [{ ...rev(9), changes: [{ id: 'x', fields: { status: {} } }] }],
    });
    expect(failed(markDone.check(good, ctx))).toEqual([]);
    const wrong = state({
      before,
      after: [custom, task('o', 'p', 'shipped'), task('x', 'p', 'done'), before[3]!],
      revisions: [{ ...rev(9), changes: [{ id: 'o', fields: { status: {} } }] }],
    });
    expect(failed(markDone.check(wrong, ctx))).toEqual([
      'other-task-unchanged-order',
      'done-revision-has-message',
    ]);
  });

  it('finds components anywhere in a spec and reads preview problems', () => {
    const view = {
      data: {
        spec: {
          component: 'Board',
          widgets: [
            { id: 'a', node: { component: 'StartHere' } },
            { id: 'b', node: { component: 'Stack', children: [{ component: 'TaskTable' }] } },
          ],
        },
      },
    };
    expect(checks.componentsOf(view)).toEqual(['Board', 'StartHere', 'Stack', 'TaskTable']);
    expect(checks.componentsOf({ data: {} })).toEqual([]);
    expect(checks.previewProblems(undefined)).toEqual(['no preview']);
    expect(
      checks.previewProblems({
        findings: [
          { level: 'warn', message: 'just a warning' },
          { level: 'reject', message: 'unknown field' },
        ],
        warnings: ['no StartHere'],
      }),
    ).toEqual(['query: unknown field', 'no StartHere']);
  });

  it('passes a report question only with a report document that reads live data (R4)', () => {
    const reportAnswer = scenario('report-answer');
    const ctx = { tag: 't', ids: { project: 'p', request: 'q' } };
    const asked = { id: 'q', type: 'request', data: { projectId: 'p', status: 'open' } };
    const answered = (viewId: string) => ({
      ...asked,
      data: { ...asked.data, status: 'answered', answerViewId: viewId },
    });
    const view = (id: string, layout: Record<string, unknown>): Entity => ({
      id,
      type: 'view',
      data: { projectId: 'p', name: 'Why', kind: 'answer', ...layout },
    });
    const live = view('v1', {
      doc: {
        summary: 'Groceries rose.',
        blocks: [
          {
            kind: 'block',
            id: 'lead',
            node: {
              component: 'Text',
              content: 'We spent ${total}.',
              values: { total: { count: { type: 'record' } } },
            },
          },
          {
            kind: 'columns',
            id: 'nums',
            columns: [
              [{ kind: 'block', id: 'n', node: { component: 'Stat', query: { type: 'record' } } }],
            ],
          },
        ],
      },
    });
    const ok = state({
      before: [project('p'), asked],
      after: [project('p'), answered('v1'), live],
      revisions: [rev(3)],
      previews: { v1: { warnings: [], findings: [] } },
    });
    expect(failed(reportAnswer.check(ok, ctx))).toEqual([]);
    expect(checks.docLiveReads(live.data.doc)).toEqual(['lead: Text values', 'n: Stat query']);
    expect(reportAnswer.previewIds!(ok, ctx)).toEqual(['v1']);

    // Typed-in numbers: a document that reads nothing, with a preview warning.
    const typed = view('v2', {
      doc: {
        blocks: [{ kind: 'block', id: 'lead', node: { component: 'Text', content: '€640.' } }],
      },
    });
    const flat = state({
      before: [project('p'), asked],
      after: [project('p'), answered('v2'), typed],
      revisions: [rev(3)],
      previews: { v2: { warnings: ['No summary'], findings: [] } },
    });
    expect(failed(reportAnswer.check(flat, ctx))).toEqual([
      'reads-live-data',
      'passes-view-checks',
    ]);

    // A board answer to a "why … compare" question is the wrong kind.
    const board = view('v3', {
      spec: {
        component: 'Board',
        widgets: [{ id: 't', node: { component: 'TaskTable', filter: { where: {} } } }],
      },
    });
    const wrongKind = state({
      before: [project('p'), asked],
      after: [project('p'), answered('v3'), board],
      revisions: [rev(3)],
      previews: { v3: { warnings: [], findings: [] } },
    });
    expect(failed(reportAnswer.check(wrongKind, ctx))).toEqual([
      'is-report-document',
      'reads-live-data',
    ]);
    expect(checks.docLiveReads(undefined)).toEqual([]);
  });

  it('fails a folder scenario where the agent asked for nothing or did not stop', () => {
    const folder = scenario('folder-request');
    const ctx = { tag: 't', ids: { project: 'p' }, folderPath: '/made/up/papers' };
    const asked = {
      path: '/made/up/papers',
      status: 'pending',
      projectId: 'p',
      requestedBy: 'codex',
    };
    const ok = state({
      before: [project('p')],
      after: [project('p')],
      folderRequests: [asked],
      finalMessage: 'Waiting for the owner to approve the folder in Pharos.',
    });
    expect(failed(folder.check(ok, ctx))).toEqual([]);
    const none = state({ before: [project('p')], after: [project('p')], finalMessage: 'Done.' });
    expect(failed(folder.check(none, ctx))).toEqual([
      'folder-requested',
      'request-pending',
      'for-the-project',
      'requested-by-agent',
      'says-it-waits',
    ]);
  });
});

// ------------------------------------------------------------------ a scripted agent

describe('compat scenarios against a real server', () => {
  let server: ServerType;
  let base: string;
  let api: Api;
  let scratch: string;
  let start = 0;
  let before: Entity[] = [];
  let agent: Client;

  beforeAll(async () => {
    scratch = mkdtempSync(join(tmpdir(), 'compat-e2e-'));
    const app = createApp(new Store(openDatabase(':memory:')));
    await new Promise<void>((done) => {
      server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, () => done());
    });
    const address = server.address() as { port: number };
    base = `http://127.0.0.1:${address.port}`;
    api = runner.restClient(base);
    // A project outside every scenario, which must stay as it is.
    await api.apply({
      message: 'Unrelated made-up project',
      operations: [{ op: 'create', type: 'project', data: { name: 'Bystander' } }],
    });
    agent = new Client({ name: 'scripted-agent', version: '1.0.0' });
    await agent.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  });

  afterAll(async () => {
    await agent?.close();
    await new Promise((done) => server?.close(done));
    rmSync(scratch, { recursive: true, force: true });
  });

  const call = async (name: string, args: Record<string, unknown>) => {
    const result = (await agent.callTool({ name, arguments: args })) as CallToolResult;
    const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
    if (result.isError) throw new Error(text);
    return JSON.parse(text) as Record<string, unknown>;
  };
  const begin = async (id: string) => {
    const ctx = await runner.prepare(api, scenario(id), { tag: 'e2e', scratch });
    before = await runner.allEntities(api);
    start = ((await api.get('/settings')) as { revisions: number }).revisions;
    return ctx;
  };
  const finish = async (id: string, ctx: Ctx, finalMessage = '') => {
    const s = scenario(id);
    return s.check(await runner.collect(api, base, s, ctx, before, start, finalMessage), ctx);
  };

  it('a) setup: passes when done right, fails when a stage is missing', async () => {
    const ctx = await begin('setup');
    const name = scenario('setup').projectName(ctx);
    await call('apply', {
      message: 'Set up the bakery site project from the brief',
      operations: [
        { op: 'create', type: 'project', ref: 'p', data: { name } },
        { op: 'create', type: 'goal', data: { projectId: '$p', title: 'Launch the site' } },
        { op: 'create', type: 'stage', ref: 's', data: { projectId: '$p', name: 'Build' } },
        ...['Write the menu page', 'Add opening hours', 'Publish the site'].map((title) => ({
          op: 'create',
          type: 'task',
          data: { projectId: '$p', stageId: '$s', title },
        })),
      ],
    });
    const results = await finish('setup', ctx);
    expect(failed(results)).toEqual([]);
    expect(results.find((c) => c.id === 'author-is-agent')?.note).toBe('scripted-agent');

    const again = await begin('setup');
    await call('apply', {
      message: 'Half a setup',
      operations: [
        { op: 'create', type: 'project', ref: 'p', data: { name: `${name} 2` } },
        { op: 'create', type: 'task', data: { projectId: '$p', title: 'Write the menu page' } },
      ],
    });
    // The name differs, so the scenario's project isn't found and the new one is "outside".
    expect(failed(await finish('setup', again))).toEqual([
      'project-created',
      'nothing-outside-changed',
    ]);
  });

  it('b) mark done: passes for the agent, fails when a person did it', async () => {
    const ctx = await begin('mark-done');
    await call('apply', {
      message: 'The floor arrows are painted',
      operations: [{ op: 'update', type: 'task', id: ctx.ids.paint, data: { status: 'done' } }],
    });
    expect(failed(await finish('mark-done', ctx))).toEqual([]);

    const human = await begin('mark-done');
    await api.apply({
      message: 'Done by hand',
      operations: [{ op: 'update', type: 'task', id: human.ids.paint, data: { status: 'done' } }],
    });
    expect(failed(await finish('mark-done', human))).toEqual(['agent-wrote', 'author-is-agent']);
  });

  it('c) answer view: passes with a StartHere and a TaskTable, fails without them', async () => {
    const ctx = await begin('answer-view');
    const snapshot = await call('project_snapshot', { projectId: ctx.ids.project });
    const tasks = (snapshot.tasks as Array<{ id: string; status: string }>).filter(
      (t) => t.status !== 'done',
    );
    await call('view_answer', {
      projectId: ctx.ids.project,
      requestId: ctx.ids.request,
      question: 'What is still left before the library move is finished?',
      widgets: [
        {
          id: 'start',
          node: {
            component: 'StartHere',
            purpose: 'found',
            why: 'To see what stands between us and a finished library move',
            headline:
              'Three tasks are left: packing the reference shelves, the tables and the desk.',
            evidence: tasks.map((t) => t.id),
            yourPart: 'Nothing now; read the list below.',
            date: '2026-10-14',
            path: [
              { label: 'Tasks left', target: 'left' },
              { label: 'Everything', target: 'all' },
            ],
          },
        },
        {
          id: 'left',
          node: {
            component: 'TaskTable',
            title: 'Left to do',
            filter: { where: { status: { not: 'done' } } },
          },
        },
        { id: 'all', node: { component: 'TaskTable', title: 'All tasks' } },
      ],
    });
    const results = await finish('answer-view', ctx);
    expect(results.filter((c) => !c.pass)).toEqual([]);

    const thin = await begin('answer-view');
    await call('view_answer', {
      projectId: thin.ids.project,
      requestId: thin.ids.request,
      question: 'What is left?',
      widgets: [{ id: 'note', node: { component: 'Callout', body: 'Some tasks are left.' } }],
    });
    expect(failed(await finish('answer-view', thin))).toEqual(['has-start-here', 'has-task-table']);
  });

  it('d) pack: passes with the car pack and a vehicle record', async () => {
    const ctx = await begin('pack');
    const name = scenario('pack').projectName(ctx);
    const applied = await call('pack_apply', { pack: 'car', name });
    const projectId = (applied.projectId ?? (applied.project as { id: string })?.id) as string;
    expect(projectId).toBeTruthy();
    await call('apply', {
      message: 'Add the car',
      operations: [
        {
          op: 'create',
          type: 'record',
          data: {
            projectId,
            recordType: 'vehicle',
            title: 'Made-up Motors Runabout',
            fields: { make: 'Made-up Motors', model: 'Runabout', year: 2019, plate: 'CMP-0001' },
          },
        },
      ],
    });
    expect(failed(await finish('pack', ctx))).toEqual([]);
  });

  it('e) folder request: passes when the agent asks and stops', async () => {
    const ctx = await begin('folder-request');
    expect(ctx.folderPath).toBeTruthy();
    await call('folder_request', {
      path: ctx.folderPath,
      level: 'details',
      reason: 'To keep the made-up company papers with the project',
      projectId: ctx.ids.project,
    });
    const results = await finish(
      'folder-request',
      ctx,
      'I asked for the folder; the owner needs to approve it in Pharos.',
    );
    expect(results.filter((c) => !c.pass)).toEqual([]);
    expect(results.find((c) => c.id === 'requested-by-agent')?.note).toBe('scripted-agent');
  });

  it('f) report answer: passes with a report document, fails with a board (R4)', async () => {
    const ctx = await begin('report-answer');
    const question = 'Why did our spending go up from July to September? Compare the months.';
    await call('view_answer', {
      projectId: ctx.ids.project,
      requestId: ctx.ids.request,
      question,
      doc: DOC_EXAMPLE,
    });
    expect(failed(await finish('report-answer', ctx))).toEqual([]);

    const board = await begin('report-answer');
    await call('view_answer', {
      projectId: board.ids.project,
      requestId: board.ids.request,
      question,
      widgets: [{ id: 'note', node: { component: 'Callout', body: 'Groceries went up.' } }],
    });
    expect(failed(await finish('report-answer', board))).toEqual([
      'is-report-document',
      'reads-live-data',
    ]);
  });

  it('left the bystander project alone throughout', async () => {
    const projects = (await api.get('/entities/project')) as Entity[];
    expect(projects.find((p) => p.data.name === 'Bystander')).toBeTruthy();
  });
});
