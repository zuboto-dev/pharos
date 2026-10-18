import type { Entity, ProjectDataset, ViewFreshness } from '@pharos/schema';
import { runQuery } from '@pharos/schema';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import dataset from '../catalog/__fixtures__/dataset.json';
import { ViewDataProvider, type ViewActions } from '../catalog/context';
import { FileViewerContext, type FileViewerApi } from '../files/viewer-context';
import { ProjectPage } from './ProjectPage';
import { announceReportAssets } from '../lib/events';
import {
  ASSET_RELOAD_DELAY_MS,
  REPORT_SANDBOX,
  ReportBar,
  ReportFrame,
  linkDecision,
  reportUrl,
} from './report';

const data = dataset as unknown as ProjectDataset;
const [board] = data.views as Entity<'view'>[];
const report: Entity<'view'> = {
  ...board!,
  id: 'view_report',
  updatedAt: '2026-10-17T09:00:00.000Z',
  data: {
    ...board!.data,
    name: 'Where the plan stands',
    pinned: true,
    order: -1,
    page: {
      html: '<!doctype html><h1>Report</h1>',
      summary: 'Most of the plan is done; two tasks are left.',
      data: { done: { type: 'task', filter: { where: { status: 'done' } } } },
    },
  },
};
const withReport: ProjectDataset = { ...data, views: [report, ...data.views] };
// What the server gives agents (AgentFiles); the page reads this, never the owner's dataset.
let agentSees: ProjectDataset = withReport;

// happy-dom loads a frame's page itself (not through `fetch`): answer it here, so no test ever
// reaches the network. The page has no bridge; tests speak for it with messages.
type HappyWindow = Window & {
  happyDOM: { settings: { fetch: { interceptor: unknown } } };
};
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
  // The page route answers (HEAD after a load without a bridge); nothing else does.
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) =>
      init?.method === 'HEAD'
        ? new Response(null, { status: 200 })
        : url.endsWith('/data') &&
            new Headers(init?.headers).get('x-pharos-author') === 'agent:Report page'
          ? Response.json(agentSees)
          : new Response('{}', { status: 404 }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.classList.remove('dark');
});

function Providers({
  version = 1,
  viewer,
  children,
  actions = { apply: vi.fn(), open: vi.fn() },
}: {
  version?: number;
  viewer?: FileViewerApi;
  children: ReactNode;
  actions?: ViewActions;
}) {
  return (
    <MemoryRouter>
      <ViewDataProvider data={withReport} version={version} actions={actions}>
        <FileViewerContext.Provider value={viewer ?? null}>{children}</FileViewerContext.Provider>
      </ViewDataProvider>
    </MemoryRouter>
  );
}

function frameOf(): HTMLIFrameElement {
  const frame = document.querySelector('iframe');
  if (!frame) throw new Error('no frame');
  return frame;
}

/** The token the page's bridge signs its messages with (R13.6). */
const TOKEN = '0123456789abcdef0123456789abcdef';

/** A message as it arrives, from `source` (the frame's window by default), exactly as given. */
function sendRaw(message: unknown, source: Window | null = frameOf().contentWindow) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: message, source }));
  });
}

/** A message from the page's bridge: signed with TOKEN unless it names its own token. */
function send(message: object, source: Window | null = frameOf().contentWindow) {
  sendRaw({ token: TOKEN, ...message }, source);
}

function spyOnFrame() {
  const win = frameOf().contentWindow!;
  return vi.spyOn(win, 'postMessage').mockImplementation(() => {});
}

