import { describe, expect, it } from 'vitest';
import { openDatabase } from '../store/database.js';
import { Store } from '../store/store.js';
import { previewView } from './service.js';

const agent = { kind: 'agent', name: 'test' } as const;

function setup() {
  const store = new Store(openDatabase(':memory:'));
  const { created } = store.apply(agent, {
    message: 'Set up',
    operations: [
      { op: 'create', type: 'project', ref: 'p', data: { name: 'App' } },
      {
        op: 'create',
        type: 'stage',
        ref: 's',
        data: { projectId: '$p', name: 'Build', targetDate: '2026-10-01' },
      },
      { op: 'update', type: 'project', id: '$p', data: { currentStageId: '$s' } },
      {
        op: 'create',
        type: 'task',
        ref: 'a',
        data: { projectId: '$p', stageId: '$s', title: 'Design', status: 'done' },
      },
      {
        op: 'create',
        type: 'task',
        data: {
          projectId: '$p',
          stageId: '$s',
          title: 'Build it',
          dueDate: '2026-10-03',
          dependsOn: ['$a'],
        },
      },
      { op: 'create', type: 'task', data: { projectId: '$p', title: 'Ship', priority: 'high' } },
    ],
  });
  return { store, projectId: created.p! };
}

describe('view_preview', () => {
  it('says what each widget shows, and flags typos, narrow widths, missing values, and gaps', () => {
    const { store, projectId } = setup();
    const result = previewView(store, {
      projectId,
      widgets: [
        {
          id: 'headline',
          node: {
            component: 'Text',
            content: '${open} open, ${late} late, ${typo}',
            values: {
              open: { count: { type: 'task', where: { status: { not: 'done' } } } },
              late: {
                count: {
                  type: 'task',
                  where: { dueDate: { lt: '2026-10-06' }, status: { not: 'done' } },
                },
              },
            },
          },
        },
        {
          id: 'oops',
          w: 4,
          node: {
            component: 'DataTable',
            query: { type: 'task', where: { dueDat: { exists: true } } },
            columns: [{ field: 'title' }, { field: 'stage.nam' }],
          },
        },
        { id: 'thin', w: 2, node: { component: 'KanbanBoard' } },
        { id: 'deps', w: 4, node: { component: 'DependencyGraph' } },
        { id: 'by', node: { component: 'CountChart', query: { type: 'task' }, by: 'priority' } },
        { id: 'nothing', node: { component: 'DecisionLog' } },
        { id: 'scope', node: { component: 'ScopeBoard', kinds: ['out'] } },
      ],
    });
    const w = Object.fromEntries(result.widgets.map((x) => [x.id, x]));
    expect(w.headline!.shows).toBe('2 open, 1 late, ${typo}');
    expect(w.headline!.warnings).toEqual(['${typo} has no value in "values"']);
    expect(w.oops!.empty).toBe(true);
    expect(w.oops!.warnings).toEqual([
      expect.stringMatching(/^"dueDat" isn't a field of task/),
      expect.stringMatching(/^"stage.nam" isn't a field of stage/),
    ]);
    expect(w.thin!.warnings).toEqual(['width 2 is below the minimum of 4 columns for KanbanBoard']);
    expect(w.deps!.shows).toBe('3 tasks, 1 dependency');
    expect(
      previewView(store, {
        projectId,
        widgets: [{ id: 'g', node: { component: 'DependencyGraph' } }],
      }).widgets[0]!.shows,
    ).toBe('3 tasks, 1 dependency');
    expect(w.by!.shows).toBe('Medium 2 · High 1'); // option labels, as people see them
    expect(w.nothing).toMatchObject({ empty: true, shows: 'nothing' });
    expect(w.scope).toMatchObject({ empty: true, shows: 'nothing' }); // only the "out" group, which is empty
    expect(result.layout).toEqual(['row 2 uses 10 of 12 columns before "by" wraps']);
    expect(result.summary).toBe(
      '7 widgets; 3 show an empty state (oops, nothing, scope); see warnings',
    );
  });

  it('lists decisions newest first, like the decision log does', () => {
    const { store, projectId } = setup();
    for (const title of ['First', 'Second', 'Third']) {
      store.apply(agent, {
        message: title,
        operations: [{ op: 'create', type: 'decision', data: { projectId, title } }],
      });
    }
    const result = previewView(store, {
      projectId,
      widgets: [{ id: 'd', node: { component: 'DecisionLog', filter: { limit: 2 } } }],
    });
    expect(result.widgets[0]!.shows).toBe('2 decisions, newest first: “Third”, “Second”');
  });

  it('previews a saved view, including its template', () => {
    const { store, projectId } = setup();
    const [overview] = store.list('view', { projectId });
    const result = previewView(store, { viewId: overview!.id });
    expect(result.view).toBe('Overview');
    expect(result.widgets.find((x) => x.id === 'header')!.shows).toBe('App, 33% done (1/3 tasks)');
    expect(result.widgets.find((x) => x.id === 'stages')!.shows).toBe('Build 50%');
    expect(result.widgets.every((x) => x.warnings.length === 0)).toBe(true);
  });
});
