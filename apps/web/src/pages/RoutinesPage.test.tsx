import type { RoutinesConfig, RoutinesState } from '@pharos/schema';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RoutinesLink, RoutinesPage, diffConfig, inTime, nextRun, runTime } from './RoutinesPage';

const CONFIG = (): RoutinesConfig => ({
  schedule: { wrapup: '00:00', nightshift: '01:00', daybreak: '07:00', timezone: 'UTC' },
  master: { model: 'opus', effort: 'high' },
  dispatch: { develop: { easy: 'sonnet', medium: 'sonnet', hard: 'opus' } },
  cleanup: { level: 1, scratch_days: 7 },
  projects: [
    {
      name: 'garden',
      path: '/tmp/garden',
      enrolled: true,
      budget_usd: 8,
      hours: 4,
      note: 'slot 1',
    },
    { name: 'bike', path: '/tmp/bike', enrolled: false, budget_usd: 5, hours: 3 },
  ],
});

const STATE = (): RoutinesState => ({
  available: true,
  url: 'http://127.0.0.1:4777',
  now: '2026-10-23T14:00',
  config: CONFIG(),
  report: { text: '', date: null, when: null },
  pages: {
    morning: {
      url: 'http://127.0.0.1:4300/projects/prj_r/views/view_m',
      date: '2026-10-23',
      posted: '2026-10-23 07:34 CT',
    },
  },
  status: [
    {
      name: 'garden',
      exists: true,
      files: { 'NEXT.md': { when: '2026-10-23T09:00', first: '# NEXT · garden' } },
      git: { dirty: 2, head: 'abc123 fix the hose', ahead: '3' },
      queue: { auto: 1, review: 2, needs_you: 3, ship: 'beans by 2026-11-01' },
      runs: {
        wrapup: {
          file: '2026-10-23-garden-wrapup.log',
          when: '2026-10-23T00:02',
          status: 'ok',
          tail: 'done\n[stopping: wrap-up complete]',
        },
        nightshift: {
          file: '2026-10-23-garden-nightshift.log',
          when: '2026-10-23T01:09',
          status: 'error',
          tail: 'budget hit',
        },
        daybreak: null,
      },
    },
    { name: 'bike', exists: true, runs: { wrapup: null, nightshift: null, daybreak: null } },
  ],
});

type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];
let state: RoutinesState;

