import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalsState, ProjectPulse, Pulse } from '@pharos/schema';
import { PortfolioPulse, ProjectPulseStrip } from './pulse';
import { StandingApprovals } from './settings-approvals';

type Call = { url: string; method: string; body?: unknown; author?: string | null };
let calls: Call[];
let approvals: ApprovalsState;

const project = (over: Partial<ProjectPulse>): ProjectPulse => ({
  projectId: 'p1',
  project: 'Garden',
  goals: { open: 1, achieved: 0 },
  tasks: { open: 2, inProgress: 1, review: 0, blocked: 0, doneWeek: 0, addedWeek: 0 },
  doneByDay: Array.from({ length: 14 }, () => 0),
  waiting: { count: 0, gates: 0 },
  byRules: 0,
  running: [],
  ...over,
});

const pulse: Pulse = {
  today: '2026-10-26',
  projects: [
    project({
      projectId: 'p1',
      project: 'Garden',
      stage: { name: 'Beta', index: 2, of: 3, targetDate: '2026-10-24', daysLeft: -2 },
      tasks: { open: 2, inProgress: 1, review: 0, blocked: 1, doneWeek: 4, addedWeek: 3 },
      doneByDay: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 0, 1],
      waiting: { count: 2, gates: 1, oldestSince: '2026-10-25T10:00:00.000Z' },
      byRules: 3,
    }),
    project({ projectId: 'p2', project: 'Quiet one' }),
  ],
};

beforeEach(() => {
  calls = [];
  approvals = {
    rules: [],
    answers: [
      {
        decisionId: 'dec_1',
        projectId: 'p1',
        title: 'Merge the fix?',
        option: 'Merge it',
        ruleId: 'rule-1',
        rule: 'Yes to “merge”',
        revision: 9,
        at: new Date().toISOString(),
      },
    ],
    matches: {},
    suggestions: [{ word: 'merge', followed: 19, answered: 24, waitHours: 10 }],
    week: { answered: 208, followed: 149, byRules: 1 },
  };
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({
      url,
      method,
      ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
      author: new Headers(init?.headers).get('x-pharos-author'),
    });
    if (url.startsWith('/api/pulse')) return Response.json(pulse);
    if (url === '/api/approvals') return Response.json(approvals);
    if (url === '/api/entities/project')
      return Response.json([{ id: 'p1', type: 'project', data: { name: 'Garden' } }]);
    return Response.json({ ok: true });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('pulse', () => {
  it('lists projects with something going on, those needing you first, and hides quiet ones', async () => {
    render(
      <MemoryRouter>
        <PortfolioPulse />
      </MemoryRouter>,
    );
    await screen.findByText('Garden');
    expect(screen.queryByText('Quiet one')).toBeNull();
    expect(screen.getByText(/1 project with no work this week/)).toBeTruthy();
    expect(screen.getByText(/Stage due .* · 2 days late/)).toBeTruthy();
    expect(screen.getByText(/2 items wait on you/).textContent).toMatch(/1 gate/);
    expect(screen.getByRole('img', { name: '4 tasks finished in the last 14 days' })).toBeTruthy();
    expect(
      screen
        .getByText(/answered/)
        .closest('a')
        ?.getAttribute('href'),
    ).toBe('/settings#approvals');
  });

  it('shows one project as a line above its views', async () => {
    render(
      <MemoryRouter>
        <ProjectPulseStrip projectId="p1" />
      </MemoryRouter>,
    );
    await screen.findByText('Beta');
    expect(calls[0]!.url).toBe('/api/pulse?projectId=p1');
    expect(screen.getByText(/blocked/).textContent).toBe('1 blocked');
  });
});

describe('standing approvals', () => {
  it('adds a suggested rule, and undoes a rule’s answer, as the owner', async () => {
    render(
      <MemoryRouter>
        <StandingApprovals />
      </MemoryRouter>,
    );
    await screen.findByText(/you took the recommendation 19 of 24 times/);
    expect(screen.getByText(/waits 10 h for you first/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Add this rule/ }));
    await waitFor(() =>
      expect(calls.find((c) => c.url === '/api/approvals/rules')).toMatchObject({
        method: 'POST',
        author: 'human:me',
        body: { words: ['merge'], waitHours: 10, enabled: true },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: /Undo/ }));
    await waitFor(() =>
      expect(calls.find((c) => c.url === '/api/approvals/undo')).toMatchObject({
        body: { decisionId: 'dec_1' },
      }),
    );
  });
});
