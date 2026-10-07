import { describe, expect, it } from 'vitest';
import { Board, ViewSpec, nextWidgetId, toBoard } from './board.js';
import { TEMPLATES } from './templates.js';

describe('toBoard', () => {
  it('flattens top-level sections and grids into sized widgets', () => {
    const board = toBoard({
      component: 'Section',
      children: [
        { component: 'ProjectHeader' },
        {
          component: 'Grid',
          columns: 3,
          children: [{ component: 'ProgressRing' }, { component: 'TaskTable', span: 2 }],
        },
        { component: 'Section', title: 'Kept together', children: [{ component: 'GoalTree' }] },
      ],
    });
    expect(board.widgets.map((w) => [w.id, w.w, w.node.component])).toEqual([
      ['w1', 12, 'ProjectHeader'],
      ['w2', 4, 'ProgressRing'],
      ['w3', 8, 'TaskTable'],
      ['w4', 12, 'Section'],
    ]);
    expect(board.widgets[2]!.node).not.toHaveProperty('span');
    expect(Board.safeParse(board).success).toBe(true);
  });

  it('wraps a single component and leaves boards alone', () => {
    expect(toBoard({ component: 'KanbanBoard' }).widgets).toEqual([
      { id: 'w1', w: 12, node: { component: 'KanbanBoard' } },
    ]);
    expect(toBoard(TEMPLATES.overview)).toBe(TEMPLATES.overview);
  });

  it('validates widgets and rejects duplicate ids', () => {
    expect(ViewSpec.safeParse(TEMPLATES.overview).success).toBe(true);
    const dup = Board.safeParse({
      component: 'Board',
      widgets: [
        { id: 'a', node: { component: 'GoalTree' } },
        { id: 'a', w: 13, node: { component: 'GoalTree' } },
      ],
    });
    expect(dup.success).toBe(false);
    expect(dup.error!.issues.map((i) => i.path.join('.'))).toEqual(['widgets.1.w', 'widgets.1.id']);
  });

  it('picks unused widget ids', () => {
    expect(
      nextWidgetId({
        component: 'Board',
        widgets: [{ id: 'w2', node: { component: 'GoalTree' } }],
      }),
    ).toBe('w3');
    expect(
      nextWidgetId({
        component: 'Board',
        widgets: [
          { id: 'w1', node: { component: 'GoalTree' } },
          { id: 'w2', node: { component: 'GoalTree' } },
        ],
      }),
    ).toBe('w3');
  });
});
