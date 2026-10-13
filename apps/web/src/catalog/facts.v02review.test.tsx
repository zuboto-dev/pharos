import { Board, CAR_PACK, ENTITIES, checkFacts, packDataset, type Entity } from '@pharos/schema';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CountChart } from './components/generic';
import { ViewDataProvider } from './context';

afterEach(cleanup);

describe('independent rendered fact review', () => {
  it('does not pass a fact about a bar excluded from the rendered chart', () => {
    const today = '2026-10-13';
    const data = packDataset(CAR_PACK, [], today);
    data.tasks = ['Zed', 'Alpha'].map((title, i): Entity<'task'> => ({
      id: `task_review_${i}`,
      type: 'task',
      data: ENTITIES.task.data.parse({
        projectId: data.project.id,
        title,
        status: 'todo',
        priority: 'normal',
        dependsOn: [],
        order: 0,
      }),
      createdAt: '',
      updatedAt: '',
      createdRev: 1,
      updatedRev: 1,
    }));
    const board = Board.parse({
      component: 'Board',
      widgets: [
        {
          id: 'chart',
          node: { component: 'CountChart', query: { type: 'task' }, by: 'title', limit: 1 },
        },
      ],
    });
    const node = board.widgets[0]!.node;
    if (node.component !== 'CountChart') throw new Error('bad fixture');
    render(
      <ViewDataProvider data={data} version={1}>
        <CountChart node={node} />
      </ViewDataProvider>,
    );
    expect(screen.getByRole('list').textContent).toBe('Alpha1');
    expect(
      checkFacts(
        board,
        data,
        [{ id: 'hidden-bar', kind: 'bar', widget: 'chart', label: 'Zed', expect: 1 }],
        today,
      ).passed,
    ).toBe(false);
  });
});
