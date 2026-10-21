import { runQuery, stripWorkCode, type Entity, type NodeOf } from '@pharos/schema';
import clsx from 'clsx';
import {
  Bot,
  Check,
  CircleCheck,
  GitBranch,
  ListChecks,
  ListTodo,
  Play,
  User,
  Users,
} from 'lucide-react';
import { useMemo, useState, type DragEvent, type ReactNode } from 'react';
import { formatDate, humanize, plural } from '../../lib/format';
import { useViewData, type ViewData } from '../context';
import { Clickable, EntityRef, TaskCheck, useGlance, useTaskActions } from '../interactive';
import { LinkedFiles } from '../linked-files';
import { EditOptionsButton, OptionBadge, OptionDot, useOptions } from '../options';
import { defaultsFrom, QuickAdd, useCreate } from '../quickadd';
import { firstUses, TermText, useTermMatcher } from '../terms';
import { AskAgentButton, EmptyState } from '../empty-state';
import { ScrollX } from '../scroll-x';
import { Badge } from '../ui';
import { useInDocument } from '../variant';

type Task = Entity<'task'>;
type GroupBy = NonNullable<NodeOf<'KanbanBoard'>['groupBy']>;
type Column = { key: string; label: string; tasks: Task[] };

const DRAG_TYPE = 'application/x-pharos-task';

/** The task field each grouping writes when a card is dropped into a column. */
const GROUP_FIELDS: Record<GroupBy, string> = {
  status: 'status',
  priority: 'priority',
  stage: 'stageId',
  assignee: 'assigneeId',
};

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A task's due date: red once overdue (unless finished), amber within two days. */
function DueChip({ date, finished }: { date: string; finished: boolean }) {
  const today = localToday();
  const [y, m, d] = today.split('-').map(Number);
  const soon = new Date(Date.UTC(y!, m! - 1, d! + 2)).toISOString().slice(0, 10);
  const tone = finished ? 'muted' : date < today ? 'red' : date <= soon ? 'amber' : 'muted';
  return (
    <Badge tone={tone} className="tabular-nums">
      {tone === 'red' ? 'Overdue · ' : 'Due '}
      {formatDate(date, true)}
    </Badge>
  );
}

function AssigneeLabel({ id }: { id?: string }) {
  const { assigneeById } = useViewData();
  const assignee = id ? assigneeById.get(id) : undefined;
  if (!assignee) return null;
  const Icon = assignee.data.kind === 'agent' ? Bot : User;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted">
      <Icon className="size-3.5" /> {assignee.data.name}
    </span>
  );
}

