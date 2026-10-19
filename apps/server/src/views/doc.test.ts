import vm from 'node:vm';
import type { Author } from '@pharos/schema';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { answerBrief } from '../guidance.js';
import { openDatabase } from '../store/database.js';
import { projectSnapshot } from '../store/snapshot.js';
import { Store } from '../store/store.js';
import { evidenceState, projectFreshness } from './freshness.js';
import { APP_PAGE_HEADERS } from './report-routes.js';
import { ReportAssets, embedCsp, reportCsp } from './report.js';
import { createView, getView, listViews, previewAny, updateView } from './service.js';

// R14: report documents on the server: the store, the view service, freshness and the refresh
// loop, the preview, and the drawing and embed routes.

const me: Author = { kind: 'human', name: 'me' };
const agent: Author = { kind: 'agent', name: 'Opus 5.5' };

const SPEND = { type: 'record' as const, filter: { where: { recordType: 'spending' } } };
const QUERY = { type: 'record' as const, where: { recordType: 'spending' } };

const DRAWING = `<!doctype html><style>:root{--ink:#111}[data-theme=dark]{--ink:#eee}</style>
<svg id="s" width="200" height="80"></svg><img src="img/a.svg" alt="">
<script>pharos.data('spend').then((rows) => { document.getElementById('s').dataset.n = rows.length; });</script>`;

const DOC = {
  summary: 'Groceries lead the spending.',
  data: { spend: SPEND },
  blocks: [
    {
      kind: 'block',
      id: 'lead',
      node: {
        component: 'Text',
        content: '# Groceries lead\n\nWe spent **${total}** over ${count} receipts.',
        values: {
          total: { sum: { query: QUERY, field: 'fields.amount' } },
          count: { count: QUERY },
        },
      },
    },
    {
      kind: 'columns',
      id: 'numbers',
      columns: [
        [{ kind: 'block', id: 'n1', node: { component: 'Stat', label: 'Receipts', query: QUERY } }],
        [{ kind: 'drawing', id: 'pic', html: DRAWING, reads: ['spend'], height: 120 }],
      ],
    },
    {
      kind: 'block',
      id: 'chart',
      node: { component: 'CountChart', query: QUERY, by: 'fields.category' },
    },
    { kind: 'embed', id: 'ref', url: 'https://example.com/path?q=1', caption: 'Reference' },
  ],
};

function setup() {
  const store = new Store(openDatabase(':memory:'));
  const { created } = store.apply(me, {
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
        ref: 'r1',
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
      { op: 'create', type: 'task', ref: 't', data: { projectId: '$p', title: 'Budget' } },
    ],
  });
  const projectId = created.p!;
  const make = (author: Author = agent, doc: Record<string, unknown> = DOC) =>
    createView(store, author, { projectId, name: 'Spending story', message: 'A report', doc });
  return { store, projectId, record: created.r1!, task: created.t!, make };
}

const spendMore = (store: Store, record: string) =>
  store.apply(me, {
    message: 'spent more',
    operations: [
      {
        op: 'update',
        type: 'record',
        id: record,
        data: { fields: { amount: { amount: 9999, currency: 'EUR' } } },
      },
    ],
  });

