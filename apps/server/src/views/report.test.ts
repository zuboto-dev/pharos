import { REPORT_LIMITS, type Author } from '@pharos/schema';
import { describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../store/database.js';
import { projectSnapshot } from '../store/snapshot.js';
import { Store } from '../store/store.js';
import { evidenceState, projectFreshness } from './freshness.js';
import {
  ReportAssets,
  blockedExternals,
  decodeBase64,
  referencedPaths,
  scheduleAssetPurge,
} from './report.js';
import {
  PAGE_HTML_SHOWN,
  createView,
  getView,
  listViews,
  previewAny,
  updateView,
} from './service.js';

// R13: report pages on the server: the store, the view service, assets, checks and freshness.

const me: Author = { kind: 'human', name: 'me' };
const agent: Author = { kind: 'agent', name: 'Opus 5.5' };

const HTML = `<!doctype html><html><head><style>:root{--a:#000}[data-theme=dark]{--a:#fff}</style></head>
<body><h1>Spending</h1><img src="img/hero.svg" alt=""><script>pharos.data('spend').then(r => r)</script></body></html>`;

const SPEND = { spend: { type: 'record' as const, filter: { where: { recordType: 'spending' } } } };

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
          fields: { date: '2026-09-02', amount: { amount: 4210, currency: 'EUR' } },
        },
      },
      { op: 'create', type: 'task', ref: 't', data: { projectId: '$p', title: 'Budget' } },
    ],
  });
  const projectId = created.p!;
  const make = (author: Author = agent, page: Record<string, unknown> = {}) =>
    createView(store, author, {
      projectId,
      name: 'Spending story',
      message: 'A report page',
      page: { html: HTML, data: SPEND, summary: 'Groceries lead.', ...page },
    });
  return { store, projectId, record: created.r1!, task: created.t!, make };
}

const png = (n: number) => new Uint8Array(n).fill(7);