beforeEach(() => {
  calls = [];
  state = STATE();
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url === '/api/routines/state') return Response.json(state);
    if (url.startsWith('/api/routines/file'))
      return Response.json({
        project: 'garden',
        name: 'NEXT.md',
        text: '# NEXT · garden\n- [ ] A1 auto water',
      });
    if (url.startsWith('/api/routines/log'))
      return Response.json({ file: 'x', text: 'the whole log' });
    if (url === '/api/routines/save') {
      const body = JSON.parse(String(init?.body)) as { changes: unknown[] };
      return Response.json({
        ok: true,
        saved: body.changes.map(() => 'garden: night budget $8 → $10'),
      });
    }
    if (url === '/api/routines/run') return Response.json({ ok: true });
    return Response.json({}, { status: 404 });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const show = () =>
  render(
    <MemoryRouter>
      <RoutinesPage />
    </MemoryRouter>,
  );

const posts = () => calls.filter((c) => c.init?.method === 'POST');

describe('the Routines page', () => {
  it('shows the glance, each project with its queue, budget, runs and repo', async () => {
    show();
    const garden = await screen.findByText('garden');
    const row = garden.closest('li')!;
    expect(screen.getByRole('switch', { name: 'Enrol garden' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(screen.getByRole('switch', { name: 'Enrol bike' }).getAttribute('aria-checked')).toBe(
      'false',
    );
    expect(within(row).getByText('3 need you')).toBeTruthy();
    expect(
      within(row).getByLabelText('Night budget in dollars for garden') as HTMLInputElement,
    ).toHaveProperty('value', '8');
    expect(within(row).getByLabelText('Night hours for garden') as HTMLInputElement).toHaveProperty(
      'value',
      '4',
    );
    expect(row.querySelector('[data-run-chip="wrapup"]')?.textContent).toMatch('Wrap-up ok00:02');
    expect(row.querySelector('[data-run-chip="nightshift"]')?.textContent).toMatch(
      'Night failed01:09',
    );
    expect(row.querySelector('[data-run-chip="daybreak"]')?.textContent).toMatch('Morning never');
    expect(row.querySelector('[data-repo]')?.textContent).toMatch('2 changed · 3 ahead');
    // At a glance: what needs the owner (enrolled projects only) and today's page, in this app.
    expect(document.querySelector('[data-tile="needs"]')?.textContent).toMatch('3 items');
    expect(document.querySelector('[data-page-link="morning"]')?.getAttribute('href')).toBe(
      '/projects/prj_r/views/view_m',
    );
    expect(document.querySelector('[data-tile="next"]')?.textContent).toMatch(
      /Wrap-up|Night run|Morning report/,
    );
    expect(document.querySelector('[data-cleanup-level="1"]')?.textContent).toMatch(
      'Level 1 · Safe',
    );
    expect(posts()).toEqual([]);
  });

  it('opens a row to its NEXT.md and last runs, and the full log', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: /garden/ }));
    const details = await waitFor(() => {
      const el = document.querySelector('[data-routines-details="garden"]');
      if (!el) throw new Error('no details');
      return el as HTMLElement;
    });
    await within(details).findByText(/A1 auto water/);
    expect(within(details).getByText(/beans by 2026-11-01/)).toBeTruthy();
    fireEvent.click(within(details).getAllByRole('button', { name: 'Open log' })[0]!);
    expect(await screen.findByText('the whole log')).toBeTruthy();
    expect(calls.some((c) => c.url === '/api/routines/log?file=2026-10-23-garden-wrapup.log')).toBe(
      true,
    );
  });

  it('saves an edit only after showing what changes, as the owner', async () => {
    show();
    const budget = await screen.findByLabelText('Night budget in dollars for garden');
    fireEvent.change(budget, { target: { value: '10' } });
    fireEvent.click(screen.getByRole('switch', { name: 'Enrol bike' }));
    expect(screen.getByText('2 unsaved changes')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save…' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('garden: night budget $8 → $10')).toBeTruthy();
    expect(within(dialog).getByText('bike: enrolled')).toBeTruthy();
    expect(posts()).toEqual([]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await screen.findByText(/Saved to routines.json/);
    const [save] = posts();
    expect(save!.url).toBe('/api/routines/save');
    expect((save!.init!.headers as Record<string, string>)['x-pharos-author']).toBe('human:me');
    expect(JSON.parse(String(save!.init!.body))).toEqual({
      changes: [
        { field: 'budget_usd', project: 'garden', from: 8, to: 10 },
        { field: 'enrolled', project: 'bike', from: false, to: true },
      ],
    });
  });

  it('keeps a bad number out of the draft', async () => {
    show();
    const hours = await screen.findByLabelText('Night hours for garden');
    fireEvent.change(hours, { target: { value: '99' } });
    expect(hours.getAttribute('aria-invalid')).toBe('true');
    expect(screen.queryByText(/unsaved change/)).toBeNull();
  });

  it('asks before Run now starts anything, and Cancel starts nothing', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: /garden/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Run now/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Night run' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog?.textContent).toMatch('Start the night run for garden now?');
    expect(dialog?.textContent).toMatch('$8');
    // The safe choice has focus.
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(posts()).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: /Run now/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Wrap-up' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Start wrap-up' }),
    );
    await screen.findByText('Started the wrap-up for garden.');
    expect(posts().map((c) => [c.url, JSON.parse(String(c.init!.body))])).toEqual([
      ['/api/routines/run', { routine: 'wrapup', project: 'garden' }],
    ]);
  });

  it('says how to start Routines when it is not reachable', async () => {
    state = {
      available: false,
      reason: "Routines isn't running at http://127.0.0.1:4777.",
      url: 'http://127.0.0.1:4777',
    };
    show();
    expect(await screen.findByText('Can’t reach Routines')).toBeTruthy();
    expect(screen.getByText('python3 server.py')).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('has a sidebar link', () => {
    render(
      <MemoryRouter>
        <RoutinesLink />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Routines' }).getAttribute('href')).toBe('/routines');
  });
});

describe('routine times', () => {
  it('finds the next run in the schedule’s timezone, across midnight', () => {
    const schedule = { wrapup: '00:00', nightshift: '01:00', daybreak: '07:00', timezone: 'UTC' };
    expect(nextRun(schedule, new Date('2026-10-23T14:00:00Z'))).toEqual({
      routine: 'wrapup',
      at: '00:00',
      inMinutes: 600,
    });
    expect(nextRun(schedule, new Date('2026-10-23T00:30:00Z'))?.routine).toBe('nightshift');
    expect(
      nextRun({ ...schedule, timezone: 'America/Chicago' }, new Date('2026-10-23T05:30:00Z')),
    ).toMatchObject({
      routine: 'nightshift',
      inMinutes: 30,
    });
    expect(inTime(626)).toBe('in 10 h 26 min');
    expect(runTime('2026-10-23T00:02', '2026-10-23')).toBe('00:02');
    expect(runTime('2026-10-22T00:02', '2026-10-23')).toMatch(/22.*00:02/);
  });

  it('diffs the draft against what was loaded', () => {
    const base = CONFIG();
    const draft = CONFIG();
    draft.schedule.daybreak = '06:30';
    draft.dispatch.develop!.hard = 'sonnet';
    draft.projects[1]!.hours = 2;
    expect(diffConfig(base, draft)).toEqual([
      { field: 'hours', project: 'bike', from: 3, to: 2 },
      { field: 'schedule', routine: 'daybreak', from: '07:00', to: '06:30' },
      { field: 'dispatch', kind: 'develop', level: 'hard', from: 'opus', to: 'sonnet' },
    ]);
  });
});