describe('report documents in the store and view service (R14)', () => {
  it('creates a document: no board, its outline listed, evidence stamped, a preview back', () => {
    const { store, projectId, make } = setup();
    const made = make();
    const view = store.getOfType('view', made.view.id);
    expect(view.data.doc?.blocks).toHaveLength(4);
    expect(view.data.spec).toBeUndefined();
    expect(view.data.evidenceRevision).toBe(made.revision!.id - 1);
    expect(made.view.doc).toBeUndefined(); // the agent just sent it
    expect(made.preview).toMatchObject({ kind: 'report document', blocks: 5 });
    const got = getView(store, view.id);
    expect(got.layout).toBe('report document');
    expect(got.board.widgets).toEqual([]);
    expect(got.doc?.blocks).toHaveLength(4);
    const listed = listViews(store, projectId).find((v) => v.id === view.id)!;
    expect(listed).toMatchObject({ layout: 'report document', summary: DOC.summary });
    expect((listed as { blocks: string[] }).blocks).toEqual([
      'lead: Text',
      'numbers: columns [n1: Stat | pic: drawing]',
      'chart: CountChart',
      'ref: embed https://example.com/path?q=1',
    ]);
    const snap = projectSnapshot(store, projectId).views.find((v) => v.id === view.id)!;
    expect(snap).toMatchObject({
      kind: 'report document',
      summary: DOC.summary,
      evidence: 'fresh',
    });
  });

  it('refuses a view with two of spec, page and doc', () => {
    const { store, projectId, make } = setup();
    const id = make().view.id;
    const board = createView(store, me, {
      projectId,
      name: 'Board',
      message: 'm',
      widgets: [{ id: 'a', node: { component: 'TaskTable' } }],
    }).view.id;
    for (const [viewId, data] of [
      [id, { spec: { component: 'Board', widgets: [] } }],
      [id, { page: { html: '<p>x</p>' } }],
      [board, { doc: DOC }],
    ] as const)
      expect(() =>
        store.apply(me, {
          message: 'two',
          operations: [{ op: 'update', type: 'view', id: viewId, data }],
        }),
      ).toThrow(/Invalid changes/);
    try {
      store.apply(me, {
        message: 'two',
        operations: [{ op: 'update', type: 'view', id: board, data: { doc: DOC } }],
      });
    } catch (error) {
      expect(JSON.stringify(error)).toContain('not spec and doc');
    }
    expect(() =>
      createView(store, agent, {
        projectId,
        name: 'x',
        message: 'm',
        doc: DOC,
        page: { html: '<p>x</p>' },
      }),
    ).toThrow(/Give one of widgets/);
    expect(() =>
      createView(store, agent, { projectId, name: 'x', message: 'm', doc: { blocks: [] } }),
    ).toThrow(/Invalid doc/);
  });

  it('view_update moves between board, page and document, one at a time', () => {
    const { store, make } = setup();
    const id = make().view.id;
    const rev = () => store.getOfType('view', id).updatedRev;
    expect(() =>
      updateView(store, agent, { viewId: id, message: 'ops', ops: [{ op: 'remove', id: 'lead' }] }),
    ).toThrow(/report document: it has no widgets/);
    expect(() =>
      updateView(store, agent, {
        viewId: id,
        message: 'both',
        doc: DOC,
        widgets: [],
      }),
    ).toThrow(/only one of/);
    updateView(store, agent, {
      viewId: id,
      message: 'page',
      expectedRevision: rev(),
      page: { html: '<p>x</p>' },
    });
    let view = store.getOfType('view', id);
    expect(view.data.page).toBeDefined();
    expect(view.data.doc).toBeUndefined();
    updateView(store, agent, { viewId: id, message: 'doc', expectedRevision: rev(), doc: DOC });
    view = store.getOfType('view', id);
    expect(view.data.doc).toBeDefined();
    expect(view.data.page).toBeUndefined();
    updateView(store, agent, {
      viewId: id,
      message: 'board',
      expectedRevision: rev(),
      widgets: [{ id: 'b', node: { component: 'TaskTable' } }],
    });
    view = store.getOfType('view', id);
    expect(view.data.doc).toBeUndefined();
    expect(view.data.spec).toBeDefined();
  });

  it('refuses block asks on a report document (store and view_update)', () => {
    const { store, projectId, make } = setup();
    const id = make().view.id;
    let message = '';
    try {
      store.apply(me, {
        message: 'ask',
        operations: [
          {
            op: 'create',
            type: 'request',
            data: { projectId, question: 'Bigger?', viewId: id, widgetId: 'lead', mode: 'block' },
          },
        ],
      });
    } catch (error) {
      message = JSON.stringify(error);
    }
    expect(message).toContain('a report document has no blocks to ask about');
    // One left over from when the view was a board is refused by view_update.
    const board = createView(store, me, {
      projectId,
      name: 'Board',
      message: 'm',
      widgets: [{ id: 'a', node: { component: 'TaskTable' } }],
    }).view.id;
    const { created } = store.apply(me, {
      message: 'ask',
      operations: [
        {
          op: 'create',
          type: 'request',
          ref: 'q',
          data: { projectId, question: 'Bigger?', viewId: board, widgetId: 'a', mode: 'block' },
        },
      ],
    });
    store.apply(me, {
      message: 'now a doc',
      operations: [{ op: 'update', type: 'view', id: board, data: { spec: null, doc: DOC } }],
    });
    expect(() =>
      updateView(store, agent, {
        viewId: board,
        message: 'r',
        requestId: created.q,
        doc: DOC,
        expectedRevision: store.getOfType('view', board).updatedRev,
      }),
    ).toThrow(/report document, which has no blocks/);
  });

  it('a document goes stale when data its components read changes, not from other data', () => {
    const { store, projectId, record, task, make } = setup();
    const id = make().view.id;
    expect(evidenceState(store, store.getOfType('view', id))).toBe('fresh');
    store.apply(me, {
      message: 'task',
      operations: [{ op: 'update', type: 'task', id: task, data: { title: 'Budget v2' } }],
    });
    expect(evidenceState(store, store.getOfType('view', id))).toBe('fresh');
    spendMore(store, record);
    expect(evidenceState(store, store.getOfType('view', id))).toBe('stale');
    const evidence = projectFreshness(store, projectId).views[id]!.evidence;
    expect(evidence && 'stale' in evidence && evidence.stale?.total).toBe(1);
  });

  it('a person-made document has no evidence; one that reads nothing never goes stale', () => {
    const { store, projectId, record, make } = setup();
    const mine = make(me).view.id;
    expect(store.getOfType('view', mine).data.evidenceRevision).toBeUndefined();
    const plain = make(agent, {
      summary: 'Plain',
      blocks: [{ kind: 'block', id: 't', node: { component: 'Markdown', content: 'Hello' } }],
    }).view.id;
    spendMore(store, record);
    expect(projectFreshness(store, projectId).views[plain]!.evidence).toBeNull();
  });
});

