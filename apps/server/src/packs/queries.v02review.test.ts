import { afterEach, describe, expect, it } from 'vitest';
import { Board, checkBoardQueries, runQuery, type RecordType, type ViewNode } from '@pharos/schema';
import { createApp } from '../app.js';
import { openDatabase } from '../store/database.js';
import { Store } from '../store/store.js';
import { createView, updateView } from '../views/service.js';

const agent = { kind: 'agent', name: 'review' } as const;
const stores: Store[] = [];
afterEach(async () => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  stores.splice(0).forEach((s) => s.database.close());
});
const types: RecordType[] = [
  {
    key: 'alpha',
    name: 'Alpha',
    fields: [
      { key: 'amount', label: 'Amount', kind: 'number' },
      { key: 'date', label: 'Date', kind: 'date' },
      { key: 'state', label: 'State', kind: 'option', options: [{ value: 'x', label: 'X' }] },
    ],
  },
  {
    key: 'beta',
    name: 'Beta',
    fields: [
      { key: 'state', label: 'State', kind: 'option', options: [{ value: 'y', label: 'Y' }] },
    ],
  },
];
function setup() {
  const s = new Store(openDatabase(':memory:'));
  stores.push(s);
  const projectId = s.apply(agent, {
    message: 'Made-up project',
    operations: [
      { op: 'create', type: 'project', data: { name: 'Review fixture', recordTypes: types } },
    ],
  }).created['0']!;
  return { s, projectId };
}
function save(s: Store, projectId: string, node: ViewNode) {
  return createView(s, agent, {
    projectId,
    name: 'Review page',
    message: 'Review query',
    widgets: [{ id: 'test', node }],
  });
}

