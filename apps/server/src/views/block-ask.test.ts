import type { Author, Entity } from '@pharos/schema';
import { describe, expect, it } from 'vitest';
import { AgentRunner, type Runner } from '../agent-runner.js';
import { createApp } from '../app.js';
import { answerBrief } from '../guidance.js';
import { applyPack } from '../packs/service.js';
import { Presence } from '../presence.js';
import { openDatabase } from '../store/database.js';
import { PharosError } from '../store/errors.js';
import { projectSnapshot } from '../store/snapshot.js';
import { Store } from '../store/store.js';
import { getView, updateView } from './service.js';

/**
 * "Ask about this block" (R10.6–R10.9): the request names one block, the agent may change only
 * that block, and the page survives save, reload, Undo and a person's layout edits.
 */

const person: Author = { kind: 'human', name: 'me' };
const agent: Author = { kind: 'agent', name: 'Claude Code' };

function setup() {
  const store = new Store(openDatabase(':memory:'));
  const pack = applyPack(
    store,
    agent,
    { pack: 'money', name: 'Money', examples: true },
    '2026-10-13',
  );
  const viewId = pack.views[0]!.id;
  const ask = (widgetId: string, question = 'Show only bills due this month') =>
    store.apply(person, {
      message: `Ask: ${question}`,
      operations: [
        {
          op: 'create',
          type: 'request',
          data: {
            projectId: pack.projectId,
            question,
            about: `${widgetId} in This month`,
            viewId,
            widgetId,
            mode: 'block',
          },
        },
      ],
    }).created['0']!;
  const board = () => getView(store, viewId).board;
  return { store, projectId: pack.projectId, viewId, ask, board };
}

function refusal(fn: () => unknown): PharosError {
  try {
    fn();
  } catch (err) {
    if (err instanceof PharosError) return err;
    throw err;
  }
  throw new Error('expected a refusal');
}

const retitle = (id: string, title: string) => ({ op: 'update' as const, id, set: { title } });

