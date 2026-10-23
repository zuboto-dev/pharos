import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  LATER_DAYS,
  choiceMessage,
  choiceUpdate,
  optionOutcome,
  decisionIssues,
  decisionState,
  decisionWarnings,
  type DecisionOption,
} from './decisions.js';
import { ENTITY_TYPES, createSchema, patchSchema } from './entities.js';
import { applyInputFor } from './revisions.js';

const options: DecisionOption[] = [
  { id: 'a', label: 'Picture and one line' },
  { id: 'b', label: 'Checklist' },
];

describe('decision choices (R10.19)', () => {
  it('checks option ids, the recommendation and the choice', () => {
    expect(decisionIssues({ options, recommendedOptionId: 'a', chosenOptionId: 'b' })).toEqual([]);
    expect(decisionIssues({ options, chosenOptionId: 'c' })).toEqual([
      'chosenOptionId: "c" isn\'t one of the options (a, b)',
    ]);
    expect(decisionIssues({ recommendedOptionId: 'a' })).toEqual([
      'recommendedOptionId: "a" isn\'t one of the options (there are no options)',
    ]);
    expect(decisionIssues({ options, chosenOptionId: 'a', answer: 'Both' })).toHaveLength(1);
  });

  it('warns until the proposal is complete', () => {
    expect(decisionWarnings({ options: [options[0]!] })).toHaveLength(2);
    expect(decisionWarnings({ options, recommendedOptionId: 'a' })).toEqual([
      'has no recommendationReason; say in one line why you recommend it',
    ]);
    expect(
      decisionWarnings({ options, recommendedOptionId: 'a', recommendationReason: 'Warmer' }),
    ).toEqual([]);
  });

  it('reads where a decision stands', () => {
    expect(decisionState({ options, chosenOptionId: 'b' })).toEqual({
      kind: 'chosen',
      option: options[1],
    });
    expect(decisionState({ options, answer: 'Neither' }).kind).toBe('answered');
    expect(decisionState({ options, deferredUntil: '2026-10-20' }).kind).toBe('deferred');
    expect(decisionState({ options }).kind).toBe('open');
    expect(decisionState({ options, chosenOptionId: 'b', note: 'Step 3 failed' })).toEqual({
      kind: 'chosen',
      option: options[1],
      note: 'Step 3 failed',
    });
  });

  it('takes a note only with a chosen option', () => {
    expect(decisionIssues({ options, chosenOptionId: 'a', note: 'Step 3 failed' })).toEqual([]);
    expect(decisionIssues({ options, note: 'Step 3 failed' })).toEqual([
      'note: a note goes with a chosen option; an answer of their own goes in answer',
    ]);
  });

  it('keeps option text short', () => {
    const long = { id: 'a', label: 'x'.repeat(61) };
    expect(
      createSchema('decision').safeParse({ projectId: 'p', title: 'Q', options: [long] }).success,
    ).toBe(false);
  });
});

describe('a smaller apply schema (C1)', () => {
  const json = JSON.stringify(z.toJSONSchema(applyInputFor(ENTITY_TYPES), { io: 'input' }));

  it('shares big schemas once and describes update fields only in the create', () => {
    for (const id of ['ProjectOptions', 'RecordTypes', 'Interval', 'DecisionOption', 'OptionColor'])
      expect(json).toContain(`"$ref":"#/$defs/${id}"`);
    const update = z.toJSONSchema(patchSchema('claim')) as {
      properties: Record<string, { description?: string }>;
    };
    expect(update.properties.statement!.description).toBeUndefined();
    expect(
      (z.toJSONSchema(createSchema('claim')) as typeof update).properties.statement!.description,
    ).toMatch(/plain sentence/);
  });

  it('keeps every check on update fields', () => {
    const patch = patchSchema('artifact');
    expect(patch.safeParse({ image: 'not a picture' }).success).toBe(false);
    expect(patch.safeParse({ image: 'https://example.com/a.png' }).success).toBe(true);
    expect(patchSchema('claim').safeParse({ statement: 'x'.repeat(201) }).success).toBe(false);
    expect(patchSchema('project').safeParse({ options: { 'task.status': [] } }).success).toBe(
      false,
    );
    expect(patchSchema('decision').safeParse({ options: null }).success).toBe(true);
  });
});

describe('what choosing an option means', () => {
  it('reads the outcome from the option, else from its label', () => {
    const o = (label: string, outcome?: 'go' | 'decline' | 'later') =>
      optionOutcome({ label, ...(outcome ? { outcome } : {}) });
    expect(
      ['Link them', 'Keep, judge again', 'Day branch only', 'Nothing else'].map((l) => o(l)),
    ).toEqual(['go', 'go', 'go', 'go']);
    expect(
      ['Leave as is', 'Keep it as it is', 'No', "Don't", 'Skip', 'No, keep it', 'No.'].map((l) =>
        o(l),
      ),
    ).toEqual(Array(7).fill('decline'));
    expect(
      ['Not now', 'Hold', 'Later', 'Decide later', 'Not now — next week'].map((l) => o(l)),
    ).toEqual(Array(5).fill('later'));
    // A longer label is an option of its own (A43 #1): go.
    expect(
      ['Cancel the membership', 'Drop-in replacement', 'Wait for the M5 model', "Don't link"].map(
        (l) => o(l),
      ),
    ).toEqual(Array(4).fill('go'));
    // The agent's word wins over the label.
    expect(o('Hold the line', 'go')).toBe('go');
  });

  it('sets status, who and when to agree with the choice', () => {
    const input = {
      today: '2026-10-22',
      decidedById: 'asg_me',
      status: (meaning: string) => `v_${meaning}`,
    };
    expect(choiceUpdate({ id: 'a', label: 'Link them' }, input)).toMatchObject({
      chosenOptionId: 'a',
      status: 'v_accepted',
      decidedById: 'asg_me',
      decisionDate: '2026-10-22',
      deferredUntil: null,
    });
    expect(choiceUpdate({ id: 'b', label: 'Leave as is' }, input)).toMatchObject({
      chosenOptionId: 'b',
      status: 'v_rejected',
      decidedById: 'asg_me',
      decisionDate: '2026-10-22',
    });
    expect(LATER_DAYS).toBe(7);
    expect(choiceUpdate({ id: 'c', label: 'Not now' }, input)).toEqual({
      chosenOptionId: null,
      note: null,
      answer: null,
      deferredUntil: '2026-10-29',
      status: 'v_proposed',
      decidedById: null,
      decisionDate: null,
    });
  });
});

describe('a later choice keeps its note', () => {
  it('says the note in the revision message', () => {
    expect(
      choiceMessage({ id: 'h', label: 'Not now' }, 'Ship it?', 'after the trip', '2026-10-22'),
    ).toBe('Later (2026-10-29): “Ship it?” (chose “Not now”: after the trip)');
  });
});
