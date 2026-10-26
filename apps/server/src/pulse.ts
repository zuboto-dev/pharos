import {
  PULSE_DAYS,
  addDays,
  localToday,
  meaningOf,
  type Entity,
  type ProjectPulse,
  type Pulse,
} from '@pharos/schema';
import type { StandingApprovals } from './approvals.js';
import { deskOf, type RunLog } from './desk.js';
import type { Store } from './store/store.js';

const DAY = 86_400_000;

/** Whole days from `from` to `to` (YYYY-MM-DD each). */
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

/**
 * Every active project's pulse (packages/schema/src/pulse.ts), from its records, the change log,
 * the desk, the run log and the standing approvals' log: nothing an agent wrote about itself.
 */
export function pulseOf(
  store: Store,
  runs: RunLog,
  approvals: StandingApprovals,
  options: { projectId?: string | undefined; now?: Date } = {},
): Pulse {
  const now = options.now ?? new Date();
  const today = localToday(now);
  const first = addDays(today, -(PULSE_DAYS - 1));
  const weekAgo = new Date(now.getTime() - 7 * DAY).toISOString();
  const projects = store
    .list('project')
    .filter((p) => p.data.status !== 'archived' && p.data.status !== 'done')
    .filter((p) => !options.projectId || p.id === options.projectId);

  // Status changes of tasks in the charted days, one query for every project.
  const since = new Date(now.getTime() - (PULSE_DAYS + 1) * DAY).toISOString();
  const moves = store.database
    .prepare(
      `SELECT c.project_id AS projectId, c.entity_id AS id, r.created_at AS at,
              json_extract(c.before, '$.status') AS before, json_extract(c.after, '$.status') AS after
         FROM changes c JOIN revisions r ON r.id = c.revision_id
        WHERE c.entity_type = 'task' AND r.created_at >= ? AND c.after IS NOT NULL
          AND (? IS NULL OR c.project_id = ?)
          AND c.project_id IS NOT NULL
          AND (c.before IS NULL OR json_extract(c.before, '$.status') IS NOT json_extract(c.after, '$.status'))
        ORDER BY r.id`,
    )
    .all(since, options.projectId ?? null, options.projectId ?? null) as {
    projectId: string;
    id: string;
    at: string;
    before: string | null;
    after: string;
  }[];

  const desk = deskOf(store, runs, {
    now,
    ...(options.projectId ? { projectId: options.projectId } : {}),
  });
  const running = runs.latest().filter((r) => r.outcome === 'running');
  const ruled = approvals.answers(weekAgo).filter((a) => !a.undoneAt);

  const out = projects.map((project): ProjectPulse => {
    const data = store.dataset(project.id);
    const meaning = (t: Entity<'task'>) => meaningOf(project, 'task.status', t.data.status);
    const tasks = data.tasks.filter((t) => meaning(t) !== 'cancelled');
    const count = (m: string) => tasks.filter((t) => meaning(t) === m).length;

    // A task counts once a day, on the day it last became done.
    const doneByDay = Array.from({ length: PULSE_DAYS }, () => 0);
    const doneWeek = new Set<string>();
    const lastDone = new Map<string, string>();
    for (const move of moves) {
      if (move.projectId !== project.id) continue;
      const done = meaningOf(project, 'task.status', move.after) === 'done';
      const was = move.before !== null && meaningOf(project, 'task.status', move.before) === 'done';
      if (done && !was) lastDone.set(move.id, move.at);
      else if (!done) lastDone.delete(move.id);
    }
    for (const [id, at] of lastDone) {
      const day = daysBetween(first, localToday(at));
      if (day >= 0 && day < PULSE_DAYS) doneByDay[day]!++;
      if (at >= weekAgo) doneWeek.add(id);
    }

    const stages = [...data.stages].sort((a, b) => a.data.order - b.data.order);
    const index = stages.findIndex((s) => s.id === project.data.currentStageId);
    const current = stages[index];
    const stage = current
      ? {
          name: current.data.name,
          index: index + 1,
          of: stages.length,
          ...(current.data.targetDate
            ? {
                targetDate: current.data.targetDate,
                daysLeft: daysBetween(today, current.data.targetDate),
              }
            : {}),
        }
      : undefined;

    const waiting = desk.items.filter((i) => i.projectId === project.id);
    const goalMeaning = (g: Entity<'goal'>) => meaningOf(project, 'goal.status', g.data.status);
    const last = store.history({ projectId: project.id, limit: 1 })[0];
    return {
      projectId: project.id,
      project: project.data.name,
      ...(stage ? { stage } : {}),
      goals: {
        open: data.goals.filter((g) => goalMeaning(g) === 'open').length,
        achieved: data.goals.filter((g) => goalMeaning(g) === 'achieved').length,
      },
      tasks: {
        open: count('todo'),
        inProgress: count('in_progress'),
        review: count('review'),
        blocked: count('blocked'),
        doneWeek: doneWeek.size,
        addedWeek: tasks.filter((t) => t.createdAt >= weekAgo).length,
      },
      doneByDay,
      waiting: {
        count: waiting.length,
        gates: waiting.filter((i) => i.gate).length,
        ...(waiting.length ? { oldestSince: waiting.map((i) => i.since).sort()[0]! } : {}),
      },
      byRules: ruled.filter((a) => a.projectId === project.id).length,
      running: running
        .filter((r) => r.projectId === project.id)
        .map((r) => ({ name: r.name, since: r.startedAt })),
      ...(last
        ? { last: { at: last.createdAt, who: last.author.name, message: last.message } }
        : {}),
    };
  });
  return { today, projects: out };
}
