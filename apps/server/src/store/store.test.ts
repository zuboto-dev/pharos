import { beforeEach, describe, expect, it } from 'vitest';
import type { Author, Operation } from '@pharos/schema';
import { openDatabase } from './database.js';
import { PharosError } from './errors.js';
import { projectSnapshot } from './snapshot.js';
import { Store } from './store.js';

const agent: Author = { kind: 'agent', name: 'test-agent' };
const human: Author = { kind: 'human', name: 'me' };

let store: Store;
beforeEach(() => {
  store = new Store(openDatabase(':memory:'));
});

function apply(message: string, ...operations: Operation[]) {
  return store.apply(agent, { message, operations });
}

function seedProject() {
  const { created } = apply(
    'Set up project',
    { op: 'create', type: 'repository', ref: 'repo', data: { name: 'pharos' } },
    { op: 'create', type: 'project', ref: 'p', data: { name: 'Pharos', repositoryId: '$repo' } },
    { op: 'create', type: 'stage', ref: 's1', data: { projectId: '$p', name: 'Foundations' } },
    { op: 'create', type: 'stage', ref: 's2', data: { projectId: '$p', name: 'Data' } },
    {
      op: 'create',
      type: 'task',
      ref: 't1',
      data: { projectId: '$p', title: 'Init repo', stageId: '$s1' },
    },
    {
      op: 'create',
      type: 'task',
      ref: 't2',
      data: { projectId: '$p', title: 'Schema', stageId: '$s2', dependsOn: ['$t1'] },
    },
    { op: 'update', type: 'project', id: '$p', data: { currentStageId: '$s1' } },
  );
  return created as Record<'repo' | 'p' | 's1' | 's2' | 't1' | 't2', string>;
}

function errorOf(fn: () => unknown): PharosError {
  try {
    fn();
  } catch (err) {
    if (err instanceof PharosError) return err;
    throw err;
  }
  throw new Error('expected an error');
}

