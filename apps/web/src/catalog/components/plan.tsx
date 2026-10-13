import {
  runQuery,
  stageProgress,
  type Entity,
  type NodeOf,
  type StageProgress,
} from '@pharos/schema';
import clsx from 'clsx';
import { CalendarRange, Check, Milestone, TriangleAlert } from 'lucide-react';
import { AskAgentButton, EmptyState } from '../empty-state';
import { useState } from 'react';
import { formatDate } from '../../lib/format';
import { useViewData } from '../context';
import { Clickable, useGlance } from '../interactive';
import { QuickAdd, useCreate } from '../quickadd';
import { timelineTicks, toDay } from '../timeline';
import { OptionBadge, useOptions } from '../options';
import { Badge, DOT_TONES, ProgressBar } from '../ui';

function dateRange(stage: Entity<'stage'>): string | null {
  const { startDate, targetDate } = stage.data;
  if (startDate && targetDate)
    return `${formatDate(startDate, true)} – ${formatDate(targetDate, true)}`;
  if (targetDate) return `Due ${formatDate(targetDate, true)}`;
  if (startDate) return `From ${formatDate(startDate, true)}`;
  return null;
}

/**
 * Presents a stage's progress the same way everywhere:
 * done → full green bar; skipped → no bar; no tasks → no bar; otherwise the task ratio.
 */
function StageProgressLine({ progress, current }: { progress: StageProgress; current: boolean }) {
  const { basis, done, total, open, percent } = progress;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span>
          {basis === 'done'
            ? 'Done'
            : basis === 'skipped'
              ? 'Skipped'
              : basis === 'empty'
                ? 'No tasks yet'
                : `${done} of ${total} tasks done`}
        </span>
        {basis === 'done' && open > 0 && (
          <span
            className="inline-flex items-center gap-1 text-warn"
            title="Stage is done but has open tasks"
          >
            <TriangleAlert className="size-3" /> {open} open
          </span>
        )}
        {basis === 'tasks' && <span className="tabular-nums">{percent}%</span>}
      </div>
      {(basis === 'done' || basis === 'tasks') && (
        <ProgressBar
          value={percent}
          tone={basis === 'done' ? 'green' : current ? 'blue' : 'neutral'}
        />
      )}
    </div>
  );
}

export function StageTracker({ node }: { node: NodeOf<'StageTracker'> }) {
  const data = useViewData();
  const { tasks, project } = data;
  const stages = runQuery(data, 'stage', node.filter);
  const create = useCreate();
  const addStage = (variant?: 'button') => (
    <QuickAdd label="Add stage" variant={variant} onAdd={(name) => create('stage', { name })} />
  );
  const options = useOptions();
  if (!stages.length) {
    return (
      <EmptyState
        icon={Milestone}
        title={data.stages.length ? 'No stages match this list' : 'No stages yet'}
        hint="Split the work into stages (phases or milestones) to see where it stands."
      >
        {addStage('button')}
      </EmptyState>
    );
  }
  return (
    <ol className="flex gap-2 overflow-x-auto pb-1">
      {stages.map((stage, i) => {
        const progress = stageProgress(stage, tasks, project);
        const current = stage.id === project.data.currentStageId;
        const status = options.meaning('stage.status', stage.data.status);
        const finished = status === 'done';
        return (
          <li key={stage.id} className="min-w-44 flex-1">
            <Clickable
              id={stage.id}
              className={clsx(
                'h-full space-y-2 rounded-tile border p-3 transition hover:shadow-sm',
                current
                  ? 'border-sky-300 bg-sky-50/60 ring-1 ring-sky-300 dark:border-sky-800 dark:bg-sky-950/40 dark:ring-sky-800'
                  : 'border-line hover:border-neutral-300 dark:hover:border-neutral-700',
                status === 'skipped' && 'opacity-50',
              )}
            >
              <div className="flex items-start gap-2">
                <span
                  className={clsx(
                    'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                    finished
                      ? 'bg-emerald-500 text-white'
                      : current
                        ? 'bg-sky-700 text-white dark:bg-sky-400 dark:text-sky-950'
                        : 'bg-subtle text-ink-soft',
                  )}
                >
                  {finished ? <Check className="size-3.5" /> : i + 1}
                </span>
                <span
                  className="line-clamp-2 min-w-0 pt-0.5 text-sm leading-5 font-medium break-words"
                  title={stage.data.name}
                >
                  {stage.data.name}
                </span>
                {current && (
                  <span className="ml-auto shrink-0 text-xs leading-6 font-medium text-accent">
                    Current
                  </span>
                )}
              </div>
              <StageProgressLine progress={progress} current={current} />
              {dateRange(stage) && <div className="text-xs text-faint">{dateRange(stage)}</div>}
            </Clickable>
          </li>
        );
      })}
      <li className="flex min-w-36 items-center">{addStage()}</li>
    </ol>
  );
}

