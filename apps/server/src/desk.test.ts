import {
  addDays,
  localToday,
  valueFor,
  type Author,
  type Entity,
  type ReportDoc,
} from '@pharos/schema';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { RunLog, answersSince, askOwner, deskOf, minutesIn } from './desk.js';
import { openDatabase } from './store/database.js';
import { Store } from './store/store.js';
import { sheetSummaries } from './views/doc.js';
import { createView } from './views/service.js';

const me: Author = { kind: 'human', name: 'me' };
const agent: Author = { kind: 'agent', name: 'Night runner' };
const OPTIONS = [
  { id: 'a', label: 'Plan A' },
  { id: 'b', label: 'Plan B', asks: 'Why B?' },
];

function setup() {
  const store = new Store(openDatabase(':memory:'));
  const { created } = store.apply(me, {
    message: 'Set up',
    operations: [
      { op: 'create', type: 'project', ref: 'p', data: { name: 'Garden' } },
      { op: 'create', type: 'project', ref: 'q', data: { name: 'Bike', status: 'archived' } },
      { op: 'create', type: 'assignee', ref: 'me', data: { name: 'Sam', kind: 'human' } },
      { op: 'create', type: 'assignee', ref: 'bot', data: { name: 'Helper', kind: 'agent' } },
      {
        op: 'create',
        type: 'decision',
        ref: 'open',
        data: {
          projectId: '$p',
          title: 'Which seeds?',
          status: 'proposed',
          options: OPTIONS,
          minutes: 2,
        },
      },
      {
        op: 'create',
        type: 'decision',
        ref: 'plain',
        data: { projectId: '$p', title: 'Use raised beds', status: 'accepted' },
      },
      {
        op: 'create',
        type: 'task',
        ref: 'mine',
        data: {
          projectId: '$p',
          title: 'Buy compost',
          assigneeId: '$me',
          estimate: '30m',
          desk: true,
        },
      },
      {
        op: 'create',
        type: 'task',
        ref: 'bots',
        data: { projectId: '$p', title: 'Water plan', assigneeId: '$bot' },
      },
      {
        op: 'create',
        type: 'task',
        ref: 'old',
        data: { projectId: '$q', title: 'Oil chain', assigneeId: '$me', desk: true },
      },
    ],
  });
  const id = (ref: string) => created[ref]!;
  return {
    store,
    runs: new RunLog(store),
    p: id('p'),
    open: id('open'),
    mine: id('mine'),
    me: id('me'),
  };
}

const ids = (store: Store, runs: RunLog, now?: Date) =>
  deskOf(store, runs, { now }).items.map((i) => [i.kind, i.title]);