describe('apply', () => {
  it('creates entities with defaults, refs, and order in one revision', () => {
    const ids = seedProject();
    const t2 = store.getOfType('task', ids.t2);
    expect(t2.data).toMatchObject({
      status: 'todo',
      priority: 'medium',
      stageId: ids.s2,
      dependsOn: [ids.t1],
      order: 1,
    });
    expect(store.getOfType('project', ids.p).data.currentStageId).toBe(ids.s1);
    const [rev] = store.history();
    expect(rev).toMatchObject({ id: 1, author: agent, message: 'Set up project' });
    expect(rev!.changes.map((c) => c.op)).toEqual(Array(7).fill('create'));
  });

  it('gives new projects a default Overview view in the same revision', () => {
    const ids = seedProject();
    const views = store.list('view', { projectId: ids.p });
    expect(views.map((v) => v.data)).toEqual([
      { projectId: ids.p, name: 'Overview', template: 'overview', pinned: true, order: 0 },
    ]);
    expect(views[0]!.createdRev).toBe(1);
  });

  it('backfills default views for projects that have none', () => {
    const ids = seedProject();
    const [view] = store.list('view', { projectId: ids.p });
    apply('Remove view', { op: 'delete', type: 'view', id: view!.id });
    const result = store.ensureDefaultViews();
    expect(result.revision).toMatchObject({ author: { kind: 'system', name: 'pharos' } });
    expect(store.list('view', { projectId: ids.p })).toHaveLength(1);
    expect(store.ensureDefaultViews().revision).toBeNull();
  });

  it('accepts board specs and rejects bad widgets', () => {
    const ids = seedProject();
    const [view] = store.list('view', { projectId: ids.p });
    const board = {
      component: 'Board',
      widgets: [
        { id: 'ring', w: 4, h: 240, node: { component: 'ProgressRing' } },
        { id: 'kanban', w: 8, node: { component: 'KanbanBoard', groupBy: 'stage' } },
      ],
    };
    apply('Customize overview', {
      op: 'update',
      type: 'view',
      id: view!.id,
      data: { spec: board },
    });
    expect(store.getOfType('view', view!.id).data).toMatchObject({
      template: 'overview',
      spec: board,
    });
    const err = errorOf(() =>
      apply('Bad widget', {
        op: 'update',
        type: 'view',
        id: view!.id,
        data: { spec: { ...board, widgets: [{ id: 'x', w: 0, node: { component: 'GoalTree' } }] } },
      }),
    );
    expect(err.issues.join('\n')).toMatch(/data\.spec\.widgets\[0\]\.w/);
  });

  it('validates view specs against the catalog', () => {
    const ids = seedProject();
    const err = errorOf(() =>
      apply('Bad view', {
        op: 'create',
        type: 'view',
        data: {
          projectId: ids.p,
          name: 'Board',
          spec: { component: 'Grid', children: [{ component: 'KanbanBoard', groupBy: 'colour' }] },
        },
      }),
    );
    expect(err.issues[0]).toMatch(/^data\.spec\.children\[0\]\.groupBy: Invalid option/);
  });

  it('two projects can share a repository', () => {
    const ids = seedProject();
    apply('Second project', {
      op: 'create',
      type: 'project',
      data: { name: 'Docs site', repositoryId: ids.repo },
    });
    expect(store.list('project', { where: { repositoryId: ids.repo } })).toHaveLength(2);
  });

  it('rolls back everything when one operation is invalid', () => {
    const ids = seedProject();
    const err = errorOf(() =>
      apply(
        'Bad batch',
        { op: 'update', type: 'task', id: ids.t1, data: { status: 'done' } },
        { op: 'update', type: 'task', id: ids.t2, data: { title: null } },
      ),
    );
    expect(err.issues).toEqual(['data.title: Invalid input: expected string, received undefined']);
    expect(err.message).toContain('operations[1]');
    expect(store.getOfType('task', ids.t1).data.status).toBe('todo');
    expect(store.latestRevisionId()).toBe(1);
  });

  it('rejects missing, cross-project, and cyclic references', () => {
    const ids = seedProject();
    const other = apply('Other', { op: 'create', type: 'project', data: { name: 'Other' } })
      .created['0']!;
    expect(
      errorOf(() =>
        apply('x', { op: 'update', type: 'task', id: ids.t1, data: { stageId: 'stg_nope' } }),
      ).issues[0],
    ).toMatch(/stageId → stage stg_nope not found/);
    expect(
      errorOf(() =>
        apply('x', {
          op: 'create',
          type: 'task',
          data: { projectId: other, title: 'T', stageId: ids.s1 },
        }),
      ).issues[0],
    ).toMatch(/belongs to another project/);
    expect(
      errorOf(() =>
        apply('x', { op: 'update', type: 'task', id: ids.t1, data: { dependsOn: [ids.t2] } }),
      ).issues[0],
    ).toMatch(/dependsOn creates a cycle/);
  });

  it('clears an optional field with null and skips no-op updates', () => {
    const ids = seedProject();
    apply('Unassign stage', { op: 'update', type: 'task', id: ids.t1, data: { stageId: null } });
    expect(store.getOfType('task', ids.t1).data.stageId).toBeUndefined();
    const result = apply('No-op', {
      op: 'update',
      type: 'task',
      id: ids.t1,
      data: { title: 'Init repo' },
    });
    expect(result.revision).toBeNull();
  });

  it('unsets references and cascades deletes', () => {
    const ids = seedProject();
    const result = apply('Drop stage 1', { op: 'delete', type: 'stage', id: ids.s1 });
    expect(store.getOfType('task', ids.t1).data.stageId).toBeUndefined();
    expect(store.getOfType('project', ids.p).data.currentStageId).toBeUndefined();
    expect(result.changes.map((c) => `${c.op} ${c.type}`).sort()).toEqual([
      'delete stage',
      'update project',
      'update task',
    ]);

    apply('Drop the project', { op: 'delete', type: 'project', id: ids.p });
    expect(store.list('task')).toHaveLength(0);
    expect(store.list('repository')).toHaveLength(1);
  });
});

