import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ActionDone, ActionResult, Entity } from '@pharos/schema';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { applyPack } from '../packs/service.js';
import { openDatabase } from '../store/database.js';
import { projectSnapshot } from '../store/snapshot.js';
import { Store } from '../store/store.js';
import { previewView } from '../views/service.js';
import { ActionService } from './service.js';

/**
 * R10.11 and R10.15: the action endpoint and MCP tool, and the regression cases for invalid,
 * duplicate, stale and failed submissions with the revisions each one leaves.
 */

const human = { kind: 'human', name: 'me' } as const;
const agent = { kind: 'agent', name: 'Opus 5.5' } as const;
const TODAY = '2026-10-13';

function setup(pack: 'car' | 'money', examples = true) {
  const store = new Store(openDatabase(':memory:'));
  const applied = applyPack(store, agent, { pack, name: pack, examples }, TODAY);
  const view = applied.views[0]!;
  const record = (title: string) =>
    store
      .list('record', { projectId: applied.projectId })
      .find((r) => r.data.title === title) as Entity<'record'>;
  return {
    store,
    projectId: applied.projectId,
    viewId: view.id,
    record,
    actions: new ActionService(store),
  };
}

let keys = 0;
const key = () => `test-key-${++keys}`;

function logService(s: ReturnType<typeof setup>, values: Record<string, unknown>, extra = {}) {
  return {
    v: 1,
    projectId: s.projectId,
    viewId: s.viewId,
    widgetId: 'log-service',
    title: 'Oil and filter',
    values,
    idempotencyKey: key(),
    ...extra,
  };
}

function markPaid(s: ReturnType<typeof setup>, bill: Entity<'record'>, extra = {}) {
  return {
    v: 1,
    projectId: s.projectId,
    viewId: s.viewId,
    widgetId: 'mark-paid',
    recordId: bill.id,
    values: { date: TODAY },
    idempotencyKey: key(),
    expectedRevision: bill.updatedRev,
    ...extra,
  };
}

describe('Log a service (create)', () => {
  it('adds the service, marks the matching reminder done and raises the odometer, in one revision', () => {
    const s = setup('car');
    const car = s.record('Blue hatchback');
    const before = s.store.latestRevisionId();
    const result = s.actions.run(
      human,
      logService(s, {
        vehicle: car.id,
        date: TODAY,
        kind: 'oil',
        odometer: 61950,
        cost: { amount: 15900, currency: 'EUR' },
        shop: 'Corner Garage',
      }),
    );
    expect(result).toMatchObject({ status: 'done', message: 'Log a service: Oil and filter' });
    const done = result as ActionDone;
    expect(done.revision).toBe(before + 1);
    expect(s.store.revision(done.revision!)!.author).toEqual(human);
    const service = s.store.get(done.recordId) as Entity<'record'>;
    expect(service.data).toMatchObject({ recordType: 'service', title: 'Oil and filter' });
    expect(s.record('Oil change').data.interval).toMatchObject({
      lastDate: TODAY,
      lastMeter: 61950,
    });
    // Only the reminder of the same kind rolls.
    expect(s.record('Brake check').data.interval?.lastDate).toBeUndefined();
    expect(s.record('Blue hatchback').data.fields.odometer).toBe(61950);
    expect(done.updated.sort()).toEqual([s.record('Oil change').id, car.id].sort());
    // The page shows it: the oil reminder is no longer urgent, the log has the new service.
    const page = previewView(s.store, { viewId: s.viewId });
    const due = page.widgets.find((w) => w.id === 'due')!;
    expect(due.shows).not.toMatch(/Urgent: “Oil change”/);
    expect(page.widgets.find((w) => w.id === 'log')!.shows).toMatch(/5 records/);
    expect(page.widgets.find((w) => w.id === 'log-service')!.shows).toBe(
      'A “Log a service” button: adds a service; its form asks for vehicle, date, kind, odometer, cost, shop',
    );
    // Undo is one revert of that revision.
    s.store.revert(done.revision!, human, 'Undo');
    expect(s.store.get(done.recordId)).toBeNull();
    expect(s.record('Blue hatchback').data.fields.odometer).toBe(61850);
    expect(s.record('Oil change').data.interval?.lastMeter).toBe(52400);
  });

  it('never lowers a reading, and titles a record from its kind when no title is given', () => {
    const s = setup('car');
    const car = s.record('Blue hatchback');
    const result = s.actions.run(
      human,
      logService(s, { vehicle: car.id, date: TODAY, kind: 'tyres', odometer: 100 }, { title: '' }),
    ) as ActionDone;
    expect(result.status).toBe('done');
    expect((s.store.get(result.recordId) as Entity<'record'>).data.title).toBe('Tyres');
    expect(s.record('Blue hatchback').data.fields.odometer).toBe(61850);
  });
});

