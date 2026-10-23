import { describe, expect, it } from 'vitest';
import { connectionsOf, groupConnections } from './connections.js';
import type { Entity } from './entities.js';

const e = (type: string, id: string, data: Record<string, unknown>) =>
  ({
    id,
    type,
    data: { projectId: 'p', ...data },
    createdRev: 1,
    updatedRev: 1,
  }) as unknown as Entity;

describe('how an object hangs together', () => {
  it('lists what points at it, the pages that show it and the text that mentions it', () => {
    const goal = e('goal', 'goal_1', { title: 'Launch' });
    const all = [
      goal,
      e('task', 'task_1', { title: 'Write the post', goalIds: ['goal_1'], dependsOn: [] }),
      e('task', 'task_2', { title: 'Test phones', goalIds: ['goal_1', 'goal_2'], dependsOn: [] }),
      e('goal', 'goal_3', { title: 'Polish', parentId: 'goal_1' }),
      e('decision', 'dec_1', { title: 'Which day?', body: 'For goal_1, see the plan' }),
      e('view', 'view_1', { name: 'Plan', spec: { component: 'Map', center: 'goal_1' } }),
      e('task', 'task_3', { title: 'Unrelated', dependsOn: [] }),
    ];
    expect(groupConnections(connectionsOf(goal, all))).toEqual([
      { label: 'Tasks serving it', ids: ['task_1', 'task_2'] },
      { label: 'Sub-goals', ids: ['goal_3'] },
      { label: 'Mentioned in', ids: ['dec_1'] },
      { label: 'Shown on', ids: ['view_1'] },
    ]);
  });
});
