import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Author } from '@pharos/schema';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { LOOKUP_MAX, LookupLog } from './lookups.js';
import { openDatabase } from './store/database.js';
import { Store } from './store/store.js';
import { compactValue, updatesOf } from './updates.js';

const me: Author = { kind: 'human', name: 'Sam' };
const bot: Author = { kind: 'agent', name: 'Garden agent' };
const other: Author = { kind: 'agent', name: 'Codex' };

const NOW = new Date('2026-10-23T18:00:00.000Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

/** A store whose clock is set per write, so revisions land at chosen times. */
function setup() {
  let clock = minutesAgo(600);
  const store = new Store(openDatabase(':memory:'), () => clock.toISOString());
  const at = (d: Date) => (clock = d);
  at(minutesAgo(600));
  const { created } = store.apply(me, {
    message: 'Set up',
    operations: [
      { op: 'create', type: 'project', ref: 'p', data: { name: 'Garden' } },
      { op: 'create', type: 'project', ref: 'q', data: { name: 'Bike' } },
      { op: 'create', type: 'task', ref: 't', data: { projectId: '$p', title: 'Plant beans' } },
    ],
  });
  const p = created.p!;
  const q = created.q!;
  const t = created.t!;
  return { store, at, p, q, t };
}

describe('updates: work sessions', () => {
  it('groups one author in one project with gaps under 30 minutes', () => {
    const { store, at, p, q, t } = setup();
    at(minutesAgo(120));
    store.apply(bot, {
      message: 'Started the beans',
      operations: [{ op: 'update', type: 'task', id: t, data: { status: 'in_progress' } }],
    });
    at(minutesAgo(100));
    store.apply(bot, {
      message: 'Beans are in',
      operations: [
        { op: 'update', type: 'task', id: t, data: { status: 'done' } },
        { op: 'create', type: 'task', data: { projectId: p, title: 'Water beans' } },
      ],
    });
    // The owner works in between: their own session.
    at(minutesAgo(110));
    store.apply(me, {
      message: 'Note',
      operations: [{ op: 'create', type: 'task', data: { projectId: p, title: 'Buy stakes' } }],
    });
    // 40 minutes later: a new session.
    at(minutesAgo(60));
    store.apply(bot, {
      message: 'Tidy',
      operations: [{ op: 'create', type: 'task', ref: 'x', data: { projectId: p, title: 'Temp' } }],
    });
    // Another project: another session.
    at(minutesAgo(58));
    store.apply(bot, {
      message: 'Bike',
      operations: [{ op: 'create', type: 'task', data: { projectId: q, title: 'Oil chain' } }],
    });

    const u = updatesOf(store, {}, { now: NOW });
    const bySession = u.sessions.map((s) => [s.author.name, s.project, s.revisions.length]);
    expect(bySession).toEqual([
      ['Garden agent', 'Bike', 1],
      ['Garden agent', 'Garden', 1],
      ['Garden agent', 'Garden', 2],
      ['Sam', 'Garden', 1],
      // The setup touched both projects: it shows in each.
      ['Sam', 'Garden', 1],
      ['Sam', 'Bike', 1],
    ]);
    const beans = u.sessions[2]!;
    expect(beans.start).toBe(minutesAgo(120).toISOString());
    expect(beans.end).toBe(minutesAgo(100).toISOString());
    // Net across the session: the task changed once (todo → done), one task added.
    expect(beans.counts).toEqual({ added: 1, changed: 1, removed: 0, lookedUp: 0 });
    expect(beans.byType).toEqual([{ type: 'task', added: 1, changed: 1, removed: 0 }]);
    expect(beans.revisions.map((r) => r.message)).toEqual(['Beans are in', 'Started the beans']);
    const status = beans.entities
      .find((e) => e.id === t)!
      .fields.find((f) => f.field === 'status')!;
    expect(status.before).toBe('todo');
    expect(status.after).toBe('done');
    expect(status.option).toEqual({
      before: { value: 'todo', label: 'Todo', color: 'neutral' },
      after: { value: 'done', label: 'Done', color: 'green' },
    });

    // Filters: by author and by project.
    expect(updatesOf(store, { author: 'Sam' }, { now: NOW }).sessions).toHaveLength(3);
    expect(
      updatesOf(store, { projectId: q }, { now: NOW }).sessions.map((s) => s.author.name),
    ).toEqual(['Garden agent', 'Sam']);
    // Since a revision: only what came after it.
    const after = updatesOf(store, { since: String(4) }, { now: NOW });
    expect(after.sessions.flatMap((s) => s.revisions.map((r) => r.id)).sort()).toEqual([5, 6]);
  });

  it('counts the last 24 hours and each day for the tiles', () => {
    const { store, at, p, t } = setup();
    at(minutesAgo(30));
    store.apply(bot, {
      message: 'Remove',
      operations: [{ op: 'delete', type: 'task', id: t }],
    });
    at(minutesAgo(60 * 30));
    store.apply(other, {
      message: 'Old',
      operations: [{ op: 'create', type: 'task', data: { projectId: p, title: 'Yesterday' } }],
    });
    const u = updatesOf(store, {}, { now: NOW });
    expect(u.last24h.removed).toBe(1);
    // The setup (2 projects, their Overview views and a task, 10 hours ago) is in the last 24 h;
    // yesterday's isn't.
    expect(u.last24h.added).toBe(5);
    expect(u.days).toHaveLength(7);
    expect(u.days.reduce((n, d) => n + d.added, 0)).toBe(6);
    expect(u.hours.length).toBeGreaterThanOrEqual(168);
    expect(u.hours.reduce((n, h) => n + h.added + h.removed, 0)).toBe(7);
    expect(u.authors.map((a) => a.name)).toEqual(['Codex', 'Garden agent', 'Sam']);
  });

  it('pages: at most one page of revisions, older ones with before', () => {
    const { store, at, p } = setup();
    for (let i = 0; i < 305; i++) {
      at(minutesAgo(500 - i));
      store.apply(bot, {
        message: `Task ${i}`,
        operations: [{ op: 'create', type: 'task', data: { projectId: p, title: `T${i}` } }],
      });
    }
    const first = updatesOf(store, {}, { now: NOW });
    const count = (u: typeof first) => u.sessions.reduce((n, s) => n + s.revisions.length, 0);
    expect(count(first)).toBe(300);
    expect(first.nextBefore).not.toBeNull();
    const second = updatesOf(store, { before: first.nextBefore! }, { now: NOW });
    expect(count(second)).toBe(7); // the other 5, and the setup in each of its two projects
    expect(second.nextBefore).toBeNull();
  });

  it('cuts big values down to their size', () => {
    expect(compactValue('a'.repeat(1000))).toHaveLength(280);
    expect(compactValue({ widgets: Array(30).fill({ id: 'x', kind: 'Text' }) })).toEqual({
      $summary: 'object',
      size: 1,
    });
    expect(compactValue(Array(20).fill(1))).toEqual({ $summary: 'list', size: 20 });
    expect(compactValue(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('shows changed pictures', () => {
    const { store, at, p } = setup();
    at(minutesAgo(10));
    store.apply(bot, {
      message: 'Screenshot',
      operations: [
        {
          op: 'create',
          type: 'artifact',
          data: {
            projectId: p,
            title: 'Bed layout',
            kind: 'other',
            image: 'https://example.com/bed.png',
            alt: 'Bed',
          },
        },
      ],
    });
    const [session] = updatesOf(store, {}, { now: NOW }).sessions;
    expect(session!.entities[0]!.pictures).toEqual([{ after: 'https://example.com/bed.png' }]);
  });
});

describe('updates: the read log (looked up)', () => {
  it('records an MCP read call with agent, project, tool and target, and joins its session', async () => {
    const { store, at, p, t } = setup();
    at(new Date());
    const app = createApp(store);
    const client = new Client({ name: 'Garden agent', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL('http://localhost:4300/mcp'), {
        fetch: async (url, init) => app.fetch(new Request(url, init)),
      }),
    );
    await client.callTool({ name: 'project_snapshot', arguments: { projectId: p } });
    await client.callTool({ name: 'get', arguments: { id: t } });
    await client.callTool({ name: 'get', arguments: { id: t } });
    await client.callTool({ name: 'list', arguments: { type: 'task', projectId: p } });
    // Writes and guides aren't lookups.
    await client.callTool({ name: 'catalog_list', arguments: {} });
    await client.callTool({
      name: 'apply',
      arguments: {
        message: 'Done',
        operations: [{ op: 'update', type: 'task', id: t, data: { status: 'done' } }],
      },
    });
    await client.close();

    const rows = new LookupLog(store).list({ since: '' });
    expect(rows.map((r) => [r.agent, r.tool, r.projectId, r.targetId, r.targetType])).toEqual([
      ['Garden agent', 'project_snapshot', p, p, 'project'],
      ['Garden agent', 'get', p, t, 'task'],
      ['Garden agent', 'get', p, t, 'task'],
      ['Garden agent', 'list', p, null, 'task'],
    ]);
    // Lookups aren't revisions.
    expect(store.history({ limit: 200 })).toHaveLength(2);

    const u = updatesOf(store);
    const session = u.sessions.find((s) => s.author.name === 'Garden agent')!;
    expect(session.counts.lookedUp).toBe(4);
    expect(session.counts.changed).toBe(1);
    const get = session.lookups.find((l) => l.tool === 'get')!;
    expect(get).toMatchObject({ targetId: t, label: 'Plant beans', count: 2 });
    expect(u.last24h.lookedUp).toBe(4);
  });

  it('keeps 30 days and at most LOOKUP_MAX rows, and never throws', () => {
    const { store, p } = setup();
    let now = new Date('2026-09-01T00:00:00Z');
    const log = new LookupLog(store, () => now);
    log.record('a', 'project_snapshot', { projectId: p });
    now = new Date('2026-10-20T00:00:00Z');
    log.record('a', 'project_snapshot', { projectId: p });
    expect(log.list({ since: '' })).toHaveLength(1);

    const insert = store.database.prepare(
      "INSERT INTO lookups (at, agent, tool) VALUES ('2026-10-20T00:00:00Z', 'a', 'get')",
    );
    for (let i = 0; i < LOOKUP_MAX + 20; i++) insert.run();
    log.prune(now);
    const { n } = store.database.prepare('SELECT COUNT(*) AS n FROM lookups').get() as {
      n: number;
    };
    expect(n).toBe(LOOKUP_MAX);

    // Unknown tools are ignored; odd arguments are fine.
    log.record('a', 'apply', { projectId: p });
    log.record('a', 'get', null);
    log.record('a', 'get', { id: 'nope_1' });
    expect(log.list({ since: '2026-10-19' }).filter((r) => r.targetId === 'nope_1')).toHaveLength(
      1,
    );
  });

  it('puts reads outside any project into the session the agent goes on to', () => {
    const { store, at, p, t } = setup();
    let clock = minutesAgo(50);
    const log = new LookupLog(store, () => clock);
    log.record('Garden agent', 'desk_list', {});
    clock = minutesAgo(48);
    log.record('Garden agent', 'get', { id: t });
    at(minutesAgo(45));
    store.apply(bot, {
      message: 'Done',
      operations: [{ op: 'update', type: 'task', id: t, data: { status: 'done' } }],
    });
    // Much later, a desk check on its own stays its own.
    clock = minutesAgo(5);
    log.record('Garden agent', 'desk_list', {});
    const sessions = updatesOf(store, {}, { now: NOW, lookups: log }).sessions.filter(
      (s) => s.author.name === 'Garden agent',
    );
    expect(sessions.map((s) => [s.projectId, s.counts.lookedUp, s.revisions.length])).toEqual([
      [null, 1, 0],
      [p, 2, 1],
    ]);
    expect(sessions[1]!.start).toBe(minutesAgo(50).toISOString());
  });

  it('is served at GET /api/updates', async () => {
    const { store, p } = setup();
    const app = createApp(store);
    const res = await app.fetch(
      new Request(`http://localhost:4300/api/updates?projectId=${p}`, {
        headers: { host: 'localhost:4300' },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessions: unknown[]; days: unknown[] };
    expect(body.days).toHaveLength(7);
    const bad = await app.fetch(
      new Request('http://localhost:4300/api/updates?since=yesterday', {
        headers: { host: 'localhost:4300' },
      }),
    );
    expect(bad.status).toBe(400);
  });
});
