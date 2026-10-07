import type { EntityDataMap } from '../entities.js';
import { meaningOf, type ProjectOptions } from '../options.js';

type TaskLike = { data: Pick<EntityDataMap['task'], 'status' | 'stageId'> };
type StageLike = { id: string; data: Pick<EntityDataMap['stage'], 'status'> };
/** The project, for its custom options; statuses are compared by meaning. */
type ProjectLike = { data: { options?: ProjectOptions } } | null | undefined;

export type Progress = {
  /** 0–100. */
  percent: number;
  /** Done tasks, out of `total` tasks that aren't cancelled. */
  done: number;
  total: number;
};

export function taskProgress(tasks: TaskLike[], project?: ProjectLike): Progress {
  const meaning = (t: TaskLike) => meaningOf(project, 'task.status', t.data.status);
  const relevant = tasks.filter((t) => meaning(t) !== 'cancelled');
  const done = relevant.filter((t) => meaning(t) === 'done').length;
  return {
    percent: relevant.length ? Math.round((done / relevant.length) * 100) : 0,
    done,
    total: relevant.length,
  };
}

export type StageProgress = Progress & {
  /**
   * How to present the stage:
   * - `done`: the stage is marked done, so it counts as 100% (even if tasks are still open)
   * - `skipped`: not applicable
   * - `empty`: no tasks to measure yet
   * - `tasks`: measured by its tasks
   */
  basis: 'done' | 'skipped' | 'empty' | 'tasks';
  /** Tasks not done or cancelled. Non-zero on a done stage means its status and tasks disagree. */
  open: number;
};

/** The one rule for a stage's progress: an explicit status wins, otherwise its tasks decide. */
export function stageProgress(
  stage: StageLike,
  tasks: TaskLike[],
  project?: ProjectLike,
): StageProgress {
  const own = taskProgress(
    tasks.filter((t) => t.data.stageId === stage.id),
    project,
  );
  const open = own.total - own.done;
  const status = meaningOf(project, 'stage.status', stage.data.status);
  if (status === 'done') return { ...own, percent: 100, basis: 'done', open };
  if (status === 'skipped') return { ...own, percent: 0, basis: 'skipped', open };
  return { ...own, basis: own.total ? 'tasks' : 'empty', open };
}
