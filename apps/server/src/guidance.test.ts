import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Board, toBoard } from '@pharos/schema';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import {
  DOC_EXAMPLE,
  EXAMPLES,
  EXPLAIN_EXAMPLE,
  REPORT_GUIDE,
  VIEW_GUIDELINES,
  answerBrief,
  answerKind,
} from './guidance.js';
import { openDatabase } from './store/database.js';
import { Store } from './store/store.js';
import { answerView, effectiveBoard, previewView, requestContext } from './views/service.js';
import { projectSnapshot } from './store/snapshot.js';

describe('guidance', () => {
  it('has a short, practical report guide with a tokens-and-pharos.data skeleton (R13)', () => {
    for (const part of [
      'when to write one',
      ':root {',
      '[data-theme=dark] {',
      'await pharos.data("spend")',
      'pharos.onData(render)',
      'report_asset_put',
      '390 px',
      'honesty box',
      'cdnjs.cloudflare.com',
      // R13.6: links go through Pharos; the page never navigates itself.
      'pharos.openLink(url)',
      'Never navigate the page',
    ])
      expect(REPORT_GUIDE).toContain(part);
    // R15 added the rich-documents section (44 lines) on top of R3's glance test; 200 keeps the
    // guide at one screen of sections. Raised from 180 on 2026-10-20.
    expect(REPORT_GUIDE.split('\n').length).toBeLessThan(200);
  });

  it("puts the glance test in the report guide: five traits, show don't tell, and what fails (R3)", () => {
    const start = REPORT_GUIDE.indexOf('## The glance test');
    expect(start).toBeGreaterThan(-1);
    // Before the how-to sections, so an agent reads the bar first.
    expect(start).toBeLessThan(REPORT_GUIDE.indexOf('## Report documents'));
    const glance = REPORT_GUIDE.slice(start, REPORT_GUIDE.indexOf('## Report documents'));
    for (const part of [
      // The five traits.
      'Its own visual world',
      'a palette, a type pairing and one motif',
      'a document is drawn in Pharos',
      'The claim and 3–5 key numbers first',
      'Headings are claims, not topics',
      'Interactives only where they answer the reader',
      'a slider, a toggle, a filter',
      'a simulator',
      'A source on every number',
      'an honesty box',
      "what the evidence doesn't show",
      // Show, don't tell, and what fails.
      "Show, don't tell",
      'Every section leads with something to see',
      'interactive drawing where the reader would',
      'a section of words only',
      'workers did',
      'a table of full sentences with no TLDR',
    ])
      expect(glance, part).toContain(part);
  });

  it('keeps the report document example to its own glance test (R3)', () => {
    type Block = {
      id: string;
      node?: {
        component: string;
        content?: string;
        caption?: string;
        title?: string;
        body?: string;
      };
      columns?: Block[][];
    };
    const blocks = DOC_EXAMPLE.blocks as Block[];
    const [lead, numbers, chart] = blocks;
    // Opens with the claim as a heading, then a row of 3–5 key numbers that say what they count.
    expect(lead?.node?.content).toMatch(/^# Groceries climbed/);
    const stats = numbers?.columns?.flat() ?? [];
    expect(stats.length).toBeGreaterThanOrEqual(3);
    expect(stats.length).toBeLessThanOrEqual(5);
    for (const s of stats) {
      expect(s.node?.component, s.id).toBe('Stat');
      expect(s.node?.caption, s.id).toBeTruthy();
    }
    // The chart title is a claim, not a topic.
    expect(chart?.node?.title).toBe('Groceries cost more each month');
    const honest = blocks.at(-1);
    expect(honest?.node?.component).toBe('Callout');
    expect(honest?.node?.body).toContain("What this doesn't say");
  });

  it('keeps cancelled tasks out of the blocked-or-overdue example', () => {
    const line = VIEW_GUIDELINES.split('\n').find((l) => l.startsWith('- Blocked or overdue'))!;
    expect(line).toContain('status: {not: ["done", "cancelled"]}');
  });

  it('tells agents that empty blocks explain themselves (v0.2 B8)', () => {
    const ready = VIEW_GUIDELINES.slice(VIEW_GUIDELINES.indexOf('## Before you say it is ready'));
    expect(ready).toContain('Empty blocks explain themselves');
    expect(ready).toContain('Ask an agent');
  });

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
    expect(brief).toContain('## Explanation views');
    expect(brief).toContain(`## Explaining: ${EXPLAIN_EXAMPLE.question}`);
  });

  it('picks a report document to explain or compare, a board for a quick lookup (R4)', () => {
    for (const question of [
      'Why is the Install stage behind?',
      'How did the spring planting go?',
      'Compare July and September spending',
      'Explain what changed in the budget',
      'Write a report on the move',
      'What changed since Monday?',
      "What's changed in the budget since last week?",
    ])
      expect(answerKind(question), question).toBe('report');
    for (const question of [
      "What's blocked?",
      "What's due this week?",
      'What is late?',
      'Who is on what?',
      'Which tasks are left in Build?',
      'Which reports are due?',
      'List the reports delivered this month',
    ])
      expect(answerKind(question), question).toBe('board');
  });

  it('tells the answering agent which kind each question gets, and to read report_guide (R4)', () => {
    const store = new Store(openDatabase(':memory:'));
    const { created } = store.apply(
      { kind: 'human', name: 'me' },
      {
        message: 'Set up',
        operations: [
          { op: 'create', type: 'project', ref: 'p', data: { name: 'Atlas' } },
          {
            op: 'create',
            type: 'request',
            ref: 'why',
            data: { projectId: '$p', question: 'Why did the build stage slip?' },
          },
          {
            op: 'create',
            type: 'request',
            ref: 'what',
            data: { projectId: '$p', question: "What's due this week?" },
          },
        ],
      },
    );
    const brief = answerBrief(store, [created.p!]);
    // A request's entry: its line and the indented lines under it.
    const entry = (id: string) => {
      const lines = brief.split('\n');
      const at = lines.findIndex((line) => line.includes(`requestId ${id} `));
      const end = lines.findIndex((line, i) => i > at && !line.startsWith('  '));
      return lines.slice(at, end).join('\n');
    };
    expect(entry(created.why!)).toContain('Kind: a report document');
    expect(entry(created.what!)).toContain('Kind: a board');
    expect(entry(created.what!)).not.toContain('report document');
    for (const part of [
      'Pick the kind of answer by the question',
      'Call report_guide first and follow it, then view_answer with doc',
      'A report page (page) only when the person asks for a whole bespoke design',
      'A quick status lookup ("what\'s blocked?", "what\'s due this week?"): a board',
    ])
      expect(brief, part).toContain(part);
    // The glance test lives in report_guide only; the brief points there.
    expect(brief).not.toContain('## The glance test');
  });

  it('answers with a report document through view_answer (R4)', () => {
    const store = new Store(openDatabase(':memory:'));
    const { created } = store.apply(
      { kind: 'human', name: 'me' },
      {
        message: 'Set up',
        operations: [
          {
            op: 'create',
            type: 'project',
            ref: 'p',
            data: {
              name: 'Money',
              recordTypes: [
                {
                  key: 'spending',
                  name: 'Spending',
                  plural: 'Spending',
                  fields: [
                    { key: 'date', label: 'Date', kind: 'date' },
                    { key: 'amount', label: 'Amount', kind: 'money', currency: 'EUR' },
                    { key: 'category', label: 'Category', kind: 'text' },
                  ],
                },
              ],
            },
          },
          {
            op: 'create',
            type: 'record',
            data: {
              projectId: '$p',
              recordType: 'spending',
              title: 'Groceries',
              fields: {
                date: '2026-09-02',
                amount: { amount: 4210, currency: 'EUR' },
                category: 'Food',
              },
            },
          },
          {
            op: 'create',
            type: 'record',
            data: {
              projectId: '$p',
              recordType: 'spending',
              title: 'Corner Market',
              fields: {
                date: '2026-08-04',
                amount: { amount: 6230, currency: 'EUR' },
                category: 'Groceries',
              },
            },
          },
          {
            op: 'create',
            type: 'request',
            ref: 'q',
            data: { projectId: '$p', question: 'Why did groceries go up?' },
          },
        ],
      },
    );
    const agent = { kind: 'agent' as const, name: 'a' };
    const answer = answerView(store, agent, {
      projectId: created.p!,
      requestId: created.q!,
      question: 'Why did groceries go up?',
      doc: DOC_EXAMPLE,
    });
    const view = store.getOfType('view', answer.view.id);
    expect(view.data).toMatchObject({ kind: 'answer', question: 'Why did groceries go up?' });
    expect(view.data.doc?.blocks).toHaveLength(DOC_EXAMPLE.blocks.length);
    expect(answer.preview.warnings).toEqual([]);
    expect(store.getOfType('request', created.q!).data).toMatchObject({
      status: 'answered',
      answerViewId: answer.view.id,
    });
    const both = { projectId: created.p!, question: 'Both?', doc: DOC_EXAMPLE, widgets: [] };
    expect(() => answerView(store, agent, both)).toThrow(/Give one of widgets/);
    expect(() => answerView(store, agent, { projectId: created.p!, question: 'None?' })).toThrow(
      /Give one of widgets/,
    );
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

  it('teaches explanation views: the six rules, and a worked example that passes its own checks', () => {
    const explaining = VIEW_GUIDELINES.slice(VIEW_GUIDELINES.indexOf('## Explanation views'));
    for (const rule of [
      'The point first, in one short sentence',
      'Then the picture',
      'Every claim stored and sourced',
      'Terms explained in place',
      'Certainty visible',
      'Detail on demand',
    ])
      expect(explaining).toContain(`**${rule}**`);
    const report = VIEW_GUIDELINES.slice(VIEW_GUIDELINES.indexOf('## Report pages: start here'));
    for (const rule of [
      'One purpose, one opening',
      'Headline',
      'Where it sits',
      'Reading path',
      'Then, by purpose.',
    ])
      expect(report).toContain(`**${rule}**`);

    const store = new Store(openDatabase(':memory:'));
    const claim = (ref: string, tags: string[] = []) => ({
      op: 'create' as const,
      type: 'claim' as const,
      ref,
      data: {
        projectId: '$p',
        statement: `Claim ${ref}.`,
        checkedOn: '2026-10-01',
        sourceIds: ['$src'],
        assumption: 'The report is current.',
        tags,
      },
    });
    const { created } = store.apply(
      { kind: 'agent', name: 't' },
      {
        message: 'Set up',
        operations: [
          { op: 'create', type: 'project', ref: 'p', data: { name: 'P' } },
          {
            op: 'create',
            type: 'stage',
            ref: 'stage',
            data: { projectId: '$p', name: 'Research' },
          },
          {
            op: 'create',
            type: 'artifact',
            ref: 'src',
            data: { projectId: '$p', title: 'Report', kind: 'link', uri: 'https://example.com' },
          },
          claim('headline'),
          claim('gap'),
          claim('keep'),
          claim('build'),
          claim('l1', ['layer-1']),
          claim('l2', ['layer-2']),
          claim('l3', ['layer-3']),
        ],
      },
    );
    const widgets = JSON.parse(
      JSON.stringify(EXPLAIN_EXAMPLE.widgets)
        .replace(/<(headline|gap|keep|build) claim id>/g, (_, ref: string) => created[ref]!)
        .replace('<stage id>', created.stage!)
        .replace('<YYYY-MM-DD>', '2026-10-12'),
    ) as unknown[];
    expect(Board.safeParse({ component: 'Board', widgets }).success).toBe(true);
    const preview = previewView(store, { projectId: created.p!, widgets });
    expect(preview.warnings).toEqual([]);
    expect(preview.widgets.flatMap((w) => w.warnings)).toEqual([]);
    expect(preview.summary).toBe('5 widgets; none empty');
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

    expect(client.getInstructions()).toContain('build an explanation view');
    expect(client.getInstructions()).toContain('create the decision with status "proposed"');

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
