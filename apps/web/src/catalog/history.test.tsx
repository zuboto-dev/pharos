import type { ProjectDataset, RevisionSummary } from '@pharos/schema';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import dataset from './__fixtures__/dataset.json';
import { ViewDataProvider, type ViewActions } from './context';
import { DetailDrawer } from './drawer';

const data = dataset as unknown as ProjectDataset;
afterEach(cleanup);

const rev = (id: number, extra: Partial<RevisionSummary> = {}): RevisionSummary => ({
  id,
  author: { kind: id % 2 ? 'agent' : 'human', name: id % 2 ? 'Claude Code' : 'me' },
  message: `Change ${id}`,
  createdAt: new Date(Date.now() - (60 - id) * 3_600_000).toISOString(),
  revertOf: null,
  revertedBy: null,
  changes: [],
  ...extra,
});

/** Serves /api/history pages of 50 from revisions 1..total, newest first. */
function serveHistory(total: number) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(url);
    const q = new URL(url, 'http://x').searchParams;
    const before = Number(q.get('before') ?? total + 1);
    const kind = q.get('authorKind');
    const all = Array.from({ length: total }, (_, i) => rev(total - i));
    const page = all
      .filter((r) => r.id < before && (!kind || r.author.kind === kind))
      .slice(0, Number(q.get('limit') ?? 20));
    return Response.json(page);
  });
  return calls;
}

function renderDrawer(
  target: Parameters<typeof DetailDrawer>[0]['target'],
  actions: Partial<ViewActions> = {},
) {
  const all: ViewActions = {
    apply: vi.fn(async () => ({ ok: true as const, revision: 1, created: {} })),
    open: vi.fn(),
    ...actions,
  };
  render(
    <ViewDataProvider data={data} version={1} actions={all}>
      <DetailDrawer target={target} onClose={() => {}} />
    </ViewDataProvider>,
  );
  return all;
}