describe('report frame (R13)', () => {
  it('is locked: exactly the sandbox tokens, never allow-same-origin', () => {
    render(
      <Providers>
        <ReportFrame view={report} />
      </Providers>,
    );
    const frame = frameOf();
    const tokens = (frame.getAttribute('sandbox') ?? '').split(/\s+/).sort();
    expect(tokens).toEqual(['allow-modals', 'allow-scripts'].sort());
    expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(REPORT_SANDBOX).not.toContain('same-origin');
    expect(frame.getAttribute('src')).toBe(
      `/api/views/view_report/page/?v=${encodeURIComponent(report.updatedAt)}`,
    );
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame.getAttribute('title')).toBe('Where the plan stands');
    // A skeleton until the page says it is ready.
    expect(screen.getByRole('status', { name: 'Loading page' })).toBeTruthy();
  });

  it('sends the theme on ready and rows for a named read; an error for an unknown one', async () => {
    render(
      <Providers>
        <ReportFrame view={report} />
      </Providers>,
    );
    const post = spyOnFrame();
    send({ pharos: 1, kind: 'ready' });
    expect(post).toHaveBeenCalledWith({ pharos: 1, kind: 'theme', theme: 'light' }, '*');
    expect(screen.queryByRole('status', { name: 'Loading page' })).toBeNull();

    send({ pharos: 1, kind: 'data', id: 7, name: 'done' });
    const rows = runQuery(withReport, 'task', { where: { status: 'done' } });
    expect(rows.length).toBeGreaterThan(0);
    await waitFor(() =>
      expect(post).toHaveBeenLastCalledWith(
        { pharos: 1, kind: 'data', id: 7, name: 'done', rows },
        '*',
      ),
    );

    send({ pharos: 1, kind: 'data', id: 'b', name: 'nope' });
    await waitFor(() =>
      expect(post).toHaveBeenLastCalledWith(
        expect.objectContaining({
          kind: 'data',
          id: 'b',
          name: 'nope',
          rows: [],
          error: expect.any(String),
        }),
        '*',
      ),
    );
    // Not an own property of the reads: still unknown.
    send({ pharos: 1, kind: 'data', id: 'c', name: 'constructor' });
    await waitFor(() =>
      expect(post).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 'c', error: expect.any(String) }),
        '*',
      ),
    );
  });

  it("answers from what agents see, not from the owner's dataset", async () => {
    // The owner sees a done task the agent view leaves out (as AgentFiles drops hidden items).
    const done = runQuery(withReport, 'task', { where: { status: 'done' } });
    agentSees = { ...withReport, tasks: withReport.tasks.filter((t) => t.id !== done[0]!.id) };
    try {
      render(
        <Providers>
          <ReportFrame view={report} />
        </Providers>,
      );
      const post = spyOnFrame();
      send({ pharos: 1, kind: 'ready' });
      send({ pharos: 1, kind: 'data', id: 1, name: 'done' });
      await waitFor(() =>
        expect(post).toHaveBeenLastCalledWith(
          expect.objectContaining({ id: 1, rows: done.slice(1) }),
          '*',
        ),
      );
    } finally {
      agentSees = withReport;
    }
  });

  it('ignores messages from other sources, unknown kinds and malformed ones', () => {
    render(
      <Providers>
        <ReportFrame view={report} />
      </Providers>,
    );
    const post = spyOnFrame();
    send({ pharos: 1, kind: 'ready' }, window);
    send({ pharos: 1, kind: 'data', id: 1, name: 'done' }, null);
    send({ pharos: 1, kind: 'fetch', url: '/api/projects' });
    send({ pharos: 2, kind: 'ready' });
    send({ pharos: 1, kind: 'data', name: 'done' });
    sendRaw('ready');
    // Unsigned or badly signed: not the bridge.
    sendRaw({ pharos: 1, kind: 'ready' });
    send({ pharos: 1, kind: 'ready', token: 'not-hex!' });
    expect(post).not.toHaveBeenCalled();
  });

  it('answers only the document that said ready, by its token (R13.6)', async () => {
    render(
      <Providers>
        <ReportFrame view={report} />
      </Providers>,
    );
    const post = spyOnFrame();
    send({ pharos: 1, kind: 'data', id: 0, name: 'done' }); // before ready: nothing
    send({ pharos: 1, kind: 'ready' });
    post.mockClear();
    send({ pharos: 1, kind: 'data', id: 1, name: 'done', token: 'f'.repeat(32) });
    sendRaw({ pharos: 1, kind: 'data', id: 2, name: 'done' });
    send({ pharos: 1, kind: 'data', id: 3, name: 'done' });
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(expect.objectContaining({ kind: 'data', id: 3 }), '*'),
    );
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("sends 'changed' when the project data reloads and 'theme' when the theme changes", async () => {
    const { rerender } = render(
      <Providers version={1}>
        <ReportFrame view={report} />
      </Providers>,
    );
    const post = spyOnFrame();
    send({ pharos: 1, kind: 'ready' });
    post.mockClear();
    rerender(
      <Providers version={2}>
        <ReportFrame view={report} />
      </Providers>,
    );
    expect(post).toHaveBeenCalledWith({ pharos: 1, kind: 'changed' }, '*');

    post.mockClear();
    act(() => document.documentElement.classList.add('dark'));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith({ pharos: 1, kind: 'theme', theme: 'dark' }, '*'),
    );
  });

  it("posts nothing before the page's bridge is ready", () => {
    const { rerender } = render(
      <Providers version={1}>
        <ReportFrame view={report} />
      </Providers>,
    );
    const post = spyOnFrame();
    rerender(
      <Providers version={2}>
        <ReportFrame view={report} />
      </Providers>,
    );
    expect(post).not.toHaveBeenCalled();
  });

  it("opens the file viewer only for this project's files", () => {
    const open = vi.fn();
    render(
      <Providers viewer={{ open }}>
        <ReportFrame view={report} />
      </Providers>,
    );
    const file = data.files[0]!;
    // Nothing before the bridge said ready.
    send({ pharos: 1, kind: 'openFile', fileId: file.id });
    expect(open).not.toHaveBeenCalled();
    send({ pharos: 1, kind: 'ready' });
    send({ pharos: 1, kind: 'openFile', fileId: 'file_elsewhere' });
    expect(open).not.toHaveBeenCalled();
    send({ pharos: 1, kind: 'openFile', fileId: file.id });
    expect(open).toHaveBeenCalledWith(file.id);
  });

  it('reloads once after a burst of uploads to its files, not once per file (R13.5)', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      render(
        <Providers>
          <ReportFrame view={report} />
        </Providers>,
      );
      const first = frameOf().getAttribute('src');
      const upload = (viewId = report.id) =>
        act(() =>
          announceReportAssets({ type: 'report-assets', viewId, at: '2026-10-17T10:00:00Z' }),
        );
      for (let i = 0; i < 37; i++) {
        upload();
        act(() => vi.advanceTimersByTime(ASSET_RELOAD_DELAY_MS / 2));
      }
      upload('view_other'); // another view's files change nothing here
      expect(frameOf().getAttribute('src')).toBe(first);
      act(() => vi.advanceTimersByTime(ASSET_RELOAD_DELAY_MS));
      const second = frameOf().getAttribute('src');
      expect(second).toBe(
        `/api/views/view_report/page/?v=${encodeURIComponent(`${report.updatedAt}-1`)}`,
      );
      expect(reportUrl(report, 1)).toBe(second);
      act(() => vi.advanceTimersByTime(ASSET_RELOAD_DELAY_MS * 4));
      expect(frameOf().getAttribute('src')).toBe(second);
      upload();
      act(() => vi.advanceTimersByTime(ASSET_RELOAD_DELAY_MS));
      expect(frameOf().getAttribute('src')).toContain(encodeURIComponent(`${report.updatedAt}-2`));
      // Another view's burst: nothing here.
      upload('view_other');
      act(() => vi.advanceTimersByTime(ASSET_RELOAD_DELAY_MS));
      expect(frameOf().getAttribute('src')).toContain(encodeURIComponent(`${report.updatedAt}-2`));
    } finally {
      vi.useRealTimers();
    }
  });

  it('says so plainly when the page route is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 404 })),
    );
    render(
      <Providers>
        <ReportFrame view={report} />
      </Providers>,
    );
    fireEvent.load(frameOf());
    expect((await screen.findByRole('alert')).textContent).toContain('This page isn’t there');
  });

  it('says it failed when the server errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 500 })),
    );
    render(
      <Providers>
        <ReportFrame view={report} />
      </Providers>,
    );
    fireEvent.load(frameOf());
    expect((await screen.findByRole('alert')).textContent).toContain('couldn’t be loaded');
  });
});

