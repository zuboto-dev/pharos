import { describe, expect, it } from 'vitest';
import type { Entity } from '../entities.js';
import type { ProjectDataset } from './query.js';
import { boardReads, changeTouches, mergeReads, readsNothing } from './reads.js';
import { filterMatcher } from './run-query.js';
import { TEMPLATES } from './templates.js';
import { toBoard } from './board.js';

const project = {
  id: 'prj_aaaaaaaaaaaa',
  type: 'project',
  data: { name: 'Car', status: 'active', order: 0 },
} as unknown as Entity<'project'>;
const empty: ProjectDataset = {
  project,
  repository: null,
  assignees: [],
  goals: [],
  scopeItems: [],
  stages: [],
  tasks: [],
  artifacts: [],
  decisions: [],
  views: [],
  requests: [],
  claims: [],
  terms: [],
  files: [],
  records: [],
};
const matches = filterMatcher(empty, { today: '2026-10-13' });
const record = (recordType: string, fields: Record<string, unknown> = {}) => ({
  type: 'record' as const,
  id: 'rec_bbbbbbbbbbbb',
  before: null,
  after: { projectId: project.id, recordType, title: 'x', fields },
});

describe('what a page reads (R11)', () => {
  it('finds queries, filters, ids and feeds anywhere in a board', () => {
    const reads = boardReads(
      toBoard({
        component: 'Board',
        widgets: [
          {
            id: 'due',
            node: {
              component: 'DueTracker',
              query: { type: 'record', where: { recordType: 'service' } },
            },
          },
          {
            id: 'tabs',
            node: {
              component: 'Tabs',
              tabs: [
                {
                  label: 'A',
                  children: [
                    { component: 'TaskTable', filter: { where: { status: 'blocked' } } },
                    { component: 'ClaimCard', claim: 'clm_cccccccccccc' },
                  ],
                },
              ],
            },
          },
        ],
      }),
    );
    expect(reads.queries).toEqual([
      { type: 'record', filter: { where: { recordType: 'service' } } },
      { type: 'task', filter: { where: { status: 'blocked' } } },
    ]);
    expect([...reads.ids]).toEqual(['clm_cccccccccccc']);
    expect(reads.everything).toBe(false);
    // The Overview template shows the project and its activity.
    const overview = boardReads(toBoard(TEMPLATES.overview));
    expect(overview).toMatchObject({ project: true, everything: true });
  });

  it('a change touches a page only when the item matched one of its queries', () => {
    const reads = boardReads(
      toBoard({
        component: 'Board',
        widgets: [
          {
            id: 'due',
            node: {
              component: 'DueTracker',
              query: { type: 'record', where: { recordType: 'service' } },
            },
          },
        ],
      }),
    );
    expect(changeTouches(reads, record('service'), matches)).toBe(true);
    expect(changeTouches(reads, record('fuel'), matches)).toBe(false);
    // Moving out of the query counts (it matched before).
    expect(
      changeTouches(reads, { ...record('fuel'), before: { ...record('service').after } }, matches),
    ).toBe(true);
    // Pages and questions are never data.
    expect(
      changeTouches(reads, { type: 'view', id: 'view_x', before: null, after: {} }, matches),
    ).toBe(false);
  });
});

describe('read tracking through links and whole queries (R11 fix round)', () => {
  const task = (id: string, data: Record<string, unknown>) =>
    ({
      id,
      type: 'task',
      data: { projectId: project.id, status: 'todo', priority: 'medium', dependsOn: [], ...data },
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      createdRev: 1,
      updatedRev: 1,
    }) as unknown as Entity<'task'>;
  const stage = {
    id: 'stg_bbbbbbbbbbbb',
    type: 'stage',
    data: { projectId: project.id, name: 'Build', status: 'active', order: 0 },
  } as unknown as Entity<'stage'>;

  it('a linked change counts only through an item the query selects', () => {
    const reads = boardReads(
      toBoard({ component: 'TaskTable', filter: { where: { status: 'blocked' } } }),
    );
    const rename = {
      type: 'stage' as const,
      id: stage.id,
      before: stage.data,
      after: { ...stage.data, name: 'Ship' },
    };
    const withTask = (status: string) =>
      filterMatcher({
        ...empty,
        stages: [stage],
        tasks: [task('task_cccccccccccc', { title: 'One', status, stageId: stage.id })],
      });
    // The only task in that stage isn't blocked: the table never shows the stage.
    expect(changeTouches(reads, rename, withTask('done'))).toBe(false);
    expect(changeTouches(reads, rename, withTask('blocked'))).toBe(true);
  });

  it('a limited query counts a row entering or leaving the shown rows, not one past the limit', () => {
    const tasks = ['a', 'b', 'c'].map((n, i) =>
      task(`task_${n.repeat(12)}`, { title: n, order: i }),
    );
    const reads = boardReads(
      toBoard({ component: 'TaskTable', filter: { sort: [{ field: 'order' }], limit: 2 } }),
    );
    const matches = filterMatcher({ ...empty, tasks });
    const edit = (t: Entity<'task'>, set: Record<string, unknown>) => ({
      type: 'task' as const,
      id: t.id,
      before: t.data,
      after: { ...t.data, ...set },
    });
    expect(changeTouches(reads, edit(tasks[2]!, { title: 'c2' }), matches)).toBe(false);
    expect(changeTouches(reads, edit(tasks[2]!, { order: -1 }), matches)).toBe(true);
    expect(changeTouches(reads, edit(tasks[0]!, { title: 'a2' }), matches)).toBe(true);
  });

  it('notes dated and current-stage queries, and pages that read nothing', () => {
    const dated = boardReads(
      toBoard({ component: 'TaskTable', filter: { where: { dueDate: { lte: '$today' } } } }),
    );
    expect(dated.dates).toBe(true);
    expect(dated.currentStage).toBeFalsy();
    const current = boardReads(
      toBoard({ component: 'TaskTable', filter: { where: { stageId: '$currentStage' } } }),
    );
    expect(current.currentStage).toBe(true);
    expect(current.dates).toBeFalsy();
    const prose = boardReads(toBoard({ component: 'Text', content: 'Nothing is blocked.' }));
    expect(readsNothing(prose)).toBe(true);
    expect(readsNothing(mergeReads(prose, dated))).toBe(false);
  });

  it('a project change counts only when the page uses what changed', () => {
    const reads = boardReads(toBoard({ component: 'TaskTable' }));
    const change = (before: Record<string, unknown>, after: Record<string, unknown>) => ({
      type: 'project' as const,
      id: project.id,
      before: { ...project.data, ...before },
      after: { ...project.data, ...after },
    });
    const matches = filterMatcher(empty);
    expect(changeTouches(reads, change({}, { description: 'New words' }), matches)).toBe(false);
    expect(
      changeTouches(reads, change({ currentStageId: 'a' }, { currentStageId: 'b' }), matches),
    ).toBe(false);
    expect(
      changeTouches(
        reads,
        change({}, { recordTypes: [{ key: 'x', name: 'X', fields: [] }] }),
        matches,
      ),
    ).toBe(false);
    expect(changeTouches(reads, change({}, { options: { 'task.status': [] } }), matches)).toBe(
      true,
    );
  });
});
