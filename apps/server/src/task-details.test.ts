import type { Author } from '@pharos/schema';
import { describe, expect, it } from 'vitest';
import { projectBrief } from './brief.js';
import { askOwner } from './desk.js';
import { openDatabase } from './store/database.js';
import { projectSnapshot } from './store/snapshot.js';
import { Store } from './store/store.js';

const me: Author = { kind: 'human', name: 'me' };
const agent: Author = { kind: 'agent', name: 'Helper' };
const DETAILS = {
  actions: ['Measure the bed', 'Order the soil'],
  acceptance: ['The soil is on the receipt'],
  deliverables: [{ label: 'Receipt', kind: 'file' as const }],
};

function setup() {
  const store = new Store(openDatabase(':memory:'));
  const { created } = store.apply(me, {
    message: 'Set up',
    operations: [
      { op: 'create', type: 'project', ref: 'p', data: { name: 'Garden' } },
      { op: 'create', type: 'assignee', ref: 'me', data: { name: 'Sam', kind: 'human' } },
    ],
  });
  return { store, p: created.p! };
}

describe('task details on apply', () => {
  it('warns an agent that creates a task without them, and never a person', () => {
    const { store, p } = setup();
    const create = (author: Author) =>
      store.apply(author, {
        message: 'Add a task',
        operations: [
          { op: 'create', type: 'task', ref: 't', data: { projectId: p, title: 'Dig' } },
        ],
      });
    const [warning] = create(agent).warnings;
    expect(warning).toMatch(/^task \S+ \("Dig"\) created without required actions/);
    expect(create(me).warnings).toEqual([]);
    const ok = store.apply(agent, {
      message: 'Add a full task',
      operations: [
        { op: 'create', type: 'task', ref: 't', data: { projectId: p, title: 'Dig', ...DETAILS } },
      ],
    });
    expect(ok.warnings).toEqual([]);
  });

  it('warns on the move to in progress, and on done with a result that has no ref', () => {
    const { store, p } = setup();
    const id = store.apply(me, {
      message: 'Owner adds a bare task',
      operations: [{ op: 'create', type: 'task', ref: 't', data: { projectId: p, title: 'Dig' } }],
    }).created.t!;
    const move = (author: Author, data: Record<string, unknown>) =>
      store.apply(author, {
        message: 'Update',
        operations: [{ op: 'update', type: 'task', id, data }],
      }).warnings;
    expect(move(agent, { status: 'in_progress' })).toEqual([
      expect.stringMatching(/moved to in progress without required actions/),
    ]);
    move(me, { status: 'todo' });
    expect(move(me, { status: 'in_progress' })).toEqual([]);
    move(agent, DETAILS);
    expect(move(agent, { status: 'done' })).toEqual([
      expect.stringMatching(/marked done with deliverables that have no ref \("Receipt"\)/),
    ]);
  });

  it('ask_owner passes actions and acceptance to the task, and warns without them', () => {
    const { store, p } = setup();
    const bare = askOwner(store, agent, { projectId: p, title: 'Paste the key' });
    expect(bare.warnings).toEqual([expect.stringMatching(/required actions .* and acceptance/)]);
    const t = askOwner(store, agent, {
      projectId: p,
      title: 'Paste the key',
      actions: ['Open Settings', 'Paste the key'],
      acceptance: ['Settings says connected'],
    });
    expect(t.warnings).toBeUndefined();
    expect(store.getOfType('task', t.id).data).toMatchObject({
      actions: ['Open Settings', 'Paste the key'],
      acceptance: ['Settings says connected'],
    });
  });

  it('the brief and the snapshot carry them for tasks in progress only', () => {
    const { store, p } = setup();
    store.apply(agent, {
      message: 'Two tasks',
      operations: [
        {
          op: 'create',
          type: 'task',
          ref: 'a',
          data: { projectId: p, title: 'Dig', status: 'in_progress', ...DETAILS },
        },
        { op: 'create', type: 'task', ref: 'b', data: { projectId: p, title: 'Rest', ...DETAILS } },
      ],
    });
    const brief = projectBrief(store, p);
    expect(brief).toContain('\n  1. Measure the bed\n  2. Order the soil');
    expect(brief).toContain('Done when: The soil is on the receipt');
    expect(brief).toContain('Produces: Receipt (file)');
    const tasks = projectSnapshot(store, p).tasks as Record<string, unknown>[];
    expect(tasks.find((t) => t.title === 'Dig')).toMatchObject(DETAILS);
    expect(tasks.find((t) => t.title === 'Rest')?.actions).toBeUndefined();
  });
});