describe('report pages in the store and view service (R13)', () => {
  it('creates a page view: no board, its reads and summary listed, evidence stamped for agents', () => {
    const { store, projectId, make } = setup();
    const made = make();
    const view = store.getOfType('view', made.view.id);
    expect(view.data.page?.summary).toBe('Groceries lead.');
    expect(view.data.spec).toBeUndefined();
    expect(view.data.evidenceRevision).toBe(made.revision!.id - 1);
    // The result leaves out the HTML the agent just sent; the preview is the page check.
    expect(made.view.page).toEqual({ summary: 'Groceries lead.', data: SPEND });
    expect((made.preview as { kind?: string }).kind).toBe('report page');
    expect(made.preview.summary).toMatch(/^report page, .* 1 named read, 0 assets/);
    const listed = listViews(store, projectId).find((v) => v.id === view.id)!;
    expect(listed).toMatchObject({ layout: 'report page', reads: ['spend'] });
    expect(projectSnapshot(store, projectId).views.find((v) => v.id === view.id)).toMatchObject({
      kind: 'report page',
      summary: 'Groceries lead.',
    });
    expect(getView(store, view.id).board.widgets).toEqual([]);
  });

  it('needs widgets or page, one of the two, and checks the page', () => {
    const { store, projectId } = setup();
    expect(() => createView(store, agent, { projectId, name: 'x', message: 'm' })).toThrow(
      /one of the two/,
    );
    expect(() =>
      createView(store, agent, {
        projectId,
        name: 'x',
        message: 'm',
        widgets: [],
        page: { html: HTML },
      }),
    ).toThrow(/one of the two/);
    expect(() =>
      createView(store, agent, { projectId, name: 'x', message: 'm', page: { html: '' } }),
    ).toThrow(/Invalid page/);
    expect(() =>
      createView(store, agent, {
        projectId,
        name: 'x',
        message: 'm',
        page: { html: 'x'.repeat(REPORT_LIMITS.htmlChars + 1) },
      }),
    ).toThrow(/Invalid page/);
    const many = Object.fromEntries(
      Array.from({ length: REPORT_LIMITS.reads + 1 }, (_, i) => [`r${i}`, { type: 'task' }]),
    );
    expect(() =>
      createView(store, agent, {
        projectId,
        name: 'x',
        message: 'm',
        page: { html: HTML, data: many },
      }),
    ).toThrow(/Invalid page/);
  });

  it('refuses a named read the query check rejects, naming the read', () => {
    const { store, projectId } = setup();
    try {
      createView(store, agent, {
        projectId,
        name: 'x',
        message: 'm',
        page: {
          html: HTML,
          data: { spend: { type: 'record', filter: { where: { recordType: 'spendng' } } } },
        },
      });
      expect.unreachable();
    } catch (error) {
      const issues = (error as { issues?: string[] }).issues ?? [];
      expect(issues.join('\n')).toMatch(/page\.data\.spend\.filter\.where.*\(read "spend"\)/);
    }
  });

  it('keeps a view a board or a page, never both; old board views stay valid', () => {
    const { store, projectId, make } = setup();
    const board = createView(store, me, {
      projectId,
      name: 'Board',
      message: 'm',
      widgets: [{ id: 'a', node: { component: 'TaskTable' } }],
    }).view.id;
    // A write with both is refused by the store (the REST apply path too).
    expect(() =>
      store.apply(me, {
        message: 'both',
        operations: [{ op: 'update', type: 'view', id: board, data: { page: { html: HTML } } }],
      }),
    ).toThrow(/Invalid changes/);
    // Renaming the old board still works.
    store.apply(me, {
      message: 'rename',
      operations: [{ op: 'update', type: 'view', id: board, data: { name: 'Board 2' } }],
    });
    // view_update with page turns the board into a page (spec cleared) …
    updateView(store, agent, {
      viewId: board,
      message: 'now a page',
      expectedRevision: store.getOfType('view', board).updatedRev,
      page: { html: HTML, data: SPEND },
    });
    let view = store.getOfType('view', board);
    expect(view.data.page).toBeDefined();
    expect(view.data.spec).toBeUndefined();
    // … ops make no sense on it …
    expect(() =>
      updateView(store, agent, {
        viewId: board,
        message: 'ops',
        ops: [{ op: 'remove', id: 'a' }],
      }),
    ).toThrow(/report page: it has no widgets/);
    // … and widgets make it a board again.
    updateView(store, agent, {
      viewId: board,
      message: 'board again',
      widgets: [{ id: 'b', node: { component: 'TaskTable' } }],
    });
    view = store.getOfType('view', board);
    expect(view.data.page).toBeUndefined();
    expect(view.data.spec).toBeDefined();
    // A page view made from scratch.
    expect(make().view.id).toMatch(/^view_/);
  });

  it('replaces the whole page with expectedRevision; refuses a stale one', () => {
    const { store, make } = setup();
    const id = make().view.id;
    const rev = store.getOfType('view', id).updatedRev;
    store.apply(me, {
      message: 'rename',
      operations: [{ op: 'update', type: 'view', id, data: { name: 'Renamed' } }],
    });
    expect(() =>
      updateView(store, agent, {
        viewId: id,
        message: 'again',
        expectedRevision: rev,
        page: { html: HTML },
      }),
    ).toThrow(/changed since revision/);
    // Without a revision, after a person's change: refused too (v0.2 review gap 4 rule).
    expect(() =>
      updateView(store, agent, { viewId: id, message: 'again', page: { html: HTML } }),
    ).toThrow(/expectedRevision/);
    const result = updateView(store, agent, {
      viewId: id,
      message: 'again',
      expectedRevision: store.getOfType('view', id).updatedRev,
      page: { html: `${HTML}<!-- v2 -->`, data: SPEND },
    });
    const view = store.getOfType('view', id);
    expect(view.data.page?.html).toContain('v2');
    expect(view.data.page?.summary).toBeUndefined(); // whole replace
    expect(view.data.evidenceRevision).toBe(result.revision!.id - 1);
  });

  it('shows a long page cut in view_get, with a note and the assets', () => {
    const { store, make } = setup();
    const long = `${HTML}${'<p>more</p>'.repeat(6000)}`;
    const id = make(agent, { html: long }).view.id;
    new ReportAssets(store).put(agent, id, 'img/hero.svg', png(10));
    const got = getView(store, id);
    expect(got.page!.html.length).toBe(PAGE_HTML_SHOWN);
    expect(got.page!.htmlTruncated).toMatch(/send the whole HTML again/);
    expect(got.assets).toEqual([
      expect.objectContaining({ path: 'img/hero.svg', mime: 'image/svg+xml', size: 10 }),
    ]);
  });

  it('refuses block asks on a report page (store and view_update)', () => {
    const { store, projectId, make } = setup();
    const id = make().view.id;
    expect(() =>
      store.apply(me, {
        message: 'ask',
        operations: [
          {
            op: 'create',
            type: 'request',
            data: { projectId, question: 'Bigger?', viewId: id, widgetId: 'x', mode: 'block' },
          },
        ],
      }),
    ).toThrow(/Invalid changes/);
    // A plain question and a refresh about the page are fine.
    const { created } = store.apply(me, {
      message: 'ask',
      operations: [
        {
          op: 'create',
          type: 'request',
          ref: 'q',
          data: { projectId, question: 'Refresh', viewId: id, mode: 'refresh' },
        },
      ],
    });
    // A refresh is answered with the whole page; a rename is refused.
    expect(() =>
      updateView(store, agent, { viewId: id, message: 'r', name: 'n', requestId: created.q }),
    ).toThrow(/whole page as page/);
    updateView(store, agent, {
      viewId: id,
      message: 'refreshed',
      expectedRevision: store.getOfType('view', id).updatedRev,
      requestId: created.q,
      page: { html: HTML, data: SPEND },
    });
    expect(store.getOfType('request', created.q!).data.status).toBe('answered');
  });
});

