import {
  DEFAULT_NOTIFICATION_PREFS,
  NOTIFICATION_PREFS_SETTING,
  deliveryOf,
  inQuietHours,
  notificationPrefsOf,
  type Author,
  type PharosNotification,
} from '@pharos/schema';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { RunLog, askOwner } from './desk.js';
import { RevisionFeed } from './feed.js';
import {
  INTERRUPTED_SETTING,
  NOTIFICATIONS_SINCE_SETTING,
  Notifications,
} from './notifications.js';
import { openDatabase } from './store/database.js';
import { Store } from './store/store.js';
import { TerminalSessions, type Pty, type PtySpawn } from './terminal/sessions.js';
import { createView } from './views/service.js';

const me: Author = { kind: 'human', name: 'me' };
const agent: Author = { kind: 'agent', name: 'Night runner' };

function setup() {
  const store = new Store(openDatabase(':memory:'));
  const { created } = store.apply(me, {
    message: 'Set up',
    operations: [
      { op: 'create', type: 'project', ref: 'p', data: { name: 'Garden' } },
      { op: 'create', type: 'assignee', ref: 'me', data: { name: 'Sam', kind: 'human' } },
      {
        op: 'create',
        type: 'task',
        ref: 't',
        data: { projectId: '$p', title: 'Water', status: 'todo' },
      },
    ],
  });
  // Notifications started a minute ago: what comes after notifies.
  let clock = Date.now() - 60_000;
  const runs = new RunLog(store);
  const center = new Notifications(store, runs, () => new Date(clock));
  clock = Date.now();
  return {
    store,
    runs,
    center,
    projectId: created.p!,
    taskId: created.t!,
    advance: (ms: number) => (clock += ms),
    setClock: (ms: number) => (clock = ms),
  };
}

