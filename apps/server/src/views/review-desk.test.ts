import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ReportDoc, valueFor, type Author, type Entity } from '@pharos/schema';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { REPORT_GUIDE, REVIEW_EXAMPLE, REVIEW_EXAMPLE_DECISION } from '../guidance.js';
import { openDatabase } from '../store/database.js';
import { Store } from '../store/store.js';
import { allDocWarnings, lenientDoc, previewDoc } from './doc.js';
import { evidenceState } from './freshness.js';
import { ASSET_CSP, byteRange } from './report-routes.js';
import { ReportAssets } from './report.js';
import { createView, deleteView, getView, listViews, previewAny, updateView } from './service.js';

// R15: rich report documents and the review desk on the server: freshness with the reader's
// answers, view_get's sheets, the preview's checks, the assets route and the guide.

const me: Author = { kind: 'human', name: 'me' };
const agent: Author = { kind: 'agent', name: 'Opus 5.5' };

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const WAV = new Uint8Array(Array.from({ length: 64 }, (_, i) => i));

function setup() {
  const store = new Store(openDatabase(':memory:'));
  const { created } = store.apply(agent, {
    message: 'Set up',
    operations: [
      { op: 'create', type: 'project', ref: 'p', data: { name: 'Lists app' } },
      { op: 'create', type: 'task', ref: 't1', data: { projectId: '$p', title: 'Try it' } },
      { op: 'create', type: 'task', ref: 't2', data: { projectId: '$p', title: 'Listen' } },
      {
        op: 'create',
        type: 'task',
        ref: 'other',
        data: { projectId: '$p', title: 'Elsewhere', priority: 'high' },
      },
      {
        op: 'create',
        type: 'decision',
        ref: 'd',
        data: {
          projectId: '$p',
          title: 'Ship the banner fix?',
          status: 'proposed',
          options: [
            { id: 'ship', label: 'Ship it', summary: 'Goes out today' },
            { id: 'wait', label: 'Wait', summary: 'Try a smaller banner first' },
          ],
          recommendedOptionId: 'ship',
          recommendationReason: 'Every row shows at 390 px.',
        },
      },
    ],
  });
  const projectId = created.p!;
  const decision = created.d!;
  const doc = {
    summary: 'Three things to review.',
    blocks: [
      { kind: 'block', id: 'lead', node: { component: 'Text', content: '# Needs you' } },
      {
        kind: 'sheet',
        id: 'banner',
        title: 'Approve the banner fix',
        time: '5 min',
        decisions: [decision],
        blocks: [
          {
            kind: 'figure',
            id: 'shots',
            layout: 'pair',
            items: [
              { src: 'shots/before.png', alt: 'Before' },
              { src: 'shots/after.png', alt: 'After' },
            ],
          },
          { kind: 'block', id: 'ask', node: { component: 'DecisionBlock', decision } },
        ],
      },
      {
        kind: 'sheet',
        id: 'try',
        title: 'Try it',
        time: '2 min',
        blocks: [
          { kind: 'steps', id: 'how', items: [{ text: 'Start it', command: 'pnpm dev' }] },
          {
            kind: 'details',
            id: 'more',
            summary: 'The list',
            blocks: [
              {
                kind: 'block',
                id: 'ticks',
                node: {
                  component: 'TaskChecklist',
                  filter: { where: { title: ['Try it', 'Listen'] } },
                },
              },
            ],
          },
        ],
      },
      {
        kind: 'sheet',
        id: 'hear',
        title: 'Listen to the alert',
        time: '1 min',
        blocks: [
          { kind: 'figure', id: 'sound', items: [{ src: 'audio/alert.wav', alt: 'Alert' }] },
        ],
      },
    ],
  };
  const made = createView(store, agent, { projectId, name: 'Review desk', message: 'Review', doc });
  const viewId = made.view.id;
  const assets = new ReportAssets(store);
  assets.put(agent, viewId, 'shots/before.png', PNG);
  assets.put(agent, viewId, 'shots/after.png', PNG);
  assets.put(agent, viewId, 'audio/alert.wav', WAV);
  return {
    store,
    projectId,
    decision,
    viewId,
    doc,
    made,
    t1: created.t1!,
    t2: created.t2!,
    other: created.other!,
  };
}

type Ctx = ReturnType<typeof setup>;