describe('report assets (R13)', () => {
  it('puts, lists, replaces, gets and deletes; refuses bad paths, types and empty files', () => {
    const { store, make } = setup();
    const id = make().view.id;
    const assets = new ReportAssets(store);
    assets.put(agent, id, 'img/hero.svg', png(3));
    assets.put(agent, id, 'img/hero.svg', png(5));
    assets.put(me, id, 'fonts/a.woff2', png(4));
    expect(assets.list(id).map((a) => [a.path, a.size, a.mime])).toEqual([
      ['fonts/a.woff2', 4, 'font/woff2'],
      ['img/hero.svg', 5, 'image/svg+xml'],
    ]);
    expect(assets.get(id, 'img/hero.svg')?.bytes.byteLength).toBe(5);
    for (const bad of [
      '../x.png',
      '/etc/a.png',
      'a/../b.png',
      './a.png',
      'a.exe',
      'a.html',
      'a b.png',
      '',
    ])
      expect(() => assets.put(agent, id, bad, png(1)), bad).toThrow(/isn't allowed/);
    expect(() => assets.put(agent, id, 'e.png', png(0))).toThrow(/empty/);
    expect(assets.delete(id, 'fonts/a.woff2')).toBe(true);
    expect(assets.list(id)).toHaveLength(1);
  });

  it('keeps to the size limits: 10 MB per asset, 64 MB per page', () => {
    const { store, make } = setup();
    const id = make().view.id;
    const assets = new ReportAssets(store);
    expect(() => assets.put(agent, id, 'big.png', png(REPORT_LIMITS.assetBytes + 1))).toThrow(
      /at most 10 MB/,
    );
    const ten = png(REPORT_LIMITS.assetBytes);
    for (let i = 0; i < 6; i++) assets.put(agent, id, `p${i}.png`, ten);
    expect(() => assets.put(agent, id, 'p6.png', ten)).toThrow(/at most 64 MB/);
    // Replacing one counts its new size only.
    assets.put(agent, id, 'p0.png', ten);
    assets.put(agent, id, 'small.png', png(REPORT_LIMITS.viewAssetBytes - 6 * ten.byteLength));
  });

  it('only on a report page that exists', () => {
    const { store, projectId, task, make } = setup();
    const assets = new ReportAssets(store);
    const board = createView(store, me, {
      projectId,
      name: 'Board',
      message: 'm',
      widgets: [{ id: 'a', node: { component: 'TaskTable' } }],
    }).view.id;
    expect(() => assets.put(agent, board, 'a.png', png(1))).toThrow(/is a board/);
    expect(() => assets.put(agent, 'view_000000000000', 'a.png', png(1))).toThrow(/not found/);
    expect(() => assets.put(agent, task, 'a.png', png(1))).toThrow(/not found/);
    expect(make().view.id).toBeTruthy();
  });

  it('outlive a delete so a revert restores the whole page; purged 30 days after (R13.5)', () => {
    const { store, projectId, make } = setup();
    const assets = new ReportAssets(store);
    const a = make().view.id;
    const b = make().view.id;
    assets.put(agent, a, 'x.png', png(2));
    assets.put(agent, b, 'x.png', png(2));
    const made = make();
    assets.put(agent, made.view.id, 'x.png', png(2));
    const deleted = store.apply(me, {
      message: 'del',
      operations: [{ op: 'delete', type: 'view', id: a }],
    });
    // Kept (not served: the routes need the view), and back with the view on undo.
    expect(assets.list(a)).toHaveLength(1);
    store.revert(deleted.revision!.id, me);
    expect(store.get(a)?.type).toBe('view');
    expect(assets.get(a, 'x.png')?.bytes.byteLength).toBe(2);
    // Reverting the create removes the view; its assets wait like a delete's.
    store.revert(made.revision!.id, me);
    expect(assets.list(made.view.id)).toHaveLength(1);
    // Nothing gone long enough yet.
    expect(assets.purgeGone()).toBe(0);
    expect(assets.purgeGone(Date.now() + 29 * 86_400_000)).toBe(0);
    // 31 days on: only the gone view's assets go; live views keep theirs.
    expect(assets.purgeGone(Date.now() + 31 * 86_400_000)).toBe(1);
    expect(assets.list(made.view.id)).toEqual([]);
    expect(assets.list(a)).toHaveLength(1);
    expect(assets.list(b)).toHaveLength(1);
    // A project delete takes its views; their assets go 30 days later.
    store.apply(me, {
      message: 'del project',
      operations: [{ op: 'delete', type: 'project', id: projectId }],
    });
    expect(assets.purgeGone()).toBe(0);
    expect(assets.purgeGone(Date.now() + 31 * 86_400_000)).toBe(2);
    const count = store.database.prepare('SELECT COUNT(*) AS n FROM report_assets').get() as {
      n: number;
    };
    expect(count.n).toBe(0);
  });

  it('the purge runs at start and logs, never throws (R13.5)', () => {
    const { store } = setup();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stop = scheduleAssetPurge(store);
    stop();
    store.database.exec('DROP TABLE report_assets');
    expect(() => scheduleAssetPurge(store)()).not.toThrow();
    expect(errors).toHaveBeenCalledWith('[pharos] Report asset purge failed:', expect.anything());
    errors.mockRestore();
  });

  it('decodes base64 strictly (a data: URL is fine)', () => {
    expect(Buffer.from(decodeBase64('aGk=')).toString()).toBe('hi');
    expect(Buffer.from(decodeBase64('data:image/png;base64,aGk=')).toString()).toBe('hi');
    expect(() => decodeBase64('not base64!')).toThrow(/not valid/);
  });
});

describe('page checks (view_preview, R13)', () => {
  it('finds relative references and blocked hosts', () => {
    const html = `<img src="img/a.png"><img src='b.jpg?x=1#y'><a href="#top">t</a>
      <link rel="stylesheet" href="css/site.css"><div style="background:url('img/bg.webp')"></div>
      <img srcset="s1.png 1x, s2.png 2x"><a href="https://example.com">src</a><img src="data:image/png;base64,AA">
      <script src="https://cdn.jsdelivr.net/npm/d3"></script><script src="https://evil.example/x.js"></script>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
      <link rel="stylesheet" href="https://cdn.example/x.css"><img src="https://pics.example/p.jpg">
      <link rel="preconnect" href="https://fonts.gstatic.com">
      <script>fetch('/api/projects')</script>`;
    expect(referencedPaths(html).sort()).toEqual(
      ['b.jpg', 'css/site.css', 'img/a.png', 'img/bg.webp', 's1.png', 's2.png'].sort(),
    );
    const blocked = blockedExternals(html);
    expect(blocked.join('\n')).toContain('evil.example');
    expect(blocked.join('\n')).toContain('cdn.example');
    expect(blocked.join('\n')).toContain('pics.example');
    expect(blocked.join('\n')).toContain('fetch');
    expect(blocked.join('\n')).not.toContain('jsdelivr');
    expect(blocked.join('\n')).not.toContain('googleapis');
    expect(blocked.join('\n')).not.toContain('gstatic');
  });

  it('looks for files only in markup and CSS, never in script text (R13.5)', () => {
    const html = `<!doctype html><html><head>
      <link rel="stylesheet" href="css/a.css"><link rel="icon" href="favicon.png">
      <link rel="preload" as="font" href="fonts/x.woff2"><link rel="canonical" href="page.html">
      <style>@import "css/b.css"; .h { background: url(img/bg.png) } /* url(img/no.png) */</style>
      <script type="application/json" id="d">{"dir":[{"n":"Mixbook","src":"img/no1.png"}],"q":"\\""}</script>
      <script>
        const clean = (m) => m.source_name.replace(/url\\(/g, '').replace(/"/g, '\\"');
        el.innerHTML = '<img src="img/no2.png">' + "<a href='x'>" + \`url('img/no3.png')\`;
        const css = "background:url(img/no4.png)";
      </script>
      <!-- <img src="img/no5.png"> -->
    </head><body>
      <a href="notes/a.pdf">a link isn't loaded</a><a href="#top">top</a>
      <img src="https://pics.example/p.jpg"><img src="//cdn.example/p.jpg"><img src="data:image/png;base64,AA">
      <img src="blob:abc"><a href="mailto:me@example.com">m</a>
      <video poster="img/poster.jpg" src="media/v.mp4"></video><object data="docs/o.svg"></object>
      <img srcset="s1.png 1x, s2.png 2x"><div style="background:url(&quot;img/inline.webp&quot;)"></div>
      <p>Text url(img/no6.png) and src="img/no7.png" in prose</p>
      <textarea><img src="img/no8.png"></textarea>
    </body></html>`;
    expect(referencedPaths(html).sort()).toEqual(
      [
        'css/a.css',
        'css/b.css',
        'docs/o.svg',
        'favicon.png',
        'fonts/x.woff2',
        'img/bg.png',
        'img/inline.webp',
        'img/poster.jpg',
        'media/v.mp4',
        's1.png',
        's2.png',
      ].sort(),
    );
    expect(blockedExternals(html).join('\n')).toContain('pics.example');
  });

  it('a big page with script text warns once, for the one missing picture (R13.5)', () => {
    const { store, projectId } = setup();
    const blob = JSON.stringify({
      dir: Array.from({ length: 2000 }, (_, i) => ({ n: 'Mixbook', i, s: 'a"b' })),
    });
    const html = `<!doctype html><html><head><style>:root{--a:#000}[data-theme=dark]{--a:#fff}</style></head>
      <body><h1>Spend</h1><img src="images/x.jpg" alt="">
      <script>const DATA = ${blob};
      const name = (m) => m.source_name.replace(/[^a-z]/g, '').replace(/"/g, '\\""');
      const q = "\\"\\"";</script></body></html>`;
    expect(html.length).toBeGreaterThan(50_000);
    const preview = previewAny(store, { projectId, page: { html, summary: 'Spend.' } });
    const assetWarnings = preview.warnings.filter((w) => /asset|won't load/.test(w));
    expect(assetWarnings).toHaveLength(1);
    expect(assetWarnings[0]).toMatch(/"images\/x\.jpg", which isn't an asset/);
  });

  it('previews a saved page and a draft: rows per read, missing assets, unknown reads', () => {
    const { store, projectId, make } = setup();
    const id = make().view.id;
    let preview = previewAny(store, { viewId: id }) as ReturnType<typeof previewAny> & {
      reads: { name: string; rows: number }[];
    };
    expect(preview.reads).toEqual([expect.objectContaining({ name: 'spend', rows: 1 })]);
    expect(preview.warnings.join('\n')).toMatch(/"img\/hero\.svg", which isn't an asset/);
    new ReportAssets(store).put(agent, id, 'img/hero.svg', png(3));
    preview = previewAny(store, { viewId: id }) as typeof preview;
    expect(preview.warnings.join('\n')).not.toContain('hero.svg');
    const draft = previewAny(store, {
      projectId,
      page: { html: '<p>pharos.data("other")</p><script>pharos.data("other")</script>' },
    });
    expect(draft.warnings.join('\n')).toMatch(
      /pharos\.data\("other"\), which isn't one of its named reads/,
    );
    expect(draft.warnings.join('\n')).toMatch(/No dark colours/);
    expect(draft.warnings.join('\n')).toMatch(/No summary/);
  });
});

describe('freshness of report pages (R13 + R11)', () => {
  it('a page reading spending goes stale when a spending record changes', () => {
    const { store, projectId, record, task, make } = setup();
    const id = make().view.id;
    expect(evidenceState(store, store.getOfType('view', id))).toBe('fresh');
    // An unrelated change (a task) leaves it fresh.
    store.apply(me, {
      message: 'task',
      operations: [{ op: 'update', type: 'task', id: task, data: { title: 'Budget v2' } }],
    });
    expect(evidenceState(store, store.getOfType('view', id))).toBe('fresh');
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
    expect(evidenceState(store, store.getOfType('view', id))).toBe('stale');
    const evidence = projectFreshness(store, projectId).views[id]!.evidence;
    expect(evidence && 'stale' in evidence && evidence.stale?.total).toBe(1);
  });

  it('a page that reads nothing never goes stale from data', () => {
    const { store, projectId, record, make } = setup();
    const id = make(agent, { data: undefined }).view.id;
    store.apply(me, {
      message: 'spent more',
      operations: [
        {
          op: 'update',
          type: 'record',
          id: record,
          data: { fields: { amount: { amount: 1, currency: 'EUR' } } },
        },
      ],
    });
    expect(projectFreshness(store, projectId).views[id]!.evidence).toBeNull();
    expect(evidenceState(store, store.getOfType('view', id))).toBe('unknown');
  });
});
