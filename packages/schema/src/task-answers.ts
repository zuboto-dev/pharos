import { meaningOf, valueFor } from './options.js';
import { addDays } from './views/dates.js';

/**
 * The owner's answers on a task they were asked to do (a TaskChecklist in a report, the desk):
 * done, won't do (the cancelled meaning), later (a day it comes back), or a reply in their own
 * words instead of doing it as asked ("send it to someone else", "wait for counsel first").
 * Agents ask; only a person replies or defers (Store.apply refuses an agent setting these).
 */

export const TASK_ANSWER = {
  /** The owner's reply, in Markdown. */
  replyChars: 2000,
} as const;

/** The task fields only a person writes: a reply of their own and a later day. */
export const OWNER_TASK_FIELDS = ['reply', 'deferredUntil'] as const;

/**
 * Where a task stands as an answer: done, won't do (cancelled), replied, later (deferred to a day
 * after today), in review (the "review" meaning: nothing is left for the owner, an agent checks
 * it), or open. A deferral whose day has come is open again.
 */
export type TaskAnswerState = 'done' | 'wontDo' | 'replied' | 'later' | 'review' | 'open';

export function taskAnswerState(
  data: { reply?: string; deferredUntil?: string },
  /** The meaning of its status (`meaningOf(project, 'task.status', status)`). */
  meaning: string | undefined,
  /** Today as YYYY-MM-DD (localToday). */
  today: string,
): TaskAnswerState {
  if (meaning === 'done') return 'done';
  if (meaning === 'cancelled') return 'wontDo';
  if (meaning === 'review') return 'review';
  if (data.reply) return 'replied';
  if (data.deferredUntil && data.deferredUntil > today) return 'later';
  return 'open';
}

/** What the owner answers on a task besides "done". */
export type TaskAnswer =
  | { kind: 'wontDo' }
  | { kind: 'later'; until: string }
  | { kind: 'reply'; text: string }
  /** Change their mind: clear the reply and the day; won't do (or done) is open again. */
  | { kind: 'reopen' };

/**
 * The update an answer makes, and its revision message: one revision each, the same from a report
 * and from the desk. Each answer replaces the others (a reply clears a later day).
 */
export function taskAnswerChange(
  project: Parameters<typeof valueFor>[0],
  task: { data: { title: string; status: string } },
  answer: TaskAnswer,
): {
  message: string;
  data: { status?: string; reply: string | null; deferredUntil: string | null };
} {
  const title = task.data.title;
  const meaning = meaningOf(project, 'task.status', task.data.status);
  // Replying, putting it off or changing one's mind reopens a task marked done or won't do.
  const reopened: { status?: string } =
    meaning === 'done' || meaning === 'cancelled'
      ? { status: valueFor(project, 'task.status', 'todo') }
      : {};
  switch (answer.kind) {
    case 'wontDo':
      return {
        message: `Won't do “${title}”`,
        data: {
          status: valueFor(project, 'task.status', 'cancelled'),
          reply: null,
          deferredUntil: null,
        },
      };
    case 'later':
      return {
        message: `Later (${answer.until}): “${title}”`,
        data: { ...reopened, deferredUntil: answer.until, reply: null },
      };
    case 'reply':
      return {
        message: `Reply on “${title}”: ${answer.text}`,
        data: { ...reopened, reply: answer.text, deferredUntil: null },
      };
    case 'reopen':
      return {
        message: `Reopen “${title}”`,
        data: { ...reopened, reply: null, deferredUntil: null },
      };
  }
}

/** The Monday after `today` (YYYY-MM-DD): "later" by default. */
export function nextMonday(today: string): string {
  const day = new Date(`${today}T00:00:00Z`).getUTCDay();
  return addDays(today, (8 - day) % 7 || 7);
}
