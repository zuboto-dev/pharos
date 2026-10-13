import { describe, expect, it } from 'vitest';
import { CAR_PACK, MONEY_PACK, MUSIC_PACK, packDataset } from '../packs/index.js';
import { checkFacts } from '../packs/fact-check.js';
import { Board } from './board.js';
import {
  categoryBreakdown,
  chartBars,
  formatMoney,
  statResult,
  sumRows,
  tableTotals,
} from './blocks.js';
import { addMonths, daysBetween, relativeDate } from './dates.js';
import { computeDue } from './due.js';
import { dueOf, runQuery } from './run-query.js';
import type { Entity } from '../entities.js';

const today = '2026-10-13';
const money = packDataset(
  MONEY_PACK,
  [
    {
      ref: 'food',
      recordType: 'category',
      title: 'Food',
      fields: { planned: { amount: 20000, currency: 'EUR' } },
    },
    {
      ref: 'fun',
      recordType: 'category',
      title: 'Fun',
      fields: { planned: { amount: 10000, currency: 'USD' } },
    },
    {
      ref: 'one',
      recordType: 'spending',
      title: 'One',
      fields: { date: today, category: '$food', amount: { amount: 3000, currency: 'EUR' } },
    },
    {
      ref: 'two',
      recordType: 'spending',
      title: 'Two',
      fields: { date: today, category: '$food', amount: { amount: 7000, currency: 'EUR' } },
    },
    {
      ref: 'three',
      recordType: 'spending',
      title: 'Three',
      fields: { date: today, category: '$fun', amount: { amount: 1500, currency: 'USD' } },
    },
    {
      ref: 'other',
      recordType: 'spending',
      title: 'Other item',
      fields: { date: today, amount: { amount: 400, currency: 'USD' } },
    },
  ],
  today,
);
const spending = { type: 'record' as const, where: { recordType: 'spending' } };

describe('independent amounts and grouping review', () => {
  it('keeps category totals, uncategorized spending and currencies separate', () => {
    const result = categoryBreakdown(money, {
      categories: { type: 'record', where: { recordType: 'category' } },
      planned: 'fields.planned',
      spent: { query: spending, by: 'fields.category', sum: 'fields.amount' },
    });
    expect(result.rows.map((r) => [r.label, r.spent])).toEqual([
      ['Food', { kind: 'money', amounts: [{ currency: 'EUR', amount: 10000 }] }],
      ['Fun', { kind: 'money', amounts: [{ currency: 'USD', amount: 1500 }] }],
      ['Other', { kind: 'money', amounts: [{ currency: 'USD', amount: 400 }] }],
    ]);
    expect(result.planned).toEqual({
      kind: 'money',
      amounts: [
        { currency: 'EUR', amount: 20000 },
        { currency: 'USD', amount: 10000 },
      ],
    });
    expect(result.spent).toEqual({
      kind: 'money',
      amounts: [
        { currency: 'EUR', amount: 10000 },
        { currency: 'USD', amount: 1900 },
      ],
    });
  });

  it('agrees across sum, Stat, table totals and month bars', () => {
    const expected = {
      kind: 'money',
      amounts: [
        { currency: 'EUR', amount: 10000 },
        { currency: 'USD', amount: 1900 },
      ],
    };
    expect(sumRows(money, runQuery(money, 'record', spending), 'fields.amount')).toEqual(expected);
    expect(statResult(money, { query: spending, sum: 'fields.amount' }).value).toEqual(expected);
    expect(
      tableTotals(money, { query: spending, columns: [{ field: 'fields.amount' }] })[
        'fields.amount'
      ],
    ).toEqual(expected);
    expect(
      chartBars(money, {
        query: spending,
        by: 'fields.date',
        bucket: 'month',
        sum: 'fields.amount',
      }).map((b) => [b.key, b.currency, b.value]),
    ).toEqual([
      ['2026-10', 'EUR', 10000],
      ['2026-10', 'USD', 1900],
    ]);
    expect(formatMoney({ amount: 15000, currency: 'KRW' })).toBe('₩15,000');
    expect(formatMoney({ amount: 1234, currency: 'KWD' })).toContain('1.234');
  });

  it('selects the newest mix per song after sorting, before limiting', () => {
    const data = packDataset(
      MUSIC_PACK,
      [
        { ref: 'song', recordType: 'song', title: 'Made-up song', fields: { stage: 'demo' } },
        {
          ref: 'old',
          recordType: 'mix',
          title: 'Old',
          fields: { song: '$song', date: '2026-09-01' },
        },
        { ref: 'new', recordType: 'mix', title: 'New', fields: { song: '$song', date: today } },
        { ref: 'solo', recordType: 'mix', title: 'Unlinked', fields: { date: '2026-10-12' } },
      ],
      today,
    );
    expect(
      runQuery(data, 'record', {
        where: { recordType: 'mix' },
        sort: [{ field: 'fields.date', dir: 'desc' }],
        onePer: 'fields.song',
        limit: 2,
      }).map((r) => r.data.title),
    ).toEqual(['New', 'Unlinked']);
  });

  it('does not choose an undated row as newest when onePer uses descending dates', () => {
    const data = packDataset(
      MUSIC_PACK,
      [
        { ref: 'song', recordType: 'song', title: 'Made-up song', fields: { stage: 'demo' } },
        { ref: 'new', recordType: 'mix', title: 'Dated', fields: { song: '$song', date: today } },
        { ref: 'undated', recordType: 'mix', title: 'Undated', fields: { song: '$song' } },
      ],
      today,
    );
    // This is valid for a custom mix type where date is optional (the built-in requires it).
    data.project.data.recordTypes = MUSIC_PACK.recordTypes.map((t) =>
      t.key === 'mix'
        ? { ...t, fields: t.fields.map((f) => (f.key === 'date' ? { ...f, required: false } : f)) }
        : t,
    );
    expect(
      runQuery(data, 'record', {
        where: { recordType: 'mix' },
        sort: [{ field: 'fields.date', dir: 'desc' }],
        onePer: 'fields.song',
      })[0]!.data.title,
    ).toBe('Dated');
  });
});