/** The owner answers in the web app: as the DecisionBlock does, with a person to decide. */
const choose = ({ store, decision }: Ctx, patch: Record<string, unknown>) =>
  store.apply(me, {
    message: 'Answer',
    undoable: true,
    operations: [
      { op: 'create', type: 'assignee', ref: 'me', data: { name: 'me', kind: 'human' } },
      {
        op: 'update',
        type: 'decision',
        id: decision,
        data: {
          chosenOptionId: null,
          note: null,
          answer: null,
          deferredUntil: null,
          status: valueFor(
            store.get(store.getOfType('decision', decision).data.projectId) as Entity<'project'>,
            'decision.status',
            'accepted',
          ),
          decidedById: '$me',
          decisionDate: '2026-10-20',
          ...patch,
        },
      },
    ],
  } as Parameters<Store['apply']>[1]);

const tick = ({ store, projectId }: Ctx, task: string, meaning = 'done') =>
  store.apply(me, {
    message: 'Tick',
    operations: [
      {
        op: 'update',
        type: 'task',
        id: task,
        data: {
          status: valueFor(store.get(projectId) as Entity<'project'>, 'task.status', meaning),
        },
      },
    ],
  });

const state = (ctx: Ctx) => evidenceState(ctx.store, ctx.store.getOfType('view', ctx.viewId));

describe("the reader's answers don't make a document out of date (R15)", () => {
  it('choosing, answering, deferring and reopening a sheet decision keeps it fresh', () => {
    const ctx = setup();
    expect(state(ctx)).toBe('fresh');
    choose(ctx, { chosenOptionId: 'ship' });
    expect(state(ctx)).toBe('fresh');
    choose(ctx, { answer: 'Ship it on Friday' });
    expect(state(ctx)).toBe('fresh');
    ctx.store.apply(me, {
      message: 'Later',
      operations: [
        {
          op: 'update',
          type: 'decision',
          id: ctx.decision,
          data: { answer: null, deferredUntil: '2026-11-01' },
        },
      ],
    });
    expect(state(ctx)).toBe('fresh');
  });

  it("ticking a task in the document's TaskChecklist keeps it fresh", () => {
    const ctx = setup();
    tick(ctx, ctx.t1);
    tick(ctx, ctx.t2, 'in_progress');
    expect(state(ctx)).toBe('fresh');
  });

  it("an agent changing the decision's title, or a checklist task's title, makes it stale", () => {
    const ctx = setup();
    ctx.store.apply(agent, {
      message: 'Rename',
      operations: [
        { op: 'update', type: 'decision', id: ctx.decision, data: { title: 'Ship it now?' } },
      ],
    });
    expect(state(ctx)).toBe('stale');
    const other = setup();
    other.store.apply(me, {
      message: 'Rename',
      operations: [{ op: 'update', type: 'task', id: other.t1, data: { title: 'Try it twice' } }],
    });
    expect(state(other)).toBe('stale');
  });

  it('an answer together with another change to the decision still counts', () => {
    const ctx = setup();
    choose(ctx, { chosenOptionId: 'ship', body: 'Changed my mind about the reasons' });
    expect(state(ctx)).toBe('stale');
  });

  it('a task status change outside its checklists still counts when the document reads it', () => {
    const ctx = setup();
    const doc = {
      ...ctx.doc,
      blocks: [...ctx.doc.blocks, { kind: 'block', id: 'all', node: { component: 'TaskTable' } }],
    };
    const id = createView(ctx.store, agent, {
      projectId: ctx.projectId,
      name: 'With a table',
      message: 'm',
      doc,
    }).view.id;
    tick(ctx, ctx.other);
    expect(evidenceState(ctx.store, ctx.store.getOfType('view', id))).toBe('stale');
    // The checklist's own tasks still don't, even though the table shows them too.
    const fresh = setup();
    tick(fresh, fresh.t1);
    expect(state(fresh)).toBe('fresh');
  });
});

