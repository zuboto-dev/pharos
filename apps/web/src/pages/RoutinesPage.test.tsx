import type { Desk, DeskItem, RoutineDef, RoutinesConfig, RoutinesState } from '@pharos/schema';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RoutinesLink,
  RoutinesPage,
  band,
  deskCount,
  diffConfig,
  inOrder,
  inTime,
  nextRun,
  routineId,
  runTime,
} from './RoutinesPage';

const ROUTINES = (): RoutineDef[] => [
  {
    id: 'wrapup',
    name: 'Wrap-up',
    time: '00:00',
    enabled: true,
    skill: 'wrapup',
    instructions: 'Close the day.',
    projects: 'enrolled',
  },
  {
    id: 'nightshift',
    name: 'Night run',
    time: '01:00',
    enabled: true,
    skill: 'nightshift',
    instructions: 'Work the handoff, verified.',
    projects: 'enrolled',
  },
  {
    id: 'daybreak',
    name: 'Morning report',
    time: '07:00',
    enabled: true,
    skill: 'daybreak',
    instructions: 'Verify the night.',
    projects: 'enrolled',
  },
  {
    id: 'evening-read',
    name: 'Evening read',
    time: '18:00',
    enabled: true,
    instructions: 'Read the day’s commits.',
    projects: ['garden'],
  },
];

const CONFIG = (): RoutinesConfig & { routines: RoutineDef[] } => ({
  schedule: { wrapup: '00:00', nightshift: '01:00', daybreak: '07:00', timezone: 'UTC' },
  master: { model: 'opus', effort: 'high' },
  dispatch: { develop: { easy: 'sonnet', medium: 'sonnet', hard: 'opus' } },
  cleanup: { level: 2, scratch_days: 7 },
  routines: ROUTINES(),
  projects: [
    { name: 'garden', path: '/tmp/garden', enrolled: true, budget_usd: 8, hours: 4 },
    { name: 'bike', path: '/tmp/bike', enrolled: false, budget_usd: 5, hours: 3 },
  ],
});

const STATE = (editable = true): RoutinesState => ({
  available: true,
  editable,
  url: 'http://127.0.0.1:4777',
  now: '2026-10-23T14:00',
  config: CONFIG(),
  pharos: {
    garden: {
      projects: [
        { id: 'prj_g', name: 'Garden' },
        { id: 'prj_g2', name: 'Garden · Beds' },
      ],
      reports: [{ routine: 'nightshift', name: 'Night run', href: '/projects/prj_g/views/view_n' }],
    },
    bike: { projects: [{ id: 'prj_b', name: 'Bike' }], reports: [] },
  },
  status: [
    {
      name: 'garden',
      exists: true,
      git: { dirty: 2, head: 'abc123 fix the hose', ahead: '3' },
      queue: { auto: 1, review: 2, needs_you: 9, ship: 'beans by 2026-11-01' },
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
    { name: 'bike', exists: true, runs: {} },
  ],
});

const item = (id: string, projectId: string, extra: Partial<DeskItem> = {}): DeskItem => ({
  id,
  kind: 'decision',
  projectId,
  title: id,
  since: '2026-10-23T10:00:00Z',
  overdue: false,
  old: false,
  gate: false,
  href: '/',
  ...extra,
});

const DESK: Desk = {
  // Garden 2 (+1 in its sub-project), bike 1; a run and an old item don't count.
  items: [
    item('a', 'prj_g'),
    item('b', 'prj_g'),
    item('c', 'prj_g2'),
    item('d', 'prj_b'),
    item('e', 'prj_g', { old: true }),
    item('f', 'prj_g', { kind: 'run' }),
    item('g', 'prj_other'),
  ],
  minutes: 0,
  overdue: 0,
  old: 1,
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
const savedChanges = () =>
  (
    JSON.parse(String(posts().find((c) => c.url === '/api/routines/save')!.init!.body)) as {
      changes: unknown[];
    }
  ).changes;
const line = (name: string) =>
  document.querySelector(`[data-project-line="${name}"]`) as HTMLElement;
const description = (el: HTMLElement) =>
  document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent ?? '';
const openGarden = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'garden' }));
  return document.querySelector('[data-project-detail="garden"]') as HTMLElement;
};
const saveAll = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Save…' }));
  const dialog = screen.getByRole('dialog');
  const listed = [...dialog.querySelectorAll('[data-save-list] li')].map((li) => li.textContent);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
  await screen.findByText(/Saved: /);
  return listed;
};

