import { describe, expect, it } from 'vitest';
import type { Entity } from '../entities.js';
import { recordFieldIssues, type RecordType } from '../records.js';
import { Board } from './board.js';
import type { ViewNode } from './catalog.js';
import { checkBoardQueries, findingKey } from './check-queries.js';
import { isCalendarDate } from './dates.js';
import { MUSIC_PACK, packDataset } from '../packs/index.js';
import { chartBars } from './blocks.js';
import { computeDue } from './due.js';
import { runQuery } from './run-query.js';

describe('plain count bars and calculation edges (gaps 10 and 11)', () => {
  const today = '2026-10-13';
  const songs = packDataset(
    MUSIC_PACK,
    [
      { ref: 'a', recordType: 'song', title: 'A', fields: { stage: 'released' } },
      { ref: 'b', recordType: 'song', title: 'B', fields: { stage: 'demo' } },
      { ref: 'c', recordType: 'song', title: 'C', fields: { stage: 'released', bpm: 90 } },
    ],
    today,
  );

  it('orders plain bars by option order with their labels and colours', () => {
    const bars = chartBars(songs, {
      query: { type: 'record', where: { recordType: 'song' } },
      by: 'fields.stage',
    });
    expect(bars).toEqual([
      { key: 'demo', label: 'Demo', value: 1, color: 'blue' },
      { key: 'released', label: 'Released', value: 2, color: 'green' },
    ]);
  });

  it('keeps rows without a value last when sorting up too', () => {
    const titles = runQuery(songs, 'record', {
      where: { recordType: 'song' },
      sort: [{ field: 'fields.bpm', dir: 'asc' }],
    }).map((r) => r.data.title);
    expect(titles[0]).toBe('C');
  });

  it('advances long monthly and weekly fixed schedules exactly', () => {
    const monthly = computeDue(
      {
        mode: 'fixed',
        every: { n: 1, unit: 'months' },
        startDate: '1990-01-31',
        lastDate: '2026-02-28',
      },
      today,
      undefined,
    );
    expect(monthly?.date).toBe('2026-03-31');
    const weekly = computeDue(
      { mode: 'fixed', every: { n: 2, unit: 'weeks' }, startDate: '1980-01-07', lastDate: today },
      today,
      undefined,
    );
    expect(weekly?.date).toBe('2026-10-26');
  });
});

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