describe('Mark paid (done)', () => {
  it('moves the bill to its next date and adds the spending, with the amount asked', () => {
    const s = setup('money');
    const rent = s.record('Rent');
    const result = s.actions.run(
      human,
      markPaid(s, rent, { values: { date: TODAY, amount: { amount: 96000, currency: 'EUR' } } }),
    ) as ActionDone;
    expect(result).toMatchObject({ status: 'done', recordId: rent.id, updated: [rent.id] });
    expect(s.record('Rent').data.interval?.lastDate).toBe(TODAY);
    const spending = s.store.get(result.created[0]!) as Entity<'record'>;
    expect(spending.data).toMatchObject({
      recordType: 'spending',
      title: 'Rent',
      fields: {
        date: TODAY,
        amount: { amount: 96000, currency: 'EUR' },
        category: rent.data.fields.category,
        payee: 'Landlord',
      },
    });
  });

  it('takes the amount from the bill when the form leaves it', () => {
    const s = setup('money');
    const phone = s.record('Phone');
    const result = s.actions.run(human, markPaid(s, phone)) as ActionDone;
    const spending = s.store.get(result.created[0]!) as Entity<'record'>;
    expect(spending.data.fields.amount).toEqual({ amount: 2500, currency: 'EUR' });
    expect(spending.data.fields.category).toBeUndefined();
  });
});