describe('refreshing a report document (R14 + R11)', () => {
  function staleWithRefresh() {
    const ctx = setup();
    const { store, projectId, record, make } = ctx;
    const id = make().view.id;
    spendMore(store, record);
    const { created } = store.apply(me, {
      message: 'Refresh',
      operations: [
        {
          op: 'create',
          type: 'request',
          ref: 'q',
          data: { projectId, question: 'Refresh “Spending story”', viewId: id, mode: 'refresh' },
        },
      ],
    });
    return { ...ctx, id, requestId: created.q! };
  }

  it('tells the answering agent to write the same document again', () => {
    const { store, projectId, id, requestId } = staleWithRefresh();
    const brief = answerBrief(store, [projectId]);
    const entry = brief.slice(brief.indexOf(`requestId ${requestId}`)).split('\n\n')[0]!;
    expect(entry).toContain('Refresh this report document (mode "refresh")');
    for (const step of [
      'report_guide',
      `view_get ${id}`,
      `view_preview {viewId: "${id}"}`,
      `requestId: "${requestId}"`,
      `data: ${JSON.stringify({ spend: SPEND })}`,
      'Never send widgets or page',
    ])
      expect(entry, step).toContain(step);
    expect(brief).toContain('When the view is a report document');
    const asked = projectSnapshot(store, projectId).requests.find((r) => r.id === requestId)!;
    expect(asked.context.join('\n')).toContain('Refresh this report document');
  });

  it('refuses a rename, widgets, a page, or a document that reads nothing; a rewrite is fresh', () => {
    const { store, id, requestId } = staleWithRefresh();
    const expectedRevision = store.getOfType('view', id).updatedRev;
    const base = { viewId: id, message: 'r', expectedRevision, requestId };
    expect(() => updateView(store, agent, { ...base, name: 'n' })).toThrow(/whole document as doc/);
    expect(() =>
      updateView(store, agent, {
        ...base,
        widgets: [{ id: 't', node: { component: 'TaskTable' } }],
      }),
    ).toThrow(/not widgets/);
    expect(() => updateView(store, agent, { ...base, page: { html: '<p>x</p>' } })).toThrow(
      /not page/,
    );
    expect(() =>
      updateView(store, agent, {
        ...base,
        doc: {
          blocks: [{ kind: 'block', id: 't', node: { component: 'Markdown', content: 'x' } }],
        },
      }),
    ).toThrow(/reads nothing/);
    const before = store.getOfType('view', id).data.evidenceRevision!;
    const result = updateView(store, agent, {
      ...base,
      reply: 'Groceries are higher now.',
      doc: { ...DOC, summary: 'Groceries jumped.' },
    });
    const view = store.getOfType('view', id);
    expect(view.data.doc?.summary).toBe('Groceries jumped.');
    expect(view.data.evidenceRevision).toBe(result.revision!.id - 1);
    expect(view.data.evidenceRevision).toBeGreaterThan(before);
    expect(evidenceState(store, view)).toBe('fresh');
    expect(store.getOfType('request', requestId).data.status).toBe('answered');
  });
});

