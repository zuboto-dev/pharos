import { describe, expect, it } from 'vitest';
import { openDatabase } from '../store/database.js';
import { Store } from '../store/store.js';
import { answerView, createView, isExpired, listViews, updateView } from './service.js';

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

describe('explanation views', () => {
  it('are saved with warnings, never refused, and warn again on update until fixed', () => {
    const store = new Store(openDatabase(':memory:'));
    const { created } = store.apply(agent, {
      message: 'p',
      operations: [
        { op: 'create', type: 'project', ref: 'p', data: { name: 'P' } },
        {
          op: 'create',
          type: 'claim',
          ref: 'c',
          data: {
            projectId: '$p',
            statement: 'The point.',
            checkedOn: '2026-10-01',
            assumption: 'It holds.',
            tags: ['a'],
          },
        },
      ],
    });
    const layers = {
      id: 'layers',
      node: {
        component: 'Layers',
        layers: [
          { key: '1', title: 'One', items: { where: { tags: 'a' } } },
          { key: '2', title: 'Two', items: { where: { tags: 'b' } } },
        ],
      },
    };
    const saved = createView(store, agent, {
      projectId: created.p!,
      name: 'Map',
      widgets: [layers],
      message: 'Explain',
    });
    expect(store.getOfType('view', saved.view.id).data.spec).toBeTruthy();
    expect(saved.preview.warnings).toEqual([
      expect.stringMatching(/^no start-here opening/),
      expect.stringMatching(/^the point comes too late: no ClaimCard/),
    ]);
    expect(saved.preview.widgets[0]!.warnings).toEqual([
      'layer "2" shows nothing',
      `claim ${created.c} "The point." has no source: add sourceIds so the reader can check it`,
    ]);
    expect(saved.preview.summary).toMatch(/see warnings$/);

    const fixed = updateView(store, agent, {
      viewId: saved.view.id,
      message: 'Point first',
      ops: [
        {
          op: 'add',
          widget: { id: 'point', node: { component: 'ClaimCard', claim: 'clm_missing' } },
          before: 'layers',
        },
      ],
    });
    // The point now comes first; only the missing StartHere opening (start-here.md) remains.
    expect(fixed.preview.warnings).toEqual([expect.stringMatching(/^no start-here opening/)]);
    expect(fixed.preview.widgets[0]!.warnings).toEqual([
      'claim clm_missing not found in this project',
    ]);
  });
});
