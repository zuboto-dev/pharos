import { describe, expect, it } from 'vitest';
import { TaskData } from './entities.js';
import { applyInputFor } from './revisions.js';
import {
  OWNER_TASK_FIELDS,
  TASK_ANSWER,
  nextMonday,
  taskAnswerChange,
  taskAnswerState,
} from './task-answers.js';

const task = {
  projectId: 'prj_a',
  title: 'Send the licence request',
  status: 'todo',
  priority: 'medium',
  dependsOn: [],
  order: 0,
};

describe("a task's owner answers", () => {
  it('stores a reply and a later day, owner-only fields', () => {
    expect(OWNER_TASK_FIELDS).toEqual(['reply', 'deferredUntil']);
    expect(TaskData.safeParse({ ...task, reply: 'Wait for counsel first' }).success).toBe(true);
    expect(TaskData.safeParse({ ...task, deferredUntil: '2026-10-27' }).success).toBe(true);
    expect(TaskData.safeParse({ ...task, deferredUntil: 'next week' }).success).toBe(false);
    expect(TaskData.safeParse({ ...task, reply: '' }).success).toBe(false);
    expect(
      TaskData.safeParse({ ...task, reply: 'x'.repeat(TASK_ANSWER.replyChars + 1) }).success,
    ).toBe(false);
  });

  it('reads done, won’t do, replied, later and open, in that order', () => {
    const today = '2026-10-21';
    expect(taskAnswerState({ reply: 'r' }, 'done', today)).toBe('done');
    expect(taskAnswerState({ reply: 'r' }, 'cancelled', today)).toBe('wontDo');
    expect(taskAnswerState({ reply: 'r', deferredUntil: '2026-10-27' }, 'todo', today)).toBe(
      'replied',
    );
    expect(taskAnswerState({ deferredUntil: '2026-10-27' }, 'todo', today)).toBe('later');
    expect(taskAnswerState({ deferredUntil: '2026-10-21' }, 'todo', today)).toBe('open');
    expect(taskAnswerState({}, 'in_progress', today)).toBe('open');
  });

  it('makes one update and message per answer; each replaces the others', () => {
    const project = null; // default options
    const open = { data: { title: 'Send it', status: 'todo' } };
    const cancelled = { data: { title: 'Send it', status: 'cancelled' } };
    expect(taskAnswerChange(project, open, { kind: 'wontDo' })).toEqual({
      message: "Won't do “Send it”",
      data: { status: 'cancelled', reply: null, deferredUntil: null },
    });
    expect(taskAnswerChange(project, open, { kind: 'later', until: '2026-10-26' })).toEqual({
      message: 'Later (2026-10-26): “Send it”',
      data: { deferredUntil: '2026-10-26', reply: null },
    });
    expect(taskAnswerChange(project, cancelled, { kind: 'reply', text: 'Ask Ana' })).toEqual({
      message: 'Reply on “Send it”: Ask Ana',
      data: { status: 'todo', reply: 'Ask Ana', deferredUntil: null },
    });
    expect(taskAnswerChange(project, cancelled, { kind: 'reopen' })).toEqual({
      message: 'Reopen “Send it”',
      data: { status: 'todo', reply: null, deferredUntil: null },
    });
  });

  it("leaves them out of the agent's apply schema", () => {
    const agent = applyInputFor(['task'], {}, {}, { task: OWNER_TASK_FIELDS });
    const update = (data: object) => ({
      message: 'm',
      operations: [{ op: 'update', type: 'task', id: 'task_1', data }],
    });
    expect(agent.safeParse(update({ title: 'Renamed' })).success).toBe(true);
    expect(agent.safeParse(update({ reply: 'Done' })).success).toBe(false);
    expect(agent.safeParse(update({ deferredUntil: '2026-10-27' })).success).toBe(false);
    expect(applyInputFor(['task']).safeParse(update({ reply: 'Done' })).success).toBe(true);
  });

  it('defaults "later" to next Monday', () => {
    expect(nextMonday('2026-10-21')).toBe('2026-10-26'); // a Wednesday
    expect(nextMonday('2026-10-26')).toBe('2026-11-02'); // a Monday: the one after
    expect(nextMonday('2026-10-25')).toBe('2026-10-26'); // a Sunday
  });
});
