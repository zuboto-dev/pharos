import { describe, expect, it } from 'vitest';
import type { Entity } from '../entities.js';
import type { ProjectDataset } from './query.js';
import { boardReads, changeTouches, type ChangeLike } from './reads.js';
import { filterMatcher, runQuery } from './run-query.js';
import { toBoard, type ViewSpec } from './board.js';

const project = (data: Record<string, unknown> = {}) =>
  ({
    id: 'prj_aaaaaaaaaaaa',
    type: 'project',
    data: { name: 'Demo', status: 'active', order: 0, ...data },
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    createdRev: 1,
    updatedRev: 1,
  }) as unknown as Entity<'project'>;

const entity = <T extends Entity['type']>(
  type: T,
  id: string,
  data: Record<string, unknown>,
  metadata: Partial<Pick<Entity, 'createdAt' | 'updatedAt' | 'createdRev' | 'updatedRev'>> = {},
) =>
  ({
    id,
    type,
    data,
    createdAt: metadata.createdAt ?? '2026-10-01T00:00:00.000Z',
    updatedAt: metadata.updatedAt ?? '2026-10-12T00:00:00.000Z',
    createdRev: metadata.createdRev ?? 1,
    updatedRev: metadata.updatedRev ?? 2,
  }) as unknown as Entity<T>;

function dataset(overrides: Partial<ProjectDataset> = {}): ProjectDataset {
  return {
    project: project(),
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
    ...overrides,
  };
}

const touches = (node: ViewSpec, change: ChangeLike, data: ProjectDataset) =>
  changeTouches(boardReads(toBoard(node)), change, filterMatcher(data, { today: '2026-10-13' }));

