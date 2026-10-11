import { describe, expect, it } from 'vitest';
import type { Entity, EntityDataMap, EntityType } from '../entities.js';
import { Filter, type ProjectDataset } from './query.js';
import { runQuery } from './run-query.js';

let rev = 0;
function e<T extends EntityType>(
  type: T,
  id: string,
  data: Partial<EntityDataMap[T]>,
  createdAt = '2026-10-01T09:00:00.000Z',
): Entity<T> {
  rev++;
  return {
    id,
    type,
    data: data as EntityDataMap[T],
    createdAt,
    updatedAt: createdAt,
    createdRev: rev,
    updatedRev: rev,
  };
}
const task = (id: string, data: Partial<EntityDataMap['task']>, createdAt?: string) =>
  e(
    'task',
    id,
    {
      projectId: 'p',
      title: id,
      status: 'todo',
      priority: 'medium',
      dependsOn: [],
      order: 0,
      ...data,
    },
    createdAt,
  );

const TODAY = '2026-10-06';
const data: ProjectDataset = {
  project: e('project', 'p', { name: 'P', status: 'active', order: 0, currentStageId: 's_now' }),
  repository: null,
  assignees: [
    e('assignee', 'me', { name: 'Me', kind: 'human' }),
    e('assignee', 'bot', { name: 'Bot', kind: 'agent' }),
  ],
  goals: [
    e('goal', 'g1', {
      projectId: 'p',
      title: 'Ship',
      status: 'achieved',
      successCriteria: [],
      order: 0,
    }),
    e('goal', 'g2', {
      projectId: 'p',
      title: 'Docs',
      parentId: 'g1',
      status: 'open',
      successCriteria: [],
      order: 1,
    }),
  ],
  scopeItems: [],
  stages: [
    e('stage', 's_late', {
      projectId: 'p',
      name: 'Late',
      status: 'active',
      targetDate: '2026-10-01',
      order: 0,
    }),
    e('stage', 's_now', {
      projectId: 'p',
      name: 'Now',
      status: 'active',
      targetDate: '2026-10-12',
      order: 1,
    }),
  ],
  tasks: [
    task('overdue', { dueDate: '2026-10-03', assigneeId: 'me' }),
    task('this_week', { dueDate: '2026-10-09', priority: 'high', assigneeId: 'bot' }),
    task('next_month', { dueDate: '2026-11-10', priority: 'urgent', title: 'Write the README' }),
    task('done_late', { dueDate: '2026-10-02', status: 'done' }),
    task('in_late_stage', { stageId: 's_late', status: 'blocked' }, '2026-10-06T08:00:00.000Z'),
  ],
  artifacts: [],
  decisions: [],
  views: [],
  requests: [],
  claims: [],
  terms: [],
};
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);
const q = (filter: Filter) => ids(runQuery(data, 'task', filter, { today: TODAY }));

describe('query language v2', () => {
  it('finds overdue and due-this-week work with relative dates', () => {
    expect(
      q({ where: { dueDate: { lt: '$today' }, status: { not: ['done', 'cancelled'] } } }),
    ).toEqual(['overdue']);
    expect(q({ where: { dueDate: { gte: '$today', lte: '$today+7d' } } })).toEqual(['this_week']);
    expect(q({ where: { dueDate: { gt: '$today+1w' } } })).toEqual(['next_month']);
    expect(q({ where: { createdAt: { gte: '$today' } } })).toEqual(['in_late_stage']);
  });

  it('follows one reference: tasks in a stage that is past its target date', () => {
    expect(q({ where: { 'stage.targetDate': { lt: '$today' }, status: { not: 'done' } } })).toEqual(
      ['in_late_stage'],
    );
    expect(q({ where: { 'assignee.kind': 'agent' } })).toEqual(['this_week']);
    expect(ids(runQuery(data, 'goal', { where: { 'parent.status': 'achieved' } }))).toEqual(['g2']);
    // A missing reference matches nothing (and nothing crashes).
    expect(q({ where: { 'stage.status': 'active', dueDate: { exists: true } } })).toEqual([]);
  });

  it('searches text and combines "or" groups', () => {
    expect(q({ where: { title: { contains: 'readme' } } })).toEqual(['next_month']);
    expect(
      q({ anyOf: [{ dueDate: { lt: '$today' }, status: { not: 'done' } }, { status: 'blocked' }] }),
    ).toEqual(['overdue', 'in_late_stage']);
  });

  it('compares option fields by their order, by value or meaning', () => {
    expect(q({ where: { priority: { gte: 'high' } } })).toEqual(['this_week', 'next_month']);
    expect(q({ where: { priority: { lt: 'medium' } } })).toEqual([]);
  });

  it('sorts through references', () => {
    expect(
      ids(
        runQuery(data, 'task', {
          where: { stageId: { exists: true } },
          sort: [{ field: 'stage.targetDate' }],
        }),
      ),
    ).toEqual(['in_late_stage']);
    expect(
      q({
        where: { dueDate: { exists: true } },
        sort: [{ field: 'dueDate', dir: 'desc' }],
        limit: 2,
      }),
    ).toEqual(['next_month', 'this_week']);
  });

  it('rejects malformed conditions with a clear path', () => {
    const bad = Filter.safeParse({ where: { dueDate: {} } });
    expect(bad.success).toBe(false);
    expect(
      Filter.safeParse({
        where: { dueDate: { gte: '$today', lt: '$today+7d' } },
        anyOf: [{ status: 'blocked' }],
      }).success,
    ).toBe(true);
    expect(Filter.safeParse({ where: { title: { contains: 3 } } }).success).toBe(false);
  });
});
