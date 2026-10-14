import { SEEN_SETTING, type Author, type ProjectFreshness } from '@pharos/schema';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { answerBrief } from '../guidance.js';
import { projectSnapshot } from '../store/snapshot.js';
import { openDatabase } from '../store/database.js';
import { Store } from '../store/store.js';
import { changedViews, evidenceState, markSeen, projectFreshness } from './freshness.js';
import { answerView, createView, updateView } from './service.js';

// R11: "changed since you looked" per view and reader, and stale answers. Regression cases
// (R11.7): a relevant change marks a page and its answer stale (and the agent then answers
// again instead of reusing it); an unrelated change marks nothing.

const me: Author = { kind: 'human', name: 'me' };
const agent: Author = { kind: 'agent', name: 'Opus 5.5' };

function setup() {
  const store = new Store(openDatabase(':memory:'));
  const { created } = store.apply(me, {
    message: 'Set up',
    operations: [
      { op: 'create', type: 'project', ref: 'p', data: { name: 'Launch' } },
      {
        op: 'create',
        type: 'task',
        ref: 'b',
        data: { projectId: '$p', title: 'Fix login', status: 'blocked' },
      },
      {
        op: 'create',
        type: 'task',
        ref: 't',
        data: { projectId: '$p', title: 'Write docs', status: 'todo' },
      },
      { op: 'create', type: 'goal', ref: 'g', data: { projectId: '$p', title: 'Ship v1' } },
    ],
  });
  const projectId = created.p!;
  // Two pages: blocked tasks, and goals.
  const blocked = createView(store, me, {
    projectId,
    name: 'Blocked',
    message: 'Blocked page',
    widgets: [
      {
        id: 'blocked',
        node: {
          component: 'TaskTable',
          title: 'Blocked',
          filter: { where: { status: 'blocked' } },
        },
      },
    ],
  }).view.id;
  const goals = createView(store, me, {
    projectId,
    name: 'Goals',
    message: 'Goals page',
    widgets: [{ id: 'goals', node: { component: 'GoalTree', title: 'Goals' } }],
  }).view.id;
  const setTask = (author: Author, id: string, data: Record<string, unknown>) =>
    store.apply(author, {
      message: 'Change a task',
      operations: [{ op: 'update', type: 'task', id, data }],
    });
  return {
    store,
    projectId,
    blocked,
    goals,
    tasks: { blocked: created.b!, todo: created.t! },
    goal: created.g!,
    setTask,
  };
}

