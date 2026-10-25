import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunnersCard, runnerFacts, useRunners } from './routines-runners';

afterEach(cleanup);

const VIEW = {
  local: {
    id: 'local',
    name: 'This Mac',
    kind: 'local',
    status: { state: 'ready', detail: 'runs here' },
  },
  runners: [
    {
      id: 'axion-01',
      name: 'axion-01',
      kind: 'ssh',
      host: 'axion-01',
      projects: ['breathe'],
      status: {
        state: 'ready',
        detail: 'ready',
        os: 'Linux',
        node: 'v22.20.0',
        claude: '2.1.310',
        memory_gb: '8',
        disk_free_gb: '391',
        checked: '2026-10-25T11:43:16',
      },
    },
    {
      id: 'vm2',
      name: 'vm2',
      kind: 'ssh',
      host: 'vm2',
      projects: [],
      status: { state: 'not-set-up', detail: 'missing: node, pnpm, claude' },
    },
    {
      id: 'box',
      name: 'box',
      kind: 'ssh',
      host: 'box',
      projects: [],
      status: { state: 'needs-sign-in', detail: 'Claude Code is not signed in there' },
    },
  ],
  candidates: [
    { host: 'mini', name: 'mini', source: 'tailscale', os: 'macOS' },
    { host: 'old-server', name: 'old-server', source: 'ssh config' },
  ],
  kinds: ['ssh', 'container', 'cloud'],
  built: ['ssh'],
};

function Card() {
  return <RunnersCard view={useRunners()} />;
}

describe('where routines run', () => {
  it('shows this Mac and each runner with its state, and sets up, adds and checks with one press', async () => {
    const posts: [string, unknown][] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push([url, JSON.parse(String(init.body))]);
        return Response.json({ ok: true });
      }
      return Response.json(VIEW);
    });
    render(<Card />);
    const card = await screen.findByRole('region', { name: 'Where routines run' });
    const axion = card.querySelector('[data-runner="axion-01"]') as HTMLElement;
    expect(within(axion).getByText('Ready')).toBeTruthy();
    expect(axion.textContent).toContain(
      'Linux · Node v22.20.0 · Claude 2.1.310 · 8 GB · 391 GB free',
    );
    expect(axion.textContent).toContain('breathe');
    const vm2 = card.querySelector('[data-runner="vm2"]') as HTMLElement;
    expect(within(vm2).getByText('Set up needed')).toBeTruthy();
    fireEvent.click(within(vm2).getByRole('button', { name: /Set up/ }));
    // A runner that needs your sign-in shows the one command, with a copy button.
    const box = card.querySelector('[data-runner="box"]') as HTMLElement;
    expect(box.textContent).toContain('ssh -t box ~/.local/bin/claude');
    expect(within(box).getByRole('button', { name: 'Copy command' })).toBeTruthy();
    // Your own devices first; other SSH hosts folded.
    fireEvent.click(within(card).getByRole('button', { name: 'Add' }));
    expect(within(card).queryByText('old-server')).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: /Other SSH hosts \(1\)/ }));
    expect(within(card).getByText('old-server')).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Check axion-01 again' }));
    await waitFor(() =>
      expect(posts).toEqual([
        ['/api/routines/runners/setup', { id: 'vm2' }],
        ['/api/routines/runners/add', { host: 'mini' }],
        ['/api/routines/runners/check', { id: 'axion-01' }],
      ]),
    );
  });

  it('says a check in one line', () => {
    expect(
      runnerFacts({ state: 'ready', detail: '', os: 'Linux', node: 'v22', claude: '2.1' }),
    ).toBe('Linux · Node v22 · Claude 2.1');
  });
});
