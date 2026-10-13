import type { Author, Board } from '@pharos/schema';
import { describe, expect, it } from 'vitest';
import { applyPack } from '../packs/service.js';
import { openDatabase } from '../store/database.js';
import { Store } from '../store/store.js';
import { getView, updateView } from './service.js';

/** v0.2 review follow-ups (gaps 3 and 4): what stays allowed next to the new refusals. */

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
  const viewId = pack.views[0]!.id;
  return { store, projectId: pack.projectId, viewId, board: () => getView(store, viewId).board };
}

function widen(board: Board, id: string): Board {
  return { ...board, widgets: board.widgets.map((w) => (w.id === id ? { ...w, w: 12 } : w)) };
}

describe('stale layout writes (gap 4)', () => {
  it('lets an agent edit single blocks with ops after a person edit, keeping that edit', () => {
    const s = setup();
    s.store.apply(owner, {
      message: 'Widen spending',
      operations: [
        { op: 'update', type: 'view', id: s.viewId, data: { spec: widen(s.board(), 'spending') } },
      ],
    });
    updateView(s.store, agent, {
      viewId: s.viewId,
      message: 'Retitle bills',
      ops: [{ op: 'update', id: 'bills', set: { title: 'Bills to pay' } }],
    });
    const board = s.board();
    expect(board.widgets.find((w) => w.id === 'spending')?.w).toBe(12);
    expect(board.widgets.find((w) => w.id === 'bills')?.node.title).toBe('Bills to pay');
  });

  it('lets an agent replace widgets it wrote last, or with a matching revision', () => {
    const s = setup();
    // The pack was set up by this agent: it changed the view last.
    updateView(s.store, agent, {
      viewId: s.viewId,
      message: 'Replace',
      widgets: s.board().widgets,
    });
    s.store.apply(owner, {
      message: 'Widen spending',
      operations: [
        { op: 'update', type: 'view', id: s.viewId, data: { spec: widen(s.board(), 'spending') } },
      ],
    });
    const read = getView(s.store, s.viewId);
    updateView(s.store, agent, {
      viewId: s.viewId,
      message: 'Replace after reading',
      expectedRevision: read.revision,
      widgets: read.board.widgets,
    });
    expect(s.board().widgets.find((w) => w.id === 'spending')?.w).toBe(12);
  });
});

describe('block request scope in the store (gap 3)', () => {
  it('still lets an agent add a new view while a block request is open', () => {
    const s = setup();
    s.store.apply(owner, {
      message: 'Ask',
      operations: [
        {
          op: 'create',
          type: 'request',
          data: {
            projectId: s.projectId,
            question: 'Only this month',
            viewId: s.viewId,
            widgetId: 'bills',
            mode: 'block',
          },
        },
      ],
    });
    const result = s.store.apply(agent, {
      message: 'An answer view for another question',
      operations: [
        {
          op: 'create',
          type: 'view',
          data: {
            projectId: s.projectId,
            name: 'Answer',
            kind: 'answer',
            spec: { component: 'Board', widgets: [] },
          },
        },
      ],
    });
    expect(result.revision).not.toBeNull();
  });
});
