import { runQuery, type Entity, type NodeOf } from '@pharos/schema';
import clsx from 'clsx';
import { Network } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useViewData } from '../context';
import { AskAgentButton, EmptyState } from '../empty-state';
import { EntityRef } from '../interactive';
import { useOptions } from '../options';

type Goal = Entity<'goal'>;
type Task = Entity<'task'>;

const W = 800;
const H = 560;
const CX = W / 2;
const CY = H / 2;
/** The goals' ring, and the tasks' band around it. */
const R_GOAL = 150;
const R_TASK = 245;
const R_SHARED = 205;

/** Status colours by meaning, as the rest of the app draws them. */
const STATUS: Record<string, string> = {
  done: '#10b981',
  in_progress: '#0ea5e9',
  blocked: '#f43f5e',
  cancelled: '#a3a3a380',
  todo: '#a3a3a3',
};

const polar = (angle: number, r: number) => ({
  x: CX + r * Math.cos(angle),
  y: CY + r * Math.sin(angle),
});

/** The mean of angles (a task between two goals sits between them on the circle). */
function meanAngle(angles: number[]): number {
  const x = angles.reduce((s, a) => s + Math.cos(a), 0);
  const y = angles.reduce((s, a) => s + Math.sin(a), 0);
  return Math.atan2(y, x);
}

/** Text stays readable where it crosses a line: a halo in the page's own colour. */
const HALO = {
  paintOrder: 'stroke',
  stroke: 'var(--ph-surface)',
  strokeWidth: 4,
  strokeLinejoin: 'round',
} as const;

const cut = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

export type MapLayout = {
  hub: string;
  goals: { goal: Goal; x: number; y: number; angle: number }[];
  tasks: { task: Task; x: number; y: number; goals: string[]; shared: boolean }[];
  unlinked: Task[];
};

/**
 * Where everything goes: the ring's goals evenly around the hub; each task near the goals it
 * serves (a sub-goal's tasks count for the ring goal above it), spread along its goal's arc, or
 * between its goals when it serves several.
 */
export function layoutMap(
  goals: Goal[],
  tasks: Task[],
  center?: string,
  hub = 'Project',
): MapLayout {
  const byId = new Map(goals.map((g) => [g.id, g]));
  const centerGoal = center ? byId.get(center) : undefined;
  const ring = centerGoal
    ? goals.filter((g) => g.data.parentId === centerGoal.id)
    : goals.filter((g) => !g.data.parentId || !byId.has(g.data.parentId));
  const ringIds = new Set(ring.map((g) => g.id));
  /** The ring goal a goal belongs to (itself, or the ancestor on the ring). */
  const ringOf = (id: string): string | undefined => {
    let at = byId.get(id);
    for (let i = 0; at && i < 20; i++) {
      if (ringIds.has(at.id)) return at.id;
      if (centerGoal && at.id === centerGoal.id) return undefined;
      at = at.data.parentId ? byId.get(at.data.parentId) : undefined;
    }
    return undefined;
  };
  const angleOf = new Map<string, number>();
  const placedGoals = ring.map((goal, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, ring.length);
    angleOf.set(goal.id, angle);
    return { goal, angle, ...polar(angle, R_GOAL) };
  });
  const own = new Map<string, Task[]>();
  const shared: { task: Task; goals: string[] }[] = [];
  const unlinked: Task[] = [];
  for (const task of tasks) {
    const served = [...new Set((task.data.goalIds ?? []).map(ringOf).filter(Boolean) as string[])];
    if (!served.length) unlinked.push(task);
    else if (served.length === 1) own.set(served[0]!, [...(own.get(served[0]!) ?? []), task]);
    else shared.push({ task, goals: served });
  }
  const sector = (2 * Math.PI) / Math.max(1, ring.length);
  const placedTasks: MapLayout['tasks'] = [];
  for (const [goalId, list] of own) {
    const base = angleOf.get(goalId)!;
    const spread = Math.min(sector * 0.8, 0.22 * list.length);
    list.forEach((task, i) => {
      // One task sits a little off its goal's line, where the goal's label would be.
      const angle =
        list.length === 1 ? base + 0.32 : base - spread / 2 + (spread * i) / (list.length - 1);
      // Alternate two radii so neighbours don't touch.
      const r = R_TASK + (i % 2 ? 26 : 0);
      placedTasks.push({ task, goals: [goalId], shared: false, ...polar(angle, r) });
    });
  }
  shared.forEach(({ task, goals: ids }, i) => {
    const angle = meanAngle(ids.map((id) => angleOf.get(id)!)) + (i % 3) * 0.04;
    placedTasks.push({ task, goals: ids, shared: true, ...polar(angle, R_SHARED) });
  });
  return {
    hub: centerGoal ? centerGoal.data.title : hub,
    goals: placedGoals,
    tasks: placedTasks,
    unlinked,
  };
}

