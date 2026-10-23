import type { Entity } from '@pharos/schema';
import { describe, expect, it } from 'vitest';
import { layoutMap } from './map';

const goal = (id: string, parentId?: string) =>
  ({
    id,
    type: 'goal',
    data: { projectId: 'p', title: id, ...(parentId ? { parentId } : {}) },
  }) as unknown as Entity<'goal'>;
const task = (id: string, goalIds?: string[]) =>
  ({
    id,
    type: 'task',
    data: { projectId: 'p', title: id, dependsOn: [], ...(goalIds ? { goalIds } : {}) },
  }) as unknown as Entity<'task'>;

describe('the map layout', () => {
  it('rings the top goals, places tasks by the goals they serve, and keeps the rest apart', () => {
    const goals = [goal('a'), goal('b'), goal('a1', 'a')];
    const tasks = [task('t1', ['a']), task('t2', ['a1']), task('t3', ['a', 'b']), task('t4')];
    const map = layoutMap(goals, tasks, undefined, 'Pharos');
    expect(map.hub).toBe('Pharos');
    expect(map.goals.map((g) => g.goal.id)).toEqual(['a', 'b']);
    const of = (id: string) => map.tasks.find((t) => t.task.id === id)!;
    // A sub-goal's task sits with its ring goal; a task serving two goals sits between them.
    expect(of('t2').goals).toEqual(['a']);
    expect(of('t3')).toMatchObject({ goals: ['a', 'b'], shared: true });
    const [ga, gb] = map.goals;
    const between = (v: number, x: number, y: number) =>
      v >= Math.min(x, y) - 1 && v <= Math.max(x, y) + 1;
    expect(between(of('t3').y, ga!.y, gb!.y) || between(of('t3').x, ga!.x, gb!.x)).toBe(true);
    expect(map.unlinked.map((t) => t.id)).toEqual(['t4']);
  });

  it('centers on a goal: its sub-goals form the ring', () => {
    const map = layoutMap(
      [goal('a'), goal('a1', 'a'), goal('a2', 'a'), goal('b')],
      [task('t', ['a2'])],
      'a',
    );
    expect(map.hub).toBe('a');
    expect(map.goals.map((g) => g.goal.id)).toEqual(['a1', 'a2']);
    expect(map.tasks[0]!.goals).toEqual(['a2']);
  });
});
