import type { Desk } from '@pharos/schema';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeskLink, DeskPage, arrangeDesk, formatMinutes, waited, type DeskSort } from './DeskPage';

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const DESK: Desk = {
  minutes: 0,
  overdue: 1,
  old: 1,
  runs: [
    {
      id: 'run_1',
      kind: 'night',
      name: 'Night run',
      agent: 'Runner',
      startedAt: hoursAgo(9),
      endedAt: hoursAgo(8),
      outcome: 'partial',
      summary: '7 could not verify',
    },
  ],
  items: [
    {
      id: 'dec_1',
      kind: 'decision',
      projectId: 'p1',
      project: 'Garden',
      title: 'Which seeds?',
      ask: 'Spring order closes Friday',
      minutes: 2,
      since: hoursAgo(60),
      overdue: true,
      old: false,
      gate: false,
      href: '/projects/p1?entity=dec_1',
      options: [
        { id: 'a', label: 'Plan A' },
        { id: 'b', label: 'Plan B', asks: 'Why B?' },
      ],
      recommendedOptionId: 'a',
    },
    {
      id: 'task_1',
      kind: 'task',
      projectId: 'p1',
      project: 'Garden',
      title: 'Paste the API key',
      minutes: 3,
      since: hoursAgo(1),
      overdue: false,
      old: false,
      gate: true,
      href: '/projects/p1?entity=task_1',
    },
    {
      id: 'view_1#s',
      kind: 'sheet',
      projectId: 'p2',
      project: 'Bike',
      title: 'Approve the new chain',
      since: hoursAgo(24 * 20),
      overdue: true,
      old: true,
      gate: false,
      href: '/projects/p2/views/view_1#sheet-s',
    },
    {
      id: 'view_2#t',
      kind: 'sheet',
      projectId: 'p3',
      project: 'Kitchen',
      title: 'Pick the tiles',
      minutes: 4,
      since: hoursAgo(3),
      overdue: false,
      old: false,
      gate: false,
      href: '/projects/p3/views/view_2#sheet-t',
    },
    {
      id: 'run_1',
      kind: 'run',
      title: 'Night run: partly done',
      ask: '7 could not verify',
      since: hoursAgo(8),
      overdue: false,
      old: false,
      gate: false,
      href: '/desk#run_1',
    },
  ],
};