describe('regression cases (R10.15)', () => {
  it('invalid: each field says what is wrong, and nothing is written', () => {
    const s = setup('car');
    const other = setup('car');
    const before = s.store.latestRevisionId();
    const result = s.actions.run(
      human,
      logService(s, {
        vehicle: other.record('Blue hatchback').id,
        date: '2026-02-30',
        kind: 'oli',
        odometer: 'lots',
        cost: { amount: -5, currency: 'EUR' },
        mileage: 3,
      }),
    );
    expect(result.status).toBe('invalid');
    const errors = (result as Extract<ActionResult, { status: 'invalid' }>).fieldErrors;
    expect(Object.keys(errors).sort()).toEqual(
      ['cost', 'date', 'kind', 'mileage', 'odometer', 'vehicle'].sort(),
    );
    expect(errors.kind).toMatch(/pick one of Oil, Tyres/);
    expect(errors.date).toMatch(/YYYY-MM-DD/);
    expect(errors.cost).toMatch(/negative/);
    expect(s.store.latestRevisionId()).toBe(before);
    // A record from another project: not this project's.
    const foreign = s.actions.run(
      human,
      logService(s, { vehicle: other.record('Blue hatchback').id, date: TODAY }),
    );
    expect(foreign).toMatchObject({ status: 'invalid' });
    expect((foreign as { fieldErrors: Record<string, string> }).fieldErrors.vehicle).toMatch(
      /isn't in this project/,
    );
    // Required fields.
    const missing = s.actions.run(human, logService(s, {}));
    expect((missing as { fieldErrors: Record<string, string> }).fieldErrors).toMatchObject({
      vehicle: 'Vehicle is required',
      date: 'Date is required',
    });
    // A malformed submission (no key, wrong version).
    const malformed = s.actions.run(human, { v: 2, projectId: s.projectId, values: {} });
    expect(malformed.status).toBe('invalid');
    expect(Object.keys((malformed as { fieldErrors: object }).fieldErrors)).toEqual(
      expect.arrayContaining(['v', 'viewId', 'widgetId', 'idempotencyKey']),
    );
    expect(s.store.latestRevisionId()).toBe(before);
  });

  it('duplicate: the same key returns the first result without a second revision', () => {
    const s = setup('money');
    const rent = s.record('Rent');
    const submission = markPaid(s, rent);
    const first = s.actions.run(human, submission) as ActionDone;
    const latest = s.store.latestRevisionId();
    const again = s.actions.run(human, submission);
    expect(again).toEqual({ ...first, status: 'duplicate' });
    expect(s.store.latestRevisionId()).toBe(latest);
    expect(
      s.store.list('record', { projectId: s.projectId, where: { recordType: 'spending' } }),
    ).toHaveLength(11);
    // After Undo, a replay still writes nothing and says the first was undone.
    s.store.revert(first.revision!, human);
    expect(s.actions.run(human, submission)).toMatchObject({ status: 'duplicate', undone: true });
    // The same key with other values is refused.
    const reused = s.actions.run(human, { ...submission, values: { date: '2026-10-01' } });
    expect(reused).toMatchObject({ status: 'invalid' });
  });

  it('stale: a bill changed since the form opened is not overwritten', () => {
    const s = setup('money');
    const rent = s.record('Rent');
    const opened = rent.updatedRev;
    // Someone moves the bill on meanwhile.
    s.store.apply(human, {
      message: 'Paid rent early',
      operations: [
        {
          op: 'update',
          type: 'record',
          id: rent.id,
          data: { interval: { ...rent.data.interval!, lastDate: '2026-10-10' } },
        },
      ],
    });
    const latest = s.store.latestRevisionId();
    const result = s.actions.run(human, markPaid(s, rent, { expectedRevision: opened }));
    expect(result).toMatchObject({
      status: 'stale',
      current: { recordId: rent.id, revision: latest, title: 'Rent', lastDate: '2026-10-10' },
    });
    expect(s.store.latestRevisionId()).toBe(latest);
    // Sent again with the current revision, it goes through.
    expect(s.actions.run(human, markPaid(s, rent, { expectedRevision: latest }))).toMatchObject({
      status: 'done',
    });
    // A done action without an expected revision is refused.
    const fresh = s.record('Rent');
    expect(s.actions.run(human, markPaid(s, fresh, { expectedRevision: undefined }))).toMatchObject(
      { status: 'invalid', fieldErrors: { form: expect.stringMatching(/expectedRevision/) } },
    );
  });

  it("a person's edit survives an agent's retry", () => {
    const s = setup('money');
    const rent = s.record('Rent');
    const submission = markPaid(s, rent);
    const first = s.actions.run(agent, submission) as ActionDone;
    expect(s.store.revision(first.revision!)!.author).toEqual(agent);
    // The owner corrects the date.
    const corrected = s.record('Rent');
    s.store.apply(human, {
      message: 'Paid on the 12th',
      operations: [
        {
          op: 'update',
          type: 'record',
          id: rent.id,
          data: { interval: { ...corrected.data.interval!, lastDate: '2026-10-12' } },
        },
      ],
    });
    const latest = s.store.latestRevisionId();
    // The agent retries: the same key replays, a new key with its old revision is stale.
    expect(s.actions.run(agent, submission).status).toBe('duplicate');
    expect(s.actions.run(agent, { ...submission, idempotencyKey: key() }).status).toBe('stale');
    expect(s.record('Rent').data.interval?.lastDate).toBe('2026-10-12');
    expect(s.store.latestRevisionId()).toBe(latest);
  });

  it('failed: an unexpected error writes nothing and frees the key for a retry', () => {
    const s = setup('money');
    const rent = s.record('Rent');
    const submission = markPaid(s, rent);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const apply = vi.spyOn(s.store, 'apply').mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    const before = s.store.latestRevisionId();
    expect(s.actions.run(human, submission)).toMatchObject({
      status: 'failed',
      message: expect.stringMatching(/nothing was changed/),
    });
    expect(s.store.latestRevisionId()).toBe(before);
    apply.mockRestore();
    errors.mockRestore();
    expect(s.actions.run(human, submission).status).toBe('done');
  });

  it('not_found: a page, block or record that is not there', () => {
    const s = setup('money');
    const other = setup('money');
    const rent = s.record('Rent');
    expect(s.actions.run(human, markPaid(s, rent, { widgetId: 'nope' }))).toMatchObject({
      status: 'not_found',
    });
    expect(s.actions.run(human, markPaid(s, rent, { viewId: other.viewId }))).toMatchObject({
      status: 'not_found',
    });
    expect(s.actions.run(human, markPaid(s, rent, { projectId: 'prj_missing' }))).toMatchObject({
      status: 'not_found',
    });
    // A bill from another project in the same Pharos, even through this project's page.
    const second = applyPack(
      s.store,
      agent,
      { pack: 'money', name: 'Theirs', examples: true },
      TODAY,
    );
    const theirs = s.store
      .list('record', { projectId: second.projectId })
      .find((r) => r.data.title === 'Rent')!;
    const before = s.store.latestRevisionId();
    expect(s.actions.run(human, markPaid(s, theirs))).toMatchObject({ status: 'not_found' });
    expect(s.store.latestRevisionId()).toBe(before);
  });

  it('refuses a block that is not an action, and an action for a type the project lacks', () => {
    const s = setup('money');
    const rent = s.record('Rent');
    expect(s.actions.run(human, markPaid(s, rent, { widgetId: 'bills' }))).toMatchObject({
      status: 'not_found',
    });
  });
});