describe('notifications: sources', () => {
  it('notifies a new desk item once, with its action and gate; not what was there before', () => {
    const store = new Store(openDatabase(':memory:'));
    const { created } = store.apply(me, {
      message: 'Set up',
      operations: [{ op: 'create', type: 'project', ref: 'p', data: { name: 'Garden' } }],
    });
    const p = created.p!;
    askOwner(store, agent, {
      projectId: p,
      title: 'Old question',
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
    });
    const center = new Notifications(store, new RunLog(store), () => new Date(Date.now() + 1));
    expect(center.checkDesk()).toEqual([]);
    const later = new Notifications(store, new RunLog(store));
    expect(later.since).toBe(center.since); // kept in settings, across restarts
    expect(store.setting(NOTIFICATIONS_SINCE_SETTING)).toBe(center.since);
  });

  it('a decision and a gate task on the desk notify; the same item never twice', async () => {
    const { store, center, projectId } = setup();
    askOwner(store, agent, {
      projectId,
      title: 'Which seeds?',
      ask: 'Spring sowing',
      options: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
    });
    askOwner(store, agent, { projectId, title: 'Pay the plot fee', gate: true });
    const got = center.checkDesk();
    expect(got.map((n) => [n.kind, n.title, n.action, n.gate])).toEqual([
      ['desk', 'Pay the plot fee', 'Open', true],
      ['desk', 'Which seeds?', 'Answer', false],
    ]);
    expect(got[1]).toMatchObject({ detail: 'Spring sowing', project: 'Garden', projectId });
    expect(center.checkDesk()).toEqual([]);
    expect(center.list().unread).toBe(2);
  });

  it('a failed or partly done run notifies as a run; a fine one does not', () => {
    const { center, runs } = setup();
    const ok = runs.report(agent, { name: 'Morning report', outcome: 'running' });
    runs.report(agent, { id: ok.id, outcome: 'ok' });
    const bad = runs.report(agent, { name: 'Night run', outcome: 'running' });
    runs.report(agent, { id: bad.id, outcome: 'failed', summary: '2 tests red' });
    const got = center.checkDesk();
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      kind: 'run',
      title: 'Night run: failed',
      detail: '2 tests red',
    });
  });

  it('the answering agent failing notifies; finishing does not', () => {
    const { center } = setup();
    const at = new Date(Date.now() + 1000).toISOString();
    expect(center.agentRun({ outcome: 'finished', finishedAt: at })).toBeNull();
    expect(center.agentRun({ outcome: 'failed', finishedAt: at })).toMatchObject({
      kind: 'run',
      title: 'Answering failed',
      href: '/settings',
    });
    expect(center.agentRun({ outcome: 'failed', finishedAt: at })).toBeNull();
  });

  it('a page an agent wrote notifies when an agent change makes it stale, not when the owner does', () => {
    const { store, center, projectId, taskId } = setup();
    const view = createView(store, agent, {
      projectId,
      name: 'To do',
      message: 'Page',
      widgets: [
        { id: 't', node: { component: 'TaskTable', filter: { where: { status: 'todo' } } } },
      ],
    }).view.id;
    center.primeStale();
    store.apply(me, {
      message: 'Rename',
      operations: [{ op: 'update', type: 'task', id: taskId, data: { title: 'Water beds' } }],
    });
    expect(center.checkStale([projectId])).toEqual([]);
    // A second page, made stale by an agent.
    const other = createView(store, agent, {
      projectId,
      name: 'Watering',
      message: 'Page',
      widgets: [{ id: 't', node: { component: 'TaskTable' } }],
    }).view.id;
    store.apply(agent, {
      message: 'Done',
      operations: [{ op: 'update', type: 'task', id: taskId, data: { status: 'done' } }],
    });
    const got = center.checkStale([projectId]);
    expect(got.map((n) => n.title)).toEqual(['“Watering” is out of date']);
    expect(got[0]).toMatchObject({ kind: 'stale', href: `/projects/${projectId}/views/${other}` });
    expect(got[0]!.detail).toMatch(/latest by Night runner/);
    expect(center.checkStale([projectId])).toEqual([]);
    expect(view).toBeTruthy();
  });

  it('a hand-back nobody picked up for the set hours notifies; one picked up does not', () => {
    const { store, center, projectId, taskId, advance } = setup();
    const make = (name: string) =>
      createView(store, agent, {
        projectId,
        name,
        message: 'Review',
        widgets: [{ id: 't', node: { component: 'TaskTable' } }],
      }).view.id;
    const a = make('Review A');
    const b = make('Review B');
    for (const id of [a, b])
      store.apply(me, {
        message: 'Hand back',
        operations: [
          {
            op: 'update',
            type: 'view',
            id,
            data: { archived: true, handedBack: { to: 'Night runner', answered: 2 } },
          },
        ],
      });
    expect(center.checkHandbacks()).toEqual([]); // not yet 4 hours
    advance(5 * 3600_000);
    const got = center.checkHandbacks();
    expect(got.map((n) => n.title).sort()).toEqual([
      '“Review A” waits for Night runner',
      '“Review B” waits for Night runner',
    ]);
    expect(center.checkHandbacks()).toEqual([]);
    // Picked up: an agent revision after the hand-back.
    const c = make('Review C');
    store.apply(me, {
      message: 'Hand back',
      operations: [
        {
          op: 'update',
          type: 'view',
          id: c,
          data: { archived: true, handedBack: { answered: 1 } },
        },
      ],
    });
    store.apply(agent, {
      message: 'Read the answers',
      operations: [
        { op: 'update', type: 'task', id: taskId, data: { title: 'Water (from review)' } },
      ],
    });
    advance(5 * 3600_000);
    expect(center.checkHandbacks()).toEqual([]);
  });

  it('a terminal agent that finished unwatched notifies; watched, restarted or server stop do not', () => {
    const { store, center, projectId } = setup();
    const ptys: { end: (code?: number) => void }[] = [];
    const spawn: PtySpawn = () => {
      const exits = new Set<(e: { exitCode: number }) => void>();
      const pty: Pty & { end: (code?: number) => void } = {
        pid: 1,
        onData: () => {},
        onExit: (fn) => void exits.add(fn),
        write: () => {},
        resize: () => {},
        kill: () => {},
        end: (code = 0) => exits.forEach((fn) => fn({ exitCode: code })),
      };
      ptys.push(pty);
      return pty;
    };
    const sessions = new TerminalSessions(spawn, { killGroup: () => {} });
    const got: PharosNotification[] = [];
    sessions.onExit((exit) => {
      const n = center.terminalExited(exit);
      if (n) got.push(n);
    });
    const launch = () => ({
      preset: 'claude' as const,
      file: 'claude',
      args: [],
      cwd: '/tmp/x',
      env: { PHAROS_PROJECT_IDS: projectId },
    });
    const panel = { send: () => {}, close: () => {} };
    // Watched: the owner saw it.
    sessions.attach('k', launch, panel, { cols: 80, rows: 24 });
    ptys[0]!.end();
    expect(got).toEqual([]);
    // Unwatched: it notifies.
    sessions.attach('k2', launch, panel, { cols: 80, rows: 24 });
    sessions.detach('k2', panel);
    ptys[1]!.end();
    expect(got.map((n) => [n.kind, n.title, n.href])).toEqual([
      ['terminal', 'Claude Code finished', `/projects/${projectId}?terminal=1`],
    ]);
    // The server stopping ends it: the next start's modal says so instead.
    sessions.attach('k3', launch, panel, { cols: 80, rows: 24 });
    sessions.detach('k3', panel);
    sessions.killAll();
    ptys[2]!.end(1);
    expect(got).toHaveLength(1);
    expect(store).toBeTruthy();
  });

  it('agents a stop ended come back as one modal on the next start', () => {
    const { store, center, projectId } = setup();
    center.noteInterrupted([{ projectIds: [projectId], agent: 'Claude Code' }]);
    expect(store.setting(INTERRUPTED_SETTING)).toHaveLength(1);
    const n = center.checkInterrupted();
    expect(n).toMatchObject({
      kind: 'system',
      modal: true,
      action: 'Reopen',
      href: `/projects/${projectId}?terminal=1`,
    });
    expect(n!.detail).toMatch(/Claude Code was running in Garden/);
    expect(center.checkInterrupted()).toBeNull();
  });

  it('watch: a revision checks the desk (debounced) and sends the new notification', async () => {
    const { store, center, projectId } = setup();
    const feed = new RevisionFeed(store, 0);
    const sent: PharosNotification[] = [];
    center.subscribe((n) => sent.push(n));
    const stop = center.watch(feed, { debounceMs: 5, everyMs: 60_000 });
    askOwner(store, agent, { projectId, title: 'Prune the roses?' });
    await new Promise((r) => setTimeout(r, 30));
    expect(sent.map((n) => n.title)).toEqual(['Prune the roses?']);
    stop();
  });
});