describe('view_preview of a document (R14)', () => {
  it('shows what each component shows, the reads, drawings and embeds', () => {
    const { store, make } = setup();
    const id = make().view.id;
    new ReportAssets(store).put(agent, id, 'img/a.svg', new Uint8Array([60]));
    const preview = previewAny(store, { viewId: id }) as Record<string, unknown> & {
      warnings: string[];
      widgets: { id: string; shows: string }[];
    };
    expect(preview.kind).toBe('report document');
    expect(preview.widgets.map((w) => w.id)).toEqual(['lead', 'n1', 'chart']);
    expect(preview.widgets[0]!.shows).toContain('€42.10');
    expect(preview.reads).toEqual([{ name: 'spend', type: 'record', rows: 1, warnings: [] }]);
    expect(preview.embeds).toEqual([
      { id: 'ref', url: 'https://example.com/path?q=1', origin: 'https://example.com' },
    ]);
    expect(preview.warnings).toEqual([]);
  });

  it('warns on a draft: http embeds, reads missing from data, a drawing reading what it did not list', () => {
    const { store, projectId } = setup();
    const draft = {
      blocks: [
        {
          kind: 'block',
          id: 'lead',
          node: { component: 'Text', content: 'Total ${nope}' },
        },
        { kind: 'embed', id: 'old', url: 'http://example.com/' },
        {
          kind: 'drawing',
          id: 'd',
          html: `<script>pharos.data('other'); location.href = 'https://x.example/'</script>`,
          reads: ['spend', 'gone'],
          height: 100,
        },
      ],
      data: { spend: SPEND },
    };
    const preview = previewAny(store, { projectId, doc: draft }) as { warnings: string[] };
    const text = preview.warnings.join('\n');
    expect(text).toContain('Embed "old" (http://example.com/) is not https');
    expect(text).toContain('Drawing "d" reads "gone", which is not in doc.data');
    expect(text).toContain('Drawing "d": it asks pharos.data("other"), which isn\'t in its reads');
    expect(text).toContain('Drawing "d": The page sets location');
    expect(text).toContain('Drawing "d": no dark colours');
    expect(text).toContain('No summary');
    expect(text).toContain('Block "lead": ${nope} has no value in "values"');
    // The save refuses what the preview only warned about.
    expect(() =>
      createView(store, agent, { projectId, name: 'x', message: 'm', doc: draft }),
    ).toThrow(/Invalid doc/);
  });

  it('runs the same query checks as boards', () => {
    const { store, projectId } = setup();
    const doc = {
      summary: 's',
      blocks: [
        {
          kind: 'block',
          id: 'bad',
          node: {
            component: 'Stat',
            label: 'x',
            query: { type: 'record', where: { recordType: 'nope' } },
          },
        },
      ],
    };
    const preview = previewAny(store, { projectId, doc }) as {
      findings: unknown[];
      warnings: string[];
    };
    expect(preview.findings.length).toBeGreaterThan(0);
    expect(preview.warnings.some((w) => w.startsWith('Block "bad"'))).toBe(true);
  });
});

