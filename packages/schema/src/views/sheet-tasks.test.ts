import { describe, expect, it } from 'vitest';
import type { Entity } from '../entities.js';
import type { DocBlock, ReportDoc } from './doc.js';
import type { ProjectDataset } from './query.js';
import { docDecisionIds, sheetTasks } from './sheet-tasks.js';

const entity = <T extends Entity['type']>(type: T, id: string, data: Record<string, unknown>) =>
  ({
    id,
    type,
    data,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    createdRev: 1,
    updatedRev: 1,
  }) as unknown as Entity<T>;

const P = 'prj_aaaaaaaaaaaa';
const data: ProjectDataset = {
  project: entity('project', P, { name: 'Demo', status: 'active', order: 0 }),
  repository: null,
  assignees: [
    entity('assignee', 'asg_h', { name: 'Sam', kind: 'human' }),
    entity('assignee', 'asg_a', { name: 'Helper', kind: 'agent' }),
  ],
  goals: [],
  scopeItems: [],
  stages: [],
  tasks: [
    entity('task', 'task_1', { projectId: P, title: 'One', status: 'done', assigneeId: 'asg_h' }),
    entity('task', 'task_2', {
      projectId: P,
      title: 'Two',
      status: 'cancelled',
      assigneeId: 'asg_h',
    }),
    entity('task', 'task_3', { projectId: P, title: 'Three', status: 'todo', assigneeId: 'asg_a' }),
  ],
  artifacts: [],
  decisions: [],
  views: [],
  requests: [],
  claims: [],
  terms: [],
  files: [],
  records: [],
};

const checklist = (node: Record<string, unknown>): DocBlock =>
  ({ kind: 'block', id: 'list', node: { component: 'TaskChecklist', ...node } }) as DocBlock;

describe('sheetTasks (R15)', () => {
  it('lists each task once; done or cancelled is finished, as the checklist counts it', () => {
    const rows = sheetTasks(data, { blocks: [checklist({}), checklist({})] });
    expect(rows.map((r) => [r.task.id, r.done, r.finished])).toEqual([
      ['task_1', true, true],
      ['task_2', false, true],
      ['task_3', false, false],
    ]);
  });

  it("applies the checklist's assigneeKind", () => {
    const rows = sheetTasks(data, { blocks: [checklist({ assigneeKind: 'human' })] });
    expect(rows.map((r) => r.task.id)).toEqual(['task_1', 'task_2']);
  });
});

describe('docDecisionIds (R15)', () => {
  it("collects the sheets' decisions and the DecisionBlocks' anywhere", () => {
    const doc = {
      blocks: [
        { kind: 'block', id: 'a', node: { component: 'DecisionBlock', decision: 'dec_a' } },
        {
          kind: 'sheet',
          id: 's',
          title: 'S',
          decisions: ['dec_b'],
          blocks: [
            { kind: 'block', id: 'c', node: { component: 'DecisionBlock', decision: 'dec_c' } },
          ],
        },
        { kind: 'block', id: 'log', node: { component: 'DecisionLog' } },
      ],
    } as unknown as ReportDoc;
    expect([...docDecisionIds(doc)].sort()).toEqual(['dec_a', 'dec_b', 'dec_c']);
  });
});