describe('notifications: list, read and preferences', () => {
  it('lists newest first, marks read (some or all), and leaves out kinds turned off', () => {
    const { store, center } = setup();
    for (const [i, kind] of (['desk', 'run', 'stale'] as const).entries())
      center.add({ key: `k${i}`, kind, title: `N${i}` });
    expect(center.add({ key: 'k0', kind: 'desk', title: 'again' })).toBeNull();
    const all = center.list();
    expect(all.items.map((n) => n.title)).toEqual(['N2', 'N1', 'N0']);
    expect(all.unread).toBe(3);
    expect(center.list({ since: all.items[1]!.id }).items.map((n) => n.title)).toEqual(['N2']);
    expect(center.markRead([all.items[2]!.id])).toBe(1);
    expect(center.list().unread).toBe(2);
    const prefs = structuredClone(DEFAULT_NOTIFICATION_PREFS);
    prefs.kinds.stale.on = false;
    center.setPrefs(prefs);
    expect(center.list().items.map((n) => n.title)).toEqual(['N1', 'N0']);
    expect(center.list().unread).toBe(1);
    expect(center.markRead()).toBe(2);
    expect(center.list().unread).toBe(0);
    expect(store.latestRevisionId()).toBe(1); // none of it is a revision
  });

  it('subscribers hear only kinds that are on; a failing one does not stop the rest', () => {
    const { center } = setup();
    const prefs = structuredClone(DEFAULT_NOTIFICATION_PREFS);
    prefs.kinds.terminal.on = false;
    center.setPrefs(prefs);
    const heard: string[] = [];
    center.subscribe(() => {
      throw new Error('boom');
    });
    center.subscribe((n) => heard.push(n.title));
    center.add({ key: 'a', kind: 'terminal', title: 'off' });
    center.add({ key: 'b', kind: 'desk', title: 'on' });
    expect(heard).toEqual(['on']);
  });

  it('preferences: defaults, saved over defaults, and how each reaches the owner', () => {
    expect(notificationPrefsOf(undefined)).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect(DEFAULT_NOTIFICATION_PREFS.kinds.desk.delivery).toBe('toast');
    expect(DEFAULT_NOTIFICATION_PREFS.kinds.run.delivery).toBe('toast');
    expect(DEFAULT_NOTIFICATION_PREFS.kinds.stale.delivery).toBe('bell');
    const saved = notificationPrefsOf({
      onlyGates: true,
      kinds: { desk: { on: false, delivery: 'bell' } },
    });
    expect(saved.onlyGates).toBe(true);
    expect(saved.kinds.desk.on).toBe(false);
    expect(saved.kinds.run).toEqual(DEFAULT_NOTIFICATION_PREFS.kinds.run);
    expect(notificationPrefsOf({ quiet: { from: 'nope' } })).toEqual(DEFAULT_NOTIFICATION_PREFS);

    const quiet = {
      ...DEFAULT_NOTIFICATION_PREFS,
      quiet: { on: true, from: '22:00', to: '07:00' },
    };
    expect(inQuietHours(quiet, 23 * 60)).toBe(true);
    expect(inQuietHours(quiet, 6 * 60 + 59)).toBe(true);
    expect(inQuietHours(quiet, 7 * 60)).toBe(false);
    expect(inQuietHours(quiet, 12 * 60)).toBe(false);
    const noon = 12 * 60;
    const desk = { kind: 'desk' as const, gate: false, modal: false };
    expect(deliveryOf(DEFAULT_NOTIFICATION_PREFS, desk, noon)).toBe('toast');
    expect(deliveryOf(quiet, desk, 23 * 60)).toBe('bell');
    expect(deliveryOf({ ...DEFAULT_NOTIFICATION_PREFS, onlyGates: true }, desk, noon)).toBe('bell');
    expect(
      deliveryOf({ ...DEFAULT_NOTIFICATION_PREFS, onlyGates: true }, { ...desk, gate: true }, noon),
    ).toBe('toast');
    expect(deliveryOf(DEFAULT_NOTIFICATION_PREFS, { ...desk, kind: 'stale' }, noon)).toBe('bell');
    expect(deliveryOf(saved, desk, noon)).toBe('none');
    expect(deliveryOf(quiet, { kind: 'system', gate: false, modal: true }, 23 * 60)).toBe('modal');
  });

  it('REST: the owner reads, marks read and saves preferences; agents are refused', async () => {
    const store = new Store(openDatabase(':memory:'));
    const center = new Notifications(store, new RunLog(store));
    const app = createApp(store, new RevisionFeed(store, 0), undefined, { notifications: center });
    center.add({ key: 'x', kind: 'desk', title: 'Hello' });
    const res = await app.request('/api/notifications');
    expect(res.status).toBe(200);
    const list = (await res.json()) as { items: PharosNotification[]; unread: number };
    expect(list.unread).toBe(1);
    const read = await app.request('/api/notifications/read', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(await read.json()).toEqual({ changed: 1, unread: 0 });
    const prefs = { ...DEFAULT_NOTIFICATION_PREFS, onlyGates: true };
    const put = await app.request('/api/settings/notifications', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(prefs),
    });
    expect(await put.json()).toEqual(prefs);
    expect(store.setting(NOTIFICATION_PREFS_SETTING)).toEqual(prefs);
    const bad = await app.request('/api/settings/notifications', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...prefs, quiet: { on: true, from: '25:00', to: '07:00' } }),
    });
    expect(bad.status).toBe(400);
    for (const [method, path] of [
      ['GET', '/api/notifications'],
      ['POST', '/api/notifications/read'],
      ['GET', '/api/settings/notifications'],
      ['PUT', '/api/settings/notifications'],
    ] as const) {
      const refused = await app.request(path, {
        method,
        headers: { 'x-pharos-author': 'agent:Claude Code', 'content-type': 'application/json' },
        ...(method === 'GET' ? {} : { body: JSON.stringify(prefs) }),
      });
      expect(refused.status).toBe(403);
    }
    expect(store.latestRevisionId()).toBe(0);
  });
});
