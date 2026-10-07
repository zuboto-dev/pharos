import { describe, expect, it } from 'vitest';
import type { Entity, EntityDataMap } from './entities.js';
import { newOptionValue, optionsFor, valueFor, type ProjectOptions } from './options.js';
import { stageProgress, taskProgress } from './views/progress.js';
import type { ProjectDataset } from './views/query.js';
import { runQuery } from './views/run-query.js';

const options: ProjectOptions = {
  'task.status': [
    { value: 'backlog', label: 'Backlog', meaning: 'todo' },
    { value: 'doing', label: 'Doing', meaning: 'in_progress' },
    { value: 'review', label: 'In review', meaning: 'in_progress', color: 'violet' },
    { value: 'shipped', label: 'Shipped', meaning: 'done' },
    { value: 'wont', label: 'Won’t do', meaning: 'cancelled' },
  ],
  'task.priority': [
    { value: 'p2', label: 'P2', meaning: 'low' },
    { value: 'p1', label: 'P1', meaning: 'high' },
    { value: 'p0', label: 'P0', meaning: 'urgent' },
  ],
};

const project = { data: { name: 'P', status: 'active', options } } as unknown as Entity<'project'>;
const task = (id: string, data: Partial<EntityDataMap['task']>) =>
  ({
    id,
    type: 'task',
    data: {
      projectId: 'p',
      title: id,
      status: 'backlog',
      priority: 'p2',
      dependsOn: [],
      order: 0,
      ...data,
    },
    createdRev: 1,
  }) as Entity<'task'>;
const tasks = [
  task('a', { status: 'shipped', stageId: 's' }),
  task('b', { status: 'review', priority: 'p0', stageId: 's' }),
  task('c', { status: 'doing', priority: 'p1' }),
  task('d', { status: 'wont' }),
];
const data = {
  project,
  tasks,
  stages: [],
  goals: [],
  scopeItems: [],
  artifacts: [],
  decisions: [],
  views: [],
  assignees: [],
  repository: null,
} as unknown as ProjectDataset;
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe('custom options', () => {
  it('falls back to defaults and fills colours from meanings', () => {
    expect(optionsFor(null, 'scope_item.kind').map((o) => [o.value, o.color])).toEqual([
      ['in', 'green'],
      ['maybe', 'amber'],
      ['out', 'muted'],
    ]);
    expect(optionsFor(project, 'task.status')[2]).toMatchObject({
      label: 'In review',
      color: 'violet',
    });
    expect(optionsFor(project, 'task.status')[1]).toMatchObject({ color: 'blue' });
  });

  it('matches queries by value or by meaning', () => {
    expect(ids(runQuery(data, 'task', { where: { status: 'in_progress' } }))).toEqual(['b', 'c']);
    expect(ids(runQuery(data, 'task', { where: { status: 'review' } }))).toEqual(['b']);
    expect(
      ids(runQuery(data, 'task', { where: { status: { not: ['done', 'cancelled'] } } })),
    ).toEqual(['b', 'c']);
  });

  it('sorts by the project’s option order', () => {
    expect(ids(runQuery(data, 'task', { sort: [{ field: 'priority', dir: 'desc' }] }))).toEqual([
      'b',
      'c',
      'a',
      'd',
    ]);
  });

  it('measures progress by meaning', () => {
    expect(taskProgress(tasks, project)).toEqual({ percent: 33, done: 1, total: 3 });
    expect(stageProgress({ id: 's', data: { status: 'active' } }, tasks, project)).toMatchObject({
      done: 1,
      total: 2,
      basis: 'tasks',
    });
  });

  it('picks values for meanings and derives new values from labels', () => {
    expect(valueFor(project, 'task.status', 'done')).toBe('shipped');
    expect(valueFor(null, 'task.status', 'done')).toBe('done');
    const list = optionsFor(project, 'task.status');
    expect(newOptionValue('Ready for QA!', 'task.status', list)).toBe('ready_for_qa');
    expect(newOptionValue('Done', 'task.status', list)).toBe('done_2');
    expect(newOptionValue('Review', 'task.status', list)).toBe('review_2');
  });
});
