import type { Author, Entity } from '@pharos/schema';
import { describe, expect, it } from 'vitest';
import { ActionService } from '../actions/service.js';
import { applyPack } from '../packs/service.js';
import { openDatabase } from './database.js';
import { PharosError } from './errors.js';
import { Store } from './store.js';

/** v0.2 review, gap 5: marking a record done is the owner's, in every write path. */

const owner: Author = { kind: 'human', name: 'owner' };
const agent: Author = { kind: 'agent', name: 'Claude Code' };

function setup() {
  const store = new Store(openDatabase(':memory:'));
  const pack = applyPack(
    store,
    agent,
    { pack: 'money', name: 'Money', examples: true },
    '2026-10-13',
  );
  const rent = () =>
    store
      .list('record', { projectId: pack.projectId })
      .find((r) => r.data.title === 'Rent') as Entity<'record'>;
  return { store, pack, rent };
}

function refusal(fn: () => unknown): PharosError {
  try {
    fn();
  } catch (error) {
    if (error instanceof PharosError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('owner outcomes (gap 5)', () => {
  it('refuses an agent moving lastDate with apply, and undoing the owner marking it paid', () => {
    const s = setup();
    const rent = s.rent();
    const error = refusal(() =>
      s.store.apply(agent, {
        message: 'Paid',
        operations: [
          {
            op: 'update',
            type: 'record',
            id: rent.id,
            data: { interval: { ...rent.data.interval!, lastDate: '2026-10-13' } },
          },
        ],
      }),
    );
    expect(error.message).toMatch(/only the owner marks it done/);

    const done = new ActionService(s.store).run(owner, {
      v: 1,
      projectId: s.pack.projectId,
      viewId: s.pack.views[0]!.id,
      widgetId: 'mark-paid',
      recordId: rent.id,
      values: { date: '2026-10-13' },
      idempotencyKey: 'v02-fix-1',
      expectedRevision: rent.updatedRev,
    });
    expect(done.status).toBe('done');
    const revision = (done as { revision: number }).revision;
    expect(refusal(() => s.store.revert(revision, agent)).code).toBe('invalid');
    expect(s.rent().data.interval?.lastDate).toBe('2026-10-13');
    // The owner can undo it.
    s.store.revert(revision, owner);
    expect(s.rent().data.interval?.lastDate).toBe(rent.data.interval?.lastDate);
  });

  it('still lets an agent change other fields of a repeating record', () => {
    const s = setup();
    const rent = s.rent();
    s.store.apply(agent, {
      message: 'Rename',
      operations: [{ op: 'update', type: 'record', id: rent.id, data: { title: 'Flat rent' } }],
    });
    expect(s.rent()).toBeUndefined();
  });
});
