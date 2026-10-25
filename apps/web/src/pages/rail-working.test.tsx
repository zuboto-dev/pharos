import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentsLink, AgentsRailLink } from './AgentsPage';
import { RoutinesLink, RoutinesRailLink } from './RoutinesPage';

afterEach(cleanup);

function serve(body: Record<string, unknown>) {
  vi.stubGlobal('fetch', async (url: string) =>
    Response.json(Object.entries(body).find(([path]) => url.startsWith(path))?.[1] ?? {}),
  );
}

describe('sidebar links show work in progress', () => {
  it('turns the Agents icon while agents work, and stays still when none do', async () => {
    serve({ '/api/agents': { counts: { working: 2, waiting: 0, idle: 1 } } });
    const { container } = render(
      <MemoryRouter>
        <AgentsLink />
      </MemoryRouter>,
    );
    expect(await screen.findByText('(2 working)', { exact: false })).toBeTruthy();
    expect(container.querySelector('svg')!.getAttribute('class')).toContain('animate-working');
    cleanup();
    serve({ '/api/agents': { counts: { working: 0, waiting: 0, idle: 3 } } });
    const still = render(
      <MemoryRouter>
        <AgentsLink />
      </MemoryRouter>,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(still.container.querySelector('[data-working]')).toBeNull();
  });

  it('turns the Routines icon while a routine runs', async () => {
    serve({
      '/api/routines/state': {
        available: true,
        current: { routine: 'nightshift', name: 'Night run', projects: [] },
      },
    });
    const { container } = render(
      <MemoryRouter>
        <RoutinesLink />
      </MemoryRouter>,
    );
    expect(await screen.findByText('(Night run running)', { exact: false })).toBeTruthy();
    expect(container.querySelector('svg')!.getAttribute('data-working')).toBe('true');
  });

  it('shows both on the folded rail, turning only while work runs', async () => {
    serve({
      '/api/agents': { counts: { working: 1, waiting: 0, idle: 0 } },
      '/api/routines/state': { available: true, current: null },
    });
    render(
      <MemoryRouter>
        <AgentsRailLink />
        <RoutinesRailLink />
      </MemoryRouter>,
    );
    const agents = await screen.findByRole('link', { name: 'Agents · 1 working' });
    expect(agents.querySelector('[data-working]')).toBeTruthy();
    const routines = screen.getByRole('link', { name: 'Routines' });
    expect(routines.getAttribute('href')).toBe('/routines');
    expect(routines.querySelector('[data-working]')).toBeNull();
  });
});
