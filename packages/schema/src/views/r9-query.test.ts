// R9 query and block additions: onePer, DueTracker date, CategoryBreakdown aim · Opus 5.5
import { describe, expect, it } from 'vitest';
import { MUSIC_PACK, STUDY_PACK, packDataset, type PackRecord } from '../packs/index.js';
import { Board } from './board.js';
import { categoryBreakdown, dueRows } from './blocks.js';
import { checkBoardQueries } from './check-queries.js';
import { dateDue } from './due.js';
import { runQuery } from './run-query.js';

const TODAY = '2026-10-13';

const songs: PackRecord[] = [
  { ref: 'a', recordType: 'song', title: 'A', fields: { stage: 'demo' } },
  { ref: 'b', recordType: 'song', title: 'B', fields: { stage: 'mixing' } },
  { ref: 'm1', recordType: 'mix', title: 'A1', fields: { song: '$a', date: '2026-09-01' } },
  { ref: 'm2', recordType: 'mix', title: 'A2', fields: { song: '$a', date: '2026-10-01' } },
  { ref: 'm3', recordType: 'mix', title: 'B1', fields: { song: '$b', date: '2026-08-01' } },
  { ref: 'm4', recordType: 'mix', title: 'No song', fields: { date: '2026-10-02' } as never },
];

describe('onePer', () => {
  const data = packDataset(MUSIC_PACK, songs, TODAY);
  const titles = (q: Parameters<typeof runQuery>[2]) =>
    runQuery(data, 'record', q, { today: TODAY }).map((r) => r.data.title);

  it('keeps the first row per value after sorting: the latest mix of each song', () => {
    expect(
      titles({
        where: { recordType: 'mix', 'fields.song': { exists: true } },
        sort: [{ field: 'fields.date', dir: 'desc' }],
        onePer: 'fields.song',
      }),
    ).toEqual(['A2', 'B1']);
    // Ascending: the first mix of each.
    expect(
      titles({
        where: { recordType: 'mix', 'fields.song': { exists: true } },
        sort: [{ field: 'fields.date' }],
        onePer: 'fields.song',
      }),
    ).toEqual(['B1', 'A1']);
  });

  it('keeps rows without a value, and limits after picking', () => {
    expect(
      titles({
        where: { recordType: 'mix' },
        sort: [{ field: 'fields.date', dir: 'desc' }],
        onePer: 'fields.song',
      }),
    ).toEqual(['No song', 'A2', 'B1']);
    expect(
      titles({
        where: { recordType: 'mix' },
        sort: [{ field: 'fields.date', dir: 'desc' }],
        onePer: 'fields.song',
        limit: 2,
      }),
    ).toEqual(['No song', 'A2']);
  });

  it('sorts through a reference by the option order of the target', () => {
    expect(
      titles({
        where: { recordType: 'mix', 'fields.song': { exists: true } },
        sort: [
          { field: 'fields.song.fields.stage', dir: 'desc' },
          { field: 'fields.date', dir: 'desc' },
        ],
        onePer: 'fields.song',
      }),
    ).toEqual(['B1', 'A2']);
  });

  it('is checked: an unknown field is refused with a fix, a unique one warns', () => {
    const project = data.project;
    const board = (onePer: string) =>
      Board.parse({
        component: 'Board',
        widgets: [
          {
            id: 'w',
            node: {
              component: 'DataList',
              query: { type: 'record', where: { recordType: 'mix' }, onePer },
            },
          },
        ],
      });
    const typo = checkBoardQueries(board('fields.sng'), project);
    expect(typo).toMatchObject([
      {
        code: 'unknown-group-field',
        path: 'widgets[0].node.query.onePer',
        suggestion: 'fields.song',
      },
    ]);
    expect(checkBoardQueries(board('id'), project).map((f) => f.code)).toEqual(['group-by-unique']);
    expect(checkBoardQueries(board('fields.song'), project)).toEqual([]);
  });
});

describe('DueTracker date', () => {
  it('puts one-off dates in the record bands: 7 and 30 days, past due once gone', () => {
    expect(dateDue('2026-10-13', TODAY)).toEqual({
      date: '2026-10-13',
      days: 0,
      band: 'very_urgent',
    });
    expect(dateDue('2026-10-20', TODAY)?.band).toBe('very_urgent');
    expect(dateDue('2026-10-21', TODAY)?.band).toBe('urgent');
    expect(dateDue('2026-11-12', TODAY)?.band).toBe('urgent');
    expect(dateDue('2026-11-13', TODAY)?.band).toBe('not_urgent');
    expect(dateDue('2026-10-12', TODAY)?.band).toBe('past_due');
    expect(dateDue('soon', TODAY)).toBeUndefined();
  });

  it('lists exams by their date, most urgent first; one without a date has no schedule', () => {
    const data = packDataset(
      STUDY_PACK,
      [
        { ref: 's', recordType: 'subject', title: 'Stats', fields: {} },
        {
          ref: 'e1',
          recordType: 'exam',
          title: 'Late',
          fields: { subject: '$s', date: '2026-12-01' },
        },
        {
          ref: 'e2',
          recordType: 'exam',
          title: 'Soon',
          fields: { subject: '$s', date: '2026-10-15' },
        },
      ],
      TODAY,
    );
    const rows = dueRows(
      data,
      { query: { type: 'record', where: { recordType: 'exam' } }, date: 'fields.date' },
      { today: TODAY },
    );
    expect(rows.map((r) => [r.record.data.title, r.due?.band])).toEqual([
      ['Soon', 'very_urgent'],
      ['Late', 'not_urgent'],
    ]);
  });
});

describe('CategoryBreakdown with hours', () => {
  it('adds up numbers with their unit, per subject and in total', () => {
    const data = packDataset(STUDY_PACK, STUDY_PACK.examples ?? [], TODAY);
    const b = categoryBreakdown(
      data,
      {
        categories: { type: 'record', where: { recordType: 'subject' } },
        planned: 'fields.target',
        spent: {
          query: { type: 'record', where: { recordType: 'session' } },
          by: 'fields.subject',
          sum: 'fields.hours',
        },
      },
      { today: TODAY },
    );
    expect(b.rows[0]).toMatchObject({
      label: 'Statistics',
      planned: { kind: 'number', value: 40, unit: 'h' },
      spent: { kind: 'number', value: 7.5, unit: 'h' },
    });
    expect(b.planned).toEqual({ kind: 'number', value: 90, unit: 'h' });
  });
});