describe('the agent changes only the block it was asked about (R10.8)', () => {
  it('changes the asked block, answers the request with a reply, and leaves every other block as it was', () => {
    const s = setup();
    const requestId = s.ask('bills');
    const before = s.board();
    const result = updateView(s.store, agent, {
      viewId: s.viewId,
      message: 'Bills due this month',
      requestId,
      reply: 'The list now shows only bills due this month.',
      expectedRevision: getView(s.store, s.viewId).revision,
      ops: [
        {
          op: 'update',
          id: 'bills',
          set: {
            title: 'Due this month',
            query: {
              type: 'record',
              where: { recordType: 'bill', 'due.date': { lte: '$monthStart+1m' } },
            },
          },
        },
      ],
    });
    const after = s.board();
    expect(after.widgets.map((w) => w.id)).toEqual(before.widgets.map((w) => w.id));
    for (const [i, w] of before.widgets.entries())
      if (w.id !== 'bills') expect(after.widgets[i]).toEqual(w);
    expect(after.widgets.find((w) => w.id === 'bills')!.node).toMatchObject({
      title: 'Due this month',
      action: 'mark-paid',
    });
    const request = s.store.get(requestId) as Entity<'request'>;
    expect(request.data).toMatchObject({
      status: 'answered',
      reply: 'The list now shows only bills due this month.',
    });
    // One revision holds both, so one Undo puts the block back and reopens the question.
    const revision = result.revision!.id;
    expect(
      s.store
        .revision(revision)!
        .changes.map((c) => c.id)
        .sort(),
    ).toEqual([s.viewId, requestId].sort());
    s.store.revert(revision, person, 'Undo');
    expect(s.board()).toEqual(before);
    expect((s.store.get(requestId) as Entity<'request'>).data.status).toBe('open');
  });

  it('refuses other blocks, new, removed or moved blocks and view changes while the request is open', () => {
    const s = setup();
    const requestId = s.ask('bills');
    const before = s.board();
    const latest = s.store.latestRevisionId();
    const tries: [string, () => unknown][] = [
      [
        'another block',
        () =>
          updateView(s.store, agent, {
            viewId: s.viewId,
            message: 'x',
            ops: [retitle('spending', 'All spending')],
          }),
      ],
      [
        'both blocks',
        () =>
          updateView(s.store, agent, {
            viewId: s.viewId,
            message: 'x',
            requestId,
            ops: [retitle('bills', 'Bills'), retitle('savings', 'Saved')],
          }),
      ],
      [
        'removing it',
        () =>
          updateView(s.store, agent, {
            viewId: s.viewId,
            message: 'x',
            ops: [{ op: 'remove', id: 'bills' }],
          }),
      ],
      [
        'adding a block',
        () =>
          updateView(s.store, agent, {
            viewId: s.viewId,
            message: 'x',
            ops: [
              { op: 'add', widget: { id: 'more', node: { component: 'Callout', body: 'hi' } } },
            ],
          }),
      ],
      [
        'moving it',
        () =>
          updateView(s.store, agent, {
            viewId: s.viewId,
            message: 'x',
            ops: [{ op: 'move', id: 'bills', before: 'headline' }],
          }),
      ],
      [
        'renaming the view',
        () => updateView(s.store, agent, { viewId: s.viewId, message: 'x', name: 'Bills' }),
      ],
      [
        'replacing all widgets',
        () =>
          updateView(s.store, agent, {
            viewId: s.viewId,
            message: 'x',
            widgets: before.widgets.slice(1),
          }),
      ],
    ];
    for (const [what, attempt] of tries) {
      const err = refusal(attempt);
      expect(err.code, what).toBe('invalid');
      expect(err.message, what).toMatch(/"bills"/);
    }
    expect(s.store.latestRevisionId()).toBe(latest);
    expect(s.board()).toEqual(before);
    // Without the requestId, the asked block itself may still change.
    updateView(s.store, agent, {
      viewId: s.viewId,
      message: 'x',
      ops: [retitle('bills', 'Bills soon')],
    });
    // A person is never limited.
    updateView(s.store, person, {
      viewId: s.viewId,
      message: 'Mine',
      ops: [retitle('spending', 'Mine')],
    });
    expect(s.board().widgets.find((w) => w.id === 'spending')!.node.title).toBe('Mine');
  });

  it('frees the view once the request is answered or dismissed', () => {
    const s = setup();
    const requestId = s.ask('bills');
    s.store.apply(agent, {
      message: "Can't do that here",
      operations: [
        {
          op: 'update',
          type: 'request',
          id: requestId,
          data: {
            status: 'dismissed',
            reply: 'A DueTracker shows every bill; ask for a new page instead.',
          },
        },
      ],
    });
    updateView(s.store, agent, {
      viewId: s.viewId,
      message: 'x',
      ops: [retitle('spending', 'Spent')],
    });
    expect(s.board().widgets.find((w) => w.id === 'spending')!.node.title).toBe('Spent');
  });

  it('checks the request: same project, still open, and the view it is about', () => {
    const s = setup();
    const requestId = s.ask('bills');
    const other = applyPack(s.store, agent, { pack: 'car', name: 'Car' }, '2026-10-13');
    expect(
      refusal(() =>
        updateView(s.store, agent, {
          viewId: other.views[0]!.id,
          message: 'x',
          requestId,
          ops: [retitle('due', 'Due')],
        }),
      ).message,
    ).toMatch(/another project/);
    expect(
      refusal(() =>
        updateView(s.store, agent, {
          viewId: s.viewId,
          message: 'x',
          reply: 'hi',
          ops: [retitle('bills', 'B')],
        }),
      ).message,
    ).toMatch(/reply needs a requestId/);
    updateView(s.store, agent, {
      viewId: s.viewId,
      message: 'x',
      requestId,
      ops: [retitle('bills', 'B')],
    });
    expect(
      refusal(() =>
        updateView(s.store, agent, {
          viewId: s.viewId,
          message: 'x',
          requestId,
          ops: [retitle('bills', 'C')],
        }),
      ).message,
    ).toMatch(/already answered/);
  });

  it('REST /api/apply holds an agent to the same scope', async () => {
    const s = setup();
    s.ask('bills');
    const app = createApp(s.store);
    const board = s.board();
    const changed = {
      ...board,
      widgets: board.widgets.map((w) => (w.id === 'spending' ? { ...w, w: 12 } : w)),
    };
    const post = (author: string) =>
      app.request('/api/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-pharos-author': author },
        body: JSON.stringify({
          message: 'Wider spending',
          operations: [{ op: 'update', type: 'view', id: s.viewId, data: { spec: changed } }],
        }),
      });
    const refused = await post('agent:Claude Code');
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toMatch(
      /"spending" would change too/,
    );
    expect((await post('human:me')).status).toBe(200);
  });
});