describe('changed since you looked (R11.4)', () => {
  it('starts calm, then marks only the pages whose data an agent changed', () => {
    const { store, projectId, blocked, goals, tasks, setTask } = setup();
    // Pharos starts keeping track now: nothing is marked yet.
    expect(changedViews(store).projects).toEqual({});
    expect(store.setting(SEEN_SETTING)).toMatchObject({ views: {} });

    // An agent unblocks a task the Blocked page shows (it matched before the change).
    setTask(agent, tasks.blocked, { status: 'in_progress' });
    const f = projectFreshness(store, projectId);
    expect(f.views[blocked]!.changed).toMatchObject({
      total: 1,
      recent: [
        {
          author: agent,
          page: false,
          items: [{ type: 'task', id: tasks.blocked, label: 'Fix login', op: 'update' }],
        },
      ],
    });
    expect(f.views[goals]!.changed).toBeNull();
    // An unrelated change (a task the page doesn't show) marks nothing new.
    setTask(agent, tasks.todo, { title: 'Write the docs' });
    expect(projectFreshness(store, projectId).views[blocked]!.changed!.total).toBe(1);
    // The default Overview shows recent activity, so every change touches it.
    const overview = store.list('view', { projectId }).find((v) => v.data.template)!.id;
    expect(changedViews(store).projects).toEqual({ [projectId]: [overview, blocked] });
  });

  it("counts a page's own change, but not the reader's own edits", () => {
    const { store, projectId, goals, goal } = setup();
    changedViews(store);
    store.apply(me, {
      message: 'Rename goal',
      operations: [{ op: 'update', type: 'goal', id: goal, data: { title: 'Ship it' } }],
    });
    expect(projectFreshness(store, projectId).views[goals]!.changed).toBeNull();
    updateView(store, agent, {
      viewId: goals,
      message: 'Retitle',
      name: 'Our goals',
    });
    expect(projectFreshness(store, projectId).views[goals]!.changed?.recent[0]).toMatchObject({
      page: true,
      author: agent,
    });
  });

  it('a page made later counts from its own start', () => {
    const { store, projectId, tasks, setTask } = setup();
    changedViews(store);
    setTask(agent, tasks.blocked, { status: 'todo' });
    const made = createView(store, agent, {
      projectId,
      name: 'New',
      message: 'New page',
      widgets: [{ id: 'all', node: { component: 'TaskTable' } }],
    }).view.id;
    const changed = projectFreshness(store, projectId).views[made]!.changed!;
    expect(changed.total).toBe(1);
    expect(changed.recent[0]).toMatchObject({ page: true, items: [] });
  });

  it('opening a view marks it seen; marks only move forward', () => {
    const { store, projectId, blocked, tasks, setTask } = setup();
    changedViews(store);
    setTask(agent, tasks.blocked, { status: 'done' });
    const latest = store.latestRevisionId();
    expect(markSeen(store, blocked)).toBe(latest);
    expect(projectFreshness(store, projectId).views[blocked]!.changed).toBeNull();
    expect(markSeen(store, blocked, 1)).toBe(latest);
    // A page can still list what changed since it was opened.
    expect(
      projectFreshness(store, projectId, { view: blocked, since: latest - 1 }).views[blocked]!
        .changed?.total,
    ).toBe(1);
  });

  it('serves the marks to the reader over REST and refuses agents', async () => {
    const { store, projectId, blocked, tasks, setTask } = setup();
    const app = createApp(store);
    expect(await (await app.request('/api/freshness')).json()).toMatchObject({ projects: {} });
    setTask(agent, tasks.blocked, { status: 'done' });
    expect(await (await app.request('/api/freshness')).json()).toMatchObject({
      projects: { [projectId]: expect.arrayContaining([blocked]) },
    });
    const one = (await (
      await app.request(`/api/projects/${projectId}/freshness?view=${blocked}`)
    ).json()) as ProjectFreshness;
    expect(Object.keys(one.views)).toEqual([blocked]);
    const seen = await app.request(`/api/views/${blocked}/seen`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(await seen.json()).toEqual({ viewId: blocked, seen: store.latestRevisionId() });
    expect(await (await app.request('/api/freshness')).json()).toMatchObject({ projects: {} });
    const asAgent = { headers: { 'x-pharos-author': 'agent:Opus 5.5' } };
    expect((await app.request('/api/freshness', asAgent)).status).toBe(403);
    expect(
      (await app.request(`/api/views/${blocked}/seen`, { ...asAgent, method: 'PUT', body: '{}' }))
        .status,
    ).toBe(403);
  });

  it('stays within budget on 1000 revisions and 20 views', () => {
    const { store, projectId, tasks, setTask } = setup();
    for (let i = 0; i < 18; i++)
      createView(store, me, {
        projectId,
        name: `Page ${i}`,
        message: 'Page',
        widgets: [
          { id: 'a', node: { component: 'TaskTable', filter: { where: { status: 'todo' } } } },
          { id: 'b', node: { component: 'DataList', query: { type: 'goal' } } },
        ],
      });
    changedViews(store);
    for (let i = 0; i < 1000; i++) setTask(agent, tasks.todo, { title: `Docs ${i}` });
    const start = performance.now();
    const f = projectFreshness(store, projectId);
    const ms = performance.now() - start;
    expect(Object.keys(f.views)).toHaveLength(21); // + the default Overview
    expect(f.views[Object.keys(f.views).at(-1)!]!.changed?.total).toBe(1000);
    // Budget (R11.4 task result): under 500 ms for 1000 revisions and 20 views; measured about
    // 20–40 ms on an M-series Mac.
    expect(ms).toBeLessThan(500);
  });
});

describe('evidence and stale answers (R11.3, R11.5, R11.6)', () => {
  const answer = (store: Store, projectId: string) =>
    answerView(store, agent, {
      projectId,
      question: 'What is blocked?',
      widgets: [
        { id: 'lead', node: { component: 'Text', content: 'One task is blocked: Fix login.' } },
        {
          id: 'list',
          node: { component: 'TaskTable', filter: { where: { status: 'blocked' } } },
        },
      ],
    }).view.id;

  it('stamps the evidence revision on what an agent builds; nobody can set it', () => {
    const { store, projectId } = setup();
    const before = store.latestRevisionId();
    const id = answer(store, projectId);
    expect(store.getOfType('view', id).data.evidenceRevision).toBe(before);
    for (const author of [agent, me])
      expect(() =>
        store.apply(author, {
          message: 'Forge',
          operations: [{ op: 'update', type: 'view', id, data: { evidenceRevision: 999 } }],
        }),
      ).toThrow(/set by Pharos/);
    // A person's page has no evidence; an old answer's is unknown.
    const mine = createView(store, me, { projectId, name: 'Mine', message: 'm', widgets: [] });
    expect(mine.view.id && store.getOfType('view', mine.view.id).data.evidenceRevision).toBe(
      undefined,
    );
    const old = store.apply(me, {
      message: 'Old answer',
      operations: [
        {
          op: 'create',
          type: 'view',
          data: { projectId, name: 'Old', kind: 'answer', question: 'Old?', pinned: false },
        },
      ],
    }).created['0']!;
    expect(projectFreshness(store, projectId).views[old]!.evidence).toEqual({ unknown: true });
    expect(evidenceState(store, store.getOfType('view', old))).toBe('unknown');
  });

  it('is stale after a relevant change by anyone, not after an unrelated one; refresh makes it fresh', () => {
    const { store, projectId, tasks, setTask } = setup();
    const id = answer(store, projectId);
    setTask(me, tasks.todo, { title: 'Unrelated' });
    expect(evidenceState(store, store.getOfType('view', id))).toBe('fresh');
    setTask(me, tasks.blocked, { status: 'done' });
    expect(evidenceState(store, store.getOfType('view', id))).toBe('stale');
    const stale = projectFreshness(store, projectId).views[id]!.evidence;
    expect(stale).toMatchObject({ stale: { total: 1, recent: [{ author: me }] } });

    // Refresh: a request in mode "refresh", answered again in the same view.
    const req = store.apply(me, {
      message: 'Refresh',
      operations: [
        {
          op: 'create',
          type: 'request',
          data: { projectId, question: 'What is blocked?', viewId: id, mode: 'refresh' },
        },
      ],
    }).created['0']!;
    expect(answerBrief(store, [projectId])).toMatch(
      /Refresh this answer[\s\S]*changed since: task "Fix login"/,
    );
    const view = store.getOfType('view', id);
    updateView(store, agent, {
      viewId: id,
      expectedRevision: view.updatedRev,
      requestId: req,
      message: 'Answer again',
      ops: [{ op: 'update', id: 'lead', set: { content: 'Nothing is blocked.' } }],
    });
    expect(evidenceState(store, store.getOfType('view', id))).toBe('fresh');
    expect(store.getOfType('request', req).data.status).toBe('answered');
    expect(JSON.stringify(store.getOfType('view', id).data.spec)).toContain('Nothing is blocked.');
  });

  it('the answering agent reuses a fresh answer but not a stale one, and logs the choice', () => {
    const { store, projectId, tasks, setTask } = setup();
    const id = answer(store, projectId);
    const ask = () =>
      store.apply(me, {
        message: 'Ask',
        operations: [
          { op: 'create', type: 'request', data: { projectId, question: 'What is blocked?' } },
        ],
      });
    ask();
    const log = vi.fn();
    expect(answerBrief(store, [projectId], log)).toContain(
      `Answered before: view ${id} ("What is blocked?"). Its blocks are live and nothing it was written from changed`,
    );
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/is fresh; offered for reuse/));
    setTask(agent, tasks.blocked, { status: 'done' });
    log.mockClear();
    const brief = answerBrief(store, [projectId], log);
    expect(brief).toContain("so its text may be wrong. Don't link it: answer again.");
    expect(brief).not.toContain(`answerViewId: "${id}"`);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/is stale; not offered for reuse/));
    // The snapshot agents read says so too.
    const snapshot = projectSnapshot(store, projectId) as {
      views: { id: string; evidence?: string }[];
    };
    expect(snapshot.views.find((v) => v.id === id)?.evidence).toBe('stale');
  });
});
