import type { Desk, RoutinesConfig, RoutinesState } from '@pharos/schema';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RoutinesLink,
  RoutinesPage,
  diffConfig,
  inTime,
  nextRun,
  runTime,
  timeline,
} from './RoutinesPage';

const CONFIG = (): RoutinesConfig => ({
  schedule: { wrapup: '00:00', nightshift: '01:00', daybreak: '07:00', timezone: 'UTC' },
  master: { model: 'opus', effort: 'high' },
  dispatch: { develop: { easy: 'sonnet', medium: 'sonnet', hard: 'opus' } },
  cleanup: { level: 2, scratch_days: 7 },
  projects: [
    {
      name: 'garden',
      path: '/tmp/garden',
      enrolled: true,
      budget_usd: 8,
      hours: 4,
      pm: { type: 'pharos', project: 'prj_g' },
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
          tail: 'SECRET TAIL TEXT',
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

const DESK: Desk = {
  items: [],
  minutes: 0,
  overdue: 0,
  old: 0,
  runs: [
    {
      id: 'run_1',
      projectId: 'prj_g',
      kind: 'night',
      name: 'Night run · garden',
      agent: 'Routines',
      startedAt: '2026-10-23T06:00:00Z',
      endedAt: '2026-10-23T07:00:00Z',
      outcome: 'partial',
      summary: 'Two slices landed',
      counts: { done: 3, failed: 1, unverified: 2 },
    },
  ],
};

type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];
let state: RoutinesState;

beforeEach(() => {
  calls = [];
  state = STATE();
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url === '/api/routines/state') return Response.json(state);
    if (url === '/api/desk') return Response.json(DESK);
    if (url.startsWith('/api/routines/log'))
      return Response.json({ file: 'x', text: 'the whole log' });
    if (url === '/api/routines/save') {
      const body = JSON.parse(String(init?.body)) as { changes: unknown[] };
      return Response.json({ ok: true, saved: body.changes.map(() => 'saved it') });
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
const line = (name: string) =>
  document.querySelector(`[data-project-line="${name}"]`) as HTMLElement;
const openGarden = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'garden' }));
  return document.querySelector('[data-project-detail="garden"]') as HTMLElement;
};

describe('the Routines page', () => {
  it('leads with one headline and a quiet line per project, details hidden', async () => {
    show();
    await screen.findByRole('button', { name: 'garden' });
    const headline = document.querySelector('[data-headline]')!.textContent!;
    expect(headline).toMatch('Tonight:');
    expect(headline).toMatch('wrap-up 00:00');
    expect(headline).toMatch('night 01:00');
    expect(headline).toMatch('morning 07:00');
    expect(headline).toMatch('1 project');
    expect(headline).toMatch('3 need you');
    // Three dots, one per routine, coloured by the last result.
    const dots = [...line('garden').querySelectorAll('[data-run-dot]')].map((d) =>
      d.getAttribute('data-look'),
    );
    expect(dots).toEqual(['ok', 'error', 'never']);
    // Needs-you count links to the desk on that project.
    expect(within(line('garden')).getByRole('link').getAttribute('href')).toBe(
      '/desk?project=prj_g',
    );
    // Parked projects fold into one line.
    expect(line('bike')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Parked/ }));
    expect(line('bike')).toBeTruthy();
    // No controls or file text on the rows.
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('spinbutton')).toBeNull();
    expect(screen.queryByText(/Run now/)).toBeNull();
    expect(screen.queryByText(/SECRET TAIL TEXT|NEXT · garden/)).toBeNull();
    expect(document.querySelector('[data-page-link="morning"]')?.getAttribute('href')).toBe(
      '/projects/prj_r/views/view_m',
    );
    expect(posts()).toEqual([]);
  });

  it('names each dot for hover and opens its log on click', async () => {
    show();
    const dot = await screen.findByRole('button', {
      name: 'Night run · garden: failed, 01:09',
    });
    fireEvent.click(dot);
    expect(await screen.findByText('the whole log')).toBeTruthy();
    expect(
      calls.some((c) => c.url === '/api/routines/log?file=2026-10-23-garden-nightshift.log'),
    ).toBe(true);
  });

  it('opens a project to a few facts, and edits the budget on click', async () => {
    show();
    const detail = await openGarden();
    expect(within(detail).getByText('beans by 2026-11-01')).toBeTruthy();
    expect(detail.querySelector('[data-night]')?.textContent).toMatch('3 done1 failed2 unverified');
    expect(within(detail).getByText('3 items')).toBeTruthy();
    expect(detail.querySelector('[data-repo]')?.textContent).toBe('2 changed · 3 ahead');
    fireEvent.click(within(detail).getByRole('button', { name: /Night budget for garden/ }));
    fireEvent.change(within(detail).getByLabelText('Night budget in dollars for garden'), {
      target: { value: '10' },
    });
    expect(screen.getByText('1 unsaved change')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save…' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('garden: night budget $8 → $10')).toBeTruthy();
    expect(posts()).toEqual([]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await screen.findByText(/Saved: saved it/);
    const [save] = posts();
    expect(save!.url).toBe('/api/routines/save');
    expect((save!.init!.headers as Record<string, string>)['x-pharos-author']).toBe('human:me');
    expect(JSON.parse(String(save!.init!.body))).toEqual({
      changes: [{ field: 'budget_usd', project: 'garden', from: 8, to: 10 }],
    });
  });

  it('keeps a bad number out of the draft', async () => {
    show();
    const detail = await openGarden();
    fireEvent.click(within(detail).getByRole('button', { name: /Night budget for garden/ }));
    const hours = within(detail).getByLabelText('Night hours for garden');
    fireEvent.change(hours, { target: { value: '99' } });
    expect(hours.getAttribute('aria-invalid')).toBe('true');
    expect(screen.queryByText(/unsaved change/)).toBeNull();
  });

  it('runs from the ⋯ menu only after asking, and Cancel starts nothing', async () => {
    show();
    await openGarden();
    fireEvent.click(screen.getByRole('button', { name: 'Options for garden' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Night run' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toMatch('Start the night run for garden now?');
    expect(dialog.textContent).toMatch('$8');
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(posts()).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Options for garden' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Wrap-up' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Start wrap-up' }),
    );
    await screen.findByText('Started the wrap-up for garden');
    expect(posts().map((c) => [c.url, JSON.parse(String(c.init!.body))])).toEqual([
      ['/api/routines/run', { routine: 'wrapup', project: 'garden' }],
    ]);
  });

  it('pauses a project from the ⋯ menu as an unsaved change', async () => {
    show();
    await openGarden();
    fireEvent.click(screen.getByRole('button', { name: 'Options for garden' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Pause/ }));
    expect(screen.getByText('1 unsaved change')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Parked \(2\)/ })).toBeTruthy();
  });

  it('keeps how it runs folded, with time chips, cleanup and models to edit on click', async () => {
    show();
    const toggle = await screen.findByRole('button', { name: 'How it runs' });
    expect(document.querySelector('[data-how]')).toBeNull();
    fireEvent.click(toggle);
    expect(document.querySelector('[data-cleanup-level="2"]')?.textContent).toMatch(
      'Level 2 · Tidy',
    );
    expect(document.querySelector('[data-model="develop-hard"]')?.textContent).toBe('opus');
    fireEvent.click(screen.getByRole('button', { name: 'Morning report at 07:00. Change' }));
    fireEvent.change(screen.getByLabelText('Morning report time'), {
      target: { value: '06:30' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit models' }));
    expect(document.querySelector('[data-model]')).toBeNull();
    expect(screen.getByText('1 unsaved change')).toBeTruthy();
  });

  it('says how to start Routines when it is not reachable', async () => {
    state = {
      available: false,
      reason: "Routines isn't running at http://127.0.0.1:4777.",
      url: 'http://127.0.0.1:4777',
    };
    show();
    expect(await screen.findByText('Routines isn’t answering')).toBeTruthy();
    expect(screen.getByText('python3 server.py')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
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
    ).toMatchObject({ routine: 'nightshift', inMinutes: 30 });
    expect(inTime(626)).toBe('in 10 h 26 min');
    expect(runTime('2026-10-23T00:02', '2026-10-23')).toBe('00:02');
    expect(runTime('2026-10-22T00:02', '2026-10-23')).toMatch(/22.*00:02/);
  });

  it('places tonight in order on the timeline, never too close, now between the marks', () => {
    const line = timeline({ wrapup: '00:00', nightshift: '01:00', daybreak: '07:00' });
    const [a, b, c] = line.marks.map((m) => m.x);
    expect(a! < b! && b! < c! && c! <= 1).toBe(true);
    expect(b! - a!).toBeGreaterThanOrEqual(0.15);
    const now = line.at(4 * 60)!;
    expect(now > b! && now < c!).toBe(true);
    expect(line.at(14 * 60)).toBeNull();
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