let posted: { url: string; body: unknown }[];
let seen: string[];
beforeEach(() => {
  posted = [];
  seen = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') {
      seen.push(url);
      return Response.json({ seen: 9 });
    }
    if (url === '/api/desk/landed')
      return Response.json({
        since: 3,
        projects: [
          {
            projectId: 'p1',
            project: 'Garden',
            revisions: 4,
            agents: ['Garden agent'],
            latest: { message: 'Planted the beans', at: hoursAgo(1) },
          },
        ],
      });
    if (init?.method === 'POST') {
      posted.push({ url, body: JSON.parse((init.body as string) || '{}') });
      return Response.json({ revision: { id: 9, message: 'Saved it' } });
    }
    return Response.json(DESK);
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const show = async () => {
  render(
    <MemoryRouter>
      <DeskPage />
    </MemoryRouter>,
  );
  await screen.findByText('Which seeds?');
};

describe('the desk page (R16)', () => {
  it('says what needs you in groups by what you do, runs in one pill, and folds the old ones', async () => {
    await show();
    // Runs aren't work: they are in the pill, not counted.
    expect(document.querySelector('[data-needs-you]')?.textContent).toBe('Needs you: 3 · ~9 min');
    expect(screen.getByText('1 over two days')).toBeTruthy();
    const only = screen.getByRole('region', { name: 'Only you' });
    expect(within(only).getByText('Paste the API key')).toBeTruthy();
    expect(within(only).getByLabelText('only you')).toBeTruthy();
    const answer = screen.getByRole('region', { name: 'Answer here' });
    expect(within(answer).getByText('Which seeds?')).toBeTruthy();
    // Waited shows once it is over two days.
    expect(within(answer).getByText('3 d')).toBeTruthy();
    const review = screen.getByRole('region', { name: 'Open to review' });
    expect(within(review).getByRole('link', { name: 'Open “Pick the tiles”' })).toBeTruthy();
    const older = screen.getByText(/Older than two weeks/).closest('details')!;
    expect(older.open).toBe(false);
    expect(within(older).getByText('Approve the new chain').getAttribute('href')).toBe(
      '/projects/p2/views/view_1#sheet-s',
    );
    // The pill: one ok run is not shown (it ran), one needs a look; Seen all marks it.
    const pill = screen.getByRole('button', { name: 'Runs: 0 ok, 1 need a look' });
    fireEvent.click(pill);
    const panel = screen.getByRole('dialog', { name: 'Runs that need a look' });
    expect(panel.textContent).toContain('Night run: partly done');
    expect(panel.textContent).toContain('7 could not verify');
    fireEvent.click(within(panel).getByRole('button', { name: 'Seen all' }));
    await waitFor(() => expect(posted.map((p) => p.url)).toEqual(['/api/runs/run_1/seen']));
  });

  it('filters by a project with something open, and sorts, remembering both', async () => {
    localStorage.clear();
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'All projects' }));
    const menu = screen.getByRole('menu', { name: 'Project' });
    // Bike has only a folded old item: not offered.
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((m) => m.textContent),
    ).toEqual(['All projects 3', 'Garden 2', 'Kitchen 1']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Kitchen 1' }));
    expect(screen.queryByText('Which seeds?')).toBeNull();
    expect(screen.getByText('Pick the tiles')).toBeTruthy();
    // The header still counts everything.
    expect(document.querySelector('[data-needs-you]')?.textContent).toBe('Needs you: 3 · ~9 min');
    fireEvent.click(screen.getByRole('button', { name: 'Sort: Waiting longest' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Quickest first' }));
    expect(JSON.parse(localStorage.getItem('pharos-desk-view')!)).toEqual({
      project: 'p3',
      sort: 'quickest',
    });
    localStorage.clear();
  });

  it('opens on the project a link names (?project=, from the Routines page)', async () => {
    localStorage.clear();
    render(
      <MemoryRouter initialEntries={['/desk?project=p3']}>
        <DeskPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Pick the tiles')).toBeTruthy();
    expect(screen.queryByText('Which seeds?')).toBeNull();
  });

  it('opens on several projects at once (a folder’s projects, ?project=a,b)', async () => {
    localStorage.clear();
    render(
      <MemoryRouter initialEntries={['/desk?project=p1,p3']}>
        <DeskPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Pick the tiles')).toBeTruthy();
    expect(screen.getByText('Which seeds?')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /Garden \+ Kitchen|Kitchen \+ Garden/ }),
    ).toBeTruthy();
  });

  it('orders by waiting, newest or quickest, keeping the server’s order for ties', () => {
    const items = DESK.items;
    const ids = (sort: DeskSort, project: string | null = null) =>
      arrangeDesk(items, { project, sort }).map((i) => i.id);
    expect(ids('waiting')).toEqual(['dec_1', 'task_1', 'view_1#s', 'view_2#t', 'run_1']);
    expect(ids('newest')).toEqual(['task_1', 'view_2#t', 'run_1', 'dec_1', 'view_1#s']);
    expect(ids('quickest')).toEqual(['dec_1', 'task_1', 'view_2#t', 'view_1#s', 'run_1']);
    expect(ids('waiting', 'p2')).toEqual(['view_1#s']);
  });

  it('answers a choice in place, asks for the note an option needs, marks a task done', async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: 'Plan A (suggested)' }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({
      url: '/api/desk/answer',
      body: { id: 'dec_1', chosenOptionId: 'a' },
    });
    expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Saved it');
    fireEvent.click(screen.getByRole('button', { name: 'Plan B' }));
    const box = screen.getByLabelText('Why B?');
    fireEvent.change(box, { target: { value: 'Cheaper' } });
    fireEvent.click(screen.getByRole('button', { name: 'Choose “Plan B”' }));
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1]!.body).toEqual({ id: 'dec_1', chosenOptionId: 'b', note: 'Cheaper' });
    fireEvent.click(screen.getByRole('button', { name: 'Mark “Paste the API key” done' }));
    await waitFor(() => expect(posted).toHaveLength(3));
    expect(posted[2]!.body).toEqual({ id: 'task_1', done: true });
  });

  it("answers a task otherwise: won't do, later, or a reply", async () => {
    await show();
    const other = () =>
      screen.getByRole('button', { name: 'Other answer for “Paste the API key”' });
    expect(other().getAttribute('title')).toBe('Other answer');
    fireEvent.click(other());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Won’t do' }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ url: '/api/desk/answer', body: { id: 'task_1', wontDo: true } });

    fireEvent.click(other());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Later…' }));
    const date = screen.getByLabelText(/Later, on/) as HTMLInputElement;
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted[1]!.body).toEqual({ id: 'task_1', later: date.value });

    fireEvent.click(other());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reply…' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Ana has the key' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    await waitFor(() => expect(posted).toHaveLength(3));
    expect(posted[2]!.body).toEqual({ id: 'task_1', reply: 'Ana has the key' });
  });

  it('the sidebar link counts what needs you today', async () => {
    render(
      <MemoryRouter>
        <DeskLink />
      </MemoryRouter>,
    );
    // Not the run, not the old one.
    expect((await screen.findByText('3')).closest('[data-desk-count]')).toBeTruthy();
  });

  it('writes times briefly', () => {
    expect(formatMinutes(5)).toBe('5 min');
    expect(formatMinutes(90)).toBe('1 h 30 min');
    const now = Date.parse('2026-10-21T12:00:00Z');
    expect(waited('2026-10-21T11:59:30Z', now)).toBe('now');
    expect(waited('2026-10-21T11:20:00Z', now)).toBe('40 min');
    expect(waited('2026-10-21T07:00:00Z', now)).toBe('5 h');
    expect(waited('2026-10-18T12:00:00Z', now)).toBe('3 d');
  });

  it('shows what agents landed since the last look, then marks the desk seen', async () => {
    await show();
    const landed = await screen.findByRole('region', {
      name: 'What agents changed since you last looked',
    });
    // One row per project, all of it a link: project, latest change, how many.
    const row = within(landed).getByRole('link');
    expect(row.getAttribute('href')).toBe('/projects/p1');
    expect(row.textContent).toBe('GardenPlanted the beans4 changes');
    await waitFor(() => expect(seen).toContain('/api/desk/seen'));
  });
});