describe('the Routines page', () => {
  it('draws tonight as evenly spaced routines in the order they run', async () => {
    show();
    await screen.findByRole('button', { name: 'garden' });
    const nodes = [...document.querySelectorAll<HTMLElement>('[data-node]')];
    expect(nodes.map((n) => n.getAttribute('data-node'))).toEqual([
      'evening-read',
      'wrapup',
      'nightshift',
      'daybreak',
    ]);
    const lefts = nodes.map((n) => n.closest<HTMLElement>('[role="listitem"]')!.style.left);
    expect(lefts).toEqual(['12.5%', '37.5%', '62.5%', '87.5%']);
    // Now (it varies) marks one node as next.
    expect(document.querySelectorAll('[data-next]').length).toBe(1);
    expect(document.querySelector('[data-now]')).toBeTruthy();
    // No header links to central pages any more.
    expect(screen.queryByText('Morning')).toBeNull();
  });

  it('says on hover what a routine does and how it last went', async () => {
    show();
    const node = await screen.findByRole('button', { name: 'Night run at 01:00. Edit' });
    expect(description(node)).toMatch('Work the handoff, verified.');
    expect(description(node)).toMatch('Last: 1 failed.');
    const custom = screen.getByRole('button', { name: 'Evening read at 18:00. Edit' });
    expect(description(custom)).toMatch('Read the day’s commits.');
  });

  it('counts what needs you as the desk does, and opens the desk on exactly those projects', async () => {
    show();
    await screen.findByRole('button', { name: 'garden' });
    const count = await within(line('garden')).findByRole('link');
    // Garden's folder holds two Pharos projects: 2 + 1, not the 9 in NEXT.md.
    expect(count.textContent).toBe('3');
    expect(count.getAttribute('href')).toBe('/desk?project=prj_g,prj_g2');
    // The total covers enrolled projects only (bike is parked).
    const total = document.querySelector('[data-needs-total]')!;
    expect(total.textContent).toBe('3 need you');
    fireEvent.click(screen.getByRole('button', { name: /Parked/ }));
    expect(within(line('bike')).getByRole('link').getAttribute('href')).toBe('/desk?project=prj_b');
  });

  it('shows one dot per routine a project is in, and opens its log on click', async () => {
    show();
    await screen.findByRole('button', { name: 'garden' });
    const looks = [...line('garden').querySelectorAll('[data-run-dot]')].map((d) => [
      d.getAttribute('data-run-dot'),
      d.getAttribute('data-look'),
    ]);
    expect(looks).toEqual([
      ['evening-read', 'never'],
      ['wrapup', 'ok'],
      ['nightshift', 'error'],
      ['daybreak', 'never'],
    ]);
    fireEvent.click(screen.getByRole('button', { name: /Parked/ }));
    // Bike isn't in the custom routine (only garden) nor enrolled: no dots.
    expect(line('bike').querySelectorAll('[data-run-dot]').length).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Night run · garden: failed, 01:09' }));
    expect(await screen.findByText('the whole log')).toBeTruthy();
    expect(screen.queryByText(/SECRET TAIL TEXT/)).toBeNull();
  });

  it('opens a project to a few facts with last night’s report, and edits the budget', async () => {
    show();
    const detail = await openGarden();
    expect(within(detail).getByText('beans by 2026-11-01')).toBeTruthy();
    expect(detail.querySelector('[data-night]')?.textContent).toMatch('3 done1 failed2 unverified');
    expect(detail.querySelector('[data-report-link]')?.getAttribute('href')).toBe(
      '/projects/prj_g/views/view_n',
    );
    expect(within(detail).getByText('3 items')).toBeTruthy();
    fireEvent.click(within(detail).getByRole('button', { name: /Night budget for garden/ }));
    fireEvent.change(within(detail).getByLabelText('Night budget in dollars for garden'), {
      target: { value: '10' },
    });
    expect(await saveAll()).toEqual(['garden: night budget $8 → $10']);
    expect((posts()[0]!.init!.headers as Record<string, string>)['x-pharos-author']).toBe(
      'human:me',
    );
    expect(savedChanges()).toEqual([{ field: 'budget_usd', project: 'garden', from: 8, to: 10 }]);
  });

  it('adds a routine in the owner’s words, saved after confirming', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Add a routine' }));
    const form = screen.getByRole('dialog');
    const add = within(form).getByRole('button', { name: 'Add' }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.change(within(form).getByPlaceholderText('Weekly review'), {
      target: { value: 'Weekly review' },
    });
    fireEvent.change(within(form).getByLabelText('Time'), { target: { value: '17:30' } });
    fireEvent.change(within(form).getByPlaceholderText(/In your words/), {
      target: { value: 'List what slipped this week.' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Only some' }));
    fireEvent.click(within(form).getByRole('button', { name: 'garden' }));
    fireEvent.click(add);
    expect(screen.getByText('1 unsaved change')).toBeTruthy();
    expect(document.querySelector('[data-node="weekly-review"]')).toBeTruthy();
    expect(await saveAll()).toEqual(['New routine “Weekly review” at 17:30 for garden']);
    expect(savedChanges()).toEqual([
      {
        field: 'routine',
        id: 'weekly-review',
        from: null,
        to: {
          id: 'weekly-review',
          name: 'Weekly review',
          time: '17:30',
          enabled: true,
          instructions: 'List what slipped this week.',
          projects: ['garden'],
        },
      },
    ]);
  });

  it('changes a routine on click of its node, and removes one after asking', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Night run at 01:00. Edit' }));
    let form = screen.getByRole('dialog');
    fireEvent.change(within(form).getByLabelText('Time'), { target: { value: '02:00' } });
    fireEvent.click(within(form).getByRole('switch', { name: 'Runs every day' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Done' }));

    fireEvent.click(screen.getByRole('button', { name: 'Evening read at 18:00. Edit' }));
    form = screen.getByRole('dialog');
    fireEvent.click(within(form).getByRole('button', { name: 'Remove this routine' }));
    const ask = screen.getByRole('dialog');
    expect(ask.textContent).toMatch('Remove “Evening read”?');
    fireEvent.click(within(ask).getByRole('button', { name: 'Remove' }));
    expect(document.querySelector('[data-node="evening-read"]')).toBeNull();

    expect(await saveAll()).toEqual([
      'Night run: at 01:00 → 02:00, off',
      'Remove the routine “Evening read”',
    ]);
    const [night, removed] = savedChanges() as { from: RoutineDef; to: RoutineDef | null }[];
    expect(night!.from.time).toBe('01:00');
    expect(night!.to).toMatchObject({ time: '02:00', enabled: false, skill: 'nightshift' });
    expect(removed!.to).toBeNull();
  });

  it('with an older Routines app: no adding, times saved as the schedule', async () => {
    state = STATE(false);
    show();
    await screen.findByRole('button', { name: 'garden' });
    expect(screen.queryByRole('button', { name: 'Add a routine' })).toBeNull();
    expect(document.querySelector('[data-old-routines]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Morning report at 07:00. Edit' }));
    const form = screen.getByRole('dialog');
    expect((within(form).getByPlaceholderText('Weekly review') as HTMLInputElement).disabled).toBe(
      true,
    );
    expect(within(form).queryByRole('button', { name: 'Remove this routine' })).toBeNull();
    fireEvent.change(within(form).getByLabelText('Time'), { target: { value: '06:30' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Done' }));
    await saveAll();
    expect(savedChanges()).toEqual([
      { field: 'schedule', routine: 'daybreak', from: '07:00', to: '06:30' },
    ]);
  });

  it('runs from the ⋯ menu only after asking, and Cancel starts nothing', async () => {
    show();
    await openGarden();
    fireEvent.click(screen.getByRole('button', { name: 'Options for garden' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Night run' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toMatch('Start Night run for garden now?');
    expect(dialog.textContent).toMatch('$8');
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(posts()).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Options for garden' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Evening read' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Start evening read' }),
    );
    await screen.findByText('Started Evening read for garden');
    expect(posts().map((c) => [c.url, JSON.parse(String(c.init!.body))])).toEqual([
      ['/api/routines/run', { routine: 'evening-read', project: 'garden' }],
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

  it('keeps how it runs folded, with cleanup and models to edit on click', async () => {
    show();
    const toggle = await screen.findByRole('button', { name: 'How it runs' });
    expect(document.querySelector('[data-how]')).toBeNull();
    fireEvent.click(toggle);
    expect(document.querySelector('[data-cleanup-level="2"]')?.textContent).toMatch(
      'Level 2 · Tidy',
    );
    expect(document.querySelector('[data-model="develop-hard"]')?.textContent).toBe('opus');
    fireEvent.click(screen.getByRole('button', { name: 'Edit models' }));
    expect(document.querySelector('[data-model]')).toBeNull();
  });

  it('says what the run dots mean', async () => {
    show();
    const legend = await screen.findByRole('list', { name: 'What the dots mean' });
    expect(legend.textContent).toContain('failed');
    expect(legend.textContent).toContain('never ran');
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

describe('routine helpers', () => {
  it('finds the next enabled routine in the timezone, across midnight', () => {
    const list = ROUTINES();
    expect(nextRun(list, 'UTC', new Date('2026-10-23T14:00:00Z'))).toMatchObject({
      routine: { id: 'evening-read' },
      inMinutes: 240,
    });
    list[3]!.enabled = false;
    expect(nextRun(list, 'UTC', new Date('2026-10-23T14:00:00Z'))?.routine.id).toBe('wrapup');
    expect(nextRun(list, 'America/Chicago', new Date('2026-10-23T05:30:00Z'))).toMatchObject({
      routine: { id: 'nightshift' },
      inMinutes: 30,
    });
    expect(inTime(626)).toBe('in 10 h 26 min');
    expect(runTime('2026-10-23T00:02', '2026-10-23')).toBe('00:02');
  });

  it('orders from noon and spaces evenly, with now between the routines around it', () => {
    expect(inOrder(ROUTINES()).map((r) => r.time)).toEqual(['18:00', '00:00', '01:00', '07:00']);
    const line = band(['00:00', '01:00', '07:00']);
    expect(line.xs.map((x) => x.toFixed(3))).toEqual(['0.167', '0.500', '0.833']);
    // 04:00 is half way between 01:00 and 07:00.
    expect(line.at(4 * 60)).toBeCloseTo((0.5 + 0.833) / 2, 2);
    expect(line.at(0)).toBeCloseTo(0.167, 2);
    expect(line.at(14 * 60)).toBeLessThan(0.167);
  });

  it('makes ids from names and counts desk items as the desk does', () => {
    expect(routineId('Weekly review!', ['weekly-review'])).toBe('weekly-review-2');
    expect(routineId('   ', [])).toBe('routine');
    expect(deskCount(DESK.items, ['prj_g', 'prj_g2'])).toBe(3);
    expect(deskCount(DESK.items, [])).toBe(0);
  });

  it('diffs the draft against what was loaded', () => {
    const base = CONFIG();
    const draft = CONFIG();
    draft.dispatch.develop!.hard = 'sonnet';
    draft.projects[1]!.hours = 2;
    draft.routines[2]!.time = '06:30';
    expect(diffConfig(base, draft)).toEqual([
      { field: 'hours', project: 'bike', from: 3, to: 2 },
      {
        field: 'routine',
        id: 'daybreak',
        from: base.routines[2],
        to: draft.routines[2],
      },
      { field: 'dispatch', kind: 'develop', level: 'hard', from: 'opus', to: 'sonnet' },
    ]);
  });
});
