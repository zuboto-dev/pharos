import type { Author, Entity } from '@pharos/schema';
import { describe, expect, it } from 'vitest';
import { ActionService } from '../actions/service.js';
import { openDatabase } from './database.js';
import { PharosError } from './errors.js';
import { Store } from './store.js';

const owner: Author = { kind: 'human', name: 'owner' };
const agent: Author = { kind: 'agent', name: 'Claude Code' };
const options = [
  { id: 'a', label: 'Keep the current page' },
  { id: 'b', label: 'Use a new page' },
];

function refusal(fn: () => unknown): PharosError {
  try {
    fn();
  } catch (error) {
    if (error instanceof PharosError) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('v0.2 decision ownership review regressions', () => {
  it('keeps an owner decision owner-only through history_revert', () => {
    const store = new Store(openDatabase(':memory:'));
    const projectId = store.apply(owner, {
      message: 'Start project',
      operations: [{ op: 'create', type: 'project', data: { name: 'Demo' } }],
    }).created['0']!;
    const decisionId = store.apply(agent, {
      message: 'Propose a choice',
      operations: [
        {
          op: 'create',
          type: 'decision',
          data: { projectId, title: 'Where should the guidance live?', options },
        },
      ],
    }).created['0']!;
    const choice = store.apply(owner, {
      message: 'Choose option A',
      operations: [
        {
          op: 'update',
          type: 'decision',
          id: decisionId,
          data: { chosenOptionId: 'a', status: 'accepted' },
        },
      ],
    });

    const error = refusal(() => store.revert(choice.revision!.id, agent));

    expect(error.code).toBe('invalid');
    expect(store.get(decisionId)).toMatchObject({
      data: { chosenOptionId: 'a', status: 'accepted' },
    });
  });

  it('does not let an agent clear an owner choice, answer, or deferral', () => {
    const store = new Store(openDatabase(':memory:'));
    const projectId = store.apply(owner, {
      message: 'Start project',
      operations: [{ op: 'create', type: 'project', data: { name: 'Demo' } }],
    }).created['0']!;
    const made = store.apply(agent, {
      message: 'Propose three choices',
      operations: ['Defer', 'Answer', 'Choose'].map((title, index) => ({
        op: 'create' as const,
        type: 'decision' as const,
        ref: `d${index}`,
        data: { projectId, title, options },
      })),
    });
    const deferId = made.created.d0!;
    const answerId = made.created.d1!;
    const chooseId = made.created.d2!;
    store.apply(owner, {
      message: 'Record owner responses',
      operations: [
        { op: 'update', type: 'decision', id: deferId, data: { deferredUntil: '2026-10-20' } },
        { op: 'update', type: 'decision', id: answerId, data: { answer: 'Neither option' } },
        {
          op: 'update',
          type: 'decision',
          id: chooseId,
          data: { chosenOptionId: 'a', status: 'accepted' },
        },
      ],
    });

    const ownerFields: [string, string][] = [
      [deferId, 'deferredUntil'],
      [answerId, 'answer'],
      [chooseId, 'chosenOptionId'],
    ];
    for (const [id, field] of ownerFields) {
      const error = refusal(() =>
        store.apply(agent, {
          message: `Clear owner's ${field}`,
          operations: [{ op: 'update', type: 'decision', id, data: { [field]: null } }],
        }),
      );
      expect(error.code).toBe('invalid');
    }
    expect((store.get(deferId) as Entity<'decision'>).data.deferredUntil).toBe('2026-10-20');
    expect((store.get(answerId) as Entity<'decision'>).data.answer).toBe('Neither option');
    expect((store.get(chooseId) as Entity<'decision'>).data.chosenOptionId).toBe('a');
  });

  it('does not let an agent delete a decision after the owner chooses it', () => {
    const store = new Store(openDatabase(':memory:'));
    const projectId = store.apply(owner, {
      message: 'Start project',
      operations: [{ op: 'create', type: 'project', data: { name: 'Demo' } }],
    }).created['0']!;
    const decisionId = store.apply(agent, {
      message: 'Propose a choice',
      operations: [
        {
          op: 'create',
          type: 'decision',
          data: { projectId, title: 'Where should the guidance live?', options },
        },
      ],
    }).created['0']!;
    store.apply(owner, {
      message: 'Choose option A',
      operations: [
        {
          op: 'update',
          type: 'decision',
          id: decisionId,
          data: { chosenOptionId: 'a', status: 'accepted' },
        },
      ],
    });

    const error = refusal(() =>
      store.apply(agent, {
        message: 'Remove the decision',
        operations: [{ op: 'delete', type: 'decision', id: decisionId }],
      }),
    );

    expect(error.code).toBe('invalid');
    expect((store.get(decisionId) as Entity<'decision'>).data.chosenOptionId).toBe('a');
  });

  it('does not let action_run treat a DecisionBlock as an Action block', () => {
    const store = new Store(openDatabase(':memory:'));
    const projectId = store.apply(owner, {
      message: 'Start project',
      operations: [{ op: 'create', type: 'project', data: { name: 'Demo' } }],
    }).created['0']!;
    const decisionId = store.apply(agent, {
      message: 'Propose a choice',
      operations: [
        {
          op: 'create',
          type: 'decision',
          data: { projectId, title: 'Where should the guidance live?', options },
        },
      ],
    }).created['0']!;
    const viewId = store.apply(owner, {
      message: 'Show the choice',
      operations: [
        {
          op: 'create',
          type: 'view',
          data: {
            projectId,
            name: 'Choice',
            spec: {
              component: 'Board',
              widgets: [
                {
                  id: 'decision-choice',
                  node: { component: 'DecisionBlock', decision: decisionId },
                },
              ],
            },
          },
        },
      ],
    }).created['0']!;

    const result = new ActionService(store).run(agent, {
      v: 1,
      projectId,
      viewId,
      widgetId: 'decision-choice',
      values: {},
      idempotencyKey: 'decision-is-not-an-action',
    });

    expect(result.status).toBe('not_found');
    expect((store.get(decisionId) as Entity<'decision'>).data.chosenOptionId).toBeUndefined();
  });
});