describe('the desk (R16)', () => {
  it('lists open decisions with options and unfinished tasks for a person, not archived projects', () => {
    const { store, runs, p, open } = setup();
    const desk = deskOf(store, runs);
    expect(desk.items.map((i) => [i.kind, i.title])).toEqual([
      ['decision', 'Which seeds?'],
      ['task', 'Buy compost'],
    ]);
    expect(desk.minutes).toBe(32);
    const decision = desk.items[0]!;
    expect(decision).toMatchObject({
      id: open,
      projectId: p,
      project: 'Garden',
      href: `/projects/${p}?entity=${open}`,
      options: [
        { id: 'a', label: 'Plan A' },
        { id: 'b', label: 'Plan B', asks: 'Why B?' },
      ],
    });
  });

  it("keeps a person's plan tasks off the desk until they are due by tomorrow", () => {
    const { store, runs, p, me: sam } = setup();
    store.apply(me, {
      message: 'Plan',
      operations: [
        {
          op: 'create',
          type: 'task',
          data: { projectId: p, title: 'Prune roses', assigneeId: sam, dueDate: '2026-10-30' },
        },
      ],
    });
    expect(ids(store, runs, new Date('2026-10-20T12:00:00Z'))).not.toContainEqual([
      'task',
      'Prune roses',
    ]);
    expect(ids(store, runs, new Date('2026-10-29T12:00:00Z'))).toContainEqual([
      'task',
      'Prune roses',
    ]);
  });

  it('drops an answered decision and a done task; a deferral comes back on its day', () => {
    const { store, runs, p, open, mine } = setup();
    const project = store.get(p) as Entity<'project'>;
    store.apply(me, {
      message: 'Answer',
      operations: [
        { op: 'update', type: 'decision', id: open, data: { deferredUntil: '2026-11-01' } },
        {
          op: 'update',
          type: 'task',
          id: mine,
          data: { status: valueFor(project, 'task.status', 'done') },
        },
      ],
    });
    expect(ids(store, runs, new Date('2026-10-25T12:00:00Z'))).toEqual([]);
    expect(ids(store, runs, new Date('2026-11-01T12:00:00Z'))).toEqual([
      ['decision', 'Which seeds?'],
    ]);
    store.apply(me, {
      message: 'Choose',
      operations: [
        {
          op: 'update',
          type: 'decision',
          id: open,
          data: { deferredUntil: null, chosenOptionId: 'a' },
        },
      ],
    });
    expect(ids(store, runs, new Date('2026-11-01T12:00:00Z'))).toEqual([]);
  });

  it('shows a sheet once, with the decision and tasks it asks about, and links to it', () => {
    const { store, runs, p, open } = setup();
    const view = createView(store, agent, {
      projectId: p,
      name: 'Review',
      message: 'm',
      doc: {
        blocks: [
          {
            kind: 'sheet',
            id: 'seeds',
            title: 'Pick the seeds',
            time: '5 min',
            tags: ['gate'],
            decisions: [open],
            blocks: [
              { kind: 'block', id: 'd', node: { component: 'DecisionBlock', decision: open } },
              {
                kind: 'block',
                id: 'l',
                node: { component: 'TaskChecklist', filter: { where: { title: 'Buy compost' } } },
              },
            ],
          },
        ],
      },
    }).view.id;
    const desk = deskOf(store, runs);
    expect(desk.items).toHaveLength(1);
    store.apply(me, {
      message: 'Archive',
      operations: [{ op: 'update', type: 'view', id: view, data: { archived: true } }],
    });
    expect(deskOf(store, runs).items.map((i) => i.kind)).toEqual(['decision', 'task']);
    store.apply(me, {
      message: 'Restore',
      operations: [{ op: 'update', type: 'view', id: view, data: { archived: null } }],
    });
    expect(desk.items[0]).toMatchObject({
      kind: 'sheet',
      id: `${view}#seeds`,
      title: 'Pick the seeds',
      ask: '1 choice, 1 task to tick · in “Review”',
      minutes: 5,
      gate: true,
      href: `/projects/${p}/views/${view}#sheet-seeds`,
    });
  });

  it('puts overdue items first, then gates, then the oldest', () => {
    const { store, runs, p } = setup();
    askOwner(store, agent, { projectId: p, title: 'Sign the lease', gate: true, options: OPTIONS });
    const later = new Date(Date.now() + 49 * 3600_000);
    const desk = deskOf(store, runs, { now: later });
    expect(desk.overdue).toBe(3);
    expect(desk.items.map((i) => i.title)).toEqual([
      'Sign the lease',
      'Which seeds?',
      'Buy compost',
    ]);
    expect(deskOf(store, runs).overdue).toBe(0);
    const month = deskOf(store, runs, { now: new Date(Date.now() + 15 * 86_400_000) });
    expect(month.old).toBe(3);
    expect(month.items.every((i) => i.old && i.overdue)).toBe(true);
  });

  it('shows a failed or partial run until it is seen or a later run of that name is ok', () => {
    const { store, runs, p } = setup();
    const night = runs.report(agent, { kind: 'night', name: 'Night run', projectId: p });
    expect(night).toMatchObject({ outcome: 'running', agent: 'Night runner' });
    runs.report(agent, {
      id: night.id,
      outcome: 'partial',
      summary: '7 could not verify',
      counts: { done: 12, unverified: 7 },
    });
    const item = deskOf(store, runs).items.find((i) => i.kind === 'run');
    expect(item).toMatchObject({
      title: 'Night run: partly done',
      ask: '7 could not verify',
      project: 'Garden',
    });
    expect(deskOf(store, runs).runs[0]).toMatchObject({ counts: { done: 12, unverified: 7 } });
    runs.markSeen(night.id);
    expect(deskOf(store, runs).items.some((i) => i.kind === 'run')).toBe(false);
    const again = runs.report(agent, { kind: 'night', name: 'Night run', outcome: 'failed' });
    expect(deskOf(store, runs).items.some((i) => i.id === again.id)).toBe(true);
    runs.report(agent, { kind: 'night', name: 'Night run', outcome: 'ok' });
    expect(deskOf(store, runs).items.some((i) => i.kind === 'run')).toBe(false);
  });

  it('ask_owner makes a decision with options, or a task for the person with most tasks', () => {
    const { store, runs, p, me: sam } = setup();
    const d = askOwner(store, agent, {
      projectId: p,
      title: 'Pick a colour',
      options: OPTIONS,
      recommendedOptionId: 'a',
      minutes: 1,
    });
    expect(d.kind).toBe('decision');
    expect(store.getOfType('decision', d.id).data).toMatchObject({
      minutes: 1,
      recommendedOptionId: 'a',
      options: OPTIONS,
    });
    const t = askOwner(store, agent, {
      projectId: p,
      title: 'Paste the API key',
      gate: true,
      minutes: 3,
    });
    expect(store.getOfType('task', t.id).data).toMatchObject({
      assigneeId: sam,
      estimate: '3 min',
      priority: 'high',
    });
    expect(deskOf(store, runs).items.find((i) => i.id === t.id)).toMatchObject({ gate: true });
    expect(() =>
      askOwner(store, agent, {
        projectId: p,
        title: 'x',
        options: OPTIONS,
        recommendedOptionId: 'z',
      }),
    ).toThrow();
    expect(() => askOwner(store, agent, { projectId: 'prj_000000000000', title: 'x' })).toThrow();
  });

  it("an agent sees the owner's answers since a revision", () => {
    const { store, p, open } = setup();
    const since = store.latestRevisionId();
    store.apply(me, {
      message: 'Choose “Plan A”: Which seeds?',
      operations: [{ op: 'update', type: 'decision', id: open, data: { chosenOptionId: 'a' } }],
    });
    askOwner(store, agent, { projectId: p, title: 'More?' });
    expect(answersSince(store, since, p).map((a) => a.message)).toEqual([
      'Choose “Plan A”: Which seeds?',
    ]);
  });

  it('reads minutes from a time or an estimate', () => {
    expect(minutesIn('10 min')).toBe(10);
    expect(minutesIn('1h 30m')).toBe(90);
    expect(minutesIn('3 points')).toBeUndefined();
    expect(minutesIn(undefined)).toBeUndefined();
  });

  it('REST: the desk, runs, and only a person marks a run seen', async () => {
    const { store, p } = setup();
    const app = createApp(store);
    const json = { 'content-type': 'application/json' };
    const started = await app.request('/api/runs', {
      method: 'POST',
      headers: { ...json, 'x-pharos-author': 'agent:Morning' },
      body: JSON.stringify({
        kind: 'routine',
        name: 'Morning report',
        outcome: 'failed',
        projectId: p,
      }),
    });
    const run = (await started.json()) as { id: string; agent: string };
    expect(run.agent).toBe('Morning');
    const desk = (await (await app.request('/api/desk')).json()) as { items: { kind: string }[] };
    expect(desk.items.map((i) => i.kind)).toContain('run');
    const refused = await app.request(`/api/runs/${run.id}/seen`, {
      method: 'POST',
      headers: { 'x-pharos-author': 'agent:x' },
    });
    expect(refused.status).toBe(403);
    const seen = await app.request(`/api/runs/${run.id}/seen`, {
      method: 'POST',
      headers: { 'x-pharos-author': 'human:me' },
    });
    expect(seen.status).toBe(200);
    expect(
      ((await (await app.request('/api/runs')).json()) as { seenAt?: string }[])[0]!.seenAt,
    ).toBeTruthy();
    const bad = await app.request('/api/runs', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ outcome: 'great' }),
    });
    expect(bad.status).toBe(400);
  });

  it('the owner answers from the desk: an option (with the note it asks for) or a task done', async () => {
    const { store, runs, open, mine } = setup();
    const app = createApp(store);
    const post = (body: unknown, who = 'human:me') =>
      app.request('/api/desk/answer', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-pharos-author': who },
        body: JSON.stringify(body),
      });
    expect((await post({ id: open, chosenOptionId: 'a' }, 'agent:x')).status).toBe(403);
    expect((await post({ id: open, chosenOptionId: 'b' })).status).toBe(400);
    expect((await post({ id: open, chosenOptionId: 'z' })).status).toBe(400);
    const ok = await post({ id: open, chosenOptionId: 'b', note: 'Cheaper' });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { revision: { message: string } }).revision.message).toBe(
      'Choose “Plan B”: Which seeds? (Cheaper)',
    );
    expect(store.getOfType('decision', open).data).toMatchObject({
      chosenOptionId: 'b',
      note: 'Cheaper',
    });
    expect((await post({ id: mine, done: true })).status).toBe(200);
    expect(deskOf(store, runs).items).toEqual([]);
  });

  it("a task's other answers: won't do, later (back on its day) and a reply, one revision each", async () => {
    const { store, runs, mine } = setup();
    const app = createApp(store);
    const post = async (body: unknown, who = 'human:me') => {
      const res = await app.request('/api/desk/answer', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-pharos-author': who },
        body: JSON.stringify(body),
      });
      return { status: res.status, body: (await res.json()) as { revision?: { message: string } } };
    };
    const task = () => store.getOfType('task', mine).data;
    const desk = (day: string) => ids(store, runs, new Date(`${day}T12:00:00Z`));
    const today = localToday();
    const tomorrow = addDays(today, 1);

    // Validation: one answer, a later day after today, a reply with words; agents can't.
    expect((await post({ id: mine, wontDo: true }, 'agent:x')).status).toBe(403);
    expect((await post({ id: mine })).status).toBe(400);
    expect((await post({ id: mine, wontDo: true, reply: 'No' })).status).toBe(400);
    expect((await post({ id: mine, later: today })).status).toBe(400);
    expect((await post({ id: mine, later: '2026-02-30' })).status).toBe(400);
    expect((await post({ id: mine, reply: '   ' })).status).toBe(400);
    expect((await post({ id: mine, reply: 'x'.repeat(2001) })).status).toBe(400);
    expect(task().reply).toBeUndefined();

    const later = await post({ id: mine, later: tomorrow });
    expect(later.body.revision?.message).toBe(`Later (${tomorrow}): “Buy compost”`);
    expect(task().deferredUntil).toBe(tomorrow);
    expect(desk(today)).toEqual([['decision', 'Which seeds?']]);
    expect(desk(tomorrow)).toContainEqual(['task', 'Buy compost']);

    const reply = await post({ id: mine, reply: ' Sam buys it on Saturday ' });
    expect(reply.body.revision?.message).toBe('Reply on “Buy compost”: Sam buys it on Saturday');
    expect(task()).toMatchObject({ reply: 'Sam buys it on Saturday', status: 'todo' });
    expect(task().deferredUntil).toBeUndefined();
    expect(desk(tomorrow)).toEqual([['decision', 'Which seeds?']]);

    const wont = await post({ id: mine, wontDo: true });
    expect(wont.body.revision?.message).toBe("Won't do “Buy compost”");
    expect(task().status).toBe('cancelled');
    expect(task().reply).toBeUndefined();
    expect(desk(tomorrow)).toEqual([['decision', 'Which seeds?']]);
  });

  it("a sheet counts won't do, a reply and later (until its day) as answers, and says which", () => {
    const { store, runs, p, mine } = setup();
    const doc = {
      blocks: [
        {
          kind: 'sheet',
          id: 'buy',
          title: 'Shopping',
          blocks: [
            {
              kind: 'block',
              id: 'l',
              node: { component: 'TaskChecklist', filter: { where: { title: 'Buy compost' } } },
            },
          ],
        },
      ],
    } as ReportDoc;
    createView(store, agent, { projectId: p, name: 'Review', message: 'm', doc });
    const project = store.get(p) as Entity<'project'>;
    const answer = (data: Record<string, unknown>) =>
      store.apply(me, {
        message: 'Answer',
        operations: [{ op: 'update', type: 'task', id: mine, data }],
      });
    const sheet = (today = '2026-10-21') => sheetSummaries(store, p, doc, today)[0]!;
    const onDesk = (day: string) =>
      deskOf(store, runs, { now: new Date(`${day}T12:00:00Z`) }).items.some(
        (i) => i.kind === 'sheet',
      );
    expect(sheet()).toMatchObject({ state: 'open', tasks: [{ id: mine, state: 'open' }] });

    answer({ reply: 'Sam has some' });
    expect(sheet()).toMatchObject({
      state: 'answered',
      tasks: [{ state: 'replied', reply: 'Sam has some', done: false }],
    });
    expect(onDesk('2026-10-21')).toBe(false);

    answer({ reply: null, deferredUntil: '2026-10-26' });
    expect(sheet()).toMatchObject({
      state: 'answered',
      tasks: [{ state: 'later', deferredUntil: '2026-10-26' }],
    });
    expect(onDesk('2026-10-21')).toBe(false);
    expect(sheet('2026-10-26')).toMatchObject({ state: 'open', tasks: [{ state: 'open' }] });
    expect(onDesk('2026-10-26')).toBe(true);

    answer({ deferredUntil: null, status: valueFor(project, 'task.status', 'cancelled') });
    expect(sheet()).toMatchObject({ state: 'answered', tasks: [{ state: 'wontDo' }] });
  });

  it("only the owner writes a task's reply or later day", () => {
    const { store, p, mine } = setup();
    expect(() =>
      store.apply(agent, {
        message: 'Answer for them',
        operations: [{ op: 'update', type: 'task', id: mine, data: { reply: 'Done already' } }],
      }),
    ).toThrow(/only the owner replies to a task or puts it off \(reply\)/);
    expect(() =>
      store.apply(agent, {
        message: 'Ask later',
        operations: [
          {
            op: 'create',
            type: 'task',
            data: { projectId: p, title: 'Later', deferredUntil: '2027-01-01' },
          },
        ],
      }),
    ).toThrow(/deferredUntil/);
    store.apply(me, {
      message: 'Reply',
      operations: [{ op: 'update', type: 'task', id: mine, data: { reply: 'Ask Ana' } }],
    });
    // An agent may still change the rest, but not delete the owner's answer.
    store.apply(agent, {
      message: 'Rename',
      operations: [{ op: 'update', type: 'task', id: mine, data: { title: 'Buy compost (40 l)' } }],
    });
    expect(() =>
      store.apply(agent, {
        message: 'Drop it',
        operations: [{ op: 'delete', type: 'task', id: mine }],
      }),
    ).toThrow(/already answered it \(reply\)/);
  });

  it('REST ask: a routine without MCP puts a decision or a task on the desk, by project name too', async () => {
    const { store, runs, p } = setup();
    const app = createApp(store);
    const ask = (body: unknown) =>
      app.request('/api/desk/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-pharos-author': 'agent:Night run' },
        body: JSON.stringify(body),
      });
    const d = await ask({
      projectId: 'Garden',
      title: 'Pick a mulch',
      options: OPTIONS,
      minutes: 1,
    });
    expect(d.status).toBe(200);
    const t = await ask({ projectId: p, title: 'Approve the push', gate: true });
    expect(((await t.json()) as { kind: string }).kind).toBe('task');
    expect(deskOf(store, runs).items.map((i) => i.title)).toEqual(
      expect.arrayContaining(['Pick a mulch', 'Approve the push']),
    );
    expect((await ask({ projectId: 'Nowhere', title: 'x' })).status).toBe(404);
  });
});
