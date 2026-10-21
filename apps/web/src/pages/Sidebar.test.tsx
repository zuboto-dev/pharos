import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HomePage } from './HomePage';
import { Sidebar } from './Sidebar';

const entity = (type: string, id: string, data: Record<string, unknown>) => ({
  id,
  type,
  data,
  createdAt: '',
  updatedAt: '',
  createdRev: 1,
  updatedRev: 1,
});
const data = {
  section: [entity('section', 'sec_work', { name: 'Work', order: 0 })],
  repository: [
    entity('repository', 'repo_a', { name: 'app', order: 0 }),
    entity('repository', 'repo_b', { name: 'site', order: 1 }),
  ],
  project: [
    entity('project', 'p1', { name: 'Alpha', status: 'active', order: 0, repositoryId: 'repo_a' }),
    entity('project', 'p2', { name: 'Beta', status: 'active', order: 1, repositoryId: 'repo_a' }),
    entity('project', 'p3', { name: 'Loose', status: 'planning', order: 0 }),
    entity('project', 'p4', {
      name: 'Old site',
      status: 'archived',
      order: 2,
      repositoryId: 'repo_a',
    }),
    entity('project', 'p5', { name: 'Old notes', status: 'archived', order: 1 }),
  ],
};

let posted: {
  url: string;
  body: {
    message?: string;
    operations?: { op: string; type: string; id?: string; data?: Record<string, unknown> }[];
  };
}[];
beforeEach(() => {
  posted = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posted.push({ url, body: JSON.parse(init.body as string) });
      return Response.json({ revision: { id: 42 }, created: {} });
    }
    if (url.includes('/data'))
      return Response.json({ tasks: [1, 2, 3], stages: [1], goals: [], views: [1], decisions: [] });
    const type = /\/api\/entities\/(\w+)/.exec(url)?.[1] as keyof typeof data;
    return Response.json(data[type] ?? []);
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function renderSidebar() {
  render(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>,
  );
  await screen.findByText('Alpha');
}

function menuFor(name: string) {
  fireEvent.click(screen.getByRole('button', { name: `Options for ${name}` }));
  return screen.getByRole('menu');
}

const last = () => posted.at(-1)!.body;

describe('Sidebar', () => {
  it('shows folders, loose projects, and sections', async () => {
    await renderSidebar();
    const nav = screen.getByRole('navigation', { name: 'Projects' });
    expect(nav.textContent).toMatch(/app.*Alpha.*Beta.*site.*No projects.*Loose.*Work/);
  });

  it('pins a project and shows an Undo that reverts it', async () => {
    await renderSidebar();
    fireEvent.click(within(menuFor('Beta')).getByRole('menuitem', { name: /Pin to top/ }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(last()).toEqual({
      message: 'Pin project “Beta”',
      operations: [{ op: 'update', type: 'project', id: 'p2', data: { pinned: true } }],
    });
    fireEvent.click(await screen.findByRole('button', { name: /Undo/ }));
    await waitFor(() => expect(posted.at(-1)!.url).toBe('/api/revisions/42/revert'));
  });

  it('pins and unpins from the row itself, without the menu', async () => {
    await renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Pin Beta' }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(last()).toEqual({
      message: 'Pin project “Beta”',
      operations: [{ op: 'update', type: 'project', id: 'p2', data: { pinned: true } }],
    });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('moves projects up and into sections', async () => {
    await renderSidebar();
    fireEvent.click(within(menuFor('Beta')).getByRole('menuitem', { name: /Move up/ }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(last().operations).toEqual([
      { op: 'update', type: 'project', id: 'p2', data: { order: 0 } },
      { op: 'update', type: 'project', id: 'p1', data: { order: 1 } },
    ]);
    fireEvent.click(within(menuFor('Alpha')).getByRole('menuitem', { name: 'Work' }));
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(last()).toEqual({
      message: 'Move project “Alpha” to section “Work”',
      operations: [
        {
          op: 'update',
          type: 'project',
          id: 'p1',
          data: { repositoryId: null, sectionId: 'sec_work' },
        },
      ],
    });
  });

  it('renames inline and removes a folder without losing its projects', async () => {
    await renderSidebar();
    fireEvent.click(within(menuFor('folder app')).getByRole('menuitem', { name: /Rename/ }));
    const input = screen.getByLabelText('New name');
    fireEvent.change(input, { target: { value: 'web-app' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(last().message).toBe('Rename folder “app” to “web-app”'));

    fireEvent.click(within(menuFor('folder app')).getByRole('menuitem', { name: /Remove folder/ }));
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(last().operations).toEqual([
      { op: 'update', type: 'project', id: 'p1', data: { sectionId: null } },
      { op: 'update', type: 'project', id: 'p2', data: { sectionId: null } },
      { op: 'update', type: 'project', id: 'p4', data: { sectionId: null } },
      { op: 'delete', type: 'repository', id: 'repo_a' },
    ]);
  });

  it('creates folders and sections from the New menu', async () => {
    await renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: /New…/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /New section/ }));
    const dialog = screen.getByRole('dialog', { name: 'New section' });
    // Rendered at the top of the page, not inside the (sticky) sidebar where it would sit behind the main view.
    expect(dialog.closest('nav, aside')).toBeNull();
    expect(
      screen.getByRole('navigation', { name: 'Projects' }).parentElement!.contains(dialog),
    ).toBe(false);
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Personal' } });
    fireEvent.submit(dialog.querySelector('form')!);
    await waitFor(() =>
      expect(last()).toEqual({
        message: 'Add section “Personal”',
        operations: [{ op: 'create', type: 'section', data: { name: 'Personal' } }],
      }),
    );
  });

  it('confirms before deleting a project, saying what goes with it', async () => {
    await renderSidebar();
    fireEvent.click(within(menuFor('Loose')).getByRole('menuitem', { name: /Delete project/ }));
    const dialog = screen.getByRole('alertdialog');
    await waitFor(() =>
      expect(dialog.textContent).toContain('3 tasks, 1 stage, 0 goals, 1 view, 0 decisions'),
    );
    expect(posted).toHaveLength(0);
    await act(async () =>
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete project' })),
    );
    expect(last()).toEqual({
      message: 'Delete project “Loose”',
      operations: [{ op: 'delete', type: 'project', id: 'p3' }],
    });
  });

  it('moves a project into a folder by dragging', async () => {
    await renderSidebar();
    const dragged = { value: '' };
    const dataTransfer = {
      setData: (_: string, v: string) => void (dragged.value = v),
      getData: () => dragged.value,
    };
    const row = screen.getByText('Loose').closest('[draggable]')!;
    fireEvent.dragStart(row, { dataTransfer });
    const folder = screen.getByRole('button', { name: /^site/ }).closest('[draggable]')!;
    fireEvent.dragOver(folder, { dataTransfer });
    fireEvent.drop(folder, { dataTransfer });
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(last()).toEqual({
      message: 'Move project “Loose” to folder “site”',
      operations: [
        {
          op: 'update',
          type: 'project',
          id: 'p3',
          data: { repositoryId: 'repo_b', sectionId: null },
        },
      ],
    });
  });

  it('keeps archived projects in a closed Archived group at the bottom, remembered per browser', async () => {
    await renderSidebar();
    const nav = screen.getByRole('navigation', { name: 'Projects' });
    expect(nav.textContent).not.toContain('Old site');
    const group = screen.getByRole('button', { name: 'Archived (2)' });
    expect(group.getAttribute('aria-expanded')).toBe('false');
    expect(nav.textContent).toMatch(/Work.*Archived \(2\)$/);
    fireEvent.click(group);
    expect(nav.textContent).toMatch(/Archived \(2\)Old notes.*Old site$/);
    // An archived project still opens.
    expect(screen.getByRole('link', { name: /Old site/ }).getAttribute('href')).toBe(
      '/projects/p4',
    );
    cleanup();
    await renderSidebar();
    expect(screen.getByRole('button', { name: 'Archived (2)' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
  });

  it('archives and restores a project in one revision each, with Undo', async () => {
    await renderSidebar();
    expect(within(menuFor('Beta')).queryByRole('menuitem', { name: 'Restore' })).toBeNull();
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Archive' }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(last()).toEqual({
      message: 'Archive project “Beta”',
      operations: [{ op: 'update', type: 'project', id: 'p2', data: { status: 'archived' } }],
    });
    fireEvent.click(await screen.findByRole('button', { name: /Undo/ }));
    await waitFor(() => expect(posted.at(-1)!.url).toBe('/api/revisions/42/revert'));

    fireEvent.click(screen.getByRole('button', { name: 'Archived (2)' }));
    const menu = menuFor('Old site');
    expect(within(menu).queryByRole('menuitem', { name: 'Archive' })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: /Move up/ })).toBeNull();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Restore' }));
    await waitFor(() => expect(posted).toHaveLength(3));
    expect(last()).toEqual({
      message: 'Restore project “Old site”',
      operations: [{ op: 'update', type: 'project', id: 'p4', data: { status: 'active' } }],
    });
  });

  it('leaves archived projects off the home page', async () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );
    await screen.findByText('Alpha');
    expect(screen.queryByText('Old site')).toBeNull();
    expect(screen.queryByText('Old notes')).toBeNull();
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '/projects/p1',
      '/projects/p2',
      '/projects/p3',
    ]);
  });
});