describe('independent query review', () => {
  it('rejects an unknown record type in anyOf even with a known outer recordType', () => {
    const { s, projectId } = setup();
    const node: ViewNode = {
      component: 'DataList',
      query: { type: 'record', where: { recordType: 'alpha' }, anyOf: [{ recordType: 'alhpa' }] },
    };
    expect(() => save(s, projectId, node)).toThrow();
  });

  it('allows an intentional empty substring match on recordType', () => {
    const { s, projectId } = setup();
    expect(() =>
      save(s, projectId, {
        component: 'DataList',
        query: { type: 'record', where: { recordType: { contains: 'alhpa' } } },
      }),
    ).not.toThrow();
  });

  it('accepts valid anyOf branches with different option lists', () => {
    const { s, projectId } = setup();
    const node: ViewNode = {
      component: 'DataList',
      query: {
        type: 'record',
        anyOf: [
          { recordType: 'alpha', 'fields.state': 'x' },
          { recordType: 'beta', 'fields.state': 'y' },
        ],
      },
    };
    expect(() => save(s, projectId, node)).not.toThrow();
  });

  it('rejects a project id used as a numeric comparison value', () => {
    const { s, projectId } = setup();
    expect(() =>
      save(s, projectId, {
        component: 'DataList',
        query: { type: 'record', where: { recordType: 'alpha', 'fields.amount': '$project' } },
      }),
    ).toThrow();
  });

  it('rejects an impossible literal calendar date in a query', () => {
    const { s, projectId } = setup();
    expect(() =>
      save(s, projectId, {
        component: 'DataList',
        query: { type: 'record', where: { recordType: 'alpha', 'fields.date': '2026-02-30' } },
      }),
    ).toThrow();
  });

  it('rejects a month bucket on a numeric field', () => {
    const { s, projectId } = setup();
    expect(() =>
      save(s, projectId, {
        component: 'CountChart',
        query: { type: 'record', where: { recordType: 'alpha' } },
        by: 'fields.amount',
        bucket: 'month',
      }),
    ).toThrow();
  });

  it('rejects record metadata edits that invalidate a saved page', async () => {
    const { s, projectId } = setup();
    save(s, projectId, {
      component: 'Stat',
      label: 'Amount',
      query: { type: 'record', where: { recordType: 'alpha' } },
      sum: 'fields.amount',
    });
    const revision = s.latestRevisionId();
    const response = await createApp(s).request('/api/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-pharos-author': 'agent:review' },
      body: JSON.stringify({
        message: 'Rename field',
        operations: [
          {
            op: 'update',
            type: 'project',
            id: projectId,
            data: {
              recordTypes: types.map((t) =>
                t.key === 'alpha'
                  ? { ...t, fields: t.fields.filter((f) => f.key !== 'amount') }
                  : t,
              ),
            },
          },
        ],
      }),
    });
    expect(response.status).toBe(400);
    expect(s.latestRevisionId()).toBe(revision);
  });

  it('rejects a second occurrence of an old error inside the same widget', () => {
    const { s, projectId } = setup();
    const result = save(s, projectId, { component: 'Text', content: 'Legacy' });
    const view = s.getOfType('view', result.view.id);
    const bad: ViewNode = {
      component: 'DataList',
      query: { type: 'record', where: { recordType: 'alpha', 'fields.typo': 1 } },
    };
    const old = Board.parse({
      component: 'Board',
      widgets: [{ id: 'legacy', node: { component: 'Section', title: 'Legacy', children: [bad] } }],
    });
    s.database
      .prepare('UPDATE entities SET data = ? WHERE id = ?')
      .run(JSON.stringify({ ...view.data, spec: old }), view.id);
    expect(() =>
      updateView(s, agent, {
        viewId: view.id,
        message: 'Add another broken query',
        widgets: [
          { id: 'legacy', node: { component: 'Section', title: 'Legacy', children: [bad, bad] } },
        ],
      }),
    ).toThrow();
  });

  it('allows an unrelated resize of a legacy page with an old error', () => {
    const { s, projectId } = setup();
    const result = save(s, projectId, { component: 'Text', content: 'Legacy' });
    const view = s.getOfType('view', result.view.id);
    const old = Board.parse({
      component: 'Board',
      widgets: [
        {
          id: 'legacy',
          node: {
            component: 'DataList',
            query: { type: 'record', where: { recordType: 'alpha', 'fields.typo': 1 } },
          },
        },
      ],
    });
    s.database
      .prepare('UPDATE entities SET data = ? WHERE id = ?')
      .run(JSON.stringify({ ...view.data, spec: old }), view.id);
    expect(() =>
      updateView(s, agent, {
        viewId: view.id,
        message: 'Resize only',
        ops: [{ op: 'update', id: 'legacy', w: 6 }],
      }),
    ).not.toThrow();
  });

  it('warns on mixed records but allows an intentional empty result', () => {
    const { s, projectId } = setup();
    const mixed = save(s, projectId, { component: 'DataList', query: { type: 'record' } });
    expect(mixed.preview.findings).toContainEqual(
      expect.objectContaining({ level: 'warn', code: 'no-record-type' }),
    );
    const result = save(s, projectId, {
      component: 'DataList',
      query: { type: 'record', where: { recordType: 'alpha', 'fields.amount': 987 } },
    });
    expect(result.preview.findings).toEqual([]);
    expect(
      runQuery(s.dataset(projectId), 'record', {
        where: { recordType: 'alpha', 'fields.amount': 987 },
      }),
    ).toEqual([]);
  });

  it('refuses unknown fields atomically with a useful correction', async () => {
    const { s, projectId } = setup();
    const node: ViewNode = {
      component: 'Stat',
      label: 'Amount',
      query: { type: 'record', where: { recordType: 'alpha' } },
      sum: 'fields.amout',
    };
    const board = Board.parse({ component: 'Board', widgets: [{ id: 'test', node }] });
    expect(checkBoardQueries(board, s.getOfType('project', projectId))).toContainEqual(
      expect.objectContaining({ level: 'reject', suggestion: 'fields.amount' }),
    );
    const revision = s.latestRevisionId();
    const response = await createApp(s).request('/api/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-pharos-author': 'agent:review' },
      body: JSON.stringify({
        message: 'Typo',
        operations: [
          { op: 'create', type: 'view', data: { projectId, name: 'Typo', spec: board } },
        ],
      }),
    });
    expect(response.status).toBe(400);
    expect(s.latestRevisionId()).toBe(revision);
  });

  it('refuses impossible dates in records before they reach a due tracker', async () => {
    const { s, projectId } = setup();
    const response = await createApp(s).request('/api/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-pharos-author': 'agent:review' },
      body: JSON.stringify({
        message: 'Impossible date',
        operations: [
          {
            op: 'create',
            type: 'record',
            data: {
              projectId,
              recordType: 'alpha',
              title: 'Bad date',
              fields: { date: '2026-02-30' },
            },
          },
        ],
      }),
    });
    expect(response.status).toBe(400);
  });
});
