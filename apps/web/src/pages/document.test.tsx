import {
  CATALOG,
  COMPONENT_INFO,
  ReportDoc,
  runQuery,
  type ComponentName,
  type Entity,
  type ProjectDataset,
  type ViewNode,
} from '@pharos/schema';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import dataset from '../catalog/__fixtures__/dataset.json';
import { ViewDataProvider } from '../catalog/context';
import { Node as CatalogNode, ViewRenderer } from '../catalog/renderer';
import { VariantProvider } from '../catalog/variant';
import { ProjectPage } from './ProjectPage';
import { REPORT_SANDBOX } from './frame-bridge';
import {
  DocumentView,
  EMBED_HEIGHT,
  EMBED_SANDBOX,
  columnTemplate,
  docWidth,
  drawingUrl,
  embedUrl,
} from './document';

// A variable path, so Vite leaves the URL alone.
const cssFile = '../index.css';

const data = dataset as unknown as ProjectDataset;
const [board] = data.views as Entity<'view'>[];

const doc = ReportDoc.parse({
  summary: 'Two tasks are left; spending is on plan.',
  data: {
    done: { type: 'task', filter: { where: { status: 'done' } } },
    open: { type: 'task', filter: { where: { status: 'todo' } } },
  },
  blocks: [
    {
      kind: 'block',
      id: 'intro',
      node: { component: 'Markdown', content: '# Where it stands\n\nMost of the plan is done.' },
    },
    { kind: 'block', id: 'more', node: { component: 'Text', content: 'Two tasks are left.' } },
    {
      kind: 'block',
      id: 'note',
      node: { component: 'Callout', tone: 'warning', body: 'One date moved.' },
    },
    {
      kind: 'block',
      id: 'tasks',
      node: { component: 'TaskTable', title: 'Open tasks' },
    },
    {
      kind: 'block',
      id: 'wide-text',
      width: 'full',
      node: { component: 'Text', content: 'Wide.' },
    },
    {
      kind: 'columns',
      id: 'pair',
      widths: [2, 1],
      columns: [
        [{ kind: 'block', id: 'left', node: { component: 'Text', content: 'Left column.' } }],
        [
          {
            kind: 'block',
            id: 'right',
            node: { component: 'Stat', label: 'Open', query: { type: 'task' } },
          },
        ],
      ],
    },
    {
      kind: 'drawing',
      id: 'map',
      html: '<!doctype html><p>map</p>',
      height: 320,
      reads: ['done'],
      caption: 'Where the work happened',
    },
    {
      kind: 'embed',
      id: 'ref',
      url: 'https://example.org/reference',
      caption: 'The reference page',
    },
    { kind: 'embed', id: 'bare', url: 'https://example.com/a', height: 300 },
  ],
});

const docView: Entity<'view'> = {
  ...board!,
  id: 'view_doc',
  updatedAt: '2026-10-19T09:00:00.000Z',
  data: { ...board!.data, name: 'Where it stands', pinned: true, order: -1, spec: undefined, doc },
};
const withDoc: ProjectDataset = { ...data, views: [docView, ...data.views] };

// happy-dom loads a frame's page itself: answer it here, so no test reaches the network.
type HappyWindow = Window & { happyDOM: { settings: { fetch: { interceptor: unknown } } } };
beforeAll(() => {
  (window as unknown as HappyWindow).happyDOM.settings.fetch.interceptor = {
    beforeAsyncRequest: async () =>
      new Response('<!doctype html><title>page</title>', {
        headers: { 'content-type': 'text/html' },
      }),
  };
});
afterAll(() => {
  (window as unknown as HappyWindow).happyDOM.settings.fetch.interceptor = null;
});

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) =>
      init?.method === 'HEAD'
        ? new Response(null, { status: 200 })
        : String(url).endsWith('/data')
          ? Response.json(withDoc)
          : Response.json([]),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Providers({ children, version = 1 }: { children: ReactNode; version?: number }) {
  return (
    <MemoryRouter>
      <ViewDataProvider
        data={withDoc}
        version={version}
        actions={{ apply: vi.fn(), open: vi.fn() }}
      >
        {children}
      </ViewDataProvider>
    </MemoryRouter>
  );
}

const block = (id: string) => document.querySelector<HTMLElement>(`[data-doc-block="${id}"]`)!;

