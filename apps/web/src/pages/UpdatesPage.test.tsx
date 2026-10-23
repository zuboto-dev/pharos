import type { Updates, UpdatesBucket } from '@pharos/schema';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  UpdatesLink,
  UpdatesPage,
  binHours,
  fieldName,
  matchesSession,
  textDiff,
  valueText,
} from './UpdatesPage';

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const bucket = (at: string, n = 0): UpdatesBucket => ({
  at,
  added: n,
  changed: 0,
  removed: 0,
  lookedUp: 0,
});

const UPDATES: Updates = {
  since: hoursAgo(168),
  until: hoursAgo(0),
  last24h: { added: 2, changed: 1, removed: 1, lookedUp: 3 },
  days: Array.from({ length: 7 }, (_, i) => bucket(hoursAgo((6 - i) * 24), i)),
  hours: Array.from({ length: 168 }, (_, i) => bucket(hoursAgo(167 - i), i === 160 ? 2 : 0)),
  authors: [
    { kind: 'agent', name: 'claude-code' },
    { kind: 'human', name: 'Sam' },
  ],
  projects: [
    { id: 'p1', name: 'Garden' },
    { id: 'p2', name: 'Bike' },
  ],
  nextBefore: null,
  sessions: [
    {
      id: 's1',
      author: { kind: 'agent', name: 'claude-code' },
      projectId: 'p1',
      project: 'Garden',
      start: hoursAgo(2),
      end: hoursAgo(1.5),
      counts: { added: 1, changed: 1, removed: 1, lookedUp: 3 },
      byType: [{ type: 'task', added: 1, changed: 1, removed: 1 }],
      revisions: [
        {
          id: 3,
          message: 'Beans are in',
          at: hoursAgo(1.5),
          revertOf: null,
          revertedBy: null,
          counts: { added: 1, changed: 1, removed: 0 },
        },
        {
          id: 2,
          message: 'Removed a duplicate',
          at: hoursAgo(2),
          revertOf: null,
          revertedBy: null,
          counts: { added: 0, changed: 0, removed: 1 },
        },
      ],
      entities: [
        {
          op: 'update',
          type: 'task',
          id: 'task_1',
          label: 'Plant the runner beans',
          fields: [
            {
              field: 'status',
              before: 'todo',
              after: 'done',
              option: {
                before: { value: 'todo', label: 'To do', color: 'neutral' },
                after: { value: 'done', label: 'Done', color: 'green' },
              },
            },
            { field: 'title', before: 'Plant the beans', after: 'Plant the runner beans' },
          ],
        },
        {
          op: 'create',
          type: 'artifact',
          id: 'art_1',
          label: 'Bed layout',
          fields: [{ field: 'image', before: null, after: 'https://example.com/bed.png' }],
          pictures: [{ after: 'https://example.com/bed.png' }],
        },
        { op: 'delete', type: 'task', id: 'task_2', label: 'Weed bed', fields: [] },
      ],
      moreEntities: 0,
      lookups: [
        {
          tool: 'get',
          targetId: 'task_1',
          targetType: 'task',
          label: 'Plant the runner beans',
          count: 2,
          at: hoursAgo(2),
        },
        {
          tool: 'project_snapshot',
          targetId: 'p1',
          targetType: 'project',
          label: 'Garden',
          count: 1,
          at: hoursAgo(2),
        },
      ],
    },
    {
      id: 's2',
      author: { kind: 'human', name: 'Sam' },
      projectId: 'p2',
      project: 'Bike',
      start: hoursAgo(30),
      end: hoursAgo(30),
      counts: { added: 1, changed: 0, removed: 0, lookedUp: 0 },
      byType: [{ type: 'task', added: 1, changed: 0, removed: 0 }],
      revisions: [
        {
          id: 1,
          message: 'Oil the chain',
          at: hoursAgo(30),
          revertOf: null,
          revertedBy: null,
          counts: { added: 1, changed: 0, removed: 0 },
        },
      ],
      entities: [{ op: 'create', type: 'task', id: 'task_3', label: 'Oil chain', fields: [] }],
      moreEntities: 0,
      lookups: [],
    },
  ],
};