describe('a page that leaves its frame is stopped (R13.6)', () => {
  function shownFrame() {
    render(
      <Providers>
        <ReportFrame view={report} />
      </Providers>,
    );
    const post = spyOnFrame();
    send({ pharos: 1, kind: 'ready' });
    return post;
  }
  const stopped = () => document.querySelector('[data-report-error="stopped"]');

  it('stops on a second load of the same address, and reloads fresh on request', async () => {
    const post = shownFrame();
    const first = frameOf();
    const src = first.getAttribute('src')!;
    fireEvent.load(first);
    expect(stopped()).toBeNull();
    post.mockClear();
    fireEvent.load(first); // the page navigated its own frame
    expect(first.getAttribute('src')).toBe('about:blank');
    expect(stopped()?.textContent).toContain('This page tried to leave Pharos, so it was stopped.');
    expect(document.querySelector('iframe')).toBeNull();
    // Nothing more is answered or posted.
    send({ pharos: 1, kind: 'data', id: 1, name: 'done' }, first.contentWindow);
    await new Promise((r) => setTimeout(r, 20));
    expect(post).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Reload page/ }));
    expect(stopped()).toBeNull();
    expect(frameOf().getAttribute('src')).not.toBe(src);
    expect(frameOf().getAttribute('src')).toBe(reportUrl(report, 1));
  });

  it('stops on a second ready (another document) and on leaving', () => {
    shownFrame();
    send({ pharos: 1, kind: 'ready', token: 'e'.repeat(32) });
    expect(stopped()).toBeTruthy();
    cleanup();

    shownFrame();
    send({ pharos: 1, kind: 'leaving', token: 'e'.repeat(32) }); // not its token
    expect(stopped()).toBeNull();
    send({ pharos: 1, kind: 'leaving' });
    expect(stopped()).toBeTruthy();
  });

  it('never posts an answer that was in flight when the frame was stopped', async () => {
    const post = shownFrame();
    post.mockClear();
    const win = frameOf().contentWindow;
    send({ pharos: 1, kind: 'data', id: 1, name: 'done' });
    send({ pharos: 1, kind: 'leaving' }, win);
    await new Promise((r) => setTimeout(r, 20));
    expect(post).not.toHaveBeenCalled();
  });
});