describe('view_get on a document lists its sheets and the answers (R15)', () => {
  it('shows each sheet, its state, the decision answers and checklist ticks', () => {
    const ctx = setup();
    const before = getView(ctx.store, ctx.viewId);
    expect(before.sheets).toEqual([
      {
        id: 'banner',
        title: 'Approve the banner fix',
        time: '5 min',
        state: 'open',
        decisions: [{ id: ctx.decision, title: 'Ship the banner fix?', state: 'open' }],
      },
      {
        id: 'try',
        title: 'Try it',
        time: '2 min',
        decisions: [],
        tasks: [
          { id: ctx.t1, title: 'Try it', status: 'todo', done: false },
          { id: ctx.t2, title: 'Listen', status: 'todo', done: false },
        ],
      },
      { id: 'hear', title: 'Listen to the alert', time: '1 min', decisions: [] },
    ]);
    choose(ctx, { chosenOptionId: 'ship' });
    tick(ctx, ctx.t1);
    const after = getView(ctx.store, ctx.viewId);
    expect(after.sheets![0]).toMatchObject({
      state: 'answered',
      decisions: [
        { state: 'chosen', chosen: { id: 'ship', label: 'Ship it' }, decidedOn: '2026-10-20' },
      ],
    });
    expect(after.sheets![1]!.tasks![0]).toMatchObject({ id: ctx.t1, done: true });
    choose(ctx, { chosenOptionId: 'ship', note: 'Step 2: the banner overlaps the menu' });
    expect(getView(ctx.store, ctx.viewId).sheets![0]!.decisions[0]).toMatchObject({
      state: 'chosen',
      chosen: { id: 'ship' },
      note: 'Step 2: the banner overlaps the menu',
    });
    choose(ctx, { answer: 'Only on Android' });
    expect(getView(ctx.store, ctx.viewId).sheets![0]!.decisions[0]).toMatchObject({
      state: 'answered',
      answer: 'Only on Android',
    });
    ctx.store.apply(me, {
      message: 'Later',
      operations: [
        {
          op: 'update',
          type: 'decision',
          id: ctx.decision,
          data: { answer: null, deferredUntil: '2026-11-01' },
        },
      ],
    });
    expect(getView(ctx.store, ctx.viewId).sheets![0]).toMatchObject({
      state: 'open',
      decisions: [{ state: 'deferred', deferredUntil: '2026-11-01' }],
    });
  });

  it('lists the outline at depth and has no sheets for a document without them', () => {
    const ctx = setup();
    const listed = listViews(ctx.store, ctx.projectId).find((v) => v.id === ctx.viewId) as {
      blocks: string[];
    };
    expect(listed.blocks).toEqual([
      'lead: Text',
      'banner: sheet "Approve the banner fix" (5 min) [shots: figure pair (shots/before.png, shots/after.png); ask: DecisionBlock]',
      'try: sheet "Try it" (2 min) [how: steps (1); more: details "The list" [ticks: TaskChecklist]]',
      'hear: sheet "Listen to the alert" (1 min) [sound: figure (audio/alert.wav)]',
    ]);
    const plain = createView(ctx.store, agent, {
      projectId: ctx.projectId,
      name: 'Plain',
      message: 'm',
      doc: {
        summary: 'x',
        blocks: [{ kind: 'block', id: 't', node: { component: 'Text', content: 'Hi' } }],
      },
    }).view.id;
    expect(getView(ctx.store, plain).sheets).toBeUndefined();
  });

  it('cuts long drawings inside sheets and details too', () => {
    const ctx = setup();
    const html = `<!doctype html><style>[data-theme=dark]{}</style>${'x'.repeat(60_000)}`;
    const doc = {
      ...ctx.doc,
      blocks: [
        ...ctx.doc.blocks,
        {
          kind: 'sheet',
          id: 'drawn',
          title: 'Drawn',
          blocks: [
            {
              kind: 'details',
              id: 'dd',
              summary: 'More',
              blocks: [{ kind: 'drawing', id: 'big', html, height: 100 }],
            },
          ],
        },
      ],
    };
    updateView(ctx.store, agent, {
      viewId: ctx.viewId,
      message: 'm',
      doc,
      expectedRevision: ctx.store.getOfType('view', ctx.viewId).updatedRev,
    });
    const got = getView(ctx.store, ctx.viewId);
    expect(got.doc!.htmlTruncated).toContain('"big"');
    expect(JSON.stringify(got.doc).length).toBeLessThan(html.length);
  });
});

