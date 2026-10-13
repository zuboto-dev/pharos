import { describe, expect, it } from 'vitest';
import type { Entity } from '../entities.js';
import { CAR_PACK, MONEY_PACK } from '../packs/index.js';
import { Board } from './board.js';
import type { ViewNode } from './catalog.js';
import {
  FINDING_LEVELS,
  checkBoardQueries,
  formatFinding,
  type FindingCode,
} from './check-queries.js';

const project = {
  id: 'prj_1',
  type: 'project',
  data: {
    name: 'Life',
    status: 'active',
    order: 0,
    recordTypes: [...CAR_PACK.recordTypes, ...MONEY_PACK.recordTypes],
    options: {
      ...CAR_PACK.options,
      'task.status': [
        { value: 'todo', label: 'To do', meaning: 'todo' },
        { value: 'in_review', label: 'In review', meaning: 'in_progress' },
        { value: 'done', label: 'Done', meaning: 'done' },
      ],
    },
  },
  createdAt: '',
  updatedAt: '',
  createdRev: 1,
  updatedRev: 1,
} as unknown as Entity<'project'>;

function check(...nodes: ViewNode[]) {
  const board = Board.parse({
    component: 'Board',
    widgets: nodes.map((node, i) => ({ id: `w${i}`, node })),
  });
  return checkBoardQueries(board, project);
}

const services = { type: 'record' as const, where: { recordType: 'service' } };

/** One spec per finding in the policy table (docs/reframe/r8-notes.md). */
const CASES: Record<FindingCode, ViewNode> = {
  'unknown-field': {
    component: 'DataList',
    query: { type: 'record', where: { recordType: 'service', 'fields.odomter': { gt: 1 } } },
  },
  'unknown-hop': {
    component: 'DataList',
    query: { type: 'task', where: { 'sprint.status': 'done' } },
  },
  'unknown-record-type': {
    component: 'DataList',
    query: { type: 'record', where: { recordType: 'servce' } },
  },
  'unknown-sort-field': {
    component: 'DataList',
    query: { ...services, sort: [{ field: 'fields.when' }] },
  },
  'unknown-group-field': {
    component: 'CountChart',
    query: services,
    by: 'fields.garage',
  },
  'unknown-sum-field': { component: 'Stat', label: 'Cost', query: services, sum: 'fields.price' },
  'sum-not-number': { component: 'Stat', label: 'Cost', query: services, sum: 'fields.date' },
  'unknown-column': {
    component: 'DataTable',
    query: services,
    columns: [{ field: 'title' }, { field: 'fields.mileage' }],
  },
  'operator-mismatch': {
    component: 'DataList',
    query: {
      type: 'record',
      where: { recordType: 'service', 'fields.odometer': { contains: '5' } },
    },
  },
  'unknown-option': {
    component: 'DataList',
    query: { type: 'task', where: { status: 'doen' } },
  },
  'bad-relative-date': {
    component: 'DataList',
    query: { type: 'task', where: { dueDate: { lt: '$tomorrow' } } },
  },
  'no-record-type': { component: 'DataList', query: { type: 'record' } },
  'mixed-record-types': {
    component: 'DataTable',
    query: { type: 'record', where: { recordType: ['service', 'reminder'] } },
    columns: [{ field: 'fields.date' }],
  },
  'group-by-unique': { component: 'CountChart', query: services, by: 'title' },
  'sort-by-list': {
    component: 'DataList',
    query: { type: 'task', sort: [{ field: 'dependsOn' }] },
  },
};