describe('report document (R14)', () => {
  it('renders every block kind in reading order', () => {
    render(
      <Providers>
        <DocumentView view={docView} />
      </Providers>,
    );
    const article = document.querySelector('article[data-document="view_doc"]')!;
    const top = [...article.children].map((el) => el.getAttribute('data-doc-block'));
    expect(top).toEqual([
      'intro',
      'more',
      'note',
      'tasks',
      'wide-text',
      'pair',
      'map',
      'ref',
      'bare',
    ]);
    // Prose is document text: Markdown headings are document headings.
    expect(block('intro').querySelector('h1')?.textContent).toBe('Where it stands');
    expect(block('more').textContent).toContain('Two tasks are left.');
    expect(block('note').textContent).toContain('One date moved.');
    // A component reads live data, as on a board.
    const open = runQuery(withDoc, 'task', {});
    expect(block('right').textContent).toContain(String(open.length));
    expect(block('tasks').querySelector('h3')?.textContent).toBe('Open tasks');
    expect(article.textContent).not.toMatch(/failed to render|Unknown component/);
  });

  it('gives text blocks the reading column and the rest the wide band, unless set', () => {
    expect(docWidth(doc.blocks[0]!)).toBe('text');
    expect(docWidth(doc.blocks[2]!)).toBe('text');
    expect(docWidth(doc.blocks[3]!)).toBe('wide');
    expect(docWidth(doc.blocks[4]!)).toBe('full');
    expect(docWidth(doc.blocks[5]!)).toBe('wide');
    expect(docWidth(doc.blocks[6]!)).toBe('wide');
    render(
      <Providers>
        <DocumentView view={docView} />
      </Providers>,
    );
    expect(block('intro').dataset.width).toBe('text');
    expect(block('note').dataset.width).toBe('text');
    expect(block('tasks').dataset.width).toBe('wide');
    expect(block('wide-text').dataset.width).toBe('full');
    // Running prose is marked so paragraphs that follow each other sit closer.
    expect(block('more').hasAttribute('data-prose')).toBe(true);
    expect(block('tasks').hasAttribute('data-prose')).toBe(false);
  });

  it('lays columns side by side by their shares; leaves in a column fill it', () => {
    expect(columnTemplate(2, [2, 1])).toBe('minmax(0, 2fr) minmax(0, 1fr)');
    expect(columnTemplate(3)).toBe('minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)');
    // Shares that don't match the columns are ignored.
    expect(columnTemplate(2, [1, 2, 3])).toBe('minmax(0, 1fr) minmax(0, 1fr)');
    render(
      <Providers>
        <DocumentView view={docView} />
      </Providers>,
    );
    const pair = block('pair');
    expect(pair.classList.contains('doc-columns')).toBe(true);
    expect(pair.style.getPropertyValue('--doc-cols')).toBe('minmax(0, 2fr) minmax(0, 1fr)');
    const columns = pair.querySelectorAll('[data-doc-column]');
    expect(columns).toHaveLength(2);
    expect(columns[0]!.textContent).toContain('Left column.');
    expect(block('left').hasAttribute('data-width')).toBe(false);
  });

  it('collapses columns to one under 720px of document width (container query in index.css)', () => {
    const css = readFileSync(new URL(cssFile, import.meta.url), 'utf8');
    expect(css).toMatch(/container:\s*doc\s*\/\s*inline-size/);
    expect(css).toMatch(/\.doc-columns\s*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
    expect(css).toMatch(
      /@container doc \(min-width: 720px\)\s*{\s*\.doc-columns\s*{\s*grid-template-columns:\s*var\(--doc-cols\)/,
    );
  });

  it('draws a drawing in the locked frame at its height, with its caption', () => {
    render(
      <Providers>
        <DocumentView view={docView} />
      </Providers>,
    );
    const frame = block('map').querySelector('iframe')!;
    expect(frame.getAttribute('sandbox')).toBe(REPORT_SANDBOX);
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(frame.getAttribute('src')).toBe(drawingUrl(docView, 'map'));
    expect(frame.getAttribute('src')).toBe(
      `/api/views/view_doc/doc/map/?v=${encodeURIComponent(docView.updatedAt)}`,
    );
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame.parentElement!.style.height).toBe('320px');
    expect(block('map').querySelector('figcaption')?.textContent).toBe('Where the work happened');
  });

  it('shows an embed with its caption, an Open site link, and the embed sandbox', () => {
    render(
      <Providers>
        <DocumentView view={docView} />
      </Providers>,
    );
    const ref = block('ref');
    const frame = ref.querySelector('iframe')!;
    expect(frame.getAttribute('src')).toBe(embedUrl(docView, 'ref'));
    expect(frame.getAttribute('src')).toBe('/api/views/view_doc/embed/ref');
    expect(frame.getAttribute('sandbox')!.split(' ').sort()).toEqual(
      [
        'allow-forms',
        'allow-popups',
        'allow-popups-to-escape-sandbox',
        'allow-same-origin',
        'allow-scripts',
      ].sort(),
    );
    expect(EMBED_SANDBOX).not.toContain('top-navigation');
    expect(frame.style.height).toBe(`${EMBED_HEIGHT}px`);
    expect(ref.textContent).toContain('The reference page');
    const link = ref.querySelector<HTMLAnchorElement>('a[data-embed-open]')!;
    expect(link.textContent).toContain('Open site');
    expect(link.getAttribute('href')).toBe('https://example.org/reference');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    // The link is above the frame, so it shows even when the site refuses to be framed.
    expect(link.compareDocumentPosition(frame) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Without a caption, the site's host says what it is; its own height wins.
    expect(block('bare').textContent).toContain('example.com');
    expect(block('bare').querySelector('iframe')!.style.height).toBe('300px');
  });

  it('says so in place of an embed whose route is not there, keeping the link', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) =>
        init?.method === 'HEAD' ? new Response(null, { status: 404 }) : Response.json([]),
      ),
    );
    render(
      <Providers>
        <DocumentView view={docView} />
      </Providers>,
    );
    const frame = block('ref').querySelector('iframe')!;
    act(() => {
      frame.dispatchEvent(new Event('load'));
    });
    await waitFor(() => expect(block('ref').querySelector('[data-report-error]')).toBeTruthy());
    expect(block('ref').querySelector('a[data-embed-open]')).toBeTruthy();
  });
});