describe('R11 read tracking review cases', () => {
  it('counts a referenced stage change when a task query filters through stage.status', () => {
    const stage = entity('stage', 'stg_bbbbbbbbbbbb', {
      projectId: 'prj_aaaaaaaaaaaa',
      name: 'Build',
      status: 'done',
      order: 0,
    });
    const task = entity('task', 'task_cccccccccccc', {
      projectId: 'prj_aaaaaaaaaaaa',
      stageId: stage.id,
      title: 'Ship it',
      status: 'todo',
      priority: 'medium',
      dependsOn: [],
      order: 0,
    });
    const data = dataset({ stages: [stage], tasks: [task] });
    const node = {
      component: 'TaskTable',
      filter: { where: { 'stage.status': 'active' } },
    } satisfies ViewSpec;
    const change: ChangeLike = {
      type: 'stage',
      id: stage.id,
      before: { ...stage.data, status: 'active' },
      after: stage.data,
    };

    expect(touches(node, change, data)).toBe(true);
  });

  it('counts a referenced label change displayed by a task table', () => {
    const stage = entity('stage', 'stg_bbbbbbbbbbbb', {
      projectId: 'prj_aaaaaaaaaaaa',
      name: 'Build',
      status: 'active',
      order: 0,
    });
    const task = entity('task', 'task_cccccccccccc', {
      projectId: 'prj_aaaaaaaaaaaa',
      stageId: stage.id,
      title: 'Ship it',
      status: 'todo',
      priority: 'medium',
      dependsOn: [],
      order: 0,
    });
    const node = {
      component: 'DataTable',
      query: { type: 'task' },
      columns: [{ field: 'title' }, { field: 'stage.name' }],
    } satisfies ViewSpec;

    expect(
      touches(
        node,
        { type: 'stage', id: stage.id, before: stage.data, after: { ...stage.data, name: 'Ship' } },
        dataset({ stages: [stage], tasks: [task] }),
      ),
    ).toBe(true);
  });

  it('counts project currentStage changes used by the $currentStage query value', () => {
    const oldStage = entity('stage', 'stg_bbbbbbbbbbbb', {
      projectId: 'prj_aaaaaaaaaaaa',
      name: 'Old',
      status: 'active',
      order: 0,
    });
    const task = entity('task', 'task_cccccccccccc', {
      projectId: 'prj_aaaaaaaaaaaa',
      stageId: oldStage.id,
      title: 'Ship it',
      status: 'todo',
      priority: 'medium',
      dependsOn: [],
      order: 0,
    });
    const node = {
      component: 'TaskTable',
      filter: { where: { stageId: '$currentStage' } },
    } satisfies ViewSpec;

    expect(
      touches(
        node,
        {
          type: 'project',
          id: 'prj_aaaaaaaaaaaa',
          before: { currentStageId: oldStage.id },
          after: { currentStageId: 'stg_dddddddddddd' },
        },
        dataset({
          project: project({ currentStageId: 'stg_dddddddddddd' }),
          stages: [oldStage],
          tasks: [task],
        }),
      ),
    ).toBe(true);
  });

  it('counts option-label changes that change how a task row is rendered', () => {
    const node = { component: 'TaskTable' } satisfies ViewSpec;
    const before = { name: 'Demo', status: 'active', order: 0 };
    const after = {
      ...before,
      options: {
        'task.status': [
          { value: 'todo', label: 'Waiting for owner', meaning: 'todo' },
          { value: 'in_progress', label: 'In progress', meaning: 'in_progress' },
          { value: 'blocked', label: 'Blocked', meaning: 'blocked' },
          { value: 'done', label: 'Done', meaning: 'done' },
          { value: 'cancelled', label: 'Cancelled', meaning: 'cancelled' },
        ],
      },
    };

    expect(
      touches(
        node,
        { type: 'project', id: 'prj_aaaaaaaaaaaa', before, after },
        dataset({ project: project(after) }),
      ),
    ).toBe(true);
  });

  it('counts a record field-unit change that changes a DataTable cell', () => {
    const node = {
      component: 'DataTable',
      query: { type: 'record', where: { recordType: 'vehicle' } },
      columns: [{ field: 'title' }, { field: 'fields.odometer' }],
    } satisfies ViewSpec;
    const before = {
      name: 'Demo',
      status: 'active',
      order: 0,
      recordTypes: [
        {
          key: 'vehicle',
          name: 'Vehicle',
          fields: [{ key: 'odometer', label: 'Odometer', kind: 'meter', unit: 'km' }],
        },
      ],
    };
    const after = {
      ...before,
      recordTypes: [
        {
          key: 'vehicle',
          name: 'Vehicle',
          fields: [{ key: 'odometer', label: 'Odometer', kind: 'meter', unit: 'mi' }],
        },
      ],
    };
    const vehicle = entity('record', 'rec_bbbbbbbbbbbb', {
      projectId: 'prj_aaaaaaaaaaaa',
      recordType: 'vehicle',
      title: 'Van',
      fields: { odometer: 100 },
    });

    expect(
      touches(
        node,
        { type: 'project', id: 'prj_aaaaaaaaaaaa', before, after },
        dataset({ project: project(after), records: [vehicle] }),
      ),
    ).toBe(true);
  });

  it('counts a referenced record change when a record query filters through that record', () => {
    const vehicle = entity('record', 'rec_bbbbbbbbbbbb', {
      projectId: 'prj_aaaaaaaaaaaa',
      recordType: 'vehicle',
      title: 'Car A',
      fields: {},
    });
    const service = entity('record', 'rec_cccccccccccc', {
      projectId: 'prj_aaaaaaaaaaaa',
      recordType: 'service',
      title: 'Oil change',
      fields: { vehicle: vehicle.id },
    });
    const node = {
      component: 'DataTable',
      query: { type: 'record', where: { recordType: 'service', 'fields.vehicle.title': 'Car A' } },
      columns: [{ field: 'title' }, { field: 'fields.vehicle.title' }],
    } satisfies ViewSpec;

    expect(
      touches(
        node,
        {
          type: 'record',
          id: vehicle.id,
          before: vehicle.data,
          after: { ...vehicle.data, title: 'Car B' },
        },
        dataset({
          records: [entity('record', vehicle.id, { ...vehicle.data, title: 'Car B' }), service],
        }),
      ),
    ).toBe(true);
  });

  it('counts a linked file metadata change on a claim card', () => {
    const claim = entity('claim', 'clm_bbbbbbbbbbbb', {
      projectId: 'prj_aaaaaaaaaaaa',
      statement: 'The policy covers repairs.',
      certainty: 'verified',
      sourceIds: [],
      tags: [],
      fileIds: ['file_cccccccccccc'],
    });
    const file = entity('file', 'file_cccccccccccc', {
      projectId: 'prj_aaaaaaaaaaaa',
      path: 'policy.md',
      title: 'Policy',
      kind: 'contract',
      tags: [],
      taskIds: [],
    });
    const node = { component: 'ClaimCard', claim: claim.id } satisfies ViewSpec;

    expect(
      touches(
        node,
        {
          type: 'file',
          id: file.id,
          before: file.data,
          after: { ...file.data, title: 'Updated policy' },
        },
        dataset({ claims: [claim], files: [file] }),
      ),
    ).toBe(true);
  });

  it('still counts metadata changes for files listed directly by FileList', () => {
    const file = entity('file', 'file_bbbbbbbbbbbb', {
      projectId: 'prj_aaaaaaaaaaaa',
      path: 'policy.md',
      title: 'Policy',
      kind: 'contract',
      tags: [],
      taskIds: [],
    });

    expect(
      touches(
        { component: 'FileList' },
        { type: 'file', id: file.id, before: file.data, after: { ...file.data, title: 'Updated' } },
        dataset({ files: [file] }),
      ),
    ).toBe(true);
  });

  it('does not mark a change to an older onePer row when it stays hidden', () => {
    const first = entity('record', 'rec_bbbbbbbbbbbb', {
      projectId: 'prj_aaaaaaaaaaaa',
      recordType: 'mix',
      title: 'Newest',
      fields: { song: 'A', date: '2026-10-12', notes: 'first' },
      order: 0,
    });
    const older = entity('record', 'rec_cccccccccccc', {
      projectId: 'prj_aaaaaaaaaaaa',
      recordType: 'mix',
      title: 'Older',
      fields: { song: 'A', date: '2026-10-11', notes: 'old version' },
      order: 1,
    });
    const node = {
      component: 'DataList',
      query: {
        type: 'record',
        where: { recordType: 'mix' },
        sort: [{ field: 'fields.date', dir: 'desc' }],
        onePer: 'fields.song',
      },
    } satisfies ViewSpec;
    const data = dataset({ records: [first, older] });
    const change: ChangeLike = {
      type: 'record',
      id: older.id,
      before: older.data,
      after: { ...older.data, fields: { ...older.data.fields, notes: 'corrected' } },
    };

    expect(runQuery(data, 'record', node.query).map((row) => row.id)).toEqual([first.id]);
    expect(touches(node, change, data)).toBe(false);
  });

  it('uses entity timestamps when a query selects by createdAt or updatedAt', () => {
    const task = entity(
      'task',
      'task_bbbbbbbbbbbb',
      {
        projectId: 'prj_aaaaaaaaaaaa',
        title: 'Ship it',
        status: 'todo',
        priority: 'medium',
        dependsOn: [],
        order: 0,
      },
      { createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-12T00:00:00.000Z' },
    );
    const node = {
      component: 'TaskTable',
      filter: { where: { updatedAt: '2026-10-12T00:00:00.000Z' } },
    } satisfies ViewSpec;
    const change: ChangeLike = {
      type: 'task',
      id: task.id,
      before: task.data,
      after: { ...task.data, title: 'Ship it now' },
    };

    expect(touches(node, change, dataset({ tasks: [task] }))).toBe(true);
  });

  it('still counts a matching item when its query result is deleted', () => {
    const node = {
      component: 'DataList',
      query: { type: 'task', where: { status: 'blocked' } },
    } satisfies ViewSpec;
    const blocked = {
      projectId: 'prj_aaaaaaaaaaaa',
      title: 'Blocked task',
      status: 'blocked',
      priority: 'high',
      dependsOn: [],
      order: 0,
    };

    expect(
      touches(
        node,
        { type: 'task', id: 'task_bbbbbbbbbbbb', before: blocked, after: null },
        dataset(),
      ),
    ).toBe(true);
  });

  it('still catches a sum input edit because the row matched before and after', () => {
    const node = {
      component: 'CountChart',
      query: { type: 'record', where: { recordType: 'bill' } },
      by: 'fields.category',
      sum: 'fields.amount',
    } satisfies ViewSpec;
    const before = { projectId: 'prj_aaaaaaaaaaaa', recordType: 'bill', fields: { amount: 900 } };
    const after = { ...before, fields: { amount: 1200 } };

    expect(
      touches(node, { type: 'record', id: 'rec_bbbbbbbbbbbb', before, after }, dataset()),
    ).toBe(true);
  });
});