function TaskCard({ task, show }: { task: Task; show: { stage: boolean; status: boolean } }) {
  const [dragging, setDragging] = useState(false);
  const options = useOptions();
  // A report document (R14) is read-only: cards don't move.
  const readOnly = useInDocument();
  const { priority, status, dependsOn, assigneeId, estimate, stageId } = task.data;
  const meaning = options.meaning('task.status', status);
  return (
    <div
      draggable={!readOnly}
      onDragStart={(e) => {
        if (readOnly) return;
        e.dataTransfer.setData(DRAG_TYPE, task.id);
        e.dataTransfer.effectAllowed = 'move';
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      className={clsx(dragging && 'opacity-40')}
    >
      <Clickable
        id={task.id}
        title={task.data.description}
        className={clsx(
          'space-y-2 rounded-tile border border-line bg-surface p-3 shadow-xs transition hover:border-neutral-300 hover:shadow-sm dark:hover:border-neutral-700',
          meaning === 'blocked' && 'border-l-2 border-l-rose-500',
          meaning === 'cancelled' && 'opacity-60',
        )}
      >
        <div className="flex items-start gap-2">
          <TaskCheck task={task} className="mt-px" />
          <div
            className={clsx(
              'text-sm leading-snug font-medium',
              meaning === 'cancelled' && 'line-through',
              meaning === 'done' && 'text-faint',
            )}
          >
            {task.data.title}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {show.status && <OptionBadge field="task.status" value={status} />}
          {options.meaning('task.priority', priority) !== 'medium' && (
            <OptionBadge field="task.priority" value={priority} />
          )}
          {show.stage && stageId && <EntityRef id={stageId} />}
          {task.data.dueDate && (
            <DueChip
              date={task.data.dueDate}
              finished={meaning === 'done' || meaning === 'cancelled'}
            />
          )}
          {estimate && <span className="text-xs text-faint">{estimate}</span>}
        </div>
        {(assigneeId || dependsOn.length > 0) && (
          <div className="flex items-center justify-between gap-2">
            <AssigneeLabel id={assigneeId} />
            {dependsOn.length > 0 && (
              <span
                className="inline-flex items-center gap-1 text-xs text-faint"
                title={`Depends on ${plural(dependsOn.length, 'task')}`}
              >
                <GitBranch className="size-3.5" /> {dependsOn.length}
              </span>
            )}
          </div>
        )}
      </Clickable>
    </div>
  );
}

/** Finished columns show this many cards (most recently finished first) until expanded. */
const FINISHED_PREVIEW = 5;

/**
 * A column's cards. Columns scroll inside a fixed maximum height so one busy column can't stretch
 * the whole board; finished columns also collapse to their latest few cards.
 */
function ColumnCards({
  tasks,
  finished,
  show,
}: {
  tasks: Task[];
  finished: boolean;
  show: { stage: boolean; status: boolean };
}) {
  const [expanded, setExpanded] = useState(false);
  const ordered = finished ? [...tasks].sort((a, b) => b.updatedRev - a.updatedRev) : tasks;
  const hidden = finished && !expanded ? Math.max(0, ordered.length - FINISHED_PREVIEW) : 0;
  const visible = hidden ? ordered.slice(0, FINISHED_PREVIEW) : ordered;
  return (
    <div className="min-h-12 flex-1">
      <div className="max-h-[32rem] space-y-2 overflow-y-auto">
        {visible.map((task) => (
          <TaskCard key={task.id} task={task} show={show} />
        ))}
      </div>
      {finished && ordered.length > FINISHED_PREVIEW && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mt-2 w-full rounded-control px-2 py-1 text-left text-xs text-muted hover:bg-subtle hover:text-ink"
        >
          {expanded ? 'Show fewer' : `Show ${hidden} more`}
        </button>
      )}
    </div>
  );
}

function groupTasks(
  tasks: Task[],
  groupBy: GroupBy,
  data: ViewData,
  options: ReturnType<typeof useOptions>,
): Column[] {
  const by = (
    keys: { key: string; label: string }[],
    get: (t: Task) => string | undefined,
    noneLabel?: string,
  ) => {
    const columns = keys.map((k) => ({ ...k, tasks: tasks.filter((t) => get(t) === k.key) }));
    const known = new Set(keys.map((k) => k.key));
    if (noneLabel)
      columns.push({
        key: '',
        label: noneLabel,
        tasks: tasks.filter((t) => !known.has(get(t) ?? '')),
      });
    return columns;
  };
  switch (groupBy) {
    case 'status':
      return by(
        options.list('task.status').map((o) => ({ key: o.value, label: o.label })),
        (t) => t.data.status,
      );
    case 'priority':
      return by(
        [...options.list('task.priority')].reverse().map((o) => ({ key: o.value, label: o.label })),
        (t) => t.data.priority,
      );
    case 'stage':
      return by(
        data.stages.map((s) => ({ key: s.id, label: s.data.name })),
        (t) => t.data.stageId,
        'No stage',
      );
    case 'assignee':
      return by(
        data.assignees.map((a) => ({ key: a.id, label: a.data.name })),
        (t) => t.data.assigneeId,
        'Unassigned',
      );
  }
}

export function KanbanBoard({ node }: { node: NodeOf<'KanbanBoard'> }) {
  const data = useViewData();
  const { setField } = useTaskActions();
  const create = useCreate();
  const options = useOptions();
  const [over, setOver] = useState<string | null>(null);
  const readOnly = useInDocument();
  const groupBy = node.groupBy ?? 'status';
  const optionField =
    groupBy === 'status' ? 'task.status' : groupBy === 'priority' ? 'task.priority' : null;
  const tasks = runQuery(data, 'task', node.filter);
  // Empty columns stay visible as drop targets, except cancelled ones and the catch-all column.
  const columns = groupTasks(tasks, groupBy, data, options).filter((c) =>
    node.hideEmpty
      ? c.tasks.length
      : c.tasks.length ||
        (c.key !== '' &&
          !(groupBy === 'status' && options.meaning('task.status', c.key) === 'cancelled')),
  );

  const onDrop = (e: DragEvent, column: Column) => {
    e.preventDefault();
    setOver(null);
    const task = data.taskById.get(e.dataTransfer.getData(DRAG_TYPE));
    const field = GROUP_FIELDS[groupBy];
    const value = column.key || null;
    if (!task || ((task.data as Record<string, unknown>)[field] ?? null) === value) return;
    void setField(task, field, value, column.label);
  };

  return (
    <div className="flex gap-3 overflow-x-auto pb-1">
      {columns.map((column) => (
        <div
          key={column.key}
          onDragOver={(e) => {
            if (readOnly || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setOver(column.key);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null);
          }}
          onDrop={(e) => !readOnly && onDrop(e, column)}
          className={clsx(
            'flex w-64 shrink-0 flex-col rounded-tile p-2 transition',
            over === column.key
              ? 'bg-sky-50 ring-2 ring-sky-300 dark:bg-sky-950/50 dark:ring-sky-800'
              : 'bg-neutral-50 dark:bg-neutral-950/60',
          )}
        >
          <div className="group/col flex items-center gap-2 px-1 pb-2 text-xs font-semibold text-ink-soft">
            {optionField && column.key && <OptionDot field={optionField} value={column.key} />}
            {column.label}
            <span className="font-normal text-faint">{column.tasks.length}</span>
            {optionField && (
              <EditOptionsButton
                field={optionField}
                className="ml-auto opacity-0 group-hover/col:opacity-100 focus:opacity-100 pointer-coarse:opacity-100"
              />
            )}
          </div>
          <ColumnCards
            tasks={column.tasks}
            finished={
              groupBy === 'status' &&
              ['done', 'cancelled'].includes(options.meaning('task.status', column.key) ?? '')
            }
            show={{ stage: groupBy !== 'stage', status: groupBy !== 'status' }}
          />
          <QuickAdd
            label="Add task"
            className="mt-1"
            onAdd={(title) =>
              create('task', {
                ...defaultsFrom(node.filter?.where, data.project.data.currentStageId),
                ...(column.key ? { [GROUP_FIELDS[groupBy]]: column.key } : {}),
                title,
              })
            }
          />
        </div>
      ))}
      {optionField && (
        <div className="flex w-40 shrink-0 items-start justify-center rounded-tile border border-dashed border-line p-2">
          <EditOptionsButton
            field={optionField}
            label={groupBy === 'status' ? 'Edit statuses' : 'Edit priorities'}
          />
        </div>
      )}
    </div>
  );
}

type TaskColumn = NonNullable<NodeOf<'TaskTable'>['columns']>[number];

export function TaskTable({ node }: { node: NodeOf<'TaskTable'> }) {
  const data = useViewData();
  const create = useCreate();
  const options = useOptions();
  const tasks = runQuery(data, 'task', node.filter);
  // F6: titles without their work codes when asked; terms in rows only when asked.
  const titles = tasks.map((t) => (node.hideCodes ? stripWorkCode(t.data.title) : t.data.title));
  const termRanges = firstUses(titles, useTermMatcher(node.terms ?? false));
  const addTask = (variant?: 'button') => (
    <QuickAdd
      label="Add task"
      variant={variant}
      onAdd={(title) =>
        create('task', {
          ...defaultsFrom(node.filter?.where, data.project.data.currentStageId),
          title,
        })
      }
    />
  );
  const columns: TaskColumn[] = node.columns ?? ['status', 'priority', 'stage', 'assignee'];
  if (!tasks.length) {
    return (
      <EmptyState
        icon={ListTodo}
        title={data.tasks.length ? 'No tasks match this list' : 'No tasks yet'}
        hint="Add one here, or ask your agent to break the work into tasks."
      >
        {addTask('button')}
        <AskAgentButton question="Break the work in this list into tasks." />
      </EmptyState>
    );
  }
  const cell = (task: Task, column: TaskColumn) => {
    switch (column) {
      case 'status':
        return <OptionBadge field="task.status" value={task.data.status} />;
      case 'priority':
        return <OptionBadge field="task.priority" value={task.data.priority} />;
      case 'stage':
        return task.data.stageId ? <EntityRef id={task.data.stageId} /> : null;
      case 'assignee':
        return <AssigneeLabel id={task.data.assigneeId} />;
      case 'estimate':
        return task.data.estimate;
      case 'dueDate':
        return task.data.dueDate ? (
          <DueChip
            date={task.data.dueDate}
            finished={['done', 'cancelled'].includes(
              options.meaning('task.status', task.data.status) ?? '',
            )}
          />
        ) : null;
      case 'dependsOn':
        return (
          <div className="flex flex-wrap gap-1">
            {task.data.dependsOn.map((id) => (
              <EntityRef key={id} id={id} />
            ))}
          </div>
        );
    }
  };
  return (
    <div className="-mx-4 -my-4">
      <ScrollX label="Tasks">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted">
            <tr className="border-b border-line-soft">
              <th className="px-4 py-2 font-medium">Task</th>
              {columns.map((c) => (
                <th key={c} className="px-3 py-2 font-medium whitespace-nowrap">
                  {c === 'dependsOn' ? 'Depends on' : c === 'dueDate' ? 'Due' : humanize(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tasks.map((task, i) => (
              <TaskRow
                key={task.id}
                task={task}
                title={<TermText text={titles[i]!} ranges={termRanges[i]} />}
              >
                {columns.map((c) => (
                  <td key={c} className="px-3 py-2 text-ink-soft">
                    {cell(task, c)}
                  </td>
                ))}
              </TaskRow>
            ))}
          </tbody>
        </table>
      </ScrollX>
      <div className="px-2 py-1">{addTask()}</div>
    </div>
  );
}

function TaskRow({ task, title, children }: { task: Task; title: ReactNode; children: ReactNode }) {
  const { actions } = useViewData();
  const meaning = useOptions().meaning('task.status', task.data.status);
  return (
    <tr
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('button, a, select'))
          actions.open({ entity: task.id });
      }}
      className="cursor-pointer border-b border-line-soft last:border-0 hover:bg-neutral-50 dark:hover:bg-neutral-800/40"
    >
      <td className="px-4 py-2">
        <span className="flex items-center gap-2">
          <TaskCheck task={task} />
          <span
            className={clsx(
              meaning === 'cancelled' && 'text-faint line-through',
              meaning === 'done' && 'text-faint',
            )}
          >
            {title}
          </span>
        </span>
        {/* Its papers (R7.12): small links that open in the board's FileView or the drawer. */}
        <LinkedFiles ids={task.data.fileIds} className="mt-1 pl-7" />
      </td>
      {children}
    </tr>
  );
}

export function TaskChecklist({ node }: { node: NodeOf<'TaskChecklist'> }) {
  const data = useViewData();
  const { setStatus } = useTaskActions();
  const create = useCreate();
  const options = useOptions();
  const meaning = (t: Task) => options.meaning('task.status', t.data.status);
  const [showDone, setShowDone] = useState(false);
  const readOnly = useInDocument();
  const hideDone = node.hideDone ?? true;
  let tasks = runQuery(data, 'task', node.filter);
  if (node.assigneeKind) {
    tasks = tasks.filter(
      (t) => data.assigneeById.get(t.data.assigneeId ?? '')?.data.kind === node.assigneeKind,
    );
  }
  const finished = tasks.filter((t) => meaning(t) === 'done' || meaning(t) === 'cancelled');
  const visible = hideDone && !showDone ? tasks.filter((t) => !finished.includes(t)) : tasks;

  // New tasks go to the first assignee of the kind this list shows, so they appear in it.
  const assignee = node.assigneeKind
    ? data.assignees.find((a) => a.data.kind === node.assigneeKind)
    : undefined;
  const addTask = (variant?: 'button') => (
    <QuickAdd
      label={assignee ? `Add task for ${assignee.data.name}` : 'Add task'}
      variant={variant}
      onAdd={(title) =>
        create('task', {
          ...defaultsFrom(node.filter?.where, data.project.data.currentStageId),
          ...(assignee ? { assigneeId: assignee.id } : {}),
          title,
        })
      }
    />
  );
  if (!tasks.length) {
    return (
      <EmptyState
        icon={ListChecks}
        title={
          node.assigneeKind === 'human'
            ? 'Nothing is assigned to people right now'
            : data.tasks.length
              ? 'No tasks match this list'
              : 'No tasks yet'
        }
        hint={
          node.assigneeKind === 'human'
            ? 'Tasks for you show up here when you or an agent assign one.'
            : 'Add the first one, or ask your agent to plan the work.'
        }
      >
        {addTask('button')}
      </EmptyState>
    );
  }
  return (
    <div className="space-y-2">
      {visible.length === 0 && (
        <EmptyState
          icon={CircleCheck}
          title="All done"
          hint="Every task in this list is finished."
        />
      )}
      <ul className="-mx-2 space-y-0.5">
        {visible.map((task) => (
          <li key={task.id}>
            <Clickable
              id={task.id}
              className="flex items-center gap-2.5 rounded-control px-2 py-1.5 hover:bg-sunken"
            >
              <TaskCheck task={task} answer />
              <span
                className={clsx(
                  'min-w-0 flex-1 truncate text-sm',
                  meaning(task) === 'done' && 'text-faint line-through',
                )}
              >
                {task.data.title}
              </span>
              {task.data.stageId && (
                <EntityRef id={task.data.stageId} className="hidden sm:inline-flex" />
              )}
              {options.meaning('task.priority', task.data.priority) !== 'medium' && (
                <OptionBadge field="task.priority" value={task.data.priority} />
              )}
              <AssigneeLabel id={task.data.assigneeId} />
              {meaning(task) === 'todo' && !readOnly ? (
                <button
                  type="button"
                  onClick={() => void setStatus(task, 'in_progress')}
                  className="inline-flex items-center gap-1 rounded-control border border-line-strong px-2 py-0.5 text-xs text-ink-soft hover:border-sky-300 hover:text-accent-strong"
                >
                  <Play className="size-3" /> Start
                </button>
              ) : meaning(task) !== 'done' ? (
                <>
                  {!(readOnly && meaning(task) === 'todo') && (
                    <OptionBadge field="task.status" value={task.data.status} />
                  )}
                  {/* In a report the tick is the reader's answer: say so in words too (R15). */}
                  {readOnly && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void setStatus(task, 'done');
                      }}
                      className="inline-flex shrink-0 items-center gap-1 rounded-control border border-line-strong px-2 py-0.5 text-xs text-ink-soft hover:border-emerald-500 hover:text-emerald-600"
                    >
                      <Check aria-hidden className="size-3" strokeWidth={3} /> Mark done
                      <span className="sr-only">: {task.data.title}</span>
                    </button>
                  )}
                </>
              ) : null}
            </Clickable>
          </li>
        ))}
      </ul>
      <div className="-mx-2">{addTask()}</div>
      {hideDone && finished.length > 0 && (
        <button
          type="button"
          onClick={() => setShowDone((v) => !v)}
          className="text-xs text-muted hover:underline"
        >
          {showDone ? 'Hide finished' : `Show ${finished.length} finished`}
        </button>
      )}
    </div>
  );
}

