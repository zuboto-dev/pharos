import { describe, expect, it } from 'vitest';
import {
  choiceMessage,
  choiceUpdate,
  declineUpdate,
  decisionIssues,
  itemsOptionId,
  itemsSize,
  selectionCount,
  type DecisionOption,
} from './decisions.js';
import { createSchema } from './entities.js';

describe('items a choice applies to', () => {
  const trash: DecisionOption[] = [
    { id: 'move', label: 'Move to Trash' },
    { id: 'keep', label: 'Keep them' },
  ];
  const list = [
    { id: 'web/dist', label: 'web/dist', detail: '200 MB · untouched 9 days' },
    { id: 'cache', label: '.cache', detail: '80 MB' },
    { id: 'tmp:shots', label: 'tmp/shots', detail: '512 KB' },
  ];

  it('validates ids, lengths and counts', () => {
    const create = createSchema('decision');
    const base = { projectId: 'prj_1', title: 'Clean up?', options: trash };
    const ok = (items: unknown) => create.safeParse({ ...base, items }).success;
    expect(ok({ list })).toBe(true);
    expect(ok({ list: [{ id: 'has space', label: 'x' }] })).toBe(false);
    expect(ok({ list: [{ id: 'a', label: 'x'.repeat(201) }] })).toBe(false);
    expect(ok({ list: [{ id: 'a', label: 'a', detail: 'x'.repeat(301) }] })).toBe(false);
    expect(ok({ list: Array.from({ length: 201 }, (_, i) => ({ id: `i${i}`, label: 'x' })) })).toBe(
      false,
    );
    expect(ok({ list: [] })).toBe(false);
    expect(ok({ list, other: 1 })).toBe(false);
  });

  it('refuses duplicate ids, an unknown option, and a selection without its choice', () => {
    expect(decisionIssues({ options: trash, items: { list } })).toEqual([]);
    expect(decisionIssues({ options: trash, items: { list: [list[0]!, list[0]!] } })).toEqual([
      'items: id "web/dist" is used twice',
    ]);
    expect(decisionIssues({ options: trash, items: { list, appliesTo: 'zap' } })[0]).toMatch(
      /appliesTo: "zap" isn't one of the options/,
    );
    // The default target is the recommended option.
    expect(
      decisionIssues({
        options: trash,
        recommendedOptionId: 'move',
        chosenOptionId: 'keep',
        items: { list, selected: ['cache'] },
      })[0],
    ).toMatch(/a selection goes with choosing "move"/);
    expect(
      decisionIssues({
        options: trash,
        recommendedOptionId: 'move',
        chosenOptionId: 'move',
        items: { list, selected: ['cache', 'nope'] },
      }),
    ).toEqual(['items.selected: "nope" isn\'t one of the items']);
  });

  it('a choice saves the selection with it; another option, later and decline clear it', () => {
    const input = {
      today: '2026-10-24',
      decidedById: 'asg_me',
      status: (meaning: string) => `v_${meaning}`,
      items: { list, selected: ['cache'] },
      itemsOptionId: 'move',
    };
    expect(choiceUpdate(trash[0]!, { ...input, selected: ['web/dist', 'cache'] }).items).toEqual({
      list,
      selected: ['web/dist', 'cache'],
    });
    expect(choiceUpdate(trash[0]!, input).items?.selected).toEqual(list.map((i) => i.id));
    expect(choiceUpdate(trash[1]!, { ...input, selected: ['cache'] }).items).toEqual({ list });
    expect(choiceUpdate({ id: 'later', label: 'Not now' }, input).items).toEqual({ list });
    expect(declineUpdate(input).items).toEqual({ list });
    expect(choiceUpdate(trash[0]!, { ...input, items: undefined })).not.toHaveProperty('items');
  });

  it('says how many in the message, and adds up sizes when every item has one', () => {
    expect(choiceMessage(trash[0]!, 'Clean up 3 items?', undefined, undefined, '2 of 3')).toBe(
      'Choose “Move to Trash”: 2 of 3 · Clean up 3 items?',
    );
    expect(selectionCount({ list, selected: ['cache'] })).toBe('1 of 3');
    expect(itemsSize(list.slice(0, 2))).toBe('280 MB');
    expect(itemsSize(list)).toBe('281 MB');
    expect(itemsSize([{ id: 'x', label: 'x' }])).toBeUndefined();
    expect(itemsOptionId({ options: trash, items: { list } })).toBe('move');
    expect(itemsOptionId({ options: trash, items: { list, appliesTo: 'keep' } })).toBe('keep');
  });
});
