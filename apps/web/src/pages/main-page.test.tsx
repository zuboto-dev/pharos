import type { Entity, ProjectDataset, ReportDoc } from '@pharos/schema';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import dataset from '../catalog/__fixtures__/dataset.json';
import { ViewDataProvider, type ViewActions } from '../catalog/context';
import { ViewTabs, makeMainPage, sortViews } from './ViewTabs';
import { ViewVersions } from './versions';

const data = dataset as unknown as ProjectDataset;
const base = data.views[0]! as Entity<'view'>;
const view = (
  id: string,
  name: string,
  extra: Partial<Entity<'view'>['data']>,
): Entity<'view'> => ({
  ...base,
  id,
  data: { projectId: base.data.projectId, name, pinned: false, order: 1, ...extra },
});
const doc = (content: string) =>
  ({
    blocks: [{ kind: 'block', id: 'lead', node: { component: 'Text', content } }],
  }) as ReportDoc;
const main = view('view_main', 'About the garden', {
  kind: 'main',
  pinned: true,
  order: -1,
  doc: doc('Grow food'),
});
const notes = view('view_notes', 'Notes', { doc: doc('Notes') });
const board = view('view_board', 'Task board', {
  spec: { component: 'Board', widgets: [{ id: 'k', node: { component: 'KanbanBoard' } }] },
} as Partial<Entity<'view'>['data']>);
const pinnedBoard = view('view_pinned', 'Roadmap', {
  pinned: true,
  order: 0,
  spec: { component: 'Board', widgets: [] },
});

let apply: ReturnType<typeof vi.fn<ViewActions['apply']>>;
beforeEach(() => {
  // The tabs read open asks and seen marks; nothing waits here.
  vi.stubGlobal('fetch', async () => Response.json({}));
  apply = vi.fn<ViewActions['apply']>(async () => ({ ok: true, revision: 1, created: {} }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function wrap(children: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={['/projects/p/views/view_main']}>
      <ViewDataProvider data={data} version={1} actions={{ apply, open: vi.fn() }}>
        {children}
      </ViewDataProvider>
    </MemoryRouter>,
  );
}

describe('the main page in the tabs', () => {
  it('comes first, even before pinned views', () => {
    expect(sortViews([notes, pinnedBoard, main]).map((v) => v.id)).toEqual([
      'view_main',
      'view_pinned',
      'view_notes',
    ]);
  });

  it('tucks unpinned boards under More as project management, and keeps pinned ones', () => {
    wrap(
      <ViewTabs
        projectId="p"
        views={[main, notes, board, pinnedBoard]}
        active={main}
        onCreated={vi.fn()}
      />,
    );
    expect(screen.getByRole('link', { name: /About the garden/ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Roadmap/ })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /Task board/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /More views \(1\)/ }));
    expect(screen.getByText('Project management')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Task board/ })).toBeTruthy();
  });

  it('offers no archive, delete or unpin on the main page', () => {
    wrap(<ViewTabs projectId="p" views={[main, notes]} active={main} onCreated={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Options for About the garden/ }));
    expect(screen.queryByRole('menuitem', { name: /Archive|Delete|Unpin/ })).toBeNull();
  });

  it('makes another document the main page in one change, keeping the old one', () => {
    const { message, operations } = makeMainPage(notes, [main, notes]);
    expect(message).toBe('Make “Notes” the main page (was “About the garden”)');
    expect(operations).toEqual([
      { op: 'update', type: 'view', id: 'view_main', data: { kind: null } },
      {
        op: 'update',
        type: 'view',
        id: 'view_notes',
        data: { kind: 'main', pinned: true, archived: null, order: -1 },
      },
    ]);
  });
});

describe('version history', () => {
  it('lists versions and marks what the picked one changed, with restore', async () => {
    const versions = [
      {
        revision: 3,
        at: '2026-10-26T18:00:00.000Z',
        author: { kind: 'agent', name: 'Claude Code' },
        message: 'Teach the kids too',
        op: 'update',
      },
      {
        revision: 1,
        at: '2026-10-25T18:00:00.000Z',
        author: { kind: 'agent', name: 'Claude Code' },
        message: 'The main page',
        op: 'create',
      },
    ];
    const posts: { url: string; author: string | null }[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push({ url, author: new Headers(init.headers).get('x-pharos-author') });
        return Response.json({ revision: { id: 4 } });
      }
      if (url.startsWith('/api/views/view_main/versions?')) return Response.json(versions);
      if (url === '/api/views/view_main/versions/1')
        return Response.json({
          version: versions[1],
          before: null,
          after: { ...main.data, doc: doc('Grow food for the family.') },
        });
      return Response.json({}, { status: 404 });
    });
    wrap(<ViewVersions view={main} selected="1" />);
    await screen.findByText('Teach the kids too');
    await screen.findByText(/First version/);
    expect(document.querySelector('[data-change="added"]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Restore this version/ }));
    await waitFor(() =>
      expect(posts).toEqual([
        { url: '/api/views/view_main/versions/1/restore', author: 'human:me' },
      ]),
    );
  });
});
