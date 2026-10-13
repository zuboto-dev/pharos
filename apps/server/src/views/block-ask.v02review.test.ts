import type { Author, Board, Entity } from '@pharos/schema';
import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { applyPack } from '../packs/service.js';
import { openDatabase } from '../store/database.js';
import { PharosError } from '../store/errors.js';
import { Store } from '../store/store.js';
import { deleteView, getView, updateView } from './service.js';

const owner: Author = { kind: 'human', name: 'owner' };
const agent: Author = { kind: 'agent', name: 'Claude Code' };
const today = '2026-10-13';

function setup() {
  const store = new Store(openDatabase(':memory:'));
  const pack = applyPack(store, agent, { pack: 'money', name: 'Money', examples: true }, today);
  const viewId = pack.views[0]!.id;
  const askId = store.apply(owner, {
    message: 'Ask about bills',
    operations: [
      {
        op: 'create',
        type: 'request',
        data: {
          projectId: pack.projectId,
          question: 'Show bills due this month',
          viewId,
          widgetId: 'bills',
          mode: 'block',
        },
      },
    ],
  }).created['0']!;
  const board = () => getView(store, viewId).board;
  return { store, projectId: pack.projectId, viewId, askId, board };
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

function ownerEdit(s: ReturnType<typeof setup>) {
  const before = s.board();
  const changed: Board = {
    ...before,
    widgets: before.widgets.map((widget) =>
      widget.id === 'spending' ? { ...widget, w: 12 } : widget,
    ),
  };
  return s.store.apply(owner, {
    message: 'Widen spending',
    operations: [{ op: 'update', type: 'view', id: s.viewId, data: { spec: changed } }],
  });
}

describe('v0.2 block ask scope review regressions', () => {
  it('REST apply refuses an agent edit to a block outside the open request', async () => {
    const s = setup();
    const board = s.board();
    const changed = {
      ...board,
      widgets: board.widgets.map((widget) =>
        widget.id === 'spending' ? { ...widget, w: 12 } : widget,
      ),
    };
    const response = await createApp(s.store).request('/api/apply', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-pharos-author': 'agent:Claude Code',
      },
      body: JSON.stringify({
        message: 'Widen spending',
        operations: [{ op: 'update', type: 'view', id: s.viewId, data: { spec: changed } }],
      }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/"spending" would change too/);
  });

  it('view_update refuses an agent edit to a block outside the open request', () => {
    const s = setup();
    const error = refusal(() =>
      updateView(s.store, agent, {
        viewId: s.viewId,
        message: 'Widen spending',
        ops: [{ op: 'update', id: 'spending', set: { title: 'Wider spending' } }],
      }),
    );

    expect(error.code).toBe('invalid');
    expect(s.store.get(s.askId)).toMatchObject({ data: { status: 'open' } });
  });

  it('an open block request also prevents an agent edit to another view in the project', () => {
    const s = setup();
    const otherViewId = s.store.apply(owner, {
      message: 'Add a second view',
      operations: [
        {
          op: 'create',
          type: 'view',
          data: {
            projectId: s.projectId,
            name: 'Notes',
            spec: {
              component: 'Board',
              widgets: [{ id: 'note', node: { component: 'Text', content: 'Before' } }],
            },
          },
        },
      ],
    }).created['0']!;
    const before = getView(s.store, otherViewId).board;

    const error = refusal(() =>
      updateView(s.store, agent, {
        viewId: otherViewId,
        message: 'Edit notes while answering bills',
        ops: [{ op: 'update', id: 'note', set: { content: 'Changed' } }],
      }),
    );

    expect(error.code).toBe('invalid');
    expect(getView(s.store, otherViewId).board).toEqual(before);
    expect(s.store.get(s.askId)).toMatchObject({ data: { status: 'open' } });
  });

  it('cannot answer one block request by changing a different requested block', () => {
    const s = setup();
    const otherAskId = s.store.apply(owner, {
      message: 'Ask about spending',
      operations: [
        {
          op: 'create',
          type: 'request',
          data: {
            projectId: s.projectId,
            question: 'Rename the spending table',
            viewId: s.viewId,
            widgetId: 'spending',
            mode: 'block',
          },
        },
      ],
    }).created['0']!;

    const error = refusal(() =>
      updateView(s.store, agent, {
        viewId: s.viewId,
        message: 'Rename spending',
        requestId: s.askId,
        ops: [{ op: 'update', id: 'spending', set: { title: 'Expenses' } }],
      }),
    );

    expect(error.code).toBe('invalid');
    expect(s.store.get(s.askId)).toMatchObject({ data: { status: 'open' } });
    expect(s.store.get(otherAskId)).toMatchObject({ data: { status: 'open' } });
  });

  it("doesn't let a stale full-board update without expectedRevision overwrite an owner edit", () => {
    const s = setup();
    const oldView = getView(s.store, s.viewId);
    ownerEdit(s);
    const ownerBoard = getView(s.store, s.viewId).board;
    s.store.apply(owner, {
      message: 'Close the test request',
      operations: [
        {
          op: 'update',
          type: 'request',
          id: s.askId,
          data: { status: 'dismissed', reply: 'Done' },
        },
      ],
    });

    const error = refusal(() =>
      updateView(s.store, agent, {
        viewId: s.viewId,
        message: 'Save the earlier draft',
        widgets: oldView.board.widgets,
      }),
    );

    expect(error.code).toBe('conflict');
    expect(s.board()).toEqual(ownerBoard);
  });

  it('an agent cannot revert an owner layout edit outside the asked block', () => {
    const s = setup();
    const ownerRevision = ownerEdit(s).revision!;
    const beforeRevert = s.board();

    const error = refusal(() => s.store.revert(ownerRevision.id, agent));

    expect(error.code).toBe('invalid');
    expect(s.board()).toEqual(beforeRevert);
    expect(s.store.get(s.askId)).toMatchObject({ data: { status: 'open' } });
  });

  it('an agent cannot delete a view while its block request is open', () => {
    const s = setup();

    const error = refusal(() =>
      deleteView(s.store, agent, { viewId: s.viewId, message: 'Delete' }),
    );

    expect(error.code).toBe('invalid');
    expect(s.store.get(s.viewId)?.type).toBe('view');
    expect((s.store.get(s.askId) as Entity<'request'>).data.status).toBe('open');
  });
});