describe('view_preview on rich documents (R15)', () => {
  const warningsOf = (ctx: Ctx, doc: unknown, viewId?: string) => {
    const { doc: parsed, warnings } = lenientDoc(doc);
    return allDocWarnings(previewDoc(ctx.store, ctx.projectId, parsed, viewId, warnings));
  };

  it('a complete review desk with its files uploaded previews without warnings', () => {
    const ctx = setup();
    expect(warningsOf(ctx, ctx.doc, ctx.viewId)).toEqual([]);
    expect(ctx.made.preview.warnings).toEqual([
      'Figure "shots": "shots/before.png", "shots/after.png" aren\'t uploaded yet: upload them with report_asset_put, then preview again',
      'Figure "sound": "audio/alert.wav" isn\'t uploaded yet: upload it with report_asset_put, then preview again',
    ]);
    const preview = previewAny(ctx.store, { viewId: ctx.viewId }) as unknown as ReturnType<
      typeof previewDoc
    >;
    expect(preview.figures[0]).toMatchObject({
      id: 'shots',
      layout: 'pair',
      items: [{ src: 'shots/before.png', media: 'image', uploaded: true }, { uploaded: true }],
    });
    expect(preview.sheets.map((s) => s.id)).toEqual(['banner', 'try', 'hear']);
  });

  it('warns on figures not uploaded, in a draft too', () => {
    const ctx = setup();
    const draft = warningsOf(ctx, ctx.doc);
    expect(draft).toContain(
      'Figure "sound": "audio/alert.wav" isn\'t uploaded yet: upload it with report_asset_put after saving, then preview again',
    );
  });

  it('warns on a compare figure without exactly two pictures', () => {
    const ctx = setup();
    const compare = (items: string[]) => ({
      summary: 's',
      blocks: [
        { kind: 'block', id: 't', node: { component: 'Text', content: 'Hi' } },
        {
          kind: 'figure',
          id: 'c',
          layout: 'compare',
          items: items.map((src) => ({ src, alt: 'x' })),
        },
      ],
    });
    const of = (items: string[]) =>
      warningsOf(ctx, compare(items), ctx.viewId).filter((w) => w.includes('compare'));
    expect(of(['shots/before.png', 'shots/after.png'])).toEqual([]);
    expect(of(['shots/before.png'])[0]).toMatch(/exactly two pictures .*it has 1 item\)/);
    expect(of(['shots/before.png', 'audio/alert.wav'])[0]).toContain('not all pictures');
  });

  it('warns on sheet decisions that are missing, have no options or no DecisionBlock, and sheets with no time', () => {
    const ctx = setup();
    const { created } = ctx.store.apply(agent, {
      message: 'plain decision',
      operations: [
        {
          op: 'create',
          type: 'decision',
          ref: 'bare',
          data: { projectId: ctx.projectId, title: 'Bare', status: 'proposed' },
        },
      ],
    });
    const other = ctx.store.apply(agent, {
      message: 'other project',
      operations: [
        { op: 'create', type: 'project', ref: 'p', data: { name: 'Other' } },
        {
          op: 'create',
          type: 'decision',
          ref: 'd',
          data: { projectId: '$p', title: 'Elsewhere', status: 'proposed' },
        },
      ],
    }).created.d!;
    const doc = {
      summary: 's',
      blocks: [
        { kind: 'block', id: 't', node: { component: 'Text', content: 'Hi' } },
        {
          kind: 'sheet',
          id: 'a',
          title: 'A',
          decisions: ['dec_000000000000', created.bare!, ctx.decision, other],
          blocks: [
            {
              kind: 'block',
              id: 'b',
              node: { component: 'DecisionBlock', decision: created.bare! },
            },
          ],
        },
        {
          kind: 'sheet',
          id: 'c',
          title: 'C',
          blocks: [{ kind: 'steps', id: 's', items: [{ text: 'x' }] }],
        },
      ],
    };
    const warnings = warningsOf(ctx, doc, ctx.viewId);
    expect(warnings).toEqual(
      expect.arrayContaining([
        'Sheet "a": decision "dec_000000000000" isn\'t a decision in this project: create it (with options) first, or remove it from decisions',
        `Sheet "a": decision "${created.bare}" ("Bare") has no options: give it 2–5 options so the reader can answer`,
        `Sheet "a": decision "${other}" isn't a decision in this project: create it (with options) first, or remove it from decisions`,
        'No sheet has a time: give each sheet a time ("5 min") so the reader knows how long the review takes',
      ]),
    );
    expect(
      warnings.some((w) =>
        w.startsWith(
          `Sheet "a": decision "${ctx.decision}" has no DecisionBlock inside this sheet`,
        ),
      ),
    ).toBe(true);
    expect(
      warnings.some((w) =>
        w.startsWith(`Sheet "a": decision "${created.bare}" has no DecisionBlock`),
      ),
    ).toBe(false);
  });

  it('sets aside an http embed or a missing read inside sheets and details in a draft', () => {
    const ctx = setup();
    const { warnings, doc } = lenientDoc({
      summary: 's',
      blocks: [
        {
          kind: 'sheet',
          id: 's',
          title: 'S',
          blocks: [
            { kind: 'block', id: 't', node: { component: 'Text', content: 'Hi' } },
            {
              kind: 'details',
              id: 'd',
              summary: 'More',
              blocks: [
                { kind: 'embed', id: 'e', url: 'http://example.com/' },
                { kind: 'block', id: 'm', node: { component: 'Markdown', content: 'More' } },
              ],
            },
            { kind: 'drawing', id: 'dr', html: '<p>x</p>', height: 100, reads: ['gone'] },
          ],
        },
      ],
    });
    expect(warnings.join('\n')).toContain('Embed "e"');
    expect(warnings.join('\n')).toContain('Drawing "dr" reads "gone"');
    expect(ReportDoc.safeParse(doc).success).toBe(true);
    void ctx;
  });
});

