import { describe, expect, it } from 'vitest';
import type { Entity } from '../entities.js';
import type { ProjectDataset } from './query.js';
import { boardReads, changeTouches } from './reads.js';
import { filterMatcher } from './run-query.js';
import { TEMPLATES } from './templates.js';
import { toBoard } from './board.js';

const project = {
  id: 'prj_aaaaaaaaaaaa',
  type: 'project',
  data: { name: 'Car', status: 'active', order: 0 },
} as unknown as Entity<'project'>;
const empty: ProjectDataset = {
  project,
  repository: null,
  assignees: [],
  goals: [],
  scopeItems: [],
  stages: [],
  tasks: [],
  artifacts: [],
  decisions: [],
  views: [],
  requests: [],
  claims: [],
  terms: [],
  files: [],
  records: [],
};
const matches = filterMatcher(empty, { today: '2026-10-13' });
const record = (recordType: string, fields: Record<string, unknown> = {}) => ({
  type: 'record' as const,
  id: 'rec_bbbbbbbbbbbb',
  before: null,
  after: { projectId: project.id, recordType, title: 'x', fields },
});

describe('what a page reads (R11)', () => {
  it('finds queries, filters, ids and feeds anywhere in a board', () => {
    const reads = boardReads(
      toBoard({
        component: 'Board',
        widgets: [
          {
            id: 'due',
            node: {
              component: 'DueTracker',
              query: { type: 'record', where: { recordType: 'service' } },
            },
          },
          {
            id: 'tabs',
            node: {
              component: 'Tabs',
              tabs: [
                {
                  label: 'A',
                  children: [
                    { component: 'TaskTable', filter: { where: { status: 'blocked' } } },
                    { component: 'ClaimCard', claim: 'clm_cccccccccccc' },
                  ],
                },
              ],
            },
          },
        ],
      }),
    );
    expect(reads.queries).toEqual([
      { type: 'record', filter: { where: { recordType: 'service' } } },
      { type: 'task', filter: { where: { status: 'blocked' } } },
    ]);
    expect([...reads.ids]).toEqual(['clm_cccccccccccc']);
    expect(reads.everything).toBe(false);
    // The Overview template shows the project and its activity.
    const overview = boardReads(toBoard(TEMPLATES.overview));
    expect(overview).toMatchObject({ project: true, everything: true });
  });

  it('a change touches a page only when the item matched one of its queries', () => {
    const reads = boardReads(
      toBoard({
        component: 'Board',
        widgets: [
          {
            id: 'due',
            node: {
              component: 'DueTracker',
              query: { type: 'record', where: { recordType: 'service' } },
            },
          },
        ],
      }),
    );
    expect(changeTouches(reads, record('service'), matches)).toBe(true);
    expect(changeTouches(reads, record('fuel'), matches)).toBe(false);
    // Moving out of the query counts (it matched before).
    expect(
      changeTouches(reads, { ...record('fuel'), before: { ...record('service').after } }, matches),
    ).toBe(true);
    // Pages and questions are never data.
    expect(
      changeTouches(reads, { type: 'view', id: 'view_x', before: null, after: {} }, matches),
    ).toBe(false);
  });
});