describe('project history', () => {
  it('lists every change by day, newest first, and loads older ones', async () => {
    const calls = serveHistory(60);
    renderDrawer({ history: true });
    const dialog = screen.getByRole('dialog', { name: 'History' });
    await waitFor(() => expect(within(dialog).getByText('Change 60')).toBeTruthy());
    expect(within(dialog).queryByText('Change 10')).toBeNull();
    expect(within(dialog).getByRole('region', { name: 'Today' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Show older changes' }));
    await waitFor(() => expect(within(dialog).getByText('Change 1')).toBeTruthy());
    expect(calls.at(-1)).toContain('before=11');
    expect(within(dialog).queryByRole('button', { name: 'Show older changes' })).toBeNull();
  });

  it('filters by who made the change', async () => {
    const calls = serveHistory(6);
    renderDrawer({ history: true });
    fireEvent.click(await screen.findByRole('radio', { name: 'People' }));
    await waitFor(() => expect(screen.queryByText('Change 5')).toBeNull());
    expect(screen.getByText('Change 6')).toBeTruthy();
    expect(calls.at(-1)).toContain('authorKind=human');
  });

  it('opens a revision from the list', async () => {
    serveHistory(3);
    const actions = renderDrawer({ history: true });
    fireEvent.click(await screen.findByText('Change 2'));
    expect(actions.open).toHaveBeenCalledWith({ revision: 2 });
  });
});

describe('reverting', () => {
  function serveRevision(r: RevisionSummary) {
    vi.stubGlobal('fetch', async () => Response.json(r));
  }

  it('reverts any revision, and shows why when it cannot', async () => {
    serveRevision(rev(4));
    const revert = vi
      .fn<NonNullable<ViewActions['revert']>>()
      .mockResolvedValueOnce({ ok: false, error: 'status was changed later' })
      .mockResolvedValueOnce({ ok: true, revision: 9 });
    renderDrawer({ revision: 4 }, { revert });
    fireEvent.click(await screen.findByRole('button', { name: /Revert this change/ }));
    expect(revert).toHaveBeenCalledWith(4, 'Revert “Change 4”');
    expect((await screen.findByRole('alert')).textContent).toBe('status was changed later');
    fireEvent.click(screen.getByRole('button', { name: /Revert this change/ }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('says which revision reverted it, and links back to all changes', async () => {
    serveRevision(rev(4, { revertedBy: 7 }));
    const actions = renderDrawer({ revision: 4 }, { revert: vi.fn() });
    fireEvent.click(await screen.findByRole('button', { name: '#7' }));
    expect(actions.open).toHaveBeenCalledWith({ revision: 7 });
    expect(screen.queryByRole('button', { name: /Revert this change/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'All changes' }));
    expect(actions.open).toHaveBeenCalledWith({ history: true });
  });

  it('shows changed values by name, not by id or stored value', async () => {
    serveRevision(
      rev(4, {
        changes: [
          {
            op: 'update',
            type: 'task',
            id: 'task_a9f652e80406',
            label: 'View spec format + queries',
            fields: {
              status: { before: 'todo', after: 'in_progress' },
              assigneeId: { before: null, after: 'asg_dc7d702b0bcf' },
            },
          },
        ],
      }),
    );
    renderDrawer({ revision: 4 });
    const table = (await screen.findByRole('table')).textContent;
    expect(table).toContain('Status');
    expect(table).toContain('Todo → In progress');
    expect(table).toContain('Assignee— → Alex');
  });
});

describe('when an item was raised', () => {
  it('shows when, by whom and why on top of its details', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url);
      if (url.startsWith('/api/revisions/1'))
        return Response.json(rev(1, { message: 'Plan the view work' }));
      return Response.json([]);
    });
    renderDrawer({ entity: 'task_a9f652e80406' });
    const raised = await screen.findByTestId('raised');
    expect(raised.textContent).toMatch(/^Raised (Oct 5, 2026|Oct 5), /);
    await waitFor(() => expect(raised.textContent).toMatch(/by\s+Claude Code/));
    expect(raised.textContent).toContain('“Plan the view work”');
    expect(urls).toContain('/api/revisions/1');
  });

  it('leaves out a reason that only repeats the title', async () => {
    vi.stubGlobal('fetch', async (url: string) =>
      url.startsWith('/api/revisions/1')
        ? Response.json(rev(1, { message: 'Ask the owner: View spec format + queries' }))
        : Response.json([]),
    );
    renderDrawer({ entity: 'task_a9f652e80406' });
    const raised = await screen.findByTestId('raised');
    await waitFor(() => expect(raised.textContent).toMatch(/by\s+Claude Code/));
    expect(raised.textContent).not.toContain('Ask the owner');
  });
});

describe('a decision asked on a review page', () => {
  it('links its details to the sheet that asks it', async () => {
    vi.stubGlobal('fetch', async () => Response.json([]));
    const decision = data.decisions[0]!;
    const view = {
      ...data.views[0]!,
      id: 'view_review',
      data: {
        ...data.views[0]!.data,
        name: 'Review · Batch',
        spec: undefined,
        template: undefined,
        doc: {
          blocks: [
            {
              kind: 'sheet',
              id: 'pick',
              title: 'Pick the layout',
              decisions: [decision.id],
              blocks: [{ kind: 'block', id: 'b', node: { component: 'Text', content: 'Why' } }],
            },
          ],
        },
      },
    } as unknown as ProjectDataset['views'][number];
    render(
      <ViewDataProvider
        data={{ ...data, views: [...data.views, view] }}
        version={1}
        actions={{ apply: vi.fn(), open: vi.fn() }}
      >
        <DetailDrawer target={{ entity: decision.id }} onClose={() => {}} />
      </ViewDataProvider>,
    );
    const link = await screen.findByRole('link', { name: 'Review · Batch › Pick the layout' });
    expect(link.getAttribute('href')).toBe(
      `/projects/${data.project.id}/views/view_review#sheet-pick`,
    );
  });
});
