import type { Desk, DeskItem, RoutineDef, RoutinesConfig, RoutinesState } from '@pharos/schema';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import {
  RoutinesLink,
  RoutinesPage,
  arrangeRows,
  band,
  entryFor,
  deskCount,
  diffConfig,
  inOrder,
  inTime,
  nextRun,
  routineId,
  runTime,
  minutesUntil,
  runsTonight,
  DRAFT_KEY,
  progressOf,
  withOpenRuns,
  currentLine,
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
/** Set to make the next saves fail as Routines would refuse them. */
let saveError: string | null = null;

beforeEach(() => {
  calls = [];
  saveError = null;
  localStorage.clear();
  state = STATE();
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url === '/api/routines/state') return Response.json(state);
    if (url === '/api/desk') return Response.json(DESK);
    if (url.startsWith('/api/routines/log'))
      return Response.json({ file: 'x', text: 'the whole log' });
    if (url === '/api/routines/save') {
      if (saveError)
        return Response.json({ error: { code: 'conflict', message: saveError } }, { status: 409 });
      const body = JSON.parse(String(init?.body)) as { changes: Record<string, unknown>[] };
      // Like Routines: the next state has the saved projects (a fresh copy, so React sees it).
      if (state.available) {
        const config = structuredClone(state.config);
        for (const ch of body.changes) {
          if (ch.field === 'enrolled') {
            const project = config.projects.find((x) => x.name === ch.project);
            if (project) project.enrolled = ch.to as boolean;
          }
          if (ch.field === 'project') {
            config.projects = config.projects.filter((x) => x.name !== ch.name);
            if (ch.to) config.projects.push(ch.to as RoutinesConfig['projects'][number]);
          }
        }
        state = { ...state, config };
      }
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
    // The "now" dot shows only while tonight is under way: pin the clock inside tonight.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-23T23:30:00-05:00'));
    onTestFinished(() => vi.useRealTimers());
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

  it('pauses a project at once: saved, the row moves, Undo saves it back', async () => {
    show();
    await openGarden();
    fireEvent.click(screen.getByRole('button', { name: 'Options for garden' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Pause/ }));
    const toast = await screen.findByText('garden paused');
    expect(savedChanges()).toEqual([
      { field: 'enrolled', project: 'garden', from: true, to: false },
    ]);
    // No Save bar for it, and garden is under Parked now.
    expect(screen.queryByText(/unsaved change/)).toBeNull();
    expect(screen.getByRole('button', { name: /Parked \(2\)/ })).toBeTruthy();
    expect(line('garden')).toBeNull();
    // A reload is asked for after the save.
    expect(calls.filter((c) => c.url === '/api/routines/state').length).toBeGreaterThan(1);

    fireEvent.click(
      within(toast.closest('[data-toast]') as HTMLElement).getByRole('button', { name: 'Undo' }),
    );
    await screen.findByText('garden enrolled again');
    const saves = posts().filter((c) => c.url === '/api/routines/save');
    expect(JSON.parse(String(saves[1]!.init!.body))).toEqual({
      changes: [{ field: 'enrolled', project: 'garden', from: false, to: true }],
    });
    expect(line('garden')).toBeTruthy();
  });

  it('enrolls a parked project at once, and leaves it parked when the save fails', async () => {
    saveError = 'routines.json changed since the page loaded. Reload and try again.';
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Parked \(1\)/ }));
    fireEvent.click(screen.getByRole('button', { name: 'bike' }));
    fireEvent.click(screen.getByRole('button', { name: 'Options for bike' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Enroll in the routines' }));
    expect(await screen.findByText(/routines.json changed since the page loaded/)).toBeTruthy();
    expect(screen.queryByText('bike enrolled')).toBeNull();
    expect(screen.getByRole('button', { name: /Parked \(1\)/ })).toBeTruthy();

    saveError = null;
    fireEvent.click(screen.getByRole('button', { name: 'Options for bike' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Enroll in the routines' }));
    await screen.findByText('bike enrolled');
    expect(savedChanges()).toEqual([{ field: 'enrolled', project: 'bike', from: false, to: true }]);
    // Its row is with the enrolled ones now, and Parked is gone.
    expect(screen.queryByRole('button', { name: /Parked/ })).toBeNull();
    expect(line('bike')).toBeTruthy();
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

describe('rows follow Pharos’s folders', () => {
  const folders = [
    {
      id: 'repo_g',
      name: 'Garden',
      path: '/tmp/garden/',
      project: { id: 'prj_g', name: 'Garden' },
    },
    { id: 'repo_k', name: 'Kiln', path: '/tmp/kiln', project: { id: 'prj_k', name: 'Kiln' } },
  ];

  it('merges routines.json with the folders: rows, parked, not in Routines, not in Pharos', () => {
    const projects = [
      ...CONFIG().projects,
      { name: 'gone', path: '/tmp/gone', enrolled: true, budget_usd: 8, hours: 4 },
    ];
    // bike's folder is in Pharos too.
    const all = [...folders, { id: 'repo_b', name: 'Bike', path: '/tmp/bike' }];
    const rows = arrangeRows(projects, all);
    expect(rows.active.map((p) => p.name)).toEqual(['garden']);
    expect(
      rows.parked.map((r) => [
        r.kind,
        r.kind === 'not-in-routines' ? r.folder.name : r.project.name,
      ]),
    ).toEqual([
      ['parked', 'bike'],
      ['not-in-routines', 'Kiln'],
      ['not-in-pharos', 'gone'],
    ]);
    // A server with no folders: routines.json alone, as before.
    expect(arrangeRows(projects, undefined).active.map((p) => p.name)).toEqual(['garden', 'gone']);
  });

  it('makes a routines.json entry for a folder like the others', () => {
    const projects = [
      ...CONFIG().projects,
      { name: 'kiln', path: '/elsewhere', enrolled: false, budget_usd: 8, hours: 4 },
    ];
    expect(entryFor(folders[1]!, projects)).toEqual({
      name: 'kiln-2',
      path: '/tmp/kiln',
      enrolled: true,
      budget_usd: 8,
      hours: 4,
      pm: { type: 'pharos', project: 'prj_k' },
    });
    expect(entryFor({ id: 'r', name: 'Bare', path: '/x/Bare' }, []).pm).toBeNull();
  });

  it('enrolls a new folder and removes a project Pharos no longer has, after confirming', async () => {
    state = {
      ...STATE(),
      folders: [folders[0]!, folders[1]!],
    } as RoutinesState;
    // bike has no folder now: not in Pharos.
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Parked \(2\)/ }));
    expect(screen.getByText('Not in Routines yet')).toBeTruthy();
    expect(line('bike').getAttribute('data-missing')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Options for Kiln' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Enroll in the routines' }));
    // Saved at once: a row of its own (enrolled).
    await screen.findByText('kiln enrolled');
    expect(line('kiln')).toBeTruthy();
    const [enrolled] = savedChanges() as { from: unknown; to: unknown }[];
    expect(enrolled).toMatchObject({
      field: 'project',
      name: 'kiln',
      from: null,
      to: { path: '/tmp/kiln', pm: { type: 'pharos', project: 'prj_k' } },
    });
    calls = [];

    fireEvent.click(screen.getByRole('button', { name: /^bike/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Options for bike' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove from Routines' }));
    const ask = screen.getByRole('dialog');
    expect(ask.textContent).toMatch('its folder and files stay');
    fireEvent.click(within(ask).getByRole('button', { name: 'Remove' }));

    expect(await saveAll()).toEqual(['Remove bike from the routines (its folder and files stay)']);
    const [removed] = savedChanges() as { from: unknown; to: unknown }[];
    expect(removed).toMatchObject({ field: 'project', name: 'bike', to: null });
  });
});

describe('days of the week', () => {
  it('counts only the days a routine runs', () => {
    // Tuesday 14:00 UTC: a Fridays-only 17:00 routine is 3 days and 3 hours away.
    const tue = new Date('2026-10-20T14:00:00Z');
    const weekly = { time: '17:00', days: ['fri' as const] };
    expect(minutesUntil(weekly, 'UTC', tue)).toBe(3 * 1440 + 180);
    expect(runsTonight(weekly, 'UTC', tue)).toBe(false);
    expect(runsTonight(weekly, 'UTC', new Date('2026-10-23T14:00:00Z'))).toBe(true);
    // 00:30 runs after midnight: on a Friday evening the next one is Saturday's.
    const late = { time: '00:30', days: ['sat' as const] };
    expect(runsTonight(late, 'UTC', new Date('2026-10-23T20:00:00Z'))).toBe(true);
    expect(minutesUntil({ time: '17:00' }, 'UTC', tue)).toBe(180);
    // The next run skips a routine whose day isn't tonight.
    const list = [
      { id: 'a', time: '15:00', enabled: true, days: ['fri' as const] },
      { id: 'b', time: '18:00', enabled: true },
    ];
    expect(nextRun(list, 'UTC', tue)?.routine.id).toBe('b');
    expect(inTime(3 * 1440 + 180)).toBe('in 3 d 3 h');
  });

  it('draws a routine that skips tonight faint, and says so on hover', async () => {
    const off = (['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const).find(
      (d) => !runsTonight({ time: '18:00', days: [d] }, 'UTC'),
    )!;
    state = STATE();
    if (state.available) state.config.routines[3]!.days = [off];
    show();
    const node = await screen.findByRole('button', { name: 'Evening read at 18:00. Edit' });
    expect(node.getAttribute('data-skips')).toBe('true');
    expect(node.getAttribute('data-next')).toBeNull();
    expect(description(node)).toMatch(/^Not tonight \(\w{3} only\)\./);
  });

  it('picks days in the form, saved after confirming', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Evening read at 18:00. Edit' }));
    const form = screen.getByRole('dialog');
    fireEvent.click(within(form).getByRole('button', { name: 'Pick days' }));
    const done = within(form).getByRole('button', { name: 'Done' }) as HTMLButtonElement;
    expect(done.disabled).toBe(true);
    fireEvent.click(within(form).getByRole('button', { name: 'fri' }));
    fireEvent.click(done);
    expect(await saveAll()).toEqual(['Evening read: every day → Fridays']);
    const [change] = savedChanges() as { to: RoutineDef }[];
    expect(change!.to.days).toEqual(['fri']);

    // Weekdays on a new one; Every day leaves days out.
    fireEvent.click(screen.getByRole('button', { name: 'Add a routine' }));
    const add = screen.getByRole('dialog');
    fireEvent.change(within(add).getByPlaceholderText('Weekly review'), {
      target: { value: 'Standup notes' },
    });
    fireEvent.change(within(add).getByPlaceholderText(/In your words/), {
      target: { value: 'Summarize yesterday.' },
    });
    fireEvent.click(within(add).getByRole('button', { name: 'Weekdays' }));
    fireEvent.click(within(add).getByRole('button', { name: 'Add' }));
    expect(screen.getByText('1 unsaved change')).toBeTruthy();
  });
});

describe('routines agents propose', () => {
  const proposal = {
    decisionId: 'dec_1',
    href: '/projects/prj_g?decision=dec_1',
    proposedBy: 'Claude Code',
    proposal: {
      name: 'Weekly review',
      time: '17:00',
      days: ['fri' as const],
      instructions: 'Read the week.',
      projects: ['garden'],
      reason: 'You asked for it.',
    },
  };

  it('lists them at the top with Add and Not now, answered as the owner', async () => {
    state = { ...STATE(), proposals: [proposal] } as RoutinesState;
    show();
    const row = await screen.findByText('Proposed by Claude Code:');
    const card = row.closest('[data-proposal]') as HTMLElement;
    expect(card.textContent).toMatch('Weekly review · Fri only 17:00');
    fireEvent.click(within(card).getByRole('button', { name: 'Add' }));
    await new Promise((r) => setTimeout(r, 0));
    fireEvent.click(within(card).getByRole('button', { name: 'Not now' }));
    await new Promise((r) => setTimeout(r, 0));
    const answers = calls.filter((c) => c.url === '/api/desk/answer');
    expect(answers.map((c) => JSON.parse(String(c.init!.body)))).toEqual([
      { id: 'dec_1', chosenOptionId: 'add' },
      { id: 'dec_1', chosenOptionId: 'not-now' },
    ]);
    expect((answers[0]!.init!.headers as Record<string, string>)['x-pharos-author']).toBe(
      'human:me',
    );
  });
});

describe('a routine at work', () => {
  const running = () => {
    const st = STATE();
    if (!st.available) throw new Error('unavailable');
    st.config.projects[1]!.enrolled = true; // bike too: the night run covers 2 projects
    const stamp = new Date(Date.now() - 12 * 60_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const when = `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())}T${pad(stamp.getHours())}:${pad(stamp.getMinutes())}`;
    const day = when.slice(0, 10);
    st.status[0]!.runs!.nightshift = {
      file: `${day}-garden-nightshift.log`,
      when,
      status: 'running',
      tail: '',
    };
    st.status[1]!.runs = {
      nightshift: { file: `${day}-bike-nightshift.log`, when, status: 'ok', tail: '' },
    };
    return st;
  };

  it('counts projects done in this run, and adds runs Pharos has open', () => {
    const st = running();
    if (!st.available) return;
    const status = withOpenRuns(st.status, st.config.routines, []);
    const night = st.config.routines.find((r) => r.id === 'nightshift')!;
    expect(progressOf(night, st.config.projects, status)).toMatchObject({
      running: true,
      done: 1,
      total: 2,
    });
    const wrapup = st.config.routines.find((r) => r.id === 'wrapup')!;
    expect(progressOf(wrapup, st.config.projects, status).running).toBe(false);
    // The run log says the wrap-up runs for bike: shown running too.
    const open = withOpenRuns(st.status, st.config.routines, [
      {
        id: 'run_9',
        kind: 'routine',
        name: 'Wrap-up · bike',
        agent: 'Routines',
        startedAt: new Date().toISOString(),
        outcome: 'running',
      },
    ]);
    expect(open.get('bike')!.runs!.wrapup!.status).toBe('running');
    expect(progressOf(wrapup, st.config.projects, open)).toMatchObject({ running: true, total: 2 });
  });

  it('spins the node with its progress, says so in the headline, and on the dot', async () => {
    state = running();
    show();
    const node = await screen.findByRole('button', { name: 'Night run at 01:00. Edit' });
    expect(node.getAttribute('data-running')).toBe('true');
    const item = node.closest('[role="listitem"]')!;
    expect(item.querySelector('[data-running-ring]')).toBeTruthy();
    expect(item.querySelector('[data-progress]')!.textContent).toBe('Running · 1 of 2');
    expect(document.querySelector('[data-running-line="nightshift"]')!.textContent).toBe(
      'Night run is running · 1 of 2',
    );
    expect(description(node)).toMatch(/^Running for 1[1-3] min: 1 of 2 projects done\./);
    expect(
      screen.getByRole('button', { name: /Night run · garden: running 1[1-3] min/ }),
    ).toBeTruthy();
  });

  it('looks again every 10 seconds while something runs', async () => {
    const timers = vi.spyOn(window, 'setInterval');
    try {
      state = running();
      show();
      await screen.findByRole('button', { name: 'Night run at 01:00. Edit' });
      await waitFor(() => expect(timers.mock.calls.some(([, ms]) => ms === 10_000)).toBe(true));
    } finally {
      timers.mockRestore();
    }
  });

  it('looks every 30 seconds when nothing runs', async () => {
    const timers = vi.spyOn(window, 'setInterval');
    try {
      show();
      await screen.findByRole('button', { name: 'garden' });
      expect(timers.mock.calls.some(([, ms]) => ms === 30_000)).toBe(true);
      expect(timers.mock.calls.some(([, ms]) => ms === 10_000)).toBe(false);
    } finally {
      timers.mockRestore();
    }
  });
});

describe('unsaved edits survive', () => {
  it('keeps them in this browser and restores them on the next load', async () => {
    const first = show();
    const detail = await openGarden();
    fireEvent.click(within(detail).getByRole('button', { name: /Night budget for garden/ }));
    fireEvent.change(within(detail).getByLabelText('Night budget in dollars for garden'), {
      target: { value: '12' },
    });
    expect(JSON.parse(localStorage.getItem(DRAFT_KEY)!)).toEqual([
      { field: 'budget_usd', project: 'garden', from: 8, to: 12 },
    ]);
    first.unmount();
    show();
    expect(await screen.findByText('Unsaved changes restored')).toBeTruthy();
    expect(screen.getByText('1 unsaved change')).toBeTruthy();
    expect(await saveAll()).toEqual(['garden: night budget $8 → $10'.replace('10', '12')]);
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('when routines.json changed meanwhile, keeps the edits and asks only about real conflicts', async () => {
    show();
    // Two edits: the night run's time, and garden's budget.
    fireEvent.click(await screen.findByRole('button', { name: 'Night run at 01:00. Edit' }));
    const form = screen.getByRole('dialog');
    fireEvent.change(within(form).getByLabelText('Time'), { target: { value: '02:00' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Done' }));
    const detail = await openGarden();
    fireEvent.click(within(detail).getByRole('button', { name: /Night budget for garden/ }));
    fireEvent.change(within(detail).getByLabelText('Night budget in dollars for garden'), {
      target: { value: '12' },
    });

    // Meanwhile someone edited the night run's instructions in routines.json.
    if (state.available) {
      const config = structuredClone(state.config);
      config.routines[1]!.instructions = 'Changed outside the page.';
      state = { ...state, config };
    }
    saveError = 'routines.json changed since the page loaded. Reload and try again.';
    fireEvent.click(screen.getByRole('button', { name: 'Save…' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));

    const conflict = await screen.findByText(/^Yours: Night run: at 01:00 → 02:00/);
    expect(document.querySelector('[data-conflicts]')!.textContent).toMatch(
      /Theirs now: 01:00 · “Changed outside the page\.”/,
    );
    // The budget didn't conflict: still an unsaved change, on top of the fresh file.
    expect(screen.getByText('1 unsaved change')).toBeTruthy();
    expect(screen.getByText(/your edits are kept on top/)).toBeTruthy();

    saveError = null;
    const row = conflict.closest('[data-conflict]') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Keep mine' }));
    expect(document.querySelector('[data-conflicts]')).toBeNull();
    calls = [];
    expect((await saveAll()).length).toBe(2);
    const changes = savedChanges() as { field: string; from: unknown; to: unknown }[];
    const night = changes.find((c) => c.field === 'routine') as {
      from: RoutineDef;
      to: RoutineDef;
    };
    // Mine over theirs, checked against what's there now.
    expect(night.from.instructions).toBe('Changed outside the page.');
    expect(night.to.time).toBe('02:00');
    expect(changes.find((c) => c.field === 'budget_usd')).toMatchObject({ from: 8, to: 12 });
  });

  it('Use theirs drops my edit to that field', async () => {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify([{ field: 'budget_usd', project: 'garden', from: 6, to: 12 }]),
    );
    show();
    const row = (await screen.findByText(/^Yours: garden: night budget \$6 → \$12/)).closest(
      '[data-conflict]',
    ) as HTMLElement;
    expect(row.textContent).toMatch('Theirs now: 8');
    fireEvent.click(within(row).getByRole('button', { name: 'Use theirs' }));
    expect(document.querySelector('[data-conflicts]')).toBeNull();
    expect(screen.queryByText(/unsaved change/)).toBeNull();
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });
});

describe('the routine running now, from Routines', () => {
  const minutesAgo = (n: number) => {
    const d = new Date(Date.now() - n * 60_000);
    const pad = (x: number) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const withCurrent = (): RoutinesState => {
    const st = STATE();
    if (!st.available) return st;
    st.config.projects[1]!.enrolled = true;
    return {
      ...st,
      current: {
        routine: 'wrapup',
        name: 'Wrap-up',
        started: minutesAgo(30),
        projects: [
          {
            name: 'garden',
            state: 'done',
            since: minutesAgo(20),
            report: '/projects/prj_g/views/view_w',
          },
          {
            name: 'bike',
            state: 'waiting',
            since: minutesAgo(5),
            reason: 'a Claude session is active in bike · try 2 of 3',
          },
        ],
      },
    };
  };

  it('says where the run is in one line', () => {
    const st = withCurrent();
    if (!st.available || !st.current) throw new Error('no current');
    expect(currentLine(st.current)).toBe('Wrap-up · 1 of 2 done · waiting on bike');
    expect(
      currentLine({
        ...st.current,
        projects: [
          { name: 'garden', state: 'running' },
          { name: 'bike', state: 'queued' },
        ],
      }),
    ).toBe('Wrap-up · 0 of 2 done · running garden');
  });

  it('spins the node, shows each project’s state on its dot, and links a finished report', async () => {
    state = withCurrent();
    show();
    const node = await screen.findByRole('button', { name: 'Wrap-up at 00:00. Edit' });
    expect(node.getAttribute('data-running')).toBe('true');
    const item = node.closest('[role="listitem"]')!;
    expect(item.querySelector('[data-running-ring]')).toBeTruthy();
    expect(item.querySelector('[data-progress]')!.textContent).toBe('Running · 1 of 2');
    expect(document.querySelector('[data-running-line="wrapup"]')!.textContent).toBe(
      'Wrap-up · 1 of 2 done · waiting on bike',
    );
    // Garden is done: its dot opens its report.
    const done = line('garden').querySelector('[data-run-dot="wrapup"]')!;
    expect(done.getAttribute('data-live')).toBe('done');
    expect(done.getAttribute('href')).toBe('/projects/prj_g/views/view_w');
    // Bike waits: amber, pulsing, the reason on hover.
    const waiting = line('bike').querySelector('[data-run-dot="wrapup"]')!;
    expect(waiting.getAttribute('data-live')).toBe('waiting');
    expect(waiting.getAttribute('aria-label')).toMatch(
      /Wrap-up · bike: waiting [4-6] min: a Claude session is active in bike · try 2 of 3/,
    );
    expect(waiting.querySelector('.bg-amber-500')).toBeTruthy();
  });

  it('looks every 10 seconds while Routines says a routine runs', async () => {
    const timers = vi.spyOn(window, 'setInterval');
    try {
      state = withCurrent();
      show();
      await screen.findByRole('button', { name: 'Wrap-up at 00:00. Edit' });
      await waitFor(() => expect(timers.mock.calls.some(([, ms]) => ms === 10_000)).toBe(true));
    } finally {
      timers.mockRestore();
    }
  });
});
