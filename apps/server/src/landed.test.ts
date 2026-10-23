import type { Author } from '@pharos/schema';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { landedSince, markDeskSeen } from './landed.js';
import { openDatabase } from './store/database.js';
import { Store } from './store/store.js';

const me: Author = { kind: 'human', name: 'me' };
const bot = (name: string): Author => ({ kind: 'agent', name });

function setup() {
  const store = new Store(openDatabase(':memory:'));
  const { created } = store.apply(me, {
    message: 'Set up',
    operations: [
      { op: 'create', type: 'project', ref: 'a', data: { name: 'Garden' } },
      { op: 'create', type: 'project', ref: 'b', data: { name: 'Bike' } },
    ],
  });
  const task = (who: Author, projectId: string, title: string) =>
    store.apply(who, {
      message: `Add ${title}`,
      operations: [{ op: 'create', type: 'task', data: { projectId, title } }],
    });
  return { store, a: created.a!, b: created.b!, task };
}

describe('what agents landed since the desk was seen (R16)', () => {
  it("counts agents' revisions by project, busiest first, and leaves people's out", () => {
    const { store, a, b, task } = setup();
    task(bot('Garden agent'), a, 'Plant');
    task(bot('Night runner'), a, 'Water');
    task(bot('Bike agent'), b, 'Oil');
    task(me, b, 'Ride');
    const landed = landedSince(store);
    expect(landed.projects.map((p) => [p.project, p.revisions, p.agents])).toEqual([
      ['Garden', 2, ['Garden agent', 'Night runner']],
      ['Bike', 1, ['Bike agent']],
    ]);
    expect(landed.projects[0]!.latest.message).toBe('Add Water');
  });

  it('starts again after the owner opens the desk', () => {
    const { store, a, task } = setup();
    task(bot('Garden agent'), a, 'Plant');
    markDeskSeen(store);
    expect(landedSince(store).projects).toEqual([]);
    task(bot('Garden agent'), a, 'Weed');
    expect(landedSince(store).projects.map((p) => p.revisions)).toEqual([1]);
  });

  it('shows only the last day before the desk was ever seen', () => {
    const { store, a, task } = setup();
    task(bot('Garden agent'), a, 'Plant');
    expect(landedSince(store, new Date(Date.now() + 2 * 86_400_000)).projects).toEqual([]);
  });

  it('REST: anyone reads it; only a person marks the desk seen', async () => {
    const { store, a, task } = setup();
    const app = createApp(store);
    task(bot('Garden agent'), a, 'Plant');
    const read = (await (await app.request('/api/desk/landed')).json()) as { projects: unknown[] };
    expect(read.projects).toHaveLength(1);
    const refused = await app.request('/api/desk/seen', {
      method: 'PUT',
      headers: { 'x-pharos-author': 'agent:x' },
    });
    expect(refused.status).toBe(403);
    expect((await app.request('/api/desk/seen', { method: 'PUT' })).status).toBe(200);
    expect(landedSince(store).projects).toEqual([]);
  });

  it('marks seen only what the desk showed, not a change that landed after it read', async () => {
    const { store, a, task } = setup();
    const app = createApp(store);
    task(bot('Garden agent'), a, 'Plant');
    const read = (await (await app.request('/api/desk/landed')).json()) as { until: number };
    // An agent lands a change while the desk is open, before the page marks what it showed.
    task(bot('Night runner'), a, 'Water');
    const put = await app.request('/api/desk/seen', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ revision: read.until }),
    });
    expect(put.status).toBe(200);
    expect(landedSince(store).projects.map((p) => [p.revisions, p.latest.message])).toEqual([
      [1, 'Add Water'],
    ]);
  });
});