export function Timeline({ node }: { node: NodeOf<'Timeline'> }) {
  const data = useViewData();
  const [now] = useState(() => Date.now());
  const stages = runQuery(data, 'stage', node.filter);
  const dated = stages.filter((s) => s.data.startDate || s.data.targetDate);
  const undated = stages.filter((s) => !s.data.startDate && !s.data.targetDate);
  if (!stages.length)
    return (
      <EmptyState
        icon={CalendarRange}
        title={data.stages.length ? 'No stages match this list' : 'No stages yet'}
        hint="Stages with dates show up here on a timeline."
      >
        <AskAgentButton question="Plan the stages of this project, with start and target dates." />
      </EmptyState>
    );
  if (!dated.length)
    return (
      <EmptyState
        icon={CalendarRange}
        title="No dates yet"
        hint="Add start or target dates to stages to see them on a timeline."
      >
        <AskAgentButton question="Add start and target dates to the stages of this project." />
      </EmptyState>
    );

  const days = dated.flatMap((s) =>
    [s.data.startDate, s.data.targetDate].filter(Boolean).map((d) => toDay(d!)),
  );
  const today = Math.floor(now / 86400000);
  const min = Math.min(...days, today) - 2;
  const max = Math.max(...days, today) + 2;
  const pos = (day: number) => ((day - min) / (max - min)) * 100;
  const ticks = timelineTicks(min, max);
  const rows = dated.length;

  // Gantt layout: stage names on the left, bars on a shared time track on the right.
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[minmax(5rem,9rem)_1fr] items-center gap-x-3 gap-y-1.5">
        <div
          aria-hidden
          className="relative h-full"
          style={{ gridColumn: 2, gridRow: `1 / span ${rows}` }}
        >
          {ticks.map((t) => (
            <div
              key={t.day}
              className="absolute inset-y-0 w-px bg-subtle"
              style={{ left: `${pos(t.day)}%` }}
            />
          ))}
          <div
            className="absolute inset-y-0 z-10 w-px bg-rose-400"
            style={{ left: `${pos(today)}%` }}
          />
        </div>
        {dated.map((stage, i) => (
          <TimelineRow
            key={stage.id}
            stage={stage}
            row={i + 1}
            pos={pos}
            current={stage.id === data.project.data.currentStageId}
          />
        ))}
        <div
          className="relative h-5 text-xs text-faint"
          style={{ gridColumn: 2, gridRow: rows + 1 }}
        >
          {/* Labels too close to "Today" are hidden so they don't overlap it. */}
          {ticks
            .filter((t) => Math.abs(pos(t.day) - pos(today)) > 7)
            .map((t) => (
              <span
                key={t.day}
                className="absolute -translate-x-1/2 whitespace-nowrap"
                style={{ left: `${pos(t.day)}%` }}
              >
                {t.label}
              </span>
            ))}
          <span
            className="absolute -translate-x-1/2 font-medium text-danger"
            style={{ left: `${pos(today)}%` }}
          >
            Today
          </span>
        </div>
      </div>
      {undated.length > 0 && (
        <p className="text-xs text-muted">
          Not scheduled: {undated.map((s) => s.data.name).join(', ')}
        </p>
      )}
    </div>
  );
}

