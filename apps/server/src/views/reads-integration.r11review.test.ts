import type { Author } from '@pharos/schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDatabase } from '../store/database.js';
import { Store } from '../store/store.js';
import { projectFreshness } from './freshness.js';
import { answerView } from './service.js';

const owner: Author = { kind: 'human', name: 'me' };
const agent: Author = { kind: 'agent', name: 'Reviewer' };

afterEach(() => vi.useRealTimers());

describe('R11 relative-date read tracking review cases', () => {
  it("does not certify yesterday's written answer when a $today query changes overnight", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-12T18:00:00.000Z'));
    const store = new Store(openDatabase(':memory:'));
    const projectId = store.apply(owner, {
      message: 'Synthetic calendar fixtures',
      operations: [
        { op: 'create', type: 'project', ref: 'p', data: { name: 'Synthetic calendar' } },
        {
          op: 'create',
          type: 'task',
          data: { projectId: '$p', title: 'First fixture', dueDate: '2026-10-12' },
        },
        {
          op: 'create',
          type: 'task',
          data: { projectId: '$p', title: 'Second fixture', dueDate: '2026-10-13' },
        },
      ],
    }).created.p!;
    const viewId = answerView(store, agent, {
      projectId,
      question: 'What is due today?',
      widgets: [
        { id: 'lead', node: { component: 'Text', content: 'First fixture is due today.' } },
        { id: 'due', node: { component: 'TaskTable', filter: { where: { dueDate: '$today' } } } },
      ],
    }).view.id;
    const latest = store.latestRevisionId();
    vi.setSystemTime(new Date('2026-10-13T18:00:00.000Z'));
    const freshness = projectFreshness(store, projectId).views[viewId]!;
    expect(store.latestRevisionId()).toBe(latest);
    expect(freshness.evidence).not.toMatchObject({ stale: null });
    store.database.close();
  });

  it('evaluates $today filters on the revision date when computing later freshness', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-12T18:00:00.000Z'));
    const store = new Store(openDatabase(':memory:'));
    const { created } = store.apply(owner, {
      message: 'Set up date-sensitive page',
      operations: [
        { op: 'create', type: 'project', ref: 'p', data: { name: 'Demo' } },
        {
          op: 'create',
          type: 'task',
          ref: 't',
          data: {
            projectId: '$p',
            title: 'Due task',
            status: 'todo',
            dueDate: '2026-10-11',
          },
        },
      ],
    });
    const projectId = created.p!;
    const taskId = created.t!;
    const viewId = answerView(store, agent, {
      projectId,
      question: 'What is due today?',
      widgets: [
        {
          id: 'due',
          node: {
            component: 'TaskTable',
            filter: { where: { dueDate: '$today' } },
          },
        },
      ],
    }).view.id;

    // Establish the seen mark and evidence while today is October 12.
    expect(projectFreshness(store, projectId).views[viewId]!.changed).toBeNull();
    store.apply(agent, {
      message: 'Move the due date to today',
      operations: [{ op: 'update', type: 'task', id: taskId, data: { dueDate: '2026-10-12' } }],
    });

    // By October 13, both snapshots are outside the live $today query, even though the after
    // snapshot matched the query on the day this revision was made.
    vi.setSystemTime(new Date('2026-10-13T18:00:00.000Z'));
    const freshness = projectFreshness(store, projectId).views[viewId]!;

    expect.soft(freshness.changed).toMatchObject({ total: 1 });
    expect.soft(freshness.evidence).toMatchObject({ stale: { total: 1 } });
  });

  it('keeps deletion and owner-revert history in stale evidence, but skips it in since-looked', () => {
    const store = new Store(openDatabase(':memory:'));
    const { created } = store.apply(owner, {
      message: 'Set up a blocked task',
      operations: [
        { op: 'create', type: 'project', ref: 'p', data: { name: 'Demo' } },
        {
          op: 'create',
          type: 'task',
          ref: 't',
          data: { projectId: '$p', title: 'Blocked task', status: 'blocked' },
        },
      ],
    });
    const projectId = created.p!;
    const taskId = created.t!;
    const viewId = answerView(store, agent, {
      projectId,
      question: 'What is blocked?',
      widgets: [
        {
          id: 'blocked',
          node: {
            component: 'TaskTable',
            filter: { where: { status: 'blocked' } },
          },
        },
      ],
    }).view.id;
    projectFreshness(store, projectId);

    const deletion = store.apply(owner, {
      message: 'Remove the task',
      operations: [{ op: 'delete', type: 'task', id: taskId }],
    });
    expect(deletion.revision).not.toBeNull();
    store.revert(deletion.revision!.id, owner, 'Restore the task');

    const freshness = projectFreshness(store, projectId).views[viewId]!;
    expect(freshness.changed).toBeNull();
    expect(freshness.evidence).toMatchObject({ stale: { total: 2 } });
  });
});