describe('the assets route (R15)', () => {
  it('serves a picture with its type and a CSP that runs nothing', async () => {
    const ctx = setup();
    const app = createApp(ctx.store);
    const res = await app.request(`/api/views/${ctx.viewId}/assets/shots/before.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('content-security-policy')).toBe(ASSET_CSP);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    // The list of the view's files is still at /assets.
    const list = await app.request(`/api/views/${ctx.viewId}/assets`);
    expect(((await list.json()) as { path: string }[]).map((a) => a.path)).toEqual([
      'audio/alert.wav',
      'shots/after.png',
      'shots/before.png',
    ]);
  });

  it('serves an SVG sandboxed, with no scripts', async () => {
    const ctx = setup();
    new ReportAssets(ctx.store).put(
      agent,
      ctx.viewId,
      'img/x.svg',
      new TextEncoder().encode(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      ),
    );
    const res = await createApp(ctx.store).request(`/api/views/${ctx.viewId}/assets/img/x.svg`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/svg+xml');
    const csp = res.headers.get('content-security-policy')!;
    expect(csp).toMatch(/^sandbox;/);
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain('script-src');
  });

  it('answers Range requests for sound and video with 206, and 416 past the end', async () => {
    const ctx = setup();
    const app = createApp(ctx.store);
    const url = `/api/views/${ctx.viewId}/assets/audio/alert.wav`;
    const whole = await app.request(url);
    expect(whole.headers.get('accept-ranges')).toBe('bytes');
    expect(whole.headers.get('content-type')).toBe('audio/wav');
    const part = await app.request(url, { headers: { range: 'bytes=10-19' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 10-19/64');
    expect(part.headers.get('content-length')).toBe('10');
    expect([...new Uint8Array(await part.arrayBuffer())]).toEqual([
      10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    ]);
    const tail = await app.request(url, { headers: { range: 'bytes=-4' } });
    expect(tail.headers.get('content-range')).toBe('bytes 60-63/64');
    const open = await app.request(url, { headers: { range: 'bytes=60-' } });
    expect([...new Uint8Array(await open.arrayBuffer())]).toEqual([60, 61, 62, 63]);
    const past = await app.request(url, { headers: { range: 'bytes=64-' } });
    expect(past.status).toBe(416);
    expect(past.headers.get('content-range')).toBe('bytes */64');
    new ReportAssets(ctx.store).put(agent, ctx.viewId, 'rec/tour.mp4', PNG);
    const video = await app.request(`/api/views/${ctx.viewId}/assets/rec/tour.mp4`, {
      headers: { range: 'bytes=0-1' },
    });
    expect(video.status).toBe(206);
    expect(video.headers.get('content-type')).toBe('video/mp4');
  });

  it('reads byte ranges the way browsers send them', () => {
    expect(byteRange(undefined, 10)).toBeNull();
    expect(byteRange('bytes=0-', 10)).toEqual({ start: 0, end: 9 });
    expect(byteRange('bytes=2-100', 10)).toEqual({ start: 2, end: 9 });
    expect(byteRange('bytes=-3', 10)).toEqual({ start: 7, end: 9 });
    expect(byteRange('bytes=-30', 10)).toEqual({ start: 0, end: 9 });
    expect(byteRange('bytes=5-2', 10)).toBe('unsatisfiable');
    expect(byteRange('bytes=0-1,4-5', 10)).toBeNull();
    expect(byteRange('items=0-1', 10)).toBeNull();
  });

  it('404s for files that are not pictures, clips or sounds, odd paths, boards, and deleted views', async () => {
    const ctx = setup();
    new ReportAssets(ctx.store).put(agent, ctx.viewId, 'js/app.js', new TextEncoder().encode('1'));
    const app = createApp(ctx.store);
    const board = createView(ctx.store, me, {
      projectId: ctx.projectId,
      name: 'Board',
      message: 'm',
      widgets: [{ id: 'a', node: { component: 'TaskTable' } }],
    }).view.id;
    for (const path of [
      `/api/views/${ctx.viewId}/assets/js/app.js`,
      `/api/views/${ctx.viewId}/assets/shots/missing.png`,
      `/api/views/${ctx.viewId}/assets/shots/before.png.exe`,
      `/api/views/${ctx.viewId}/assets/%ZZ.png`,
      `/api/views/${board}/assets/shots/before.png`,
      `/api/views/view_000000000000/assets/shots/before.png`,
    ]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(404);
      expect(res.headers.get('content-security-policy'), path).toBe(ASSET_CSP);
    }
    deleteView(ctx.store, me, { viewId: ctx.viewId, message: 'gone' });
    expect((await app.request(`/api/views/${ctx.viewId}/assets/shots/before.png`)).status).toBe(
      404,
    );
    // The list of a view's files is still at /assets.
    const list = await app.request(`/api/views/${board}/assets`);
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual([]);
  });
});

describe('the review desk over MCP and in the guide (R15)', () => {
  async function connect(app: ReturnType<typeof createApp>) {
    const client = new Client({ name: 'Opus 5.5', version: '1.0.0' });
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

  it('the guide has the section, its advice on depth and a valid example', () => {
    expect(ReportDoc.safeParse(REVIEW_EXAMPLE).success).toBe(true);
    const sheets = REVIEW_EXAMPLE.blocks.filter((b) => b.kind === 'sheet');
    expect(sheets).toHaveLength(2);
    const text = JSON.stringify(REVIEW_EXAMPLE);
    for (const kind of ['"figure"', '"steps"', '"details"', 'DecisionBlock'])
      expect(text).toContain(kind);
    for (const part of [
      '## Rich documents and the review desk',
      'what was done, why, the evidence as pictures',
      'report_asset_put',
      'before and after',
      JSON.stringify(REVIEW_EXAMPLE),
    ])
      expect(REPORT_GUIDE, part).toContain(part);
  });

  it('the example previews without warnings once its decision and pictures exist; view_get reads the answer', async () => {
    const ctx = setup();
    const { created } = ctx.store.apply(agent, {
      message: 'The decision the example asks',
      operations: [
        {
          op: 'create',
          type: 'decision',
          ref: 'd',
          data: {
            projectId: ctx.projectId,
            title: 'Ship the offline banner fix?',
            status: 'proposed',
            options: [
              { id: 'ship', label: 'Ship it' },
              { id: 'smaller', label: 'Try a smaller banner' },
            ],
            recommendedOptionId: 'ship',
            recommendationReason: 'Every row shows at 390 px.',
          },
        },
      ],
    });
    const doc = JSON.parse(
      JSON.stringify(REVIEW_EXAMPLE).replaceAll(REVIEW_EXAMPLE_DECISION, created.d!),
    );
    const client = await connect(createApp(ctx.store));
    const made = await call(client, 'view_create', {
      projectId: ctx.projectId,
      name: 'Review',
      message: 'The review desk example',
      doc,
    });
    for (const path of ['shots/banner-before.png', 'shots/banner-after.png'])
      await call(client, 'report_asset_put', {
        viewId: made.view.id,
        path,
        base64: Buffer.from(PNG).toString('base64'),
      });
    const sound = await call(client, 'report_asset_put', {
      viewId: made.view.id,
      path: 'audio/note.mp3',
      base64: Buffer.from(WAV).toString('base64'),
    });
    expect(sound.saved.mime).toBe('audio/mpeg');
    const preview = await call(client, 'view_preview', { viewId: made.view.id });
    expect(preview.warnings).toEqual([]);
    expect(preview.widgets.flatMap((w: { warnings: string[] }) => w.warnings)).toEqual([]);
    choose({ ...ctx, decision: created.d! }, { chosenOptionId: 'ship' });
    const got = await call(client, 'view_get', { viewId: made.view.id });
    expect(got.sheets).toEqual([
      {
        id: 'banner',
        title: 'Approve the offline banner fix',
        time: '5 min',
        tags: ['review'],
        state: 'answered',
        decisions: [
          {
            id: created.d,
            title: 'Ship the offline banner fix?',
            state: 'chosen',
            chosen: { id: 'ship', label: 'Ship it' },
            decidedOn: '2026-10-20',
          },
        ],
      },
      { id: 'import', title: 'Try the new import', time: '2 min', decisions: [] },
    ]);
  });

  it('tool descriptions and the instructions mention figures and sheets; audio is a type', async () => {
    const ctx = setup();
    const client = await connect(createApp(ctx.store));
    const tools = (await client.listTools()).tools;
    const tool = (name: string) => tools.find((t) => t.name === name)!.description!;
    for (const name of ['view_create', 'view_update'])
      expect(tool(name), name).toMatch(/figures.*sheets/);
    expect(tool('view_preview')).toContain('figure files not uploaded yet');
    expect(tool('report_guide')).toContain('review desk');
    expect(tool('report_asset_put')).toContain('mp3 m4a ogg wav');
    expect(client.getInstructions()).toMatch(/figures of screenshots.*sheets/);
  });
});

describe('the "Review desk (sample)" install step (R15)', () => {
  it('installs on made-up data with no preview warnings, uploads its files, and re-runs as a no-op', async () => {
    const repo = fileURLToPath(new URL('../../../../', import.meta.url));
    const step = (await import(
      pathToFileURL(join(repo, 'samples/install/steps/r15-review-desk.mjs')).href
    )) as {
      run: (ctx: Record<string, unknown>) => Promise<{ viewId: string; made: boolean }[]>;
    };
    const store = new Store(openDatabase(':memory:'));
    const { created } = store.apply(agent, {
      message: 'samples',
      operations: [{ op: 'create', type: 'project', ref: 'p', data: { name: 'Pharos samples' } }],
    });
    const client = new Client({ name: 'Opus 5.5', version: '1.0.0' });
    const app = createApp(store);
    await client.connect(
      new StreamableHTTPClientTransport(new URL('http://localhost:4300/mcp'), {
        fetch: async (url, init) => app.fetch(new Request(url, init)),
      }),
    );
    const call = Object.assign(
      async (name: string, args: Record<string, unknown> = {}) => {
        const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
        const text = result.content.map((c) => (c.type === 'text' ? c.text : '')).join('\n');
        if (result.isError) throw new Error(`${name} failed: ${text}`);
        try {
          return JSON.parse(text) as unknown;
        } catch {
          return text;
        }
      },
      { tools: async () => (await client.listTools()).tools },
    );
    const samples = { id: created.p!, name: 'Pharos samples' };
    const lines: string[] = [];
    const ctx = { call, samples, repo, log: (l: string) => lines.push(l) };
    const [row] = await step.run(ctx);
    expect(row!.made).toBe(true);
    expect(lines.at(-1)).toMatch(/^Review desk made/);
    const view = getView(store, row!.viewId);
    expect(view.sheets!.map((s) => [s.id, s.state ?? null])).toEqual([
      ['banner', 'open'],
      ['import', null],
      ['chime', null],
    ]);
    expect(view.sheets![2]!.tasks).toHaveLength(2);
    expect(view.assets!.map((a) => a.path)).toEqual([
      'audio/reminder-chime.wav',
      'shots/banner-after.png',
      'shots/banner-before.png',
      'shots/import-after.png',
    ]);
    const preview = previewAny(store, { viewId: row!.viewId }) as unknown as ReturnType<
      typeof previewDoc
    >;
    expect(allDocWarnings(preview)).toEqual([]);
    const blocks = JSON.stringify(view.doc);
    for (const kind of ['"details"', '"pair"', '"steps"', '"command"', 'TaskChecklist', '.wav'])
      expect(blocks).toContain(kind);
    const again: string[] = [];
    const [second] = await step.run({ ...ctx, log: (l: string) => again.push(l) });
    expect(second).toMatchObject({ viewId: row!.viewId, made: false });
    expect(again).toEqual([]);
  });
});
