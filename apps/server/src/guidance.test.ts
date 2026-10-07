import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Board, toBoard } from '@pharos/schema';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { EXAMPLES, answerBrief } from './guidance.js';
import { openDatabase } from './store/database.js';
import { Store } from './store/store.js';
import { answerView, effectiveBoard, previewView, requestContext } from './views/service.js';
import { projectSnapshot } from './store/snapshot.js';

describe('guidance', () => {
  it('briefs the answering agent with the open questions and everything it needs to answer', () => {
    const store = new Store(openDatabase(':memory:'));
    const person = { kind: 'human' as const, name: 'me' };
    const { created } = store.apply(person, {
      message: 'Set up',
      operations: [
        { op: 'create', type: 'project', ref: 'p', data: { name: 'Atlas' } },
        {
          op: 'create',
          type: 'request',
          ref: 'open',
          data: { projectId: '$p', question: 'What is late?', about: 'Tasks in Overview' },
        },
        {
          op: 'create',
          type: 'request',
          ref: 'done',
          data: { projectId: '$p', question: 'Old one', status: 'dismissed' },
        },
      ],
    });
    const brief = answerBrief(store, [created.p!]);
    expect(brief).toContain(
      `requestId ${created.open} in project "Atlas" (${created.p}): What is late?`,
    );
    expect(brief).toContain('Asked from: Tasks in Overview');
    expect(brief).toContain('Feedback about Pharos itself');
    expect(brief).not.toContain('Old one');
    expect(brief).not.toContain('Answered before');

    const earlier = answerView(
      store,
      { kind: 'agent', name: 'a' },
      {
        projectId: created.p!,
        question: 'Which tasks are late?',
        widgets: EXAMPLES[0]!.widgets,
      },
    );
    expect(answerBrief(store, [created.p!])).toContain(
      `Answered before: view ${earlier.view.id} ("Which tasks are late?")`,
    );
    expect(brief).toContain('# Designing Pharos views');
    expect(brief).toContain('**KanbanBoard**');
    expect(brief).toContain("## What's overdue?");
  });

  it('spells out the widget and item a request was asked about', () => {
    const store = new Store(openDatabase(':memory:'));
    const person = { kind: 'human' as const, name: 'me' };
    const { created } = store.apply(person, {
      message: 'Set up',
      operations: [
        { op: 'create', type: 'project', ref: 'p', data: { name: 'Atlas' } },
        { op: 'create', type: 'task', ref: 't', data: { projectId: '$p', title: 'Ship it' } },
      ],
    });
    const overview = store.list('view', { projectId: created.p! })[0]!;
    const widget = toBoard(effectiveBoard(overview)).widgets.find(
      (w) => w.node.component === 'KanbanBoard',
    )!;
    const request = store.apply(person, {
      message: 'Ask',
      operations: [
        {
          op: 'create',
          type: 'request',
          data: {
            projectId: created.p!,
            question: 'Texts here wrap',
            viewId: overview.id,
            widgetId: widget.id,
            aboutId: created.t!,
          },
        },
      ],
    }).created['0']!;
    const context = requestContext(store, store.getOfType('request', request));
    expect(context[0]).toMatch(
      new RegExp(
        `^Widget "${widget.id}": KanbanBoard .* in view "Overview" \\(${overview.id}, a saved view\\)\\. Its settings: \\{`,
      ),
    );
    expect(context[1]).toBe(`Item: task "Ship it" (${created.t})`);
    expect(projectSnapshot(store, created.p!).requests[0]).toMatchObject({
      viewId: overview.id,
      widgetId: widget.id,
      context,
    });
  });

  it('returns a preview with every saved answer, so agents need no extra check', () => {
    const store = new Store(openDatabase(':memory:'));
    const agent = { kind: 'agent' as const, name: 't' };
    const projectId = store.apply(agent, {
      message: 'p',
      operations: [{ op: 'create', type: 'project', data: { name: 'P' } }],
    }).created['0']!;
    const answer = answerView(store, agent, {
      projectId,
      question: "What's overdue?",
      widgets: EXAMPLES[0]!.widgets,
    });
    expect(answer.preview.summary).toMatch(/^2 widgets/);
    expect(answer.preview.widgets.map((w) => w.id)).toEqual(['headline', 'late']);
  });

  it('every example is a valid board whose filters only use real fields', () => {
    const store = new Store(openDatabase(':memory:'));
    const projectId = store.apply(
      { kind: 'agent', name: 't' },
      { message: 'p', operations: [{ op: 'create', type: 'project', data: { name: 'P' } }] },
    ).created['0']!;
    for (const example of EXAMPLES) {
      expect(
        Board.safeParse({ component: 'Board', widgets: example.widgets }).success,
        example.question,
      ).toBe(true);
      const preview = previewView(store, { projectId, widgets: example.widgets });
      const warnings = preview.widgets.flatMap((w) => w.warnings).filter((w) => !w.includes('${'));
      expect(warnings, example.question).toEqual([]);
    }
  });

  it('serves guidelines, examples, snapshots, and prompts over MCP', async () => {
    const store = new Store(openDatabase(':memory:'));
    const projectId = store.apply(
      { kind: 'agent', name: 't' },
      { message: 'p', operations: [{ op: 'create', type: 'project', data: { name: 'Demo' } }] },
    ).created['0']!;
    const app = createApp(store);
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL('http://localhost:4300/mcp'), {
        fetch: async (url, init) => app.fetch(new Request(url, init)),
      }),
    );

    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toEqual(
      expect.arrayContaining([
        'pharos://guide/views',
        'pharos://guide/catalog',
        'pharos://examples/answers',
        `pharos://projects/${projectId}/snapshot`,
      ]),
    );
    const guide = await client.readResource({ uri: 'pharos://guide/views' });
    expect((guide.contents[0] as { text: string }).text).toMatch(/Lead with the answer/);
    const snapshot = await client.readResource({ uri: `pharos://projects/${projectId}/snapshot` });
    expect(JSON.parse((snapshot.contents[0] as { text: string }).text).project.name).toBe('Demo');

    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual([
      'answer_question',
      'catch_up',
      'design_view',
    ]);
    const prompt = await client.getPrompt({
      name: 'answer_question',
      arguments: { question: "What's overdue?", project: 'Demo' },
    });
    const body = (prompt.messages[0]!.content as { text: string }).text;
    expect(body).toMatch(/Question: What's overdue\?/);
    expect(body).toMatch(/# Example answer views/);
  });
});