describe('over REST and MCP', () => {
  async function connect(app: ReturnType<typeof createApp>) {
    const client = new Client({ name: 'Opus 5.5', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL('http://localhost:4300/mcp'), {
        fetch: async (url, init) => app.fetch(new Request(url, init)),
      }),
    );
    return client;
  }

  it('POST /api/projects/:id/actions answers each result with its status code', async () => {
    const s = setup('money');
    const app = createApp(s.store);
    const rent = s.record('Rent');
    const post = (body: unknown, headers: Record<string, string> = {}) =>
      app.request(`/api/projects/${s.projectId}/actions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
    const { projectId: _p, ...body } = markPaid(s, rent);
    void _p;
    const done = await post(body);
    expect(done.status).toBe(200);
    const result = (await done.json()) as { revision: number };
    expect(s.store.revision(result.revision)!.author).toEqual({ kind: 'human', name: 'me' });
    expect((await post(body)).status).toBe(200);
    expect((await post({ ...body, idempotencyKey: key() })).status).toBe(409);
    const now = s.record('Rent').updatedRev;
    expect(
      (await post({ ...body, idempotencyKey: key(), expectedRevision: now, values: {} })).status,
    ).toBe(400);
    // Marked paid today already: a second time today is refused, not logged twice.
    const twice = await post({ ...body, idempotencyKey: key(), expectedRevision: now });
    expect(twice.status).toBe(400);
    expect(((await twice.json()) as { fieldErrors: { date: string } }).fieldErrors.date).toMatch(
      /Already marked done/,
    );
    expect((await post({ ...body, idempotencyKey: key(), widgetId: 'gone' })).status).toBe(404);
    expect((await post({ ...body, projectId: 'prj_other' })).status).toBe(400);
    // An agent's header is its author.
    const fresh = s.record('Phone');
    const byAgent = await post(
      { ...markPaid(s, fresh), projectId: undefined },
      { 'x-pharos-author': 'agent:Opus 5.5' },
    );
    const agentResult = (await byAgent.json()) as { revision: number };
    expect(s.store.revision(agentResult.revision)!.author).toEqual(agent);
  });

  it('action_run submits as the agent; project_snapshot lists the actions and revisions', async () => {
    const s = setup('car');
    const app = createApp(s.store);
    const client = await connect(app);
    const snapshot = projectSnapshot(s.store, s.projectId) as {
      actions: unknown[];
      records: { title: string; revision: number }[];
    };
    expect(snapshot.actions).toEqual([
      {
        viewId: s.viewId,
        widgetId: 'log-service',
        label: 'Log a service',
        does: 'create',
        recordType: 'service',
      },
    ]);
    expect(snapshot.records.find((r) => r.title === 'Oil change')!.revision).toBeGreaterThan(0);
    const run = (args: Record<string, unknown>) =>
      client.callTool({ name: 'action_run', arguments: args }) as Promise<CallToolResult>;
    const car = s.record('Blue hatchback');
    const ok = await run(logService(s, { vehicle: car.id, date: TODAY, kind: 'oil' }));
    expect(ok.isError).toBeFalsy();
    const text = (ok.content[0] as { text: string }).text;
    const revision = (JSON.parse(text) as { revision: number }).revision;
    expect(s.store.revision(revision)!.author).toEqual(agent);
    const bad = await run(logService(s, { vehicle: car.id }));
    expect(bad.isError).toBe(true);
    expect((bad.content[0] as { text: string }).text).toMatch(/Date is required/);
  });
});