function TimelineRow({
  stage,
  row,
  pos,
  current,
}: {
  stage: Entity<'stage'>;
  row: number;
  pos: (day: number) => number;
  current: boolean;
}) {
  const { handlers, card } = useGlance(stage.id);
  const options = useOptions();
  const start = stage.data.startDate ? toDay(stage.data.startDate) : undefined;
  const end = stage.data.targetDate ? toDay(stage.data.targetDate) : undefined;
  const tone = DOT_TONES[current ? 'blue' : options.get('stage.status', stage.data.status).color];
  const range = start !== undefined && end !== undefined;
  return (
    <>
      <div className="min-w-0" style={{ gridColumn: 1, gridRow: row }}>
        <Clickable
          id={stage.id}
          className={clsx('truncate text-sm hover:underline', current && 'font-medium')}
          title={stage.data.name}
        >
          {stage.data.name}
        </Clickable>
      </div>
      <div className="relative z-20 h-6" style={{ gridColumn: 2, gridRow: row }}>
        <div
          {...handlers}
          className="absolute inset-y-0"
          style={
            range
              ? { left: `${pos(start)}%`, width: `max(${pos(end + 1) - pos(start)}%, 0.5rem)` }
              : { left: `calc(${pos((start ?? end)!)}% - 0.5rem)`, width: '1rem' }
          }
        >
          <Clickable
            id={stage.id}
            className={
              range
                ? clsx('h-full rounded-control hover:brightness-110', tone)
                : 'flex h-full items-center justify-center'
            }
          >
            {!range && <span className={clsx('size-3 rotate-45', tone)} />}
          </Clickable>
        </div>
        {card}
      </div>
    </>
  );
}

export function MilestoneList({ node }: { node: NodeOf<'MilestoneList'> }) {
  const data = useViewData();
  const options = useOptions();
  const stages = runQuery(data, 'stage', node.filter);
  const create = useCreate();
  const addStage = (variant?: 'button') => (
    <QuickAdd label="Add stage" variant={variant} onAdd={(name) => create('stage', { name })} />
  );
  if (!stages.length) {
    return (
      <EmptyState
        icon={Milestone}
        title={data.stages.length ? 'No stages match this list' : 'No stages yet'}
        hint="Split the work into stages (phases or milestones) to see where it stands."
      >
        {addStage('button')}
      </EmptyState>
    );
  }
  return (
    <ol className="relative space-y-2 border-l border-line pl-4">
      {stages.map((stage) => {
        const progress = stageProgress(stage, data.tasks, data.project);
        const current = stage.id === data.project.data.currentStageId;
        return (
          <li key={stage.id} className="relative">
            <span
              className={clsx(
                'absolute top-3 -left-[1.36rem] size-2.5 rounded-full ring-4 ring-white dark:ring-neutral-900',
                DOT_TONES[current ? 'blue' : options.get('stage.status', stage.data.status).color],
              )}
            />
            <Clickable
              id={stage.id}
              className="space-y-1 rounded-control px-2 py-1.5 hover:bg-sunken"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{stage.data.name}</span>
                {current ? (
                  <Badge tone="blue">Current</Badge>
                ) : (
                  <OptionBadge field="stage.status" value={stage.data.status} />
                )}
                {dateRange(stage) && <span className="text-xs text-faint">{dateRange(stage)}</span>}
              </div>
              {stage.data.description && (
                <p className="text-sm text-muted">{stage.data.description}</p>
              )}
              <div className="max-w-64">
                <StageProgressLine progress={progress} current={current} />
              </div>
            </Clickable>
          </li>
        );
      })}
      <li className="-ml-2">{addStage()}</li>
    </ol>
  );
}