let requested: string[];
beforeEach(() => {
  requested = [];
  vi.stubGlobal('fetch', async (url: string) => {
    requested.push(url);
    return Response.json(UPDATES);
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const show = async (path = '/updates') => {
  render(
    <MemoryRouter initialEntries={[path]}>
      <UpdatesPage />
    </MemoryRouter>,
  );
  await screen.findByText('Weed bed');
};

describe('the Updates page', () => {
  it('shows the tiles, the timeline and one card per session', async () => {
    await show();
    const tile = (kind: string) => document.querySelector(`[data-tile="${kind}"]`)!;
    expect(within(tile('added') as HTMLElement).getByText('2')).toBeTruthy();
    expect(within(tile('lookedUp') as HTMLElement).getByText('3')).toBeTruthy();
    expect(screen.getByRole('img', { name: /Work per 2 hours/ })).toBeTruthy();
    expect(document.querySelectorAll('[data-session]')).toHaveLength(2);
    expect(screen.getByText('Today')).toBeTruthy();
    expect(screen.getByText('Yesterday')).toBeTruthy();
  });

  it('opens the newest session to its before → after', async () => {
    await show();
    const card = document.querySelector('[data-session="s1"]') as HTMLElement;
    await within(card).findByText('To do');
    // Status as pill → pill, the title as its changed part, the picture, the delete.
    const status = card.querySelector('[data-field="status"]') as HTMLElement;
    expect(within(status).getByText('To do')).toBeTruthy();
    expect(within(status).getByText('Done')).toBeTruthy();
    const title = card.querySelector('[data-field="title"]') as HTMLElement;
    expect(title.querySelector('ins')?.textContent).toBe('runner ');
    expect(within(card).getByRole('img', { name: 'Bed layout' }).getAttribute('src')).toBe(
      'https://example.com/bed.png',
    );
    expect(within(card).getByText('Weed bed').className).toContain('line-through');
    // Looked up: once per thing, with how many times.
    expect(within(card).getByText('×2')).toBeTruthy();
    // The other card opens on a click.
    const other = document.querySelector('[data-session="s2"] > button') as HTMLElement;
    expect(other.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(other);
    expect(other.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Oil chain')).toBeTruthy();
  });

  it('filters by kind and by words', async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: /Added/, pressed: true }));
    // Sam's session only added: with Added off it goes.
    expect(document.querySelector('[data-session="s2"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Added/, pressed: false }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'chain' } });
    expect(document.querySelector('[data-session="s1"]')).toBeNull();
    expect(document.querySelector('[data-session="s2"]')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'nothing like it' } });
    expect(screen.getByText('Nothing matches these filters.')).toBeTruthy();
  });

  it('asks the server for one project and agent from the address', async () => {
    await show('/updates?project=p1&agent=claude-code');
    expect(requested[0]).toBe('/api/updates?projectId=p1&author=claude-code');
    expect(screen.getByRole('button', { name: 'Project: Garden' })).toBeTruthy();
  });

  it('links from the sidebar', () => {
    render(
      <MemoryRouter>
        <UpdatesLink />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Updates' }).getAttribute('href')).toBe('/updates');
  });
});

describe('Updates helpers', () => {
  it('marks only the changed part of a text', () => {
    expect(textDiff('Plant the beans', 'Plant the peas')).toEqual({
      lead: 'Plant the ',
      before: 'beans',
      after: 'peas',
      tail: '',
    });
    expect(textDiff(`${'a '.repeat(20)}x`, `${'a '.repeat(20)}y`).lead).toBe(`…${'a '.repeat(9)}`);
    expect(textDiff('Plant the beans', 'Plant the runner beans')).toMatchObject({
      before: '',
      after: 'runner ',
      tail: 'beans',
    });
  });

  it('says values in a few words', () => {
    expect(valueText(null)).toBe('—');
    expect(valueText(true)).toBe('yes');
    expect(valueText(['a', 'b'])).toBe('a, b');
    expect(valueText({ $summary: 'list', size: 3 })).toBe('3 items');
    expect(fieldName('dueDate')).toBe('Due date');
  });

  it('bins hours and matches sessions', () => {
    const hours = Array.from({ length: 5 }, (_, i) => bucket(String(i), 1));
    expect(binHours(hours, 2).map((b) => b.added)).toEqual([2, 2, 1]);
    const [s1] = UPDATES.sessions;
    expect(matchesSession(s1!, ['lookedUp'], '')).toBe(true);
    expect(matchesSession(s1!, ['added'], 'beans garden')).toBe(true);
    expect(matchesSession(s1!, ['added'], 'bike')).toBe(false);
  });
});