describe('independent calendar and due-band review', () => {
  it('clamps month ends and leap years without daylight-saving arithmetic', () => {
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2024-02-29', 12)).toBe('2025-02-28');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(relativeDate('$monthStart+1m', '2026-12-31')).toBe('2027-01-01');
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
  });

  it.each([
    [31, 'not_urgent'],
    [30, 'urgent'],
    [8, 'urgent'],
    [7, 'very_urgent'],
    [0, 'very_urgent'],
    [-1, 'past_due'],
  ] as const)('puts a date %i days away in %s', (left, band) => {
    const date = relativeDate(`$today${left < 0 ? '-' : '+'}${Math.abs(left)}d`, today)!;
    expect(
      computeDue({ every: { n: 1, unit: 'days' }, startDate: date }, today, undefined)?.band,
    ).toBe(band);
  });

  it.each([
    [1001, 'not_urgent'],
    [1000, 'urgent'],
    [251, 'urgent'],
    [250, 'very_urgent'],
    [0, 'very_urgent'],
    [-1, 'past_due'],
  ] as const)('puts a meter %i km away in %s', (left, band) => {
    expect(
      computeDue(
        { meter: { n: 10000, from: 'fields.reading' }, startMeter: 20000 },
        today,
        20000 - left,
      )?.band,
    ).toBe(band);
  });

  it('keeps fixed month ends anchored and rolling dates relative to completion', () => {
    const interval = {
      every: { n: 1, unit: 'months' as const },
      startDate: '2026-01-31',
      lastDate: '2026-02-28',
    };
    expect(computeDue({ ...interval, mode: 'fixed' }, '2026-03-01', undefined)?.date).toBe(
      '2026-03-31',
    );
    expect(computeDue({ ...interval, mode: 'rolling' }, '2026-03-01', undefined)?.date).toBe(
      '2026-03-28',
    );
  });

  it('uses the more urgent date or km band and distinguishes fixed from rolling km', () => {
    const data = packDataset(
      CAR_PACK,
      [
        { ref: 'car', recordType: 'vehicle', title: 'Made-up car', fields: { odometer: 20300 } },
        {
          ref: 'reminder',
          recordType: 'reminder',
          title: 'Service',
          fields: { vehicle: '$car' },
          interval: {
            every: { n: 1, unit: 'years' },
            lastDate: today,
            meter: { n: 10000, from: 'fields.vehicle.fields.odometer' },
            lastMeter: 10000,
          },
        },
      ],
      today,
    );
    expect(dueOf(data, data.records![1]!, { today })).toMatchObject({
      date: '2027-10-13',
      meter: 20000,
      left: -300,
      band: 'past_due',
    });
    const meter = {
      meter: { n: 10000, from: 'fields.reading' },
      startMeter: 10000,
      lastMeter: 21500,
    };
    expect(computeDue({ ...meter, mode: 'fixed' }, today, 25000)?.meter).toBe(30000);
    expect(computeDue({ ...meter, mode: 'rolling' }, today, 25000)?.meter).toBe(31500);
  });

  it('advances a fixed daily schedule beyond 5000 elapsed occurrences', () => {
    expect(
      computeDue(
        {
          mode: 'fixed',
          every: { n: 1, unit: 'days' },
          startDate: '2000-01-01',
          lastDate: '2026-10-13',
        },
        today,
        undefined,
      )?.date,
    ).toBe('2026-10-14');
  });
});