const NODE_W = 200;
const NODE_H = 56;
const GAP_X = 56;
const GAP_Y = 16;

function GraphNode({ task, x, y }: { task: Task; x: number; y: number }) {
  const { handlers, card } = useGlance(task.id);
  const done = useOptions().meaning('task.status', task.data.status) === 'done';
  return (
    <div
      {...handlers}
      className="absolute"
      style={{ left: x, top: y, width: NODE_W, height: NODE_H }}
    >
      <Clickable
        id={task.id}
        className="flex h-full items-center gap-2 rounded-tile border border-line-strong bg-surface px-3 transition hover:border-sky-300 hover:shadow-sm dark:hover:border-sky-800"
      >
        <OptionDot field="task.status" value={task.data.status} />
        <span className={clsx('line-clamp-2 text-xs font-medium', done && 'text-faint')}>
          {task.data.title}
        </span>
      </Clickable>
      {card}
    </div>
  );
}

export function DependencyGraph({ node }: { node: NodeOf<'DependencyGraph'> }) {
  const data = useViewData();
  const tasks = runQuery(data, 'task', node.filter);
  const layout = useMemo(() => {
    const ids = new Set(tasks.map((t) => t.id));
    const depth = new Map<string, number>();
    const depthOf = (task: Task, seen = new Set<string>()): number => {
      const known = depth.get(task.id);
      if (known !== undefined) return known;
      if (seen.has(task.id)) return 0;
      seen.add(task.id);
      const deps = task.data.dependsOn
        .filter((d) => ids.has(d))
        .map((d) => depthOf(data.taskById.get(d)!, seen));
      const value = deps.length ? Math.max(...deps) + 1 : 0;
      depth.set(task.id, value);
      return value;
    };
    const columns: Task[][] = [];
    for (const task of tasks) (columns[depthOf(task)] ??= []).push(task);
    const position = new Map<string, { x: number; y: number }>();
    columns.forEach((column, col) =>
      column.forEach((task, row) =>
        position.set(task.id, { x: col * (NODE_W + GAP_X), y: row * (NODE_H + GAP_Y) }),
      ),
    );
    const edges = tasks.flatMap((task) =>
      task.data.dependsOn
        .filter((d) => ids.has(d))
        .map((d) => ({
          from: position.get(d)!,
          to: position.get(task.id)!,
          key: `${d}-${task.id}`,
        })),
    );
    const width = columns.length * (NODE_W + GAP_X) - GAP_X;
    const height = Math.max(...columns.map((c) => c.length)) * (NODE_H + GAP_Y) - GAP_Y;
    return { position, edges, width, height, linked: edges.length > 0 };
  }, [tasks, data.taskById]);

  if (!tasks.length)
    return (
      <EmptyState
        icon={GitBranch}
        title={data.tasks.length ? 'No tasks match this list' : 'No tasks yet'}
        hint="The graph draws tasks and what each one waits for, once there are tasks."
      >
        <AskAgentButton question="Plan the tasks for this work, with what each one depends on." />
      </EmptyState>
    );
  if (!layout.linked)
    return (
      <EmptyState
        icon={GitBranch}
        title="No dependencies between these tasks"
        hint="Open a task and set what it depends on, or ask your agent to order the work."
      >
        <AskAgentButton question="Which of these tasks depend on each other? Set their dependencies." />
      </EmptyState>
    );
  return (
    <div className="overflow-auto">
      <div className="relative" style={{ width: layout.width, height: layout.height }}>
        <svg
          className="absolute inset-0 overflow-visible"
          width={layout.width}
          height={layout.height}
        >
          {layout.edges.map(({ from, to, key }) => {
            const x1 = from.x + NODE_W;
            const y1 = from.y + NODE_H / 2;
            const x2 = to.x;
            const y2 = to.y + NODE_H / 2;
            const mid = (x1 + x2) / 2;
            return (
              <path
                key={key}
                d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2 - 4},${y2}`}
                fill="none"
                strokeWidth={1.5}
                markerEnd="url(#arrow)"
                className="stroke-neutral-300 dark:stroke-neutral-600"
              />
            );
          })}
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto"
            >
              <path d="M0,0 L10,5 L0,10 z" className="fill-neutral-400" />
            </marker>
          </defs>
        </svg>
        {tasks.map((task) => {
          const { x, y } = layout.position.get(task.id)!;
          return <GraphNode key={task.id} task={task} x={x} y={y} />;
        })}
      </div>
    </div>
  );
}

export function AssigneeMatrix({ node }: { node: NodeOf<'AssigneeMatrix'> }) {
  const data = useViewData();
  const options = useOptions();
  const tasks = runQuery(data, 'task', node.filter);
  if (!tasks.length)
    return (
      <EmptyState
        icon={Users}
        title={data.tasks.length ? 'No tasks match this list' : 'No tasks yet'}
        hint="Who does what shows up here once tasks are assigned."
      >
        <AskAgentButton question="Plan the tasks for this work and who should do each one." />
      </EmptyState>
    );
  const statuses = options
    .list('task.status')
    .filter((o) => o.meaning !== 'cancelled' || tasks.some((t) => t.data.status === o.value));
  const rows = [
    ...data.assignees.map((a) => ({ key: a.id, label: a.data.name, kind: a.data.kind })),
    { key: '', label: 'Unassigned', kind: null },
  ]
    .map((row) => ({ ...row, tasks: tasks.filter((t) => (t.data.assigneeId ?? '') === row.key) }))
    .filter((row) => row.tasks.length);
  return (
    <ScrollX label="Tasks by assignee" className="-mx-4 -my-4">
      <table className="w-full text-sm">
        <thead className="text-xs text-muted">
          <tr className="border-b border-line-soft">
            <th className="px-4 py-2 text-left font-medium">Assignee</th>
            {statuses.map((s) => (
              <th key={s.value} className="px-3 py-2 text-right font-medium whitespace-nowrap">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-line-soft last:border-0">
              <td className="px-4 py-2">
                <span className="inline-flex items-center gap-1.5">
                  {row.kind === 'agent' ? (
                    <Bot className="size-4 text-violet-500" />
                  ) : row.kind === 'human' ? (
                    <User className="size-4 text-sky-500" />
                  ) : null}
                  {row.label}
                </span>
              </td>
              {statuses.map(({ value: s }) => {
                const matching = row.tasks.filter((t) => t.data.status === s);
                return (
                  <td
                    key={s}
                    title={matching.map((t) => t.data.title).join('\n')}
                    className={clsx(
                      'px-3 py-2 text-right tabular-nums',
                      matching.length ? 'font-medium' : 'text-faint',
                    )}
                  >
                    {matching.length}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollX>
  );
}
