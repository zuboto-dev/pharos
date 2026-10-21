import type { Desk } from '@pharos/schema';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeskLink, DeskPage, formatMinutes, waited } from './DeskPage';

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
  it('says what needs you today, overdue first, and folds the old ones', async () => {
    await show();
    expect(document.querySelector('[data-needs-you]')?.textContent).toBe(
      'Needs you: 2 items, about 5 min',
    );
    expect(screen.getByText('1 waiting more than two days')).toBeTruthy();
    const overdue = screen.getByRole('region', { name: 'Waiting more than two days' });
    expect(within(overdue).getByText('Which seeds?')).toBeTruthy();
    const today = screen.getByRole('region', { name: 'Today' });
    expect(within(today).getByText('only you')).toBeTruthy();
    const older = screen.getByText(/Older than two weeks/).closest('details')!;
    expect(older.open).toBe(false);
    expect(within(older).getByText('Approve the new chain').getAttribute('href')).toBe(
      '/projects/p2/views/view_1#sheet-s',
    );
    expect(screen.getByRole('region', { name: 'Runs' }).textContent).toContain('Night run');
  });

  it('answers a choice in place, asks for the note an option needs, marks a task done', async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: /Plan A/ }));
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
    fireEvent.click(screen.getByRole('button', { name: /Mark done/ }));
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
    expect((await screen.findByText('2')).closest('[data-desk-count]')).toBeTruthy();
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
    const landed = await screen.findByRole('region', { name: 'Since you last looked' });
    expect(landed.textContent).toContain('Garden');
    expect(landed.textContent).toContain('Planted the beans');
    await waitFor(() => expect(seen).toContain('/api/desk/seen'));
  });
});