describe('drawing frame guard (R13.6 in a document)', () => {
  const TOKEN = '0123456789abcdef0123456789abcdef';
  const frame = () => block('map').querySelector('iframe')!;
  function send(message: object, source: Window | null = frame().contentWindow) {
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: { token: TOKEN, ...message }, source }),
      );
    });
  }

  it("answers only the token that said ready, and only the drawing's own reads", async () => {
    render(
      <Providers>
        <DocumentView view={docView} />
      </Providers>,
    );
    const post = vi.spyOn(frame().contentWindow!, 'postMessage').mockImplementation(() => {});
    send({ pharos: 1, kind: 'data', id: 0, name: 'done' }); // before ready: nothing
    expect(post).not.toHaveBeenCalled();
    send({ pharos: 1, kind: 'ready' });
    expect(post).toHaveBeenCalledWith({ pharos: 1, kind: 'theme', theme: 'light' }, '*');
    post.mockClear();
    send({ pharos: 1, kind: 'data', id: 1, name: 'done', token: 'f'.repeat(32) });
    send({ pharos: 1, kind: 'data', id: 2, name: 'done' });
    const rows = runQuery(withDoc, 'task', { where: { status: 'done' } });
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        { pharos: 1, kind: 'data', id: 2, name: 'done', rows },
        '*',
      ),
    );
    expect(post).toHaveBeenCalledTimes(1);
    // `open` is in the document's data but this drawing doesn't list it.
    send({ pharos: 1, kind: 'data', id: 3, name: 'open' });
    await waitFor(() =>
      expect(post).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 3, rows: [], error: expect.stringContaining('drawing') }),
        '*',
      ),
    );
  });

  it('stops a drawing that leaves its page (a second load or ready)', () => {
    render(
      <Providers>
        <DocumentView view={docView} />
      </Providers>,
    );
    send({ pharos: 1, kind: 'ready' });
    send({ pharos: 1, kind: 'ready' });
    const stopped = block('map').querySelector('[data-report-error="stopped"]');
    expect(stopped?.textContent).toContain(
      'This drawing tried to leave Pharos, so it was stopped.',
    );
    expect(block('map').querySelector('iframe')).toBeNull();
    // The block keeps its height, so the document doesn't jump.
    expect((stopped!.parentElement as HTMLElement).style.height).toBe('320px');
  });

  it('stops on a second load of the same address', () => {
    render(
      <Providers>
        <DocumentView view={docView} />
      </Providers>,
    );
    act(() => {
      frame().dispatchEvent(new Event('load'));
    });
    act(() => {
      frame().dispatchEvent(new Event('load'));
    });
    expect(block('map').querySelector('[data-report-error="stopped"]')).toBeTruthy();
  });
});

/** Card chrome: a rounded block with a border (a board widget's frame). */
const CARD = '.rounded-block.border';

function inVariant(node: ViewNode, variant: 'board' | 'document') {
  return render(
    <Providers>
      <VariantProvider variant={variant}>
        <CatalogNode node={node} />
      </VariantProvider>
    </Providers>,
  );
}