describe('links from a report page (R13.6)', () => {
  let opened: ReturnType<typeof vi.fn>;
  function setActive(isActive: boolean) {
    Object.defineProperty(navigator, 'userActivation', {
      value: { isActive },
      configurable: true,
    });
  }
  beforeEach(() => {
    opened = vi.fn();
    vi.stubGlobal('open', opened);
    setActive(true);
    render(
      <Providers>
        <ReportFrame view={report} />
      </Providers>,
    );
    send({ pharos: 1, kind: 'ready' });
  });
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'userActivation');
  });
  const link = (url: string) => send({ pharos: 1, kind: 'link', url });
  const strip = () => document.querySelector('[data-report-link]');

  it('opens a plain link at once after a click, in a new tab without opener or referrer', () => {
    link('https://en.wikipedia.org/wiki/Lighthouse');
    expect(opened).toHaveBeenCalledWith(
      'https://en.wikipedia.org/wiki/Lighthouse',
      '_blank',
      'noopener,noreferrer',
    );
    expect(strip()).toBeNull();
  });

  it('asks first, showing the whole address, for a link with a query, a fragment or a long path', () => {
    const long = `https://example.org/${'a'.repeat(130)}`;
    for (const url of [
      'http://127.0.0.1:4399/evil.html?d=%5B%22secret%22%5D',
      'https://example.org/page#rows',
      long,
      'https://user:pw@example.org/',
    ]) {
      link(url);
      expect(opened).not.toHaveBeenCalled();
      expect(strip()?.textContent).toContain(`This page wants to open: ${new URL(url).href}`);
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(strip()).toBeNull();
    }
    expect(opened).not.toHaveBeenCalled();
  });

  it('asks first when the reader did not just click (a script asked)', () => {
    setActive(false);
    link('https://example.org/plain');
    expect(opened).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(opened).toHaveBeenCalledWith(
      'https://example.org/plain',
      '_blank',
      'noopener,noreferrer',
    );
    expect(strip()).toBeNull();
  });

  it('keeps one question at a time: a later link does not replace the one shown', () => {
    link('https://example.org/?first');
    link('https://example.org/?second');
    expect(strip()?.textContent).toContain('?first');
    expect(strip()?.textContent).not.toContain('?second');
  });

  it('opens at most 3 links at once in 10 s; the next one asks', () => {
    for (let i = 0; i < 4; i++) link(`https://example.org/p${i}`);
    expect(opened).toHaveBeenCalledTimes(3);
    expect(strip()?.textContent).toContain('https://example.org/p3');
  });

  it('ignores other schemes, very long addresses and unsigned requests', () => {
    setActive(true);
    for (const url of [
      'mailto:me@example.org',
      'javascript:alert(1)',
      'data:text/html,<p>x',
      'file:///etc/passwd',
      `https://example.org/${'a'.repeat(2000)}`,
      'not a url',
    ])
      link(url);
    sendRaw({ pharos: 1, kind: 'link', url: 'https://example.org/unsigned' });
    expect(opened).not.toHaveBeenCalled();
    expect(strip()).toBeNull();
  });
});

describe('link decisions (R13.6)', () => {
  it('says which links are plain', () => {
    expect(linkDecision('https://example.org/a/b')).toEqual({
      url: 'https://example.org/a/b',
      plain: true,
    });
    expect(linkDecision('https://example.org/a?')?.plain).toBe(false);
    expect(linkDecision('https://example.org/a#')?.plain).toBe(false);
    expect(linkDecision(`https://example.org/${'a'.repeat(119)}`)?.plain).toBe(true);
    expect(linkDecision(`https://example.org/${'a'.repeat(120)}`)?.plain).toBe(false);
    expect(linkDecision('ftp://example.org/')).toBeNull();
    expect(linkDecision(`https://example.org/${'a'.repeat(1990)}`)).toBeNull();
  });
});

