import {
  meaningOf,
  runQuery,
  stripWorkCode,
  taskProgress,
  type Entity,
  type NodeOf,
} from '@pharos/schema';
import clsx from 'clsx';
import { ChevronDown } from 'lucide-react';
import { useViewData, type ViewData } from '../context';
import { OptionDot } from '../options';

/**
 * Progress per part of a Layers block (R4 block 2): a thin bar and "2 of 9" under each step,
 * drawn on one scale for every step, and the step's open tasks with their work codes hidden.
 */

type Task = Entity<'task'>;
type Layer = NodeOf<'Layers'>['layers'][number];

export type StepProgress = {
  /** Done tasks, out of `total` that aren't cancelled. */
  done: number;
  total: number;
  /** Tasks neither done nor cancelled, in task order. */
  open: Task[];
};

/** Counts a step's tasks live by meaning, so custom statuses work; cancelled ones are left out. */
export function stepProgress(data: ViewData, layer: Layer): StepProgress | undefined {
  if (!layer.progress) return undefined;
  const tasks = runQuery(data, 'task', { where: layer.progress, sort: [{ field: 'order' }] });
  const { done, total } = taskProgress(tasks, data.project);
  const closed = new Set(['done', 'cancelled']);
  const open = tasks.filter(
    (t) => !closed.has(meaningOf(data.project, 'task.status', t.data.status) ?? ''),
  );
  return { done, total, open };
}

/** The largest step, so every bar is drawn against the same length. */
export function progressScale(steps: readonly (StepProgress | undefined)[]): number {
  return Math.max(1, ...steps.map((s) => s?.total ?? 0));
}

/**
 * A bar whose track is as long as the step's task count against the largest step, filled by
 * the done share; "2 of 9" beside it. With `toggle`, the count is a button that shows the open
 * tasks (used where the step itself isn't a button).
 */
export function ProgressLine({
  progress,
  scale,
  id,
  toggle,
}: {
  progress: StepProgress;
  scale: number;
  id?: string;
  toggle?: { open: boolean; controls: string; onToggle: () => void };
}) {
  const { done, total } = progress;
  if (!total) {
    return (
      <span id={id} className="block text-xs text-neutral-400 dark:text-neutral-500">
        No tasks yet
      </span>
    );
  }
  const count = (
    <>
      {done} of {total}
      <span className="sr-only"> tasks done</span>
    </>
  );
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span aria-hidden className="block h-1.5 min-w-0 flex-1">
        <span
          className="block h-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700"
          style={{ width: `${(total / scale) * 100}%`, minWidth: '0.75rem' }}
        >
          <span
            className="block h-full rounded-full bg-emerald-500 motion-safe:transition-[width]"
            style={{ width: `${(done / total) * 100}%` }}
          />
        </span>
      </span>
      {toggle ? (
        <button
          type="button"
          id={id}
          aria-expanded={toggle.open}
          aria-controls={toggle.controls}
          onClick={toggle.onToggle}
          className="inline-flex shrink-0 items-center gap-0.5 rounded-sm text-xs font-medium text-neutral-600 tabular-nums hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-sky-400 dark:text-neutral-300 dark:hover:text-white"
        >
          {count}
          <ChevronDown
            aria-hidden
            className={clsx('size-3 motion-safe:transition-transform', toggle.open && 'rotate-180')}
          />
        </button>
      ) : (
        <span
          id={id}
          className="shrink-0 text-xs font-medium text-neutral-600 tabular-nums dark:text-neutral-300"
        >
          {count}
        </span>
      )}
    </span>
  );
}

/** The step's open tasks in plain titles; each opens the task drawer. */
export function OpenTasks({ progress, id }: { progress: StepProgress; id?: string }) {
  const { actions } = useViewData();
  if (!progress.total) return null;
  if (!progress.open.length) {
    return (
      <p id={id} className="text-sm text-neutral-500 dark:text-neutral-400">
        All done
      </p>
    );
  }
  return (
    <div id={id} className="space-y-1">
      <p className="text-xs font-medium tracking-wide text-neutral-500 uppercase dark:text-neutral-400">
        Open tasks
      </p>
      <ul className="space-y-0.5">
        {progress.open.map((task) => (
          <li key={task.id}>
            <button
              type="button"
              onClick={() => actions.open({ entity: task.id })}
              className="flex w-full min-w-0 items-baseline gap-2 rounded-md px-1.5 py-1 text-left text-sm text-neutral-800 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-sky-400 dark:text-neutral-100 dark:hover:bg-neutral-800"
            >
              <OptionDot field="task.status" value={task.data.status} className="shrink-0" />
              <span className="min-w-0 break-words whitespace-normal">
                {stripWorkCode(task.data.title)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
