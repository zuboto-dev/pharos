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
import { REPORT_SANDBOX, ReportBar, ReportFrame, reportUrl } from './report';

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

/** A message from `source` (the frame's window by default), as the browser would deliver it. */
function send(message: unknown, source: Window | null = frameOf().contentWindow) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: message, source }));
  });
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
    expect(tokens).toEqual(
      ['allow-modals', 'allow-popups', 'allow-popups-to-escape-sandbox', 'allow-scripts'].sort(),
    );
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
    send('ready');
    expect(post).not.toHaveBeenCalled();
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
    send({ pharos: 1, kind: 'openFile', fileId: 'file_elsewhere' });
    expect(open).not.toHaveBeenCalled();
    send({ pharos: 1, kind: 'openFile', fileId: file.id });
    expect(open).toHaveBeenCalledWith(file.id);
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
