import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RoutinesConfig, RoutinesState } from '@pharos/schema';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { applyChanges } from './routines.js';
import { openDatabase } from './store/database.js';
import { Store } from './store/store.js';

// A fake Routines server, in this process: never the owner's real one (its POSTs rewrite
// routines.json and /api/run starts paid work).

const CONFIG = (): RoutinesConfig => ({
  schedule: {
    wrapup: '00:00',
    nightshift: '01:00',
    daybreak: '07:00',
    timezone: 'America/Chicago',
  },
  master: { model: 'opus', effort: 'high' },
  dispatch: { develop: { easy: 'sonnet', medium: 'sonnet', hard: 'opus' } },
  cleanup: { level: 1, scratch_days: 7 },
  handoff_never: ['tax'],
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

type Seen = { method: string; url: string; body: string };

const ROUTINE_LIST = () => [
  {
    id: 'wrapup',
    name: 'Wrap-up',
    time: '00:00',
    enabled: true,
    skill: 'wrapup',
    instructions: 'Close the day.',
    projects: 'enrolled' as const,
  },
  {
    id: 'nightshift',
    name: 'Night run',
    time: '01:00',
    enabled: true,
    skill: 'nightshift',
    instructions: 'Work the handoff.',
    projects: 'enrolled' as const,
  },
];

async function fakeRoutines(opts: { hang?: boolean; runStatus?: number; routines?: boolean } = {}) {
  let config: RoutinesConfig = opts.routines ? { ...CONFIG(), routines: ROUTINE_LIST() } : CONFIG();
  const seen: Seen[] = [];
  const read = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let data = '';
      req.on('data', (chunk) => (data += chunk));
      req.on('end', () => resolve(data));
    });
  const server: Server = createServer((req, res) => {
    void (async () => {
      const body = await read(req);
      seen.push({ method: req.method!, url: req.url!, body });
      if (opts.hang) return; // never answers
      const url = new URL(req.url!, 'http://x');
      const json = (code: number, value: unknown) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(value));
      };
      if (req.method === 'GET' && url.pathname === '/api/state')
        return json(200, {
          config,
          status: [{ name: 'garden', exists: true, runs: { wrapup: null } }],
          report: { text: '', date: null, when: null },
          pages: {},
          now: '2026-10-23T14:00',
        });
      if (req.method === 'POST' && url.pathname === '/api/state') {
        const patch = JSON.parse(body) as Partial<RoutinesConfig>;
        config = { ...config, ...patch };
        return json(200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/api/run') {
        if (opts.runStatus === 409)
          return json(409, { error: 'wrapup is already running for garden' });
        return json(200, { ok: true, started: ['run.sh'] });
      }
      if (url.pathname === '/api/file') {
        if (url.searchParams.get('project') !== 'garden')
          return json(404, { error: 'no such file' });
        res.writeHead(200, { 'content-type': 'text/plain' });
        return res.end('# NEXT · garden\n- [ ] A1 auto water');
      }
      if (req.method === 'GET' && url.pathname === '/api/runners')
        return json(200, {
          local: {
            id: 'local',
            name: 'This Mac',
            kind: 'local',
            status: { state: 'ready', detail: 'runs here' },
          },
          runners: [
            {
              id: 'box',
              name: 'box',
              kind: 'ssh',
              host: 'box',
              status: { state: 'ready', detail: 'ready' },
              projects: ['garden'],
            },
          ],
          candidates: [{ host: 'vm2', name: 'vm2', source: 'tailscale' }],
          kinds: ['ssh', 'container', 'cloud'],
          built: ['ssh'],
        });
      if (req.method === 'POST' && url.pathname.startsWith('/api/runners/')) {
        if (url.pathname.endsWith('/setup')) return json(409, { error: 'box is busy' });
        return json(200, { ok: true, ...(url.pathname.endsWith('/add') ? { id: 'vm2' } : {}) });
      }
      if (url.pathname === '/api/log') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        return res.end(`log ${url.searchParams.get('file')}`);
      }
      json(404, { error: 'not found' });
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  servers.push(server);
  return { url, seen, config: () => config };
}

const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise((resolve) => s.close(resolve));
  }
});