describe('save, reload, Undo and layout (R10.9)', () => {
  it("keeps a person's layout edit when the agent retries with an old revision", () => {
    const s = setup();
    const requestId = s.ask('bills');
    const read = getView(s.store, s.viewId);
    // The person widens the spending table while the agent works.
    const board = s.board();
    s.store.apply(person, {
      message: 'Wider spending table',
      operations: [
        {
          op: 'update',
          type: 'view',
          id: s.viewId,
          data: {
            spec: {
              ...board,
              widgets: board.widgets.map((w) => (w.id === 'spending' ? { ...w, w: 12 } : w)),
            },
          },
        },
      ],
    });
    const mine = s.board();
    const stale = refusal(() =>
      updateView(s.store, agent, {
        viewId: s.viewId,
        message: 'Retitle',
        requestId,
        expectedRevision: read.revision,
        ops: [retitle('bills', 'Due soon')],
      }),
    );
    expect(stale.code).toBe('conflict');
    expect(s.board()).toEqual(mine);
    // Read again and redo: the person's edit stays, only the block changes.
    updateView(s.store, agent, {
      viewId: s.viewId,
      message: 'Retitle',
      requestId,
      expectedRevision: getView(s.store, s.viewId).revision,
      ops: [retitle('bills', 'Due soon')],
    });
    const after = s.board();
    expect(after.widgets.find((w) => w.id === 'spending')!.w).toBe(12);
    expect(after.widgets.find((w) => w.id === 'bills')!.node.title).toBe('Due soon');
    expect(after.widgets.map((w) => w.id)).toEqual(mine.widgets.map((w) => w.id));
  });

  it('a saved change reloads the same, from a fresh store on the same data', () => {
    const db = openDatabase(':memory:');
    const store = new Store(db);
    const pack = applyPack(
      store,
      agent,
      { pack: 'money', name: 'Money', examples: true },
      '2026-10-13',
    );
    const viewId = pack.views[0]!.id;
    updateView(store, agent, { viewId, message: 'x', ops: [retitle('bills', 'Next bills')] });
    const reloaded = new Store(db);
    expect(getView(reloaded, viewId).board).toEqual(getView(store, viewId).board);
    expect(getView(reloaded, viewId).board.widgets.find((w) => w.id === 'bills')!.node.title).toBe(
      'Next bills',
    );
  });

  it('each change undoes on its own, newest first, back to the pack page', () => {
    const s = setup();
    const original = s.board();
    const first = updateView(s.store, agent, {
      viewId: s.viewId,
      message: 'a',
      ops: [retitle('bills', 'One')],
    });
    const second = updateView(s.store, person, {
      viewId: s.viewId,
      message: 'b',
      ops: [retitle('spending', 'Two')],
    });
    s.store.revert(second.revision!.id, person);
    expect(s.board().widgets.find((w) => w.id === 'spending')!.node.title).toBe(
      original.widgets.find((w) => w.id === 'spending')!.node.title,
    );
    expect(s.board().widgets.find((w) => w.id === 'bills')!.node.title).toBe('One');
    s.store.revert(first.revision!.id, person);
    expect(s.board()).toEqual(original);
  });
});

describe('what the agent is told and what the page shows', () => {
  it('the brief, the snapshot and the request context say to change only that block', () => {
    const s = setup();
    const requestId = s.ask('bills');
    const brief = answerBrief(s.store, [s.projectId]);
    expect(brief).toMatch(/Change this block \(mode "block"\)/);
    expect(brief).toContain(`requestId: "${requestId}"`);
    const snapshot = projectSnapshot(s.store, s.projectId) as { requests: { mode?: string }[] };
    expect(snapshot.requests[0]).toMatchObject({ mode: 'block' });
  });

  it('the answering run marks the asked block as being edited, and clears it after', async () => {
    const s = setup();
    s.ask('bills');
    const presence = new Presence();
    let finish: () => void = () => {};
    const runner: Runner = () =>
      new Promise((resolve) => {
        finish = () => resolve({ exitCode: 0, timedOut: false });
      });
    const runnerAgent = new AgentRunner(s.store, { command: 'answer', runner, presence });
    (runnerAgent as unknown as { queue: Set<string> }).queue.add(s.projectId);
    const run = runnerAgent.runNext();
    expect(presence.state().entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ viewId: s.viewId, widgetId: 'bills', activity: 'editing' }),
      ]),
    );
    finish();
    await run;
    expect(presence.state().entries).toEqual([]);
  });
});