/**
 * The Map (2026-10-23, "a map … radiated to explain goals and tasks since tasks live in
 * multidimensions entangled each other"): goals in a ring, tasks around the goals they serve,
 * lines for what a task waits on. Hovering a goal or a task lights up what it's tied to;
 * clicking opens it.
 */
export function GoalMap({ node }: { node: NodeOf<'Map'> }) {
  const data = useViewData();
  const options = useOptions();
  const [focus, setFocus] = useState<string | null>(null);
  const tasks = runQuery(data, 'task', node.filter) as Task[];
  const layout = useMemo(
    () => layoutMap(data.goals as Goal[], tasks, node.center, data.project?.data.name),
    [data.goals, tasks, node.center, data.project],
  );
  if (!layout.goals.length)
    return (
      <EmptyState
        icon={Network}
        title={data.goals.length ? 'No goals on this ring' : 'No goals yet'}
        hint="The map places goals in a ring and the tasks serving them around each."
      >
        <AskAgentButton question="Set this project's goals, and link each task to the goals it serves (goalIds)." />
      </EmptyState>
    );
  const at = new Map<string, { x: number; y: number }>([
    ...layout.goals.map((g) => [g.goal.id, g] as const),
    ...layout.tasks.map((t) => [t.task.id, t] as const),
  ]);
  // What the focused item is tied to: its goals, its tasks, what it waits on and what waits on it.
  const near = new Set<string>();
  if (focus) {
    near.add(focus);
    for (const t of layout.tasks) {
      const deps = t.task.data.dependsOn ?? [];
      if (t.task.id === focus) {
        t.goals.forEach((g) => near.add(g));
        deps.forEach((d) => near.add(d));
      }
      if (t.goals.includes(focus) || deps.includes(focus)) near.add(t.task.id);
    }
  }
  const dim = (id: string) => focus !== null && !near.has(id);
  const statusOf = (task: Task) =>
    STATUS[options.meaning('task.status', task.data.status) ?? 'todo'] ?? STATUS.todo;
  const labelTasks = layout.tasks.length <= 24;
  return (
    <div data-map="" className="space-y-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Map of ${layout.goals.length} goals and ${layout.tasks.length} tasks around ${layout.hub}`}
        className="h-auto w-full select-none"
        onMouseLeave={() => setFocus(null)}
      >
        <circle
          cx={CX}
          cy={CY}
          r={R_GOAL}
          className="fill-none stroke-line-soft"
          strokeDasharray="2 6"
        />
        {/* Hub to goals. */}
        {layout.goals.map(({ goal, x, y }) => (
          <line
            key={`h-${goal.id}`}
            x1={CX}
            y1={CY}
            x2={x}
            y2={y}
            className={clsx('stroke-line', dim(goal.id) && 'opacity-20')}
          />
        ))}
        {/* Tasks to the goals they serve. */}
        {layout.tasks.flatMap((t) =>
          t.goals.map((g) => {
            const goal = at.get(g)!;
            return (
              <line
                key={`g-${t.task.id}-${g}`}
                x1={goal.x}
                y1={goal.y}
                x2={t.x}
                y2={t.y}
                className={clsx('stroke-line-strong', dim(t.task.id) && 'opacity-15')}
                strokeWidth={t.shared ? 1.4 : 1}
              />
            );
          }),
        )}
        {/* What a task waits on. */}
        {layout.tasks.flatMap((t) =>
          (t.task.data.dependsOn ?? [])
            .filter((d) => at.has(d))
            .map((d) => {
              const from = at.get(d)!;
              return (
                <path
                  key={`d-${t.task.id}-${d}`}
                  d={`M${from.x},${from.y} Q${(from.x + t.x) / 2 + (CX - (from.x + t.x) / 2) / 3},${(from.y + t.y) / 2 + (CY - (from.y + t.y) / 2) / 3} ${t.x},${t.y}`}
                  className={clsx(
                    'fill-none stroke-amber-500',
                    focus && !(near.has(t.task.id) && near.has(d)) && 'opacity-15',
                  )}
                  strokeDasharray="4 4"
                  strokeWidth={1.2}
                />
              );
            }),
        )}
        <circle cx={CX} cy={CY} r={34} className="fill-sunken stroke-line-strong" />
        <text
          x={CX}
          y={CY + 4}
          textAnchor="middle"
          className="fill-ink text-[12px] font-semibold"
          style={HALO}
        >
          {cut(layout.hub, 16)}
        </text>
        {layout.goals.map(({ goal, x, y, angle }) => {
          // Its label just inside the ring, toward the hub: tasks are all outside it.
          const label = polar(angle, R_GOAL - 44);
          return (
            <g
              key={goal.id}
              data-map-goal={goal.id}
              role="button"
              tabIndex={0}
              aria-label={`Goal: ${goal.data.title}`}
              onMouseEnter={() => setFocus(goal.id)}
              onFocus={() => setFocus(goal.id)}
              onClick={() => data.actions.open({ entity: goal.id })}
              onKeyDown={(e) => e.key === 'Enter' && data.actions.open({ entity: goal.id })}
              className={clsx('cursor-pointer outline-none', dim(goal.id) && 'opacity-25')}
            >
              {/* A ring, so a goal never reads as an in-progress task. */}
              <circle cx={x} cy={y} r={14} className="fill-surface stroke-accent" strokeWidth={4} />
              <circle cx={x} cy={y} r={4} className="fill-accent" />
              <text
                x={label.x}
                y={label.y + 4}
                textAnchor="middle"
                className="fill-ink text-[12px] font-semibold"
                style={HALO}
              >
                {cut(goal.data.title, layout.goals.length > 5 ? 16 : 24)}
              </text>
            </g>
          );
        })}
        {layout.tasks.map(({ task, x, y }) => (
          <g
            key={task.id}
            data-map-task={task.id}
            role="button"
            tabIndex={0}
            aria-label={`Task: ${task.data.title}`}
            onMouseEnter={() => setFocus(task.id)}
            onFocus={() => setFocus(task.id)}
            onClick={() => data.actions.open({ entity: task.id })}
            onKeyDown={(e) => e.key === 'Enter' && data.actions.open({ entity: task.id })}
            className={clsx('cursor-pointer outline-none', dim(task.id) && 'opacity-20')}
          >
            <title>{task.data.title}</title>
            <circle
              cx={x}
              cy={y}
              r={7}
              fill={statusOf(task)}
              className="stroke-surface"
              strokeWidth={2}
            />
            {(labelTasks || focus === task.id) && (
              <text
                x={x + (x >= CX ? 11 : -11)}
                y={y + 3}
                textAnchor={x >= CX ? 'start' : 'end'}
                className="fill-muted text-[10px]"
                style={HALO}
              >
                {cut(task.data.title, 22)}
              </text>
            )}
          </g>
        ))}
      </svg>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        {(['todo', 'in_progress', 'blocked', 'done'] as const).map((m) => (
          <span key={m} className="inline-flex items-center gap-1">
            <span aria-hidden className="size-2 rounded-full" style={{ background: STATUS[m] }} />
            {m === 'in_progress' ? 'in progress' : m}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="h-0 w-4 border-t border-dashed border-amber-500" />
          waits on
        </span>
      </div>
      {layout.unlinked.length > 0 && (
        <div data-map-unlinked="" className="space-y-1">
          <p className="text-xs text-muted">Not on a goal ({layout.unlinked.length})</p>
          <div className="flex flex-wrap gap-1">
            {layout.unlinked.map((t) => (
              <EntityRef key={t.id} id={t.id} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
