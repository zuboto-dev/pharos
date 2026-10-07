import { describe, expect, it } from 'vitest';
import { openDatabase } from '../store/database.js';
import { Store } from '../store/store.js';
import { answerView, isExpired, listViews } from './service.js';

const agent = { kind: 'agent', name: 'test' } as const;

describe('answer views', () => {
  it('stop being listed once expired, but stay in the data', () => {
    const store = new Store(openDatabase(':memory:'));
    const projectId = store.apply(agent, {
      message: 'p',
      operations: [{ op: 'create', type: 'project', data: { name: 'P' } }],
    }).created['0']!;
    const widgets = [{ id: 't', node: { component: 'Text', content: 'Hi' } }];
    const old = answerView(
      store,
      agent,
      { projectId, question: 'Old question', widgets, expiresInDays: 1 },
      Date.now() - 2 * 86_400_000,
    );
    const fresh = answerView(store, agent, {
      projectId,
      question: 'A long question that needs to be shortened for its tab',
      widgets,
    });
    expect(fresh.view.name).toBe('A long question that needs to be shorte…');
    expect(isExpired(store.getOfType('view', old.view.id))).toBe(true);
    expect(listViews(store, projectId).map((v) => v.id)).not.toContain(old.view.id);
    expect(listViews(store, projectId, true).find((v) => v.id === old.view.id)).toMatchObject({
      expired: true,
    });
  });
});