describe('drawing and embed routes (R14)', () => {
  function served() {
    const ctx = setup();
    const id = ctx.make().view.id;
    new ReportAssets(ctx.store).put(agent, id, 'img/a.svg', new Uint8Array([60, 115, 118, 103]));
    return { ...ctx, id, app: createApp(ctx.store) };
  }

  it('serves a drawing in the locked frame with its own path as its source and the bridge first', async () => {
    const { app, id } = served();
    const res = await app.request(`/api/views/${id}/doc/pic/?theme=dark`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toBe(
      reportCsp(`http://localhost/api/views/${id}/doc/pic/`),
    );
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const html = await res.text();
    expect(html.startsWith('<!doctype html><script>(function () {')).toBe(true);
    expect(html).toContain('var initial = "dark";');
    expect(html).toContain('var listed = ["spend"];');
    // Its files are the view's assets, under its own path.
    const asset = await app.request(`/api/views/${id}/doc/pic/img/a.svg`, {
      headers: { origin: 'null' },
    });
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toBe('image/svg+xml');
    // Without the slash it redirects so relative URLs resolve.
    const moved = await app.request(`/api/views/${id}/doc/pic?theme=light`);
    expect(moved.status).toBe(308);
    expect(moved.headers.get('location')).toBe(`/api/views/${id}/doc/pic/?theme=light`);
  });

  it('answers a locked 404 for a block that is not a drawing, a board and a missing view', async () => {
    const { app, id, store, projectId } = served();
    const board = createView(store, me, {
      projectId,
      name: 'Board',
      message: 'm',
      widgets: [{ id: 'a', node: { component: 'TaskTable' } }],
    }).view.id;
    for (const path of [
      `/api/views/${id}/doc/lead/`,
      `/api/views/${id}/doc/ref/`,
      `/api/views/${id}/doc/nope/`,
      `/api/views/${board}/doc/a/`,
      `/api/views/view_000000000000/doc/pic/`,
      `/api/views/${id}/doc/pic/img/missing.svg`,
      `/api/views/${id}/doc/pic/%ZZ`,
    ]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(404);
      expect(res.headers.get('content-security-policy'), path).toContain('sandbox allow-scripts');
    }
  });

  it('gives a drawing only the reads it lists: pharos.data refuses any other, never asking the parent', async () => {
    const { app, id } = served();
    const html = await (await app.request(`/api/views/${id}/doc/pic/`)).text();
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;
    const posted: Record<string, unknown>[] = [];
    const parent = { postMessage: (m: Record<string, unknown>) => posted.push(m) };
    const win: Record<string, unknown> = {
      addEventListener: () => {},
      setTimeout,
      clearTimeout,
      console,
      URL,
      crypto: globalThis.crypto,
      Event: class {},
      location: { href: `http://localhost/api/views/${id}/doc/pic/` },
      matchMedia: () => ({ matches: false }),
      document: { documentElement: { setAttribute: () => {} } },
    };
    win.window = win;
    win.parent = parent;
    vm.createContext(win);
    vm.runInContext(script, win);
    const pharos = win.pharos as { data: (name: string) => Promise<unknown> };
    await expect(pharos.data('secrets')).rejects.toThrow(/does not list "secrets"/);
    await expect(pharos.data('__proto__')).rejects.toThrow(/does not list/);
    void pharos.data('spend');
    const asked = posted.filter((m) => m.kind === 'data').map((m) => m.name);
    expect(asked).toEqual(['spend']);
  });

  it('serves an embed wrapper whose CSP frames only that origin, with no script', async () => {
    const { app, id } = served();
    const res = await app.request(`/api/views/${id}/embed/ref`);
    expect(res.status).toBe(200);
    const csp = res.headers.get('content-security-policy')!;
    expect(csp).toBe(embedCsp('https://example.com'));
    expect(csp).toContain('frame-src https://example.com;');
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain('script-src');
    expect(csp).not.toContain('allow-top-navigation');
    expect(csp.match(/https?:\/\/[^\s;]+/g)).toEqual(['https://example.com']);
    expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    const html = await res.text();
    expect(html).toContain('<iframe src="https://example.com/path?q=1"');
    expect(html).toContain(
      'sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"',
    );
    expect(html).not.toContain('<script');
    // Anything that isn't an embed: a 404 framing nothing.
    for (const path of [`/api/views/${id}/embed/pic`, `/api/views/${id}/embed/nope`]) {
      const missing = await app.request(path);
      expect(missing.status, path).toBe(404);
      expect(missing.headers.get('content-security-policy'), path).toBe(embedCsp(null));
    }
  });

  it("keeps the app's own frame-src 'self' (R13.6)", () => {
    expect(APP_PAGE_HEADERS['Content-Security-Policy']).toBe(
      "frame-src 'self'; frame-ancestors 'self'",
    );
  });

  it('takes asset uploads for a document view (its drawings use them)', async () => {
    const { app, id } = served();
    const res = await app.request(`/api/views/${id}/page/img/b.svg`, {
      method: 'PUT',
      headers: { 'x-pharos-author': 'agent:Opus 5.5' },
      body: '<svg/>',
    });
    expect(res.status).toBe(200);
    expect((await app.request(`/api/views/${id}/doc/pic/img/b.svg`)).status).toBe(200);
  });
});
