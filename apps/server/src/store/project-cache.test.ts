import type { Author } from '@pharos/schema';
import { describe, expect, it } from 'vitest';
import { openDatabase } from './database.js';
import { perProject } from './project-cache.js';
import { Store } from './store.js';

const me: Author = { kind: 'human', name: 'me' };

describe('per-project cache', () => {
  it('reuses a result until the project, anything outside projects, or the key changes', () => {
    const store = new Store(openDatabase(':memory:'));
    const { created } = store.apply(me, {
      message: 'Set up',
      operations: [
        { op: 'create', type: 'project', ref: 'a', data: { name: 'Garden' } },
        { op: 'create', type: 'project', ref: 'b', data: { name: 'Bike' } },
      ],
    });
    const a = created.a!;
    let runs = 0;
    const get = (key = 'k') => perProject(store, 'test', a, key, () => ++runs);
    expect(get()).toBe(1);
    expect(get()).toBe(1);
    // Another project's change leaves it alone.
    store.apply(me, {
      message: 'x',
      operations: [{ op: 'create', type: 'task', data: { projectId: created.b!, title: 'Oil' } }],
    });
    expect(get()).toBe(1);
    // Its own change, a change outside projects, or another key recompute.
    store.apply(me, {
      message: 'x',
      operations: [{ op: 'create', type: 'task', data: { projectId: a, title: 'Plant' } }],
    });
    expect(get()).toBe(2);
    store.apply(me, {
      message: 'x',
      operations: [{ op: 'create', type: 'assignee', data: { name: 'Sam', kind: 'human' } }],
    });
    expect(get()).toBe(3);
    expect(get('other')).toBe(4);
  });
});