describe('custom options', () => {
  const statuses = [
    { value: 'backlog', label: 'Backlog', meaning: 'todo' },
    { value: 'doing', label: 'Doing', meaning: 'in_progress' },
    { value: 'review', label: 'In review', meaning: 'in_progress' },
    { value: 'shipped', label: 'Shipped', meaning: 'done' },
  ];

  it('uses the project’s options for defaults and validation', () => {
    const ids = seedProject();
    // Existing tasks use todo/…, so switching options must move them in the same change.
    const err = errorOf(() =>
      apply('Custom statuses', {
        op: 'update',
        type: 'project',
        id: ids.p,
        data: { options: { 'task.status': statuses } },
      }),
    );
    expect(err.issues).toEqual([
      expect.stringMatching(/2 tasks still use task status "todo", which isn't an option anymore/),
    ]);
    apply(
      'Custom statuses',
      { op: 'update', type: 'project', id: ids.p, data: { options: { 'task.status': statuses } } },
      { op: 'update', type: 'task', id: ids.t1, data: { status: 'backlog' } },
      { op: 'update', type: 'task', id: ids.t2, data: { status: 'review' } },
    );
    const { created } = apply('New task', {
      op: 'create',
      type: 'task',
      data: { projectId: ids.p, title: 'Default' },
    });
    expect(store.getOfType('task', created['0']!).data.status).toBe('backlog');
    expect(
      errorOf(() =>
        apply('Bad', { op: 'update', type: 'task', id: ids.t1, data: { status: 'done' } }),
      ).issues[0],
    ).toMatch(
      /status "done" isn't one of this project's task status options \(backlog, doing, review, shipped\)/,
    );
  });

  it('measures snapshot progress by meaning', () => {
    const ids = seedProject();
    apply(
      'Custom statuses',
      { op: 'update', type: 'project', id: ids.p, data: { options: { 'task.status': statuses } } },
      { op: 'update', type: 'task', id: ids.t1, data: { status: 'shipped' } },
      { op: 'update', type: 'task', id: ids.t2, data: { status: 'review' } },
    );
    const snap = projectSnapshot(store, ids.p);
    expect(snap.progress).toEqual({ percentDone: 50, tasks: { shipped: 1, review: 1 } });
    expect(snap.options['task.status']).toHaveLength(4);
    expect(snap.options).not.toHaveProperty('task.priority');
  });

  it('sorts scope items by meaning when the project has custom scope options', () => {
    const ids = seedProject();
    apply(
      'Custom scope',
      {
        op: 'update',
        type: 'project',
        id: ids.p,
        data: {
          options: {
            'scope_item.kind': [
              { value: 'core', label: 'Core', meaning: 'in' },
              { value: 'later', label: 'Later', meaning: 'maybe' },
              { value: 'never', label: 'Never', meaning: 'out' },
            ],
          },
        },
      },
      { op: 'create', type: 'scope_item', data: { projectId: ids.p, title: 'A', kind: 'core' } },
      { op: 'create', type: 'scope_item', data: { projectId: ids.p, title: 'B', kind: 'later' } },
      { op: 'create', type: 'scope_item', data: { projectId: ids.p, title: 'C', kind: 'never' } },
    );
    const { scope } = projectSnapshot(store, ids.p);
    expect(scope.in.map((s) => s.title)).toEqual(['A']);
    expect(scope.maybe.map((s) => s.title)).toEqual(['B']);
    expect(scope.out.map((s) => s.title)).toEqual(['C']);
  });

  it('clears request.aboutId when the item it was about is deleted', () => {
    const ids = seedProject();
    const { created } = apply('Ask', {
      op: 'create',
      type: 'request',
      data: { projectId: ids.p, question: 'Why?', aboutId: ids.t2 },
    });
    apply('Drop task', { op: 'delete', type: 'task', id: ids.t2 });
    expect(store.getOfType('request', created['0']!).data.aboutId).toBeUndefined();
  });

  it('lists assignees with ids, so an agent can assign a task to itself', () => {
    const ids = seedProject();
    const { created } = apply('Codex joins', {
      op: 'create',
      type: 'assignee',
      data: { name: 'Codex', kind: 'agent' },
    });
    expect(projectSnapshot(store, ids.p).assignees).toContainEqual({
      id: created['0'],
      name: 'Codex',
      kind: 'agent',
    });
  });
});

describe('history, diff, revert', () => {
  it('filters history by project and entity', () => {
    const ids = seedProject();
    apply('Start', { op: 'update', type: 'task', id: ids.t1, data: { status: 'in_progress' } });
    apply('Other', { op: 'create', type: 'project', data: { name: 'Other' } });
    expect(store.history({ projectId: ids.p }).map((r) => r.message)).toEqual([
      'Start',
      'Set up project',
    ]);
    expect(store.history({ entityId: ids.t1 }).map((r) => r.id)).toEqual([2, 1]);
  });

  it('diffs net changes across revisions', () => {
    const ids = seedProject();
    apply('Start', { op: 'update', type: 'task', id: ids.t1, data: { status: 'in_progress' } });
    apply('Finish', { op: 'update', type: 'task', id: ids.t1, data: { status: 'done' } });
    expect(store.diff({ from: 1 })).toEqual([
      {
        op: 'update',
        type: 'task',
        id: ids.t1,
        label: 'Init repo',
        fields: { status: { before: 'todo', after: 'done' } },
      },
    ]);
  });

  it('reverts an update, a delete, and a whole setup revision', () => {
    const ids = seedProject();
    apply('Finish', { op: 'update', type: 'task', id: ids.t1, data: { status: 'done' } });
    store.revert(2, human);
    expect(store.getOfType('task', ids.t1).data.status).toBe('todo');
    expect(store.revision(3)).toMatchObject({
      revertOf: 2,
      author: human,
      message: 'Revert revision 2: Finish',
    });
    expect(store.revision(2)!.revertedBy).toBe(3);
    expect(store.history().find((r) => r.id === 3)!.revertedBy).toBeNull();

    apply('Drop stage', { op: 'delete', type: 'stage', id: ids.s1 });
    store.revert(4, human);
    expect(store.getOfType('task', ids.t1).data.stageId).toBe(ids.s1);
    expect(store.getOfType('project', ids.p).data.currentStageId).toBe(ids.s1);

    store.revert(1, human);
    expect(store.list('project')).toHaveLength(0);
    expect(store.list('repository')).toHaveLength(0);
  });

  it('refuses to revert when later revisions conflict', () => {
    const ids = seedProject();
    apply('Start', { op: 'update', type: 'task', id: ids.t1, data: { status: 'in_progress' } });
    apply('Finish', { op: 'update', type: 'task', id: ids.t1, data: { status: 'done' } });
    expect(errorOf(() => store.revert(2, human)).issues).toEqual([
      'task ' + ids.t1 + ' ("Init repo"): status was changed later',
    ]);
    apply('Add task', { op: 'create', type: 'task', data: { projectId: ids.p, title: 'Later' } });
    expect(errorOf(() => store.revert(1, human)).code).toBe('conflict');
    store.revert(3, human);
    expect(errorOf(() => store.revert(3, human)).message).toMatch(/already reverted/);
  });
});

describe('projectSnapshot', () => {
  it('summarises progress, stages, and goals', () => {
    const ids = seedProject();
    apply(
      'Progress',
      { op: 'update', type: 'task', id: ids.t1, data: { status: 'done' } },
      { op: 'create', type: 'goal', ref: 'g', data: { projectId: ids.p, title: 'Ship v1' } },
      {
        op: 'create',
        type: 'goal',
        data: { projectId: ids.p, title: 'MCP works', parentId: '$g' },
      },
    );
    const snap = projectSnapshot(store, ids.p);
    expect(snap.progress).toEqual({ percentDone: 50, tasks: { done: 1, todo: 1 } });
    expect(snap.stages.map((s) => [s.name, s.current, s.percentDone])).toEqual([
      ['Foundations', true, 100],
      ['Data', false, 0],
    ]);
    expect(snap.goals).toHaveLength(1);
    expect(snap.goals[0]!.subgoals[0]!.title).toBe('MCP works');
    expect(snap.project.repository?.name).toBe('pharos');
  });
});
