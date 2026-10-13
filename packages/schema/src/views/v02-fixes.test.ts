import { describe, expect, it } from 'vitest';
import type { Entity } from '../entities.js';
import { recordFieldIssues, type RecordType } from '../records.js';
import { Board } from './board.js';
import type { ViewNode } from './catalog.js';
import { checkBoardQueries, findingKey } from './check-queries.js';
import { isCalendarDate } from './dates.js';

/** v0.2 review, gaps 7–9: what the stricter query checks still allow, and where they look. */

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
const project = {
  id: 'prj_1',
  type: 'project',
  data: { name: 'Made-up', status: 'active', order: 0, recordTypes: types },
} as unknown as Entity<'project'>;

const check = (...nodes: ViewNode[]) =>
  checkBoardQueries(
    Board.parse({ component: 'Board', widgets: nodes.map((node, i) => ({ id: `w${i}`, node })) }),
    project,
  );
const codes = (...nodes: ViewNode[]) => check(...nodes).map((f) => f.code);

describe('anyOf alternatives (gap 7)', () => {
  it('checks each alternative in its own record type, within the outer one', () => {
    // An alternative naming its own type is checked in it; one naming none, in the outer type.
    expect(
      codes({
        component: 'DataList',
        query: {
          type: 'record',
          where: { recordType: 'alpha' },
          anyOf: [{ recordType: 'beta', 'fields.state': 'y' }],
        },
      }),
    ).toEqual([]);
    expect(
      codes({
        component: 'DataList',
        query: {
          type: 'record',
          where: { recordType: 'alpha' },
          anyOf: [{ 'fields.state': 'y' }],
        },
      }),
    ).toEqual(['unknown-option']);
  });

  it('accepts an outer option value that fits one of several record types', () => {
    expect(
      codes({
        component: 'DataList',
        query: { type: 'record', where: { recordType: ['alpha', 'beta'], 'fields.state': 'y' } },
      }),
    ).toEqual([]);
  });
});

describe('special values, dates and buckets (gaps 8 and 9)', () => {
  it('lets $project and $currentStage match ids, not numbers or dates', () => {
    expect(
      codes({ component: 'TaskTable', filter: { where: { stageId: '$currentStage' } } }),
    ).toEqual([]);
    expect(
      codes({
        component: 'DataList',
        query: { type: 'record', where: { recordType: 'alpha', 'fields.date': '$project' } },
      }),
    ).toEqual(['operator-mismatch']);
  });

  it('knows calendar dates', () => {
    expect(isCalendarDate('2028-02-29')).toBe(true);
    expect(isCalendarDate('2026-02-29')).toBe(false);
    expect(isCalendarDate('2026-13-01')).toBe(false);
    expect(isCalendarDate('2026-1-01')).toBe(false);
    expect(recordFieldIssues(types[0]!, { date: '2026-04-31' }, false)).toEqual([
      "fields.date: 2026-04-31 isn't a date on the calendar",
    ]);
  });

  it('allows month and year buckets on dates', () => {
    for (const bucket of ['month', 'year'] as const)
      expect(
        codes({
          component: 'CountChart',
          query: { type: 'record', where: { recordType: 'alpha' } },
          by: 'fields.date',
          bucket,
        }),
      ).toEqual([]);
  });

  it('keys a finding by where it is in its widget, not by the widget position', () => {
    const bad: ViewNode = {
      component: 'DataList',
      query: { type: 'record', where: { recordType: 'alpha', 'fields.typo': 1 } },
    };
    const [moved] = check({ component: 'Text', content: 'First' }, bad).filter(
      (f) => f.level === 'reject',
    );
    const [first] = check(bad).filter((f) => f.level === 'reject');
    expect(findingKey({ ...moved!, widget: 'w0' })).toBe(findingKey(first!));
  });
});
