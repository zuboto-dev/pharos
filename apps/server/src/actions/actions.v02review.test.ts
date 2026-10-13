import type { ActionDone, Author, Entity } from '@pharos/schema';
import { describe, expect, it } from 'vitest';
import { applyPack } from '../packs/service.js';
import { openDatabase } from '../store/database.js';
import { Store } from '../store/store.js';
import { ActionService } from './service.js';

const owner: Author = { kind: 'human', name: 'owner' };
const agent: Author = { kind: 'agent', name: 'Claude Code' };
const today = '2026-10-13';
let serial = 0;

function setup() {
  const store = new Store(openDatabase(':memory:'));
  const first = applyPack(store, agent, { pack: 'money', name: 'Money', examples: true }, today);
  const other = applyPack(
    store,
    agent,
    { pack: 'money', name: 'Other money', examples: true },
    today,
  );
  const record = (projectId: string, title: string) =>
    store
      .list('record', { projectId })
      .find((entity) => entity.data.title === title) as Entity<'record'>;
  const service = new ActionService(store);
  const submission = (bill: Entity<'record'>, extra: Record<string, unknown> = {}) => ({
    v: 1,
    projectId: first.projectId,
    viewId: first.views[0]!.id,
    widgetId: 'mark-paid',
    recordId: bill.id,
    values: { date: today },
    idempotencyKey: `v02-review-${++serial}`,
    expectedRevision: bill.updatedRev,
    ...extra,
  });
  return { store, first, other, record, service, submission };
}

describe('v0.2 action review regressions', () => {
  it('does not reserve a stale form key and replays a successful retry as a duplicate', () => {
    const s = setup();
    const rent = s.record(s.first.projectId, 'Rent');
    const form = s.submission(rent);
    s.store.apply(owner, {
      message: 'Move the due date forward',
      operations: [
        {
          op: 'update',
          type: 'record',
          id: rent.id,
          data: { interval: { ...rent.data.interval!, lastDate: '2026-10-10' } },
        },
      ],
    });
    const current = s.record(s.first.projectId, 'Rent');
    const afterEdit = s.store.latestRevisionId();

    expect(s.service.run(owner, form)).toMatchObject({ status: 'stale' });
    expect(s.store.latestRevisionId()).toBe(afterEdit);

    const retry = { ...form, expectedRevision: current.updatedRev };
    const done = s.service.run(owner, retry) as ActionDone;
    expect(done.status).toBe('done');
    const afterSave = s.store.latestRevisionId();
    expect(s.service.run(owner, retry)).toEqual({ ...done, status: 'duplicate' });
    expect(s.store.latestRevisionId()).toBe(afterSave);
  });

  it('rejects a saved action submitted with a forged view or block id', () => {
    const s = setup();
    const rent = s.record(s.first.projectId, 'Rent');
    const form = s.submission(rent);
    const before = s.store.latestRevisionId();

    expect(s.service.run(owner, { ...form, viewId: s.other.views[0]!.id })).toMatchObject({
      status: 'not_found',
    });
    expect(s.service.run(owner, { ...form, widgetId: 'log-service' })).toMatchObject({
      status: 'not_found',
    });
    expect(s.store.latestRevisionId()).toBe(before);
  });

  it('keeps an agent action attributed to the agent, including Mark paid', () => {
    const s = setup();
    const phone = s.record(s.first.projectId, 'Phone');
    const done = s.service.run(agent, s.submission(phone)) as ActionDone;

    expect(done.status).toBe('done');
    expect(s.store.revision(done.revision!)!.author).toEqual(agent);
    expect((s.store.get(phone.id) as Entity<'record'>).data.interval?.lastDate).toBe(today);
  });

  it('refuses an agent Mark paid submission without changing project data', () => {
    const s = setup();
    const phone = s.record(s.first.projectId, 'Phone');
    const before = new Map(
      s.store
        .list('record', { projectId: s.first.projectId })
        .map((record) => [record.id, structuredClone(record.data)]),
    );
    const latest = s.store.latestRevisionId();

    const result = s.service.run(agent, s.submission(phone));

    expect(result.status).toBe('invalid');
    expect(s.store.latestRevisionId()).toBe(latest);
    expect(
      new Map(
        s.store
          .list('record', { projectId: s.first.projectId })
          .map((record) => [record.id, record.data]),
      ),
    ).toEqual(before);
  });

  it('Undo restores the exact record set and fields changed by Mark paid', () => {
    const s = setup();
    const rent = s.record(s.first.projectId, 'Rent');
    const before = new Map(
      s.store
        .list('record', { projectId: s.first.projectId })
        .map((record) => [record.id, structuredClone(record.data)]),
    );
    const done = s.service.run(owner, s.submission(rent)) as ActionDone;
    expect(done.status).toBe('done');
    expect(done.created).toHaveLength(1);

    s.store.revert(done.revision!, owner, 'Undo Mark paid');

    const after = new Map(
      s.store
        .list('record', { projectId: s.first.projectId })
        .map((record) => [record.id, record.data]),
    );
    expect(after).toEqual(before);
    expect(s.store.revision(done.revision!)!.revertedBy).toBe(s.store.latestRevisionId());
    expect(s.store.revision(s.store.latestRevisionId())!.revertOf).toBe(done.revision);
  });
});