function appFor(url: string, timeoutMs = 2000, store = new Store(openDatabase(':memory:'))) {
  return createApp(store, undefined, undefined, { routines: { url, timeoutMs } });
}

const OWNER = { 'x-pharos-author': 'human:me', 'content-type': 'application/json' };
const post = (body: unknown, headers: Record<string, string> = OWNER) => ({
  method: 'POST',
  headers,
  body: JSON.stringify(body),
});

describe('the Routines proxy', () => {
  it('passes the state through, marked available', async () => {
    const fake = await fakeRoutines();
    const res = await appFor(fake.url).request('/api/routines/state');
    const state = (await res.json()) as RoutinesState;
    expect(state.available).toBe(true);
    if (!state.available) return;
    expect(state.config.projects.map((p) => p.name)).toEqual(['garden', 'bike']);
    expect(state.now).toBe('2026-10-23T14:00');
    expect(state.url).toBe(fake.url);
  });

  it('says clearly when Routines is not running, and how to start it', async () => {
    const fake = await fakeRoutines();
    const url = fake.url;
    for (const s of servers.splice(0)) await new Promise((r) => s.close(r));
    const app = appFor(url);
    const state = (await (await app.request('/api/routines/state')).json()) as RoutinesState;
    expect(state).toMatchObject({ available: false, url });
    if (state.available) return;
    expect(state.reason).toContain("isn't running");
    expect(state.reason).toContain('server.py');
    const save = await app.request(
      '/api/routines/save',
      post({ changes: [{ field: 'enrolled', project: 'bike', from: false, to: true }] }),
    );
    expect(save.status).toBe(503);
    expect(((await save.json()) as { error: { code: string } }).error.code).toBe('unavailable');
  });

  it('gives up quickly on a Routines server that never answers', async () => {
    const fake = await fakeRoutines({ hang: true });
    const started = Date.now();
    const state = (await (await appFor(fake.url, 150).request('/api/routines/state')).json()) as {
      available: boolean;
      reason: string;
    };
    expect(state.available).toBe(false);
    expect(state.reason).toContain("didn't answer");
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('refuses agents everything, and writes without an owner header', async () => {
    const fake = await fakeRoutines();
    const app = appFor(fake.url);
    const agent = { 'x-pharos-author': 'agent:Claude Code', 'content-type': 'application/json' };
    expect((await app.request('/api/routines/state', { headers: agent })).status).toBe(403);
    expect(
      (
        await app.request(
          '/api/routines/run',
          post({ routine: 'wrapup', project: 'garden' }, agent),
        )
      ).status,
    ).toBe(403);
    // No header at all reads as the owner for GETs, but a write or a run must say human:….
    expect(
      (
        await app.request(
          '/api/routines/run',
          post({ routine: 'wrapup', project: 'garden' }, { 'content-type': 'application/json' }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request(
          '/api/routines/save',
          post(
            { changes: [{ field: 'enrolled', project: 'bike', from: false, to: true }] },
            { 'content-type': 'application/json' },
          ),
        )
      ).status,
    ).toBe(403);
    expect(fake.seen.filter((s) => s.method === 'POST')).toEqual([]);
  });

  it('saves the edits into routines.json, keeping every other field', async () => {
    const fake = await fakeRoutines();
    const res = await appFor(fake.url).request(
      '/api/routines/save',
      post({
        changes: [
          { field: 'enrolled', project: 'bike', from: false, to: true },
          { field: 'budget_usd', project: 'garden', from: 8, to: 10 },
          { field: 'schedule', routine: 'daybreak', from: '07:00', to: '06:30' },
          { field: 'dispatch', kind: 'develop', level: 'hard', from: 'opus', to: 'sonnet' },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { saved: string[] }).saved).toEqual([
      'bike: enrolled',
      'garden: night budget $8 → $10',
      'Morning report at 07:00 → 06:30',
      'develop, hard: opus → sonnet',
    ]);
    const posted = JSON.parse(fake.seen.find((s) => s.method === 'POST')!.body) as RoutinesConfig;
    // Only what the Routines page saves: never master, never other keys.
    expect(Object.keys(posted).sort()).toEqual(['dispatch', 'projects', 'schedule']);
    const conf = fake.config();
    expect(conf.projects[1]).toMatchObject({ name: 'bike', enrolled: true, path: '/tmp/bike' });
    expect(conf.projects[0]).toMatchObject({ budget_usd: 10, note: 'slot 1', hours: 4 });
    expect(conf.schedule).toMatchObject({ daybreak: '06:30', timezone: 'America/Chicago' });
    expect(conf.dispatch.develop).toEqual({ easy: 'sonnet', medium: 'sonnet', hard: 'sonnet' });
    expect(conf.handoff_never).toEqual(['tax']);
  });

  it('refuses a save when routines.json changed since the page loaded', async () => {
    const fake = await fakeRoutines();
    const res = await appFor(fake.url).request(
      '/api/routines/save',
      post({ changes: [{ field: 'budget_usd', project: 'garden', from: 6, to: 10 }] }),
    );
    expect(res.status).toBe(409);
    expect(fake.seen.some((s) => s.method === 'POST')).toBe(false);
  });

  it('refuses bad values and unknown projects before they reach Routines', async () => {
    const fake = await fakeRoutines();
    const app = appFor(fake.url);
    const bad = await app.request(
      '/api/routines/save',
      post({ changes: [{ field: 'schedule', routine: 'daybreak', from: '07:00', to: '25:00' }] }),
    );
    expect(bad.status).toBe(400);
    const unknown = await app.request(
      '/api/routines/save',
      post({ changes: [{ field: 'hours', project: 'nope', from: 1, to: 2 }] }),
    );
    expect(unknown.status).toBe(400);
    const run = await app.request(
      '/api/routines/run',
      post({ routine: 'wrapup', project: 'nope' }),
    );
    expect(run.status).toBe(404);
    const badRoutine = await app.request(
      '/api/routines/run',
      post({ routine: '../rm -rf', project: 'garden' }),
    );
    expect(badRoutine.status).toBe(400);
    const unknownRoutine = await app.request(
      '/api/routines/run',
      post({ routine: 'weekly', project: 'garden' }),
    );
    expect(unknownRoutine.status).toBe(404);
    expect(fake.seen.some((s) => s.method === 'POST')).toBe(false);
  });

  it('starts a routine for one project, and passes on "already running"', async () => {
    const fake = await fakeRoutines();
    const res = await appFor(fake.url).request(
      '/api/routines/run',
      post({ routine: 'nightshift', project: 'garden' }),
    );
    expect(res.status).toBe(200);
    const runs = fake.seen.filter((s) => s.url === '/api/run');
    expect(runs.map((r) => JSON.parse(r.body))).toEqual([
      { routine: 'nightshift', project: 'garden' },
    ]);

    const busy = await fakeRoutines({ runStatus: 409 });
    const again = await appFor(busy.url).request(
      '/api/routines/run',
      post({ routine: 'wrapup', project: 'garden' }),
    );
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: { message: string } }).error.message).toContain(
      'already running',
    );
  });

  it('reads planning files and logs, and only those', async () => {
    const fake = await fakeRoutines();
    const app = appFor(fake.url);
    const file = await app.request('/api/routines/file?project=garden&name=NEXT.md');
    expect(await file.json()).toEqual({
      project: 'garden',
      name: 'NEXT.md',
      text: '# NEXT · garden\n- [ ] A1 auto water',
    });
    expect((await app.request('/api/routines/file?project=garden&name=.env')).status).toBe(400);
    expect((await app.request('/api/routines/file?project=nope&name=NEXT.md')).status).toBe(404);
    const log = await app.request('/api/routines/log?file=2026-10-23-garden-wrapup.log');
    expect(((await log.json()) as { text: string }).text).toBe('log 2026-10-23-garden-wrapup.log');
    expect((await app.request('/api/routines/log?file=../routines.json')).status).toBe(400);
  });
});

describe('applyChanges', () => {
  it('leaves the original alone and adds a missing dispatch row', () => {
    const conf = CONFIG();
    const next = applyChanges(conf, [
      { field: 'dispatch', kind: 'search', level: 'easy', to: 'haiku' },
      { field: 'timezone', from: 'America/Chicago', to: 'Europe/Berlin' },
      { field: 'hours', project: 'bike', from: 3, to: 2 },
    ]);
    expect(conf.dispatch.search).toBeUndefined();
    expect(next.dispatch.search).toEqual({ easy: 'haiku' });
    expect(next.schedule.timezone).toBe('Europe/Berlin');
    expect(next.projects[1]!.hours).toBe(2);
  });
});

describe('runners through Pharos', () => {
  it('lists them, passes the owner’s actions through, and refuses agents and bad input', async () => {
    const fake = await fakeRoutines();
    const app = appFor(fake.url);
    const view = (await (await app.request('/api/routines/runners')).json()) as {
      runners: { id: string }[];
      candidates: { host: string }[];
    };
    expect(view.runners.map((r) => r.id)).toEqual(['box']);
    expect(view.candidates.map((c) => c.host)).toEqual(['vm2']);
    const add = await app.request('/api/routines/runners/add', post({ host: 'vm2' }));
    expect(await add.json()).toEqual({ ok: true, id: 'vm2' });
    expect(fake.seen.at(-1)).toMatchObject({ url: '/api/runners/add', body: '{"host":"vm2"}' });
    expect((await app.request('/api/routines/runners/setup', post({ id: 'box' }))).status).toBe(
      409,
    );
    expect((await app.request('/api/routines/runners/zap', post({ id: 'box' }))).status).toBe(400);
    expect(
      (await app.request('/api/routines/runners/add', post({ host: 'a; rm -rf ~' }))).status,
    ).toBe(400);
    const agent = await app.request(
      '/api/routines/runners/check',
      post(
        { id: 'box' },
        { 'x-pharos-author': 'agent:Claude Code', 'content-type': 'application/json' },
      ),
    );
    expect(agent.status).toBe(403);
  });
});

describe('where a project runs', () => {
  it('sets a project to one of the machines and back, and refuses an unknown one', () => {
    const conf = {
      ...CONFIG(),
      runners: [{ id: 'axion-01', name: 'axion-01', kind: 'ssh' as const, host: 'axion-01' }],
    };
    const there = applyChanges(conf, [
      { field: 'runner', project: 'bike', from: null, to: 'axion-01' },
    ]);
    expect(there.projects[1]!.runner).toBe('axion-01');
    const back = applyChanges(there, [
      { field: 'runner', project: 'bike', from: 'axion-01', to: null },
    ]);
    expect('runner' in back.projects[1]!).toBe(false);
    expect(() =>
      applyChanges(conf, [{ field: 'runner', project: 'bike', from: null, to: 'nowhere' }]),
    ).toThrow(/No runner "nowhere"/);
  });
});

describe('routines the owner defines', () => {
  const weekly = {
    id: 'weekly',
    name: 'Weekly review',
    time: '18:00',
    enabled: true,
    instructions: 'Read the week and list what slipped.',
    projects: ['garden'],
  };

  it('derives the three built-ins from an older routines.json, and says it cannot add', async () => {
    const fake = await fakeRoutines();
    const app = appFor(fake.url);
    const state = (await (await app.request('/api/routines/state')).json()) as RoutinesState;
    if (!state.available) throw new Error('unavailable');
    expect(state.editable).toBe(false);
    expect(state.config.routines.map((r) => [r.id, r.time])).toEqual([
      ['wrapup', '00:00'],
      ['nightshift', '01:00'],
      ['daybreak', '07:00'],
    ]);
    const add = await app.request(
      '/api/routines/save',
      post({ changes: [{ field: 'routine', id: 'weekly', from: null, to: weekly }] }),
    );
    expect(add.status).toBe(400);
    expect(fake.seen.some((s) => s.method === 'POST')).toBe(false);
  });

  it('adds, changes and removes routines, checked against what the page saw', async () => {
    const fake = await fakeRoutines({ routines: true });
    const app = appFor(fake.url);
    const state = (await (await app.request('/api/routines/state')).json()) as RoutinesState;
    if (!state.available) throw new Error('unavailable');
    expect(state.editable).toBe(true);
    const night = state.config.routines[1]!;
    const res = await app.request(
      '/api/routines/save',
      post({
        changes: [
          { field: 'routine', id: 'weekly', from: null, to: weekly },
          // Fields in another order than routines.json: still the same routine.
          {
            field: 'routine',
            id: 'nightshift',
            from: { ...night, projects: 'enrolled', id: 'nightshift' },
            to: { ...night, time: '02:00' },
          },
          { field: 'routine', id: 'wrapup', from: state.config.routines[0], to: null },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { saved: string[] }).saved).toEqual([
      'New routine “Weekly review” at 18:00 for garden',
      'Night run: at 01:00 → 02:00',
      'Remove the routine “Wrap-up”',
    ]);
    const posted = JSON.parse(fake.seen.find((s) => s.method === 'POST')!.body) as RoutinesConfig;
    expect(posted.routines!.map((r) => [r.id, r.time])).toEqual([
      ['nightshift', '02:00'],
      ['weekly', '18:00'],
    ]);

    // The page saw 02:00? No: it still shows 01:00, so the next save is refused.
    const stale = await app.request(
      '/api/routines/save',
      post({
        changes: [
          { field: 'routine', id: 'nightshift', from: night, to: { ...night, enabled: false } },
        ],
      }),
    );
    expect(stale.status).toBe(409);
    // Adding an id that exists now is stale too.
    const again = await app.request(
      '/api/routines/save',
      post({ changes: [{ field: 'routine', id: 'weekly', from: null, to: weekly }] }),
    );
    expect(again.status).toBe(409);
  });

  it('runs any routine routines.json has, and only those', async () => {
    const fake = await fakeRoutines({ routines: true });
    const app = appFor(fake.url);
    expect(
      (await app.request('/api/routines/run', post({ routine: 'nightshift', project: 'garden' })))
        .status,
    ).toBe(200);
    expect(
      (await app.request('/api/routines/run', post({ routine: 'daybreak', project: 'garden' })))
        .status,
    ).toBe(404);
  });

  it('maps each project to its Pharos projects by folder, with report views by routine name', async () => {
    const fake = await fakeRoutines();
    const store = new Store(openDatabase(':memory:'));
    const me = { kind: 'human' as const, name: 'me' };
    const { created } = store.apply(me, {
      message: 'Set up',
      operations: [
        {
          op: 'create',
          type: 'repository',
          ref: 'repo',
          data: { name: 'garden', path: '/tmp/garden' },
        },
        {
          op: 'create',
          type: 'project',
          ref: 'a',
          data: { name: 'Garden', repositoryId: '$repo' },
        },
        {
          op: 'create',
          type: 'project',
          ref: 'b',
          data: { name: 'Garden · Beds', repositoryId: '$repo' },
        },
        { op: 'create', type: 'project', ref: 'c', data: { name: 'Elsewhere' } },
      ],
    });
    store.apply(me, {
      message: 'Report',
      operations: [
        { op: 'create', type: 'view', data: { projectId: created.b!, name: 'Night run' } },
      ],
    });
    const state = (await (
      await appFor(fake.url, 2000, store).request('/api/routines/state')
    ).json()) as RoutinesState;
    if (!state.available) throw new Error('unavailable');
    const garden = state.pharos.garden!;
    expect(garden.projects.map((p) => p.name).sort()).toEqual(['Garden', 'Garden · Beds']);
    expect(garden.reports).toEqual([
      {
        routine: 'nightshift',
        name: 'Night run',
        href: expect.stringMatching(new RegExp(`^/projects/${created.b}/views/`)),
      },
    ]);
    expect(state.pharos.bike).toEqual({ projects: [], reports: [] });
  });
});

describe('Routines projects follow Pharos folders', () => {
  it('lists Pharos folders with a path, each with its main project', async () => {
    const fake = await fakeRoutines();
    const store = new Store(openDatabase(':memory:'));
    const me = { kind: 'human' as const, name: 'me' };
    store.apply(me, {
      message: 'Set up',
      operations: [
        { op: 'create', type: 'repository', ref: 'r', data: { name: 'Kiln', path: '/tmp/kiln' } },
        { op: 'create', type: 'repository', ref: 'x', data: { name: 'No path' } },
        { op: 'create', type: 'project', data: { name: 'Kiln · Glaze', repositoryId: '$r' } },
        { op: 'create', type: 'project', data: { name: 'Kiln', repositoryId: '$r' } },
      ],
    });
    const state = (await (
      await appFor(fake.url, 2000, store).request('/api/routines/state')
    ).json()) as RoutinesState;
    if (!state.available) throw new Error('unavailable');
    expect(state.folders?.map((f) => [f.name, f.path, f.project?.name])).toEqual([
      ['Kiln', '/tmp/kiln', 'Kiln'],
    ]);
  });

  it('adds a folder as a project, and removes one (leaving the routines that named it)', async () => {
    const fake = await fakeRoutines({ routines: true });
    const app = appFor(fake.url);
    const kiln = {
      name: 'kiln',
      path: '/tmp/kiln',
      enrolled: true,
      budget_usd: 5,
      hours: 4,
      pm: { type: 'pharos', project: 'prj_k' },
    };
    // The night run names garden and bike: removing garden takes it out of that list too.
    const night = ROUTINE_LIST()[1]!;
    await app.request(
      '/api/routines/save',
      post({
        changes: [
          {
            field: 'routine',
            id: 'nightshift',
            from: night,
            to: { ...night, projects: ['garden', 'bike'] },
          },
        ],
      }),
    );
    const garden = CONFIG().projects[0]!;
    const res = await app.request(
      '/api/routines/save',
      post({
        changes: [
          { field: 'project', name: 'kiln', from: null, to: kiln },
          { field: 'project', name: 'garden', from: garden, to: null },
        ],
      }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { saved: string[] }).saved).toEqual([
      'Add kiln to the routines (enrolled, $5 · 4 h)',
      'Remove garden from the routines (its folder and files stay)',
    ]);
    const conf = fake.config();
    expect(conf.projects.map((p) => p.name)).toEqual(['bike', 'kiln']);
    expect(conf.projects[1]).toEqual(kiln);
    expect(conf.routines!.find((r) => r.id === 'nightshift')!.projects).toEqual(['bike']);

    // Adding it again is stale (it's there now); a renamed entry is refused.
    const again = await app.request(
      '/api/routines/save',
      post({ changes: [{ field: 'project', name: 'kiln', from: null, to: kiln }] }),
    );
    expect(again.status).toBe(409);
    const renamed = await app.request(
      '/api/routines/save',
      post({ changes: [{ field: 'project', name: 'oven', from: null, to: kiln }] }),
    );
    expect(renamed.status).toBe(400);
  });
});