describe('independent fact-check review', () => {
  it('checks a hand-calculated mixed-currency total and rejects a wrong total', () => {
    const board = Board.parse({
      component: 'Board',
      widgets: [
        {
          id: 'sum',
          node: { component: 'Stat', label: 'Spent', query: spending, sum: 'fields.amount' },
        },
      ],
    });
    expect(
      checkFacts(
        board,
        money,
        [
          {
            id: 'right',
            widget: 'sum',
            kind: 'stat',
            expect: [
              { currency: 'EUR', amount: 10000 },
              { currency: 'USD', amount: 1900 },
            ],
          },
        ],
        today,
      ).passed,
    ).toBe(true);
    expect(
      checkFacts(
        board,
        money,
        [
          {
            id: 'wrong',
            widget: 'sum',
            kind: 'stat',
            expect: [{ currency: 'EUR', amount: 11900 }],
          },
        ],
        today,
      ).passed,
    ).toBe(false);
  });

  it('marks an unbound number in prose unverifiable', () => {
    const board = Board.parse({
      component: 'Board',
      widgets: [{ id: 'text', node: { component: 'Text', content: 'Spent 99999 euros.' } }],
    });
    expect(checkFacts(board, money, [], today)).toMatchObject({
      passed: false,
      unverifiable: [{ widget: 'text' }],
    });
  });

  it('checks a displayed option label instead of its raw stored value', () => {
    const data = packDataset(
      CAR_PACK,
      [
        { ref: 'car', recordType: 'vehicle', title: 'Car', fields: {} },
        {
          ref: 'service',
          recordType: 'service',
          title: 'Service',
          fields: { vehicle: '$car', date: today, kind: 'oil' },
        },
      ],
      today,
    );
    const label = CAR_PACK.recordTypes
      .find((t) => t.key === 'service')!
      .fields.find((f) => f.key === 'kind')!
      .options!.find((o) => o.value === 'oil')!.label;
    const board = Board.parse({
      component: 'Board',
      widgets: [
        {
          id: 'table',
          node: {
            component: 'DataTable',
            query: { type: 'record', where: { recordType: 'service' } },
            columns: [{ field: 'fields.kind' }],
          },
        },
      ],
    });
    expect(
      checkFacts(
        board,
        data,
        [
          {
            id: 'label',
            widget: 'table',
            kind: 'cell',
            row: 0,
            column: 'fields.kind',
            expect: label,
          },
        ],
        today,
      ).passed,
    ).toBe(true);
  });

  it('checks each bar of a plain CountChart grouped by a list', () => {
    const data = packDataset(CAR_PACK, [], today);
    data.tasks = [
      {
        id: 'task_row',
        type: 'task',
        createdAt: '',
        updatedAt: '',
        createdRev: 1,
        updatedRev: 1,
        data: { projectId: data.project.id, title: 'Task', dependsOn: ['task_a', 'task_b'] },
      } as Entity<'task'>,
    ];
    const board = Board.parse({
      component: 'Board',
      widgets: [
        {
          id: 'chart',
          node: { component: 'CountChart', query: { type: 'task' }, by: 'dependsOn' },
        },
      ],
    });
    // The plain web CountChart renders one count for each list member.
    expect(
      checkFacts(
        board,
        data,
        [
          { id: 'a', widget: 'chart', kind: 'bar', label: 'task_a', expect: 1 },
          { id: 'b', widget: 'chart', kind: 'bar', label: 'task_b', expect: 1 },
        ],
        today,
      ).passed,
    ).toBe(true);
  });
});
