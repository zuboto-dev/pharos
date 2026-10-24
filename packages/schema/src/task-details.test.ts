import { describe, expect, it } from 'vitest';
import { TaskData } from './entities.js';
import { TASK_DETAILS, taskDetailSummary, taskDetailWarnings } from './task-details.js';

const base = {
  projectId: 'prj_000000000001',
  title: 'Write the guide',
  status: 'todo',
  priority: 'medium',
  dependsOn: [],
  order: 0,
};
const meaning = (s: string | undefined) => s;
const full = {
  ...base,
  actions: ['Draft it', 'Send it'],
  acceptance: ['The guide previews with no warnings'],
  deliverables: [{ label: 'Guide', kind: 'page' as const, ref: 'v1' }],
};

describe('task details', () => {
  it('accepts actions, acceptance and deliverables, and trims them', () => {
    const t = TaskData.parse({ ...full, actions: ['  Draft it '] });
    expect(t.actions).toEqual(['Draft it']);
    expect(t.deliverables).toEqual([{ label: 'Guide', kind: 'page', ref: 'v1' }]);
    expect(TaskData.parse(base).actions).toBeUndefined();
  });

  it('refuses empty lines, unknown kinds, unknown keys and too many items', () => {
    expect(TaskData.safeParse({ ...base, actions: ['  '] }).success).toBe(false);
    expect(
      TaskData.safeParse({ ...base, deliverables: [{ label: 'x', kind: 'pdf' }] }).success,
    ).toBe(false);
    expect(TaskData.safeParse({ ...base, deliverables: [{ label: 'x', url: 'y' }] }).success).toBe(
      false,
    );
    const many = Array.from({ length: TASK_DETAILS.items + 1 }, (_, i) => `Step ${i}`);
    expect(TaskData.safeParse({ ...base, acceptance: many }).success).toBe(false);
    expect(
      TaskData.safeParse({ ...base, actions: ['x'.repeat(TASK_DETAILS.stepChars + 1)] }).success,
    ).toBe(false);
  });

  it('warns on create and on a move to in progress without them, never twice', () => {
    expect(taskDetailWarnings(null, { ...base, status: 'todo' }, meaning)).toEqual([
      expect.stringMatching(
        /^created without required actions \(actions\), acceptance criteria \(acceptance\) and expected results \(deliverables\)/,
      ),
    ]);
    expect(taskDetailWarnings(null, full, meaning)).toEqual([]);
    const todo = { ...base, status: 'todo', actions: ['Do it'] };
    expect(taskDetailWarnings(todo, { ...todo, status: 'in_progress' }, meaning)).toEqual([
      expect.stringMatching(/^moved to in progress without acceptance criteria/),
    ]);
    const going = { ...todo, status: 'in_progress' };
    expect(taskDetailWarnings(going, { ...going, title: 'Renamed' }, meaning)).toEqual([]);
  });

  it('asks a desk task only for actions and acceptance', () => {
    expect(
      taskDetailWarnings(null, { ...base, desk: true, actions: ['a'], acceptance: ['b'] }, meaning),
    ).toEqual([]);
  });

  it('warns when marked done with a deliverable that has no ref', () => {
    const going = { ...full, status: 'in_progress', deliverables: [{ label: 'Notes' }] };
    expect(taskDetailWarnings(going, { ...going, status: 'done' }, meaning)).toEqual([
      expect.stringMatching(/^marked done with deliverables that have no ref \("Notes"\)/),
    ]);
    expect(
      taskDetailWarnings(
        going,
        { ...going, status: 'done', deliverables: full.deliverables },
        meaning,
      ),
    ).toEqual([]);
  });

  it('summarizes the counts for a hover hint', () => {
    expect(taskDetailSummary(full)).toBe('2 steps · 1 check · 1 result');
    expect(taskDetailSummary(base)).toBeUndefined();
  });
});
