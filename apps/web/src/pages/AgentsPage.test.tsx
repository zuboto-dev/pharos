import type { AgentsOverview } from '@pharos/schema';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentsLink, AgentsPage, duration } from './AgentsPage';

const NOW = '2026-10-23T20:00:00.000Z';
const ago = (s: number) => new Date(Date.parse(NOW) - s * 1000).toISOString();

const OVERVIEW: AgentsOverview = {
  at: NOW,
  counts: { working: 2, waiting: 1, idle: 1 },
  panels: [
    {
      id: 'a1',
      agent: 'Claude Code',
      cwd: '/Users/sam/tutti',
      projects: [{ id: 'p1', name: 'Tutti' }],
      state: 'waiting',
      since: ago(240),
      startedAt: ago(3600),
      lastOutputAt: ago(240),
      turnEndedAt: ago(240),
      watched: false,
    },
    {
      id: 'a2',
      agent: 'Codex',
      projects: [{ id: 'p2', name: 'Garden' }],
      state: 'working',
      since: ago(30),
      startedAt: ago(600),
      lastOutputAt: ago(2),
      watched: true,
    },
  ],
  connected: [
    {
      agent: 'Night runner',
      live: true,
      projects: [{ id: 'p2', name: 'Garden' }],
      last: { kind: 'revision', text: 'Watered the tomatoes', at: ago(20), projectId: 'p2' },
    },
    {
      agent: 'Claude Code',
      live: false,
      projects: [],
      last: { kind: 'lookup', text: 'Looked up “Tutti”', at: ago(900) },
    },
  ],
  answering: { state: 'idle', agent: 'Claude Code', queued: 0 },
  runs: [],
  local: true,
};

let calls: { url: string; init?: RequestInit }[];
let overview: AgentsOverview;
beforeEach(() => {
  calls = [];
  overview = OVERVIEW;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const body = url.startsWith('/api/agents') ? overview : { stopped: true };
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Where() {
  const location = useLocation();
  return <div data-testid="where">{location.pathname + location.search}</div>;
}

function page(pollMs?: number) {
  return render(
    <MemoryRouter initialEntries={['/agents']}>
      <Routes>
        <Route path="/agents" element={<AgentsPage {...(pollMs ? { pollMs } : {})} />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('the Agents page', () => {
  it('leads with the counts, then one row per agent', async () => {
    page();
    expect(await screen.findByRole('button', { name: 'Working: 2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Waiting for you: 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Idle: 1' })).toBeTruthy();
    const panels = screen.getByRole('region', { name: 'Agent panels' });
    expect(
      within(panels).getByRole('button', { name: 'Claude Code in Tutti: Waiting for you' }),
    ).toBeTruthy();
    expect(within(panels).getByRole('button', { name: 'Codex in Garden: Working' })).toBeTruthy();
    expect(within(panels).getByText('4 min')).toBeTruthy();
    const connected = screen.getByRole('region', { name: 'Connected agents' });
    expect(within(connected).getByText('Watered the tomatoes')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Answering questions' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Routines running' })).toBeNull();
  });

  it('opens a row to its details on click', async () => {
    page();
    const row = await screen.findByRole('button', {
      name: 'Claude Code in Tutti: Waiting for you',
    });
    expect(screen.queryByText('/Users/sam/tutti')).toBeNull();
    fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('/Users/sam/tutti')).toBeTruthy();
    expect(screen.getByText('Last answer')).toBeTruthy();
  });

  it('a count filters the rows to that state', async () => {
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Waiting for you: 1' }));
    expect(
      screen.getByRole('button', { name: 'Claude Code in Tutti: Waiting for you' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Codex in Garden: Working' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Connected agents' })).toBeNull();
  });

  it('Open goes to the project with its panel; Stop asks the server to stop it', async () => {
    page();
    fireEvent.click(await screen.findByRole('button', { name: 'Stop the agent of Tutti' }));
    await waitFor(() =>
      expect(calls.some((c) => c.url === '/api/projects/p1/terminal/stop')).toBe(true),
    );
    const stop = calls.find((c) => c.url === '/api/projects/p1/terminal/stop')!;
    expect(stop.init?.method).toBe('POST');
    fireEvent.click(screen.getByRole('button', { name: 'Open the panel of Tutti' }));
    expect(screen.getByTestId('where').textContent).toBe('/projects/p1?terminal=1');
  });

  it('has no Stop on the hosted address, and says when no agent is around', async () => {
    overview = {
      ...OVERVIEW,
      local: false,
      panels: [OVERVIEW.panels[0]!],
      connected: [],
      answering: { state: 'unavailable', queued: 0 },
      counts: { working: 0, waiting: 1, idle: 0 },
    };
    page();
    await screen.findByRole('button', { name: 'Open the panel of Tutti' });
    expect(screen.queryByRole('button', { name: 'Stop the agent of Tutti' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Working: 0' }));
    expect(screen.getByText('None working')).toBeTruthy();
  });

  it('looks again by itself (panels change with their output)', async () => {
    page(20);
    await screen.findByRole('button', { name: 'Working: 2' });
    overview = { ...OVERVIEW, counts: { working: 1, waiting: 2, idle: 1 } };
    expect(await screen.findByRole('button', { name: 'Waiting for you: 2' })).toBeTruthy();
  });

  it('durations read short', () => {
    const now = Date.parse(NOW);
    expect(duration(ago(20), now)).toBe('20 s');
    expect(duration(ago(240), now)).toBe('4 min');
    expect(duration(ago(3900), now)).toBe('1 h 5 min');
    expect(duration(ago(7200), now)).toBe('2 h');
  });

  it('the sidebar links to it', () => {
    render(
      <MemoryRouter>
        <AgentsLink />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Agents' }).getAttribute('href')).toBe('/agents');
  });
});