describe('query checks', () => {
  for (const [code, node] of Object.entries(CASES) as [FindingCode, ViewNode][]) {
    it(`${code}: ${FINDING_LEVELS[code]}`, () => {
      const findings = check(node);
      expect(findings.map((f) => f.code)).toContain(code);
      expect(findings.find((f) => f.code === code)!.level).toBe(FINDING_LEVELS[code]);
    });
  }

  it('allow empty results, custom option values, meanings, special values and mixed currencies', () => {
    expect(
      check(
        { component: 'DataList', query: { type: 'task', where: { status: 'in_review' } } },
        { component: 'DataList', query: { type: 'task', where: { status: 'in_progress' } } },
        { component: 'KanbanBoard', filter: { where: { stageId: '$currentStage' } } },
        { component: 'DataList', query: { type: 'task', where: { dueDate: { lt: '$today+2w' } } } },
        { component: 'FileList', filter: { where: { kind: 'insurance' } } },
        {
          component: 'Stat',
          label: 'Spent',
          query: { type: 'record', where: { recordType: 'spending' } },
          sum: 'fields.amount',
        },
        {
          component: 'DueTracker',
          query: { type: 'record', where: { recordType: 'bill', 'due.band': 'past_due' } },
        },
        { component: 'DataList', query: { type: 'decision', where: { status: 'rejected' } } },
        { component: 'DataList', query: { type: 'task', where: { title: { exists: true } } } },
      ),
    ).toEqual([]);
  });

  it('check every query-bearing prop of the record blocks', () => {
    const findings = check({
      component: 'CategoryBreakdown',
      categories: { type: 'record', where: { recordType: 'category' } },
      planned: 'fields.plan',
      spent: {
        query: { type: 'record', where: { recordType: 'spending' } },
        by: 'fields.categry',
        sum: 'fields.payee',
      },
    });
    expect(findings.map((f) => [f.path, f.code])).toEqual([
      ['widgets[0].node.planned', 'unknown-sum-field'],
      ['widgets[0].node.spent.by', 'unknown-group-field'],
      ['widgets[0].node.spent.sum', 'sum-not-number'],
    ]);
    const text = check({
      component: 'Text',
      content: '${a}',
      values: {
        a: {
          sum: { query: { type: 'record', where: { recordType: 'bill' } }, field: 'fields.amout' },
        },
      },
    });
    expect(text[0]).toMatchObject({
      path: 'widgets[0].node.values.a.sum.field',
      suggestion: 'fields.amount',
    });
    const nested = check({
      component: 'Tabs',
      tabs: [
        {
          label: 'A',
          children: [{ component: 'TaskTable', filter: { where: { priorty: 'high' } } }],
        },
      ],
    });
    expect(nested[0]).toMatchObject({
      path: 'widgets[0].node.tabs[0].children[0].filter.where.priorty',
      suggestion: 'priority',
    });
  });

  it('make a typo in a record field fixable on the first retry', () => {
    const [finding] = check(CASES['unknown-field']);
    expect(finding).toMatchObject({
      level: 'reject',
      path: 'widgets[0].node.query.where["fields.odomter"]',
      suggestion: 'fields.odometer',
      example: { where: { recordType: 'service', 'fields.odometer': { gt: 1 } } },
    });
    expect(finding!.allowed).toEqual(expect.arrayContaining(['fields.odometer', 'fields.cost']));
    expect(formatFinding(finding!)).toMatch(
      /^widgets\[0\]\.node\.query\.where\["fields\.odomter"\] \(widget "w0"\): "fields\.odomter" isn't a field of Service \(service\) \(did you mean "fields\.odometer"\?\)\. Allowed: .*fields\.odometer.*Example: \{"where":\{"recordType":"service","fields\.odometer":\{"gt":1\}\},"type":"record"\}$/,
    );
    const [money] = check({
      component: 'DataList',
      query: { type: 'record', where: { recordType: 'spending', 'fields.amount': { gte: 1000 } } },
    });
    expect(money).toMatchObject({ code: 'operator-mismatch', suggestion: 'fields.amount.amount' });
  });

  it('keep the old messages for entity fields', () => {
    const findings = check({
      component: 'DataTable',
      query: { type: 'task', where: { dueDat: { exists: true } } },
      columns: [{ field: 'title' }, { field: 'stage.nam' }],
    });
    expect(findings.map((f) => f.message)).toEqual([
      expect.stringMatching(/^"dueDat" isn't a field of task \(did you mean "dueDate"\?\)/),
      expect.stringMatching(/^"stage.nam" isn't a field of stage \(did you mean "stage.name"\?\)/),
    ]);
  });
});
