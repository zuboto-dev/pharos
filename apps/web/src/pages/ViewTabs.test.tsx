import type { Entity, ProjectDataset } from '@pharos/schema';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import dataset from '../catalog/__fixtures__/dataset.json';
import { ViewDataProvider, type ViewActions } from '../catalog/context';
import { ViewTabs, ViewUpdated, sortViews, tabTitle } from './ViewTabs';

const data = dataset as unknown as ProjectDataset;
const [overview, delivery] = [...data.views].sort(
  (a, b) => Number(b.data.pinned) - Number(a.data.pinned),
) as Entity<'view'>[];
const archived: Entity<'view'> = {
  ...delivery!,
  id: 'view_old',
  data: { ...delivery!.data, name: 'Old plan', archived: true },
};

let apply: ReturnType<typeof vi.fn<ViewActions['apply']>>;
beforeEach(() => {
  apply = vi.fn<ViewActions['apply']>(async () => ({
    ok: true,
    revision: 1,
    created: { view: 'view_new' },
  }));
});
afterEach(cleanup);

function Where() {
  return <p data-testid="path">{useLocation().pathname}</p>;
}

function renderTabs(active = overview!, onCreated = vi.fn()) {
  render(
    <MemoryRouter initialEntries={[`/projects/p/views/${active.id}`]}>
      <ViewDataProvider data={data} version={1} actions={{ apply, open: vi.fn() }}>
        <ViewTabs
          projectId="p"
          views={[overview!, delivery!, archived]}
          active={active}
          onCreated={onCreated}
        />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </ViewDataProvider>
    </MemoryRouter>,
  );
  return onCreated;
}