describe('report bar (R13)', () => {
  const agent = { kind: 'agent' as const, name: 'claude-code' };
  const stale: ViewFreshness = {
    viewId: report.id,
    seen: 5,
    changed: null,
    evidence: {
      revision: 9,
      at: '2026-10-16T09:00:00.000Z',
      stale: {
        since: 9,
        total: 1,
        recent: [
          {
            revision: 12,
            at: new Date().toISOString(),
            author: { kind: 'human', name: 'me' },
            message: 'Done',
            items: [{ type: 'task', id: 't', label: 'Write the brief', op: 'update' }],
            page: false,
          },
        ],
      },
    },
  };

  it('shows the summary, who updated it, the out-of-date mark and asks to refresh', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json([{ id: 9, author: agent, message: 'Write the report', at: '' }]),
      ),
    );
    const apply = vi.fn<ViewActions['apply']>(async () => ({
      ok: true,
      revision: 20,
      created: {},
    }));
    render(
      <Providers actions={{ apply, open: vi.fn() }}>
        <ReportBar view={report} freshness={stale} />
      </Providers>,
    );
    expect(screen.getByText('Most of the plan is done; two tasks are left.')).toBeTruthy();
    await screen.findByText(/Updated .* by Claude Code/);
    expect(screen.getByText('Out of date')).toBeTruthy();
    expect(document.querySelector('[data-report-bar]')?.textContent).toContain(
      'Since it was written, you changed “Write the brief”',
    );
    const link = screen.getByRole('link', { name: /Open in new tab/ });
    expect(link.getAttribute('href')).toBe(reportUrl(report));
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noopener');

    fireEvent.click(screen.getByRole('button', { name: /Ask to refresh/ }));
    await waitFor(() => expect(apply).toHaveBeenCalled());
    expect(apply.mock.calls[0]![1][0]).toMatchObject({
      op: 'create',
      type: 'request',
      data: { viewId: report.id, mode: 'refresh' },
    });
  });

  it('is calm when the page is up to date', () => {
    render(
      <Providers>
        <ReportBar
          view={report}
          freshness={{ ...stale, evidence: { revision: 9, at: null, stale: null } }}
        />
      </Providers>,
    );
    expect(screen.queryByText('Out of date')).toBeNull();
    expect(screen.queryByRole('button', { name: /Ask to refresh/ })).toBeNull();
  });
});

describe('project page with a report (R13)', () => {
  function route(path: string) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.includes('/data')
          ? Response.json(withReport)
          : url.includes('/freshness?')
            ? Response.json({
                projectId: data.project.id,
                latest: 30,
                views: {
                  [report.id]: { viewId: report.id, seen: 30, changed: null, evidence: null },
                  [board!.id]: { viewId: board!.id, seen: 30, changed: null, evidence: null },
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

  it('shows the frame and bar instead of the board, with a report mark on its tab', async () => {
    route(`/projects/${data.project.id}/views/${report.id}`);
    await screen.findByRole('link', { name: /Where the plan stands/ });
    expect(frameOf().getAttribute('sandbox')).toBe(REPORT_SANDBOX);
    expect(document.querySelector('[data-report-bar]')).toBeTruthy();
    expect(document.querySelector('[data-widget]')).toBeNull();
    // No board to customize, nothing to ask about block by block.
    expect(screen.queryByRole('button', { name: 'Customize' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Ask about/ })).toBeNull();
    const tab = screen.getByRole('link', { name: /Where the plan stands/ });
    expect(tab.querySelector('[aria-label="Report"]')).toBeTruthy();
    const boardTab = screen.getByRole('link', { name: new RegExp(board!.data.name) });
    expect(boardTab.querySelector('[aria-label="Report"]')).toBeNull();
  });

  it('marks a report seen when it opens, like any view', async () => {
    route(`/projects/${data.project.id}/views/${report.id}`);
    await screen.findByRole('link', { name: /Where the plan stands/ });
    const fetch = vi.mocked(globalThis.fetch);
    await waitFor(() =>
      expect(
        fetch.mock.calls.some(
          ([url, init]) =>
            String(url) === `/api/views/${report.id}/seen` &&
            (init as RequestInit | undefined)?.method === 'PUT',
        ),
      ).toBe(true),
    );
  });

  it('board views still render the board', async () => {
    route(`/projects/${data.project.id}/views/${board!.id}`);
    await screen.findByRole('link', { name: new RegExp(board!.data.name) });
    await waitFor(() => expect(document.querySelector('[data-widget]')).toBeTruthy());
    expect(document.querySelector('iframe')).toBeNull();
    expect(document.querySelector('[data-report-bar]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Customize' })).toBeTruthy();
  });
});
