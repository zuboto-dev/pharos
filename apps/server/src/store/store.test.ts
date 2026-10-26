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
      { projectId: ids.p, name: 'Overview', template: 'overview', pinned: false, order: 0 },
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

  it('tells agents in the snapshot that a project is archived', () => {
    const ids = seedProject();
    expect(projectSnapshot(store, ids.p).project).not.toHaveProperty('archived');
    apply('Archive', { op: 'update', type: 'project', id: ids.p, data: { status: 'archived' } });
    expect(projectSnapshot(store, ids.p).project.archived).toMatch(/archived this project/);
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

describe('claims and terms', () => {
  // The store compares checkedOn with the server's local date.
  const localDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const today = localDate(new Date());
  const asHuman = (message: string, ...operations: Operation[]) =>
    store.apply(human, { message, operations });

  function seedClaims() {
    const { created } = apply(
      'Set up',
      { op: 'create', type: 'project', ref: 'p', data: { name: 'Map' } },
      {
        op: 'create',
        type: 'artifact',
        ref: 'web',
        data: { projectId: '$p', title: 'Report', uri: 'https://example.com/report' },
      },
      {
        op: 'create',
        type: 'artifact',
        ref: 'file',
        data: { projectId: '$p', title: 'Notes', uri: '/notes/report.md' },
      },
    );
    return created as Record<'p' | 'web' | 'file', string>;
  }
  const claim = (ids: { p: string }, data: Record<string, unknown> = {}): Operation => ({
    op: 'create',
    type: 'claim',
    ref: 'c',
    data: { projectId: ids.p, statement: 'Tambo is open source', checkedOn: today, ...data },
  });

  it('stores claims and terms with defaults, in the dataset, snapshot and history', () => {
    const ids = seedClaims();
    const { created } = apply('Findings', claim(ids, { sourceIds: [ids.web], tags: ['layer-4'] }), {
      op: 'create',
      type: 'term',
      ref: 't',
      data: { projectId: ids.p, word: 'recipe', explanation: 'A saved description of a view' },
    });
    expect(store.getOfType('claim', created.c!).data).toMatchObject({
      certainty: 'reading',
      sourceIds: [ids.web],
      order: 0,
    });
    expect(store.getOfType('term', created.t!).data.alsoCalled).toEqual([]);
    const data = store.dataset(ids.p);
    expect(data.claims.map((c) => c.id)).toEqual([created.c]);
    expect(data.terms.map((t) => t.data.word)).toEqual(['recipe']);
    const snap = projectSnapshot(store, ids.p);
    expect(snap.claims).toEqual([
      {
        id: created.c,
        statement: 'Tambo is open source',
        certainty: 'reading',
        checkedOn: today,
        sources: 1,
        tags: ['layer-4'],
      },
    ]);
    expect(snap.terms).toEqual([{ id: created.t, word: 'recipe' }]);
    // History shows the claim by its statement, and a revert removes both again.
    expect(store.history({ entityId: created.c })[0]!.changes[0]).toMatchObject({
      label: 'Tambo is open source',
    });
    const revision = store.history({ limit: 1 })[0]!.id;
    store.revert(revision, human);
    expect(store.dataset(ids.p).claims).toEqual([]);
  });

  it('warns about a claim without a source, but still saves it', () => {
    const ids = seedClaims();
    const result = apply('No source', claim(ids));
    expect(result.warnings).toEqual([
      `claim ${result.created.c} "Tambo is open source" has no source: add sourceIds so the reader can check it`,
      `claim ${result.created.c} "Tambo is open source" is "Our reading" but states no assumption: add assumption, what this reading takes for granted`,
    ]);
    expect(
      apply('Source', claim(ids, { sourceIds: [ids.web], assumption: 'The repo is current.' }))
        .warnings,
    ).toEqual([]);
    expect(
      apply('Other', { op: 'update', type: 'project', id: ids.p, data: { summary: 'x' } }).warnings,
    ).toEqual([]);
  });

  it('refuses "From source" without an http(s) source', () => {
    const ids = seedClaims();
    const noSource = errorOf(() => apply('x', claim(ids, { certainty: 'verified' })));
    expect(noSource.issues?.[0]).toMatch(/"From source" needs sourceIds .*http/);
    expect(noSource.issues?.[0]).toContain('Tambo is open source');
    // A local path doesn't open as a link.
    expect(
      errorOf(() => apply('x', claim(ids, { certainty: 'verified', sourceIds: [ids.file] })))
        .issues,
    ).toHaveLength(1);
    const ok = apply('ok', claim(ids, { certainty: 'verified', sourceIds: [ids.file, ids.web] }));
    expect(store.getOfType('claim', ok.created.c!).data.certainty).toBe('verified');
    expect(ok.warnings).toEqual([
      `claim ${ok.created.c} "Tambo is open source" is "From source" but quotes nothing: add quote, the exact passage from the source that supports it`,
    ]);
  });

  it('warns, without refusing, about a missing quote or assumption and a quote from an unlisted source', () => {
    const ids = seedClaims();
    const quoted = apply(
      'Quoted',
      claim(ids, {
        certainty: 'verified',
        sourceIds: [ids.file, ids.web],
        quote: 'Tambo is MIT licensed.',
        quoteSourceId: ids.web,
      }),
    );
    expect(quoted.warnings).toEqual([]);
    expect(store.getOfType('claim', quoted.created.c!).data).toMatchObject({
      quote: 'Tambo is MIT licensed.',
      quoteSourceId: ids.web,
    });
    // A quote credited to a source the claim doesn't list is saved, with a warning.
    const stray = apply(
      'Stray',
      claim(ids, {
        certainty: 'verified',
        sourceIds: [ids.web],
        quote: 'Tambo is MIT licensed.',
        quoteSourceId: ids.file,
      }),
    );
    expect(stray.warnings).toEqual([
      `claim ${stray.created.c} "Tambo is open source" credits its quote to ${ids.file}, which isn't in its sourceIds`,
    ]);
    // An assumption silences the reading warning; a quote isn't asked of a reading.
    expect(
      apply('Reading', claim(ids, { sourceIds: [ids.web], assumption: 'The license is current.' }))
        .warnings,
    ).toEqual([]);
    // Clearing the quote warns again; the label comes from the project's options.
    apply('Rename', {
      op: 'update',
      type: 'project',
      id: ids.p,
      data: {
        options: {
          'claim.certainty': [
            { value: 'reading', label: 'Our reading', meaning: 'reading' },
            { value: 'verified', label: 'Checked', meaning: 'verified' },
            { value: 'confirmed', label: 'Confirmed by you', meaning: 'confirmed' },
          ],
        },
      },
    });
    const cleared = apply('Clear', {
      op: 'update',
      type: 'claim',
      id: quoted.created.c!,
      data: { quote: null, quoteSourceId: null },
    });
    expect(cleared.warnings).toEqual([
      `claim ${quoted.created.c} "Tambo is open source" is "Checked" but quotes nothing: add quote, the exact passage from the source that supports it`,
    ]);
    // Deleting the quoted source unsets quoteSourceId with it.
    apply('Delete', { op: 'delete', type: 'artifact', id: ids.file });
    expect(store.getOfType('claim', stray.created.c!).data.quoteSourceId).toBeUndefined();
  });

  it('refuses "From source" checked after the save', () => {
    const ids = seedClaims();
    const tomorrow = localDate(new Date(Date.now() + 86_400_000));
    const err = errorOf(() =>
      apply('x', claim(ids, { certainty: 'verified', sourceIds: [ids.web], checkedOn: tomorrow })),
    );
    expect(err.issues?.[0]).toMatch(/checkedOn no later than today .* but it is /);
    // "Our reading" may carry any date: nothing was read from a source.
    apply('ok', claim(ids, { checkedOn: tomorrow }));
  });

  it('refuses changes that take a source away from a "From source" claim', () => {
    const ids = seedClaims();
    const { created } = apply('c', claim(ids, { certainty: 'verified', sourceIds: [ids.web] }));
    const err = errorOf(() => apply('x', { op: 'delete', type: 'artifact', id: ids.web }));
    expect(err.issues?.[0]).toContain(`claim ${created.c}`);
    expect(store.get(ids.web)).not.toBeNull();
    // Pointing the artifact at a file path has the same effect.
    expect(
      errorOf(() =>
        apply('x', { op: 'update', type: 'artifact', id: ids.web, data: { uri: '/tmp/a.md' } }),
      ).issues?.[0],
    ).toContain(`claim ${created.c}`);
    // Unless the same call makes the claim "Our reading".
    apply(
      'Retire the source',
      { op: 'delete', type: 'artifact', id: ids.web },
      { op: 'update', type: 'claim', id: created.c!, data: { certainty: 'reading' } },
    );
    const after = store.getOfType('claim', created.c!).data;
    expect(after).toMatchObject({ certainty: 'reading', sourceIds: [] });
  });

  it('re-checks claims when the project changes what a certainty means', () => {
    const ids = seedClaims();
    const { created } = apply('c', claim(ids));
    const options = (readingMeans: string) => ({
      op: 'update' as const,
      type: 'project' as const,
      id: ids.p,
      data: {
        options: {
          'claim.certainty': [
            { value: 'reading', label: 'Sure', meaning: readingMeans },
            { value: 'guess', label: 'Guess', meaning: 'reading' },
            { value: 'checked', label: 'Checked', meaning: 'verified' },
            { value: 'owner', label: 'Owner says', meaning: 'confirmed' },
          ],
        },
      },
    });
    // Turning the stored "reading" into a From-source meaning would skip the source check.
    const err = errorOf(() => apply('x', options('verified')));
    expect(err.issues?.[0]).toContain(`claim ${created.c}`);
    expect(err.issues?.[0]).toContain('"Sure" needs sourceIds');
    apply('Rename only', options('reading'));
  });

  it('judges certainty by meaning when the project renames the options', () => {
    const ids = seedClaims();
    apply('Rename', {
      op: 'update',
      type: 'project',
      id: ids.p,
      data: {
        options: {
          'claim.certainty': [
            { value: 'guess', label: 'Guess', meaning: 'reading' },
            { value: 'checked', label: 'Checked', meaning: 'verified' },
            { value: 'owner', label: 'Owner says', meaning: 'confirmed' },
          ],
        },
      },
    });
    // The default is the project's value for "reading".
    const { created } = apply('c', claim(ids));
    expect(store.getOfType('claim', created.c!).data.certainty).toBe('guess');
    expect(errorOf(() => apply('x', claim(ids, { certainty: 'checked' }))).issues?.[0]).toContain(
      '"Checked" needs sourceIds',
    );
    expect(errorOf(() => apply('x', claim(ids, { certainty: 'owner' }))).issues?.[0]).toContain(
      '"Owner says" needs confirmedById',
    );
  });

  describe('"Confirmed by you"', () => {
    function seedDecision(ids: { p: string }, status = 'proposed') {
      return apply('Decision', {
        op: 'create',
        type: 'decision',
        ref: 'd',
        data: { projectId: ids.p, title: 'Keep our own format', status },
      }).created.d!;
    }
    const confirmed = (ids: { p: string }, confirmedById?: string): Operation =>
      claim(ids, { certainty: 'confirmed', ...(confirmedById ? { confirmedById } : {}) });

    it('needs a decision', () => {
      const ids = seedClaims();
      expect(errorOf(() => apply('x', confirmed(ids))).issues?.[0]).toContain(
        '"Confirmed by you" needs confirmedById → a decision the owner accepted in Pharos',
      );
    });

    it('refuses a decision that is not accepted', () => {
      const ids = seedClaims();
      const decision = seedDecision(ids);
      asHuman('Owner proposes', {
        op: 'update',
        type: 'decision',
        id: decision,
        data: { body: 'Still open' },
      });
      expect(errorOf(() => apply('x', confirmed(ids, decision))).issues?.[0]).toContain(
        'is "Proposed"',
      );
    });

    it('refuses a decision an agent accepted, and takes one the owner accepted', () => {
      const ids = seedClaims();
      const decision = seedDecision(ids);
      apply('Agent accepts', {
        op: 'update',
        type: 'decision',
        id: decision,
        data: { status: 'accepted' },
      });
      expect(errorOf(() => apply('x', confirmed(ids, decision))).issues?.[0]).toContain(
        'not set by a person',
      );
      // Created already accepted by an agent counts the same.
      const direct = seedDecision(ids, 'accepted');
      expect(errorOf(() => apply('x', confirmed(ids, direct))).issues).toHaveLength(1);

      asHuman('Owner accepts', {
        op: 'update',
        type: 'decision',
        id: decision,
        data: { status: 'accepted' },
      });
      // The status did not change from accepted, so the agent's acceptance still counts.
      expect(errorOf(() => apply('x', confirmed(ids, decision))).issues).toHaveLength(1);

      const proposed = seedDecision(ids);
      asHuman('Owner accepts', {
        op: 'update',
        type: 'decision',
        id: proposed,
        data: { status: 'accepted' },
      });
      const { created } = apply('ok', confirmed(ids, proposed));
      expect(store.getOfType('claim', created.c!).data.certainty).toBe('confirmed');
      // Editing other fields later, even by an agent, keeps it valid.
      apply('Edit', {
        op: 'update',
        type: 'decision',
        id: proposed,
        data: { body: 'More context' },
      });
    });

    it('refuses turning the decision down while the claim stays confirmed', () => {
      const ids = seedClaims();
      const decision = seedDecision(ids);
      asHuman('Owner accepts', {
        op: 'update',
        type: 'decision',
        id: decision,
        data: { status: 'accepted' },
      });
      const { created } = apply('ok', confirmed(ids, decision));
      for (const author of [human, agent]) {
        const err = errorOf(() =>
          store.apply(author, {
            message: 'Reject',
            operations: [
              { op: 'update', type: 'decision', id: decision, data: { status: 'rejected' } },
            ],
          }),
        );
        expect(err.issues?.[0]).toContain(`claim ${created.c}`);
      }
      // An agent flipping it away and back doesn't pass as the owner either.
      apply(
        'Same call: claim goes back to a reading',
        { op: 'update', type: 'decision', id: decision, data: { status: 'rejected' } },
        { op: 'update', type: 'claim', id: created.c!, data: { certainty: 'reading' } },
      );
      expect(store.getOfType('claim', created.c!).data.certainty).toBe('reading');
      apply('Agent re-accepts', {
        op: 'update',
        type: 'decision',
        id: decision,
        data: { status: 'accepted' },
      });
      expect(
        errorOf(() =>
          apply('x', {
            op: 'update',
            type: 'claim',
            id: created.c!,
            data: { certainty: 'confirmed' },
          }),
        ).issues?.[0],
      ).toContain('not set by a person');
    });

    it("refuses reverting the owner's acceptance while the claim stays confirmed", () => {
      const ids = seedClaims();
      const decision = seedDecision(ids);
      const accepted = asHuman('Owner accepts', {
        op: 'update',
        type: 'decision',
        id: decision,
        data: { status: 'accepted' },
      }).revision!.id;
      const { created, revision } = apply('ok', confirmed(ids, decision));
      expect(errorOf(() => store.revert(accepted, human)).issues?.[0]).toContain(
        `claim ${created.c}`,
      );
      // Reverting the claim first, then the acceptance, works.
      store.revert(revision!.id, human);
      store.revert(accepted, human);
      expect(store.getOfType('decision', decision).data.status).toBe('proposed');
    });

    it('refuses deleting the decision', () => {
      const ids = seedClaims();
      const decision = seedDecision(ids);
      asHuman('Owner accepts', {
        op: 'update',
        type: 'decision',
        id: decision,
        data: { status: 'accepted' },
      });
      const { created } = apply('ok', confirmed(ids, decision));
      expect(
        errorOf(() => apply('x', { op: 'delete', type: 'decision', id: decision })).issues?.[0],
      ).toContain(`claim ${created.c}`);
    });
  });

  it('refuses two terms sharing a word or another form, ignoring case', () => {
    const ids = seedClaims();
    const term = (word: string, alsoCalled: string[] = []): Operation => ({
      op: 'create',
      type: 'term',
      data: { projectId: ids.p, word, explanation: 'x', alsoCalled },
    });
    apply('First', term('recipe', ['recipes']));
    expect(errorOf(() => apply('x', term('Recipe'))).issues?.[0]).toContain(
      '"recipe" is already used',
    );
    expect(errorOf(() => apply('x', term('format', ['RECIPES']))).issues?.[0]).toContain(
      '"recipes" is already used',
    );
    apply('Fine', term('format', ['formats']));
    // Another project may reuse a word.
    const other = apply('Other project', {
      op: 'create',
      type: 'project',
      data: { name: 'Other' },
    });
    apply('Same word', {
      op: 'create',
      type: 'term',
      data: { projectId: Object.values(other.created)[0]!, word: 'recipe', explanation: 'x' },
    });
  });
});

describe('task checks and comments', () => {
  const task = (id: string) => store.get(id)!.data as Record<string, unknown>;

  it('marks a task done when every "done when" check is ticked, and back when one is unticked', () => {
    const ids = seedProject();
    apply('Checks', {
      op: 'update',
      type: 'task',
      id: ids.t1,
      data: { acceptance: ['Tests pass', 'Screenshot on the page'], status: 'in_progress' },
    });
    apply('One', {
      op: 'update',
      type: 'task',
      id: ids.t1,
      data: { acceptanceMet: ['Tests pass'] },
    });
    expect(task(ids.t1).status).toBe('in_progress');
    apply('Both', {
      op: 'update',
      type: 'task',
      id: ids.t1,
      data: { acceptanceMet: ['Tests pass', 'Screenshot on the page'] },
    });
    expect(task(ids.t1).status).toBe('done');
    apply('Untick', {
      op: 'update',
      type: 'task',
      id: ids.t1,
      data: { acceptanceMet: ['Tests pass'] },
    });
    expect(task(ids.t1).status).toBe('in_progress');
  });

  it('drops ticks for reworded checks and lets an explicit status win', () => {
    const ids = seedProject();
    apply('Checks', {
      op: 'update',
      type: 'task',
      id: ids.t1,
      data: { acceptance: ['A', 'B'], acceptanceMet: ['A'] },
    });
    apply('Reword', { op: 'update', type: 'task', id: ids.t1, data: { acceptance: ['A2', 'B'] } });
    expect(task(ids.t1).acceptanceMet).toBeUndefined();
    apply('Tick all, but needs review', {
      op: 'update',
      type: 'task',
      id: ids.t1,
      data: { acceptanceMet: ['A2', 'B'], status: 'review' },
    });
    expect(task(ids.t1).status).toBe('review');
  });

  it('keeps comments on a task and removes them with it', () => {
    const ids = seedProject();
    const { created } = apply('Result', {
      op: 'create',
      type: 'comment',
      ref: 'c',
      data: {
        projectId: ids.p,
        taskId: ids.t1,
        body: 'Both evals pass.\n\n```\nnode run.mjs\n```',
      },
    });
    expect(store.dataset(ids.p).comments?.map((c) => c.id)).toEqual([created.c]);
    apply('Remove', { op: 'delete', type: 'task', id: ids.t1 });
    expect(store.get(created.c!)).toBeNull();
  });
});