describe('view tabs', () => {
  it('tells when each view was last updated, so similar names can be told apart', () => {
    renderTabs();
    expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('title')).toMatch(
      /Updated .*ago/,
    );
    const now = Date.parse(overview!.updatedAt) + 3 * 3_600_000;
    expect(
      tabTitle({ ...overview!, data: { ...overview!.data, description: 'The plan' } }, now),
    ).toBe('The plan\nUpdated 3 hours ago');
  });

  it('shows visible views, hides archived ones behind a menu, and restores them', () => {
    renderTabs();
    expect(screen.getByRole('link', { name: 'Overview' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Old plan' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Archived \(1\)/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Restore “Old plan”/ }));
    expect(apply).toHaveBeenLastCalledWith(
      'Restore view “Old plan”',
      [{ op: 'update', type: 'view', id: 'view_old', data: { archived: null } }],
      { undoable: true },
    );
    expect(screen.getByTestId('path').textContent).toBe('/projects/p/views/view_old');
  });

  it('renames, pins, and archives the active view', () => {
    renderTabs(delivery);
    fireEvent.click(screen.getByRole('button', { name: 'Options for Delivery' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Rename/ }));
    const input = screen.getByLabelText('View name');
    fireEvent.change(input, { target: { value: 'Shipping' } });
    fireEvent.submit(input.closest('form')!);
    expect(apply).toHaveBeenLastCalledWith(
      'Rename view “Delivery” to “Shipping”',
      [expect.objectContaining({ data: { name: 'Shipping' } })],
      { undoable: true },
    );

    fireEvent.click(screen.getByRole('button', { name: 'Options for Delivery' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Pin/ }));
    expect(apply.mock.calls.at(-1)![1][0]).toMatchObject({ data: { pinned: true } });

    fireEvent.click(screen.getByRole('button', { name: 'Options for Delivery' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Archive/ }));
    expect(apply.mock.calls.at(-1)![1][0]).toMatchObject({ data: { archived: true } });
    expect(screen.getByTestId('path').textContent).toBe('/projects/p');
  });

  it('needs a second click to delete', () => {
    renderTabs(delivery);
    fireEvent.click(screen.getByRole('button', { name: 'Options for Delivery' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete/ }));
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('menuitem', { name: /Click again to delete/ }));
    expect(apply).toHaveBeenLastCalledWith(
      'Delete view “Delivery”',
      [{ op: 'delete', type: 'view', id: delivery!.id }],
      { undoable: true },
    );
  });

  it('adds a blank view, opens it, and starts customizing', async () => {
    const onCreated = renderTabs();
    fireEvent.click(screen.getByRole('button', { name: 'New view' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(apply.mock.calls[0]![1][0]).toMatchObject({
      op: 'create',
      type: 'view',
      data: { name: 'New view', spec: { component: 'Board', widgets: [] } },
    });
    expect(screen.getByTestId('path').textContent).toBe('/projects/p/views/view_new');
  });
});

describe('answer views in tabs', () => {
  const answer = (
    id: string,
    question: string,
    expiresAt: string,
    createdRev: number,
  ): Entity<'view'> => ({
    ...delivery!,
    id,
    createdRev,
    data: { ...delivery!.data, name: question, kind: 'answer', question, expiresAt, pinned: false },
  });
  const fresh = answer('view_a1', "What's overdue?", '2099-01-01T00:00:00.000Z', 50);
  const newer = answer('view_a2', 'Who is on what?', '2099-01-01T00:00:00.000Z', 60);
  const expired = answer('view_a0', 'Old question', '2020-01-01T00:00:00.000Z', 40);

  it('lists answers after saved views, newest first, and hides expired ones', () => {
    expect(sortViews([fresh, overview!, newer, delivery!]).map((v) => v.id)).toEqual([
      overview!.id,
      delivery!.id,
      'view_a2',
      'view_a1',
    ]);
    render(
      <MemoryRouter>
        <ViewDataProvider data={data} version={1} actions={{ apply, open: vi.fn() }}>
          <ViewTabs
            projectId="p"
            views={[overview!, fresh, expired]}
            active={overview}
            onCreated={vi.fn()}
          />
        </ViewDataProvider>
      </MemoryRouter>,
    );
    const tab = screen.getByRole('link', { name: /What's overdue\?/ });
    expect(tab.querySelector('[aria-label="Answer"]')).toBeTruthy();
    expect(tab.getAttribute('title')).toMatch(/^What's overdue\?\nUpdated /);
    expect(screen.queryByRole('link', { name: /Old question/ })).toBeNull();
  });
});

describe('answer menu', () => {
  const answer: Entity<'view'> = {
    ...delivery!,
    id: 'view_ans',
    data: {
      ...delivery!.data,
      name: "What's overdue?",
      kind: 'answer',
      question: "What's overdue?",
      expiresAt: '2099-01-01T00:00:00.000Z',
      pinned: false,
      description: undefined,
    },
  };
  const expired: Entity<'view'> = {
    ...answer,
    id: 'view_old',
    data: { ...answer.data, name: 'Old', question: 'Old', expiresAt: '2020-01-01T00:00:00.000Z' },
  };

  function renderAnswer() {
    render(
      <MemoryRouter initialEntries={['/projects/p/views/view_ans']}>
        <ViewDataProvider data={data} version={1} actions={{ apply, open: vi.fn() }}>
          <ViewTabs
            projectId="p"
            views={[overview!, answer, expired]}
            active={answer}
            onCreated={vi.fn()}
          />
          <Routes>
            <Route path="*" element={<Where />} />
          </Routes>
        </ViewDataProvider>
      </MemoryRouter>,
    );
  }

  it('keeps an answer as a regular view, carrying the question over as its description', () => {
    renderAnswer();
    fireEvent.click(screen.getByRole('button', { name: "Options for What's overdue?" }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Keep as a view/ }));
    expect(apply).toHaveBeenLastCalledWith(
      "Keep answer “What's overdue?” as a view",
      [
        {
          op: 'update',
          type: 'view',
          id: 'view_ans',
          data: { kind: null, expiresAt: null, archived: null, description: "What's overdue?" },
        },
      ],
      { undoable: true },
    );
  });

  it('dismisses an answer, and offers expired answers in the Archived menu', () => {
    renderAnswer();
    fireEvent.click(screen.getByRole('button', { name: "Options for What's overdue?" }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Dismiss/ }));
    expect(apply.mock.calls.at(-1)![1]).toEqual([
      { op: 'update', type: 'view', id: 'view_ans', data: { archived: true } },
    ]);
    expect(screen.getByTestId('path').textContent).toBe('/projects/p');
    fireEvent.click(screen.getByRole('button', { name: /Archived \(1\)/ }));
    expect(screen.getByRole('menuitem', { name: /Keep “Old” \(expired\)/ })).toBeTruthy();
  });
});

describe('ViewUpdated', () => {
  it('shows who last changed the view and opens its history', async () => {
    vi.stubGlobal('fetch', async (url: string) => {
      expect(url).toContain(`/api/history?entityId=${overview!.id}&limit=1`);
      return Response.json([
        {
          id: 42,
          author: { kind: 'agent', name: 'Codex' },
          message: 'Show the delivery handoff',
          createdAt: overview!.updatedAt,
          revertOf: null,
          revertedBy: null,
          changes: [],
        },
      ]);
    });
    const open = vi.fn();
    render(
      <MemoryRouter>
        <ViewDataProvider data={data} version={1} actions={{ apply, open }}>
          <ViewUpdated view={overview!} />
        </ViewDataProvider>
      </MemoryRouter>,
    );
    const line = await screen.findByRole('button', { name: /Updated .* by Codex/ });
    expect(line.textContent).toContain('Show the delivery handoff');
    expect(line.getAttribute('title')).toBe('#42 · Show the delivery handoff');
    fireEvent.click(line);
    expect(open).toHaveBeenCalledWith({ entity: overview!.id });
    vi.unstubAllGlobals();
  });
});
