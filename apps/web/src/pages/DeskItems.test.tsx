import type { Desk } from '@pharos/schema';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeskPage } from './DeskPage';

// A decision whose choice applies to some items (a cleanup's folders), answered from the desk:
// the row stays one line, opening it shows the checklist, and the choice sends the ticked ids.
// Every name here is made up.

const LIST = [
  { id: 'web/dist', label: 'web/dist', detail: '200 MB · untouched 9 days · build output' },
  { id: 'cache', label: '.cache', detail: '80 MB · untouched 30 days' },
  { id: 'shots', label: 'shots', detail: '32 MB · untouched 12 days' },
];
const DESK: Desk = {
  minutes: 1,
  overdue: 0,
  old: 0,
  runs: [],
  items: [
    {
      id: 'dec_clean',
      kind: 'decision',
      projectId: 'p1',
      project: 'tutti',
      title: 'Clean up 3 items (312 MB) in tutti: move them to the Trash?',
      minutes: 1,
      since: new Date().toISOString(),
      overdue: false,
      old: false,
      gate: false,
      href: '/projects/p1?entity=dec_clean',
      options: [
        { id: 'move', label: 'Move to Trash' },
        { id: 'keep', label: 'Keep them' },
      ],
      recommendedOptionId: 'move',
      items: { list: LIST, appliesTo: 'move' },
    },
  ],
};

let posted: { url: string; body: unknown }[];
beforeEach(() => {
  posted = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') return Response.json({ seen: 9 });
    if (url === '/api/desk/landed') return Response.json({ since: 3, projects: [] });
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
  await screen.findByText(DESK.items[0]!.title);
};

describe('the desk: picking which items', () => {
  it('opens the checklist from the row and sends the ticked ids with the choice', async () => {
    await show();
    const toggle = screen.getByRole('button', { name: 'Items: 3 of 3 selected · 312 MB' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('group', { name: /Items for/ })).toBeNull();
    fireEvent.click(toggle);
    const group = screen.getByRole('group', { name: 'Items for “Move to Trash”' });
    fireEvent.click(within(group).getByRole('checkbox', { name: /\.cache/ }));
    expect(within(group).getByText('2 of 3 selected · 232 MB')).toBeTruthy();
    expect(toggle.textContent).toContain('2/3');
    fireEvent.click(screen.getByRole('button', { name: 'Move to Trash (suggested)' }));
    await waitFor(() =>
      expect(posted).toEqual([
        {
          url: '/api/desk/answer',
          body: { id: 'dec_clean', chosenOptionId: 'move', selected: ['web/dist', 'shots'] },
        },
      ]),
    );
  });

  it('select none blocks the option it applies to; select all and the other option work', async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: /^Items:/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Select none' }));
    const move = screen.getByRole('button', { name: 'Move to Trash (suggested)' });
    expect((move as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect((move as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Keep them' }));
    await waitFor(() =>
      expect(posted.map((p) => p.body)).toEqual([{ id: 'dec_clean', chosenOptionId: 'keep' }]),
    );
  });
});
