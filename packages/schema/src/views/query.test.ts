import { describe, expect, it } from 'vitest';
import type { Entity, EntityDataMap, EntityType } from '../entities.js';
import type { ProjectDataset } from './query.js';
import { runQuery } from './run-query.js';

let rev = 0;
function entity<T extends EntityType>(type: T, id: string, data: EntityDataMap[T]): Entity<T> {
  rev++;
  return { id, type, data, createdAt: '', updatedAt: '', createdRev: rev, updatedRev: rev };
}

const task = (id: string, data: Partial<EntityDataMap['task']>) =>
  entity('task', id, {
    projectId: 'p',
    title: id,
    status: 'todo',
    priority: 'medium',
    dependsOn: [],
    order: 0,
    ...data,
  });

const data: ProjectDataset = {
  project: entity('project', 'p', { name: 'P', status: 'active', currentStageId: 's2', order: 0 }),
  repository: null,
  assignees: [],
  goals: [],
  scopeItems: [],
  stages: [],
  tasks: [
    task('a', { stageId: 's1', status: 'done', priority: 'low' }),
    task('b', { stageId: 's2', status: 'in_progress', priority: 'high', dependsOn: ['a'] }),
    task('c', { stageId: 's2', status: 'cancelled', estimate: '2h' }),
    task('d', { status: 'todo', priority: 'urgent' }),
  ],
  artifacts: [],
  decisions: [],
  views: [],
  requests: [],
  claims: [],
  terms: [],
  files: [],
};

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe('runQuery', () => {
  it('filters by value, any-of, not, exists, and array membership', () => {
    expect(ids(runQuery(data, 'task', { where: { status: 'done' } }))).toEqual(['a']);
    expect(ids(runQuery(data, 'task', { where: { status: ['todo', 'done'] } }))).toEqual([
      'a',
      'd',
    ]);
    expect(
      ids(runQuery(data, 'task', { where: { status: { not: ['cancelled', 'done'] } } })),
    ).toEqual(['b', 'd']);
    expect(ids(runQuery(data, 'task', { where: { stageId: { exists: false } } }))).toEqual(['d']);
    expect(ids(runQuery(data, 'task', { where: { dependsOn: 'a' } }))).toEqual(['b']);
    expect(ids(runQuery(data, 'task', { where: { dependsOn: { exists: true } } }))).toEqual(['b']);
  });

  it('resolves $currentStage and sorts with missing values last', () => {
    expect(ids(runQuery(data, 'task', { where: { stageId: '$currentStage' } }))).toEqual([
      'b',
      'c',
    ]);
    expect(
      ids(runQuery(data, 'task', { sort: [{ field: 'estimate', dir: 'asc' }], limit: 2 })),
    ).toEqual(['c', 'a']);
    expect(ids(runQuery(data, 'task', { sort: [{ field: 'priority', dir: 'desc' }] }))).toEqual([
      'd',
      'b',
      'c',
      'a',
    ]);
  });
});