describe('document variant', () => {
  // Components that draw a card of their own (bare) or sit in the board's panel.
  const CHROME: ComponentName[] = [
    'Stat',
    'StatCards',
    'Callout',
    'ProjectHeader',
    'TaskTable',
    'DataTable',
    'CountChart',
    'Timeline',
    'Markdown',
  ];
  for (const name of CHROME) {
    it(`${name}: a card on a board, plain in a document`, () => {
      const node = COMPONENT_INFO[name].example as ViewNode;
      const onBoard = inVariant(node, 'board').container;
      const card = onBoard.querySelector(CARD) ?? onBoard.querySelector('.border');
      expect(card).toBeTruthy();
      cleanup();
      const inDoc = inVariant(node, 'document').container;
      expect(inDoc.querySelector(CARD)).toBeNull();
      expect(inDoc.textContent).not.toMatch(/failed to render/);
    });
  }

  it('every catalog component renders in a document', () => {
    for (const name of Object.keys(CATALOG) as ComponentName[]) {
      const node = COMPONENT_INFO[name].example as ViewNode;
      const { container, unmount } = inVariant(node, 'document');
      expect(container.textContent, name).not.toMatch(/failed to render|Unknown component/);
      unmount();
    }
  });

  it('a board keeps its chrome: cards, title bars, the grid', () => {
    render(
      <Providers>
        <ViewRenderer
          spec={{
            component: 'Board',
            widgets: [
              { id: 'w1', w: 6, node: { component: 'TaskTable', title: 'Tasks' } },
              {
                id: 'w2',
                w: 6,
                node: { component: 'Stat', label: 'All', query: { type: 'task' } },
              },
            ],
          }}
        />
      </Providers>,
    );
    expect(document.querySelector('.md\\:grid-cols-12')).toBeTruthy();
    expect(document.querySelectorAll(`[data-widget] ${CARD}`).length).toBeGreaterThanOrEqual(2);
    const title = screen.getByRole('heading', { name: 'Tasks' });
    expect(title.className).toContain('border-b');
  });

  it('a document has no widget frames, grid, drag handles or ask buttons', () => {
    render(
      <Providers>
        <DocumentView view={docView} />
      </Providers>,
    );
    const article = document.querySelector('article')!;
    expect(article.querySelector('[data-widget]')).toBeNull();
    expect(article.querySelector('.md\\:grid-cols-12')).toBeNull();
    expect(article.querySelector('[draggable]')).toBeNull();
    expect(article.querySelector('[aria-label^="Ask about"]')).toBeNull();
    expect(article.querySelector(CARD)).toBeNull();
    // A block's title is a document heading, not a card's title bar.
    expect(block('tasks').querySelector('h3')?.className).toBe('doc-block-title');
  });
});

describe('project page with a report document (R14)', () => {
  function route(path: string) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) =>
        init?.method === 'HEAD'
          ? new Response(null, { status: 200 })
          : url.includes('/data')
            ? Response.json(withDoc)
            : url.includes('/freshness?')
              ? Response.json({
                  projectId: data.project.id,
                  latest: 30,
                  views: {
                    [docView.id]: {
                      viewId: docView.id,
                      seen: 30,
                      changed: null,
                      evidence: {
                        revision: 9,
                        at: null,
                        stale: {
                          since: 9,
                          total: 1,
                          recent: [
                            {
                              revision: 12,
                              at: new Date().toISOString(),
                              author: { kind: 'human', name: 'me' },
                              message: 'Done',
                              items: [
                                { type: 'task', id: 't', label: 'Write the brief', op: 'update' },
                              ],
                              page: false,
                            },
                          ],
                        },
                      },
                    },
                  },
                })
              : new Response('[]', { status: 200 }),
      ),
    );
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/projects/:projectId" element={<ProjectPage />} />
          <Route path="/projects/:projectId/views/:viewId" element={<ProjectPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('shows the document and the report bar instead of the board, with Ask to refresh', async () => {
    route(`/projects/${data.project.id}/views/${docView.id}`);
    await screen.findByRole('link', { name: /Where it stands/ });
    await waitFor(() => expect(document.querySelector('article[data-document]')).toBeTruthy());
    expect(document.querySelector('[data-report-bar]')).toBeTruthy();
    expect(document.querySelector('[data-widget]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Customize' })).toBeNull();
    await screen.findByText('Out of date');
    expect(screen.getByRole('button', { name: /Ask to refresh/ })).toBeTruthy();
    // A document has no page of its own to open in a new tab.
    expect(screen.queryByRole('link', { name: /Open in new tab/ })).toBeNull();
    const tab = screen.getByRole('link', { name: /Where it stands/ });
    expect(tab.querySelector('[aria-label="Report"]')).toBeTruthy();
  });
});
