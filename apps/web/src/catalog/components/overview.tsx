import { runQuery, taskProgress, type NodeOf } from '@pharos/schema';
import clsx from 'clsx';
import { FolderGit2, Info, CircleCheck, TriangleAlert, OctagonAlert, Flag } from 'lucide-react';
import { useViewData } from '../context';
import { EntityRef } from '../interactive';
import { useMarkdownTerms } from '../terms';
import { Empty, Markdown, ProgressBar, StatusBadge, type Tone } from '../ui';

export function ProjectHeader() {
  const { project, repository, tasks, stageById } = useViewData();
  const stage = project.data.currentStageId
    ? stageById.get(project.data.currentStageId)
    : undefined;
  const { percent: progress, done, total } = taskProgress(tasks, project);
  return (
    <header className="flex flex-col gap-4 rounded-xl border border-neutral-200 bg-white p-5 md:flex-row md:items-end md:justify-between dark:border-neutral-800 dark:bg-neutral-900">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{project.data.name}</h1>
          <StatusBadge value={project.data.status} />
        </div>
        {project.data.summary && (
          <p className="text-neutral-600 dark:text-neutral-400">{project.data.summary}</p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-neutral-500 dark:text-neutral-400">
          {repository && (
            <span
              className="inline-flex items-center gap-1.5"
              title={repository.data.path ?? repository.data.url}
            >
              <FolderGit2 className="size-4" /> {repository.data.name}
            </span>
          )}
          {stage && (
            <span className="inline-flex items-center gap-1.5">
              <Flag className="size-4" /> <EntityRef id={stage.id} />
            </span>
          )}
        </div>
      </div>
      <div className="w-full shrink-0 space-y-1.5 md:w-56">
        <div className="flex justify-between text-sm">
          <span className="text-neutral-500 dark:text-neutral-400">Progress</span>
          <span className="font-medium tabular-nums">
            {progress}%{' '}
            <span className="font-normal text-neutral-400">
              ({done}/{total} tasks)
            </span>
          </span>
        </div>
        <ProgressBar value={progress} />
      </div>
    </header>
  );
}

const STAT_COLS: Record<number, string> = {
  1: 'sm:grid-cols-1',
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-3',
  4: 'sm:grid-cols-4',
};

const STAT_TONES: Record<string, string> = {
  neutral: 'text-neutral-900 dark:text-neutral-100',
  good: 'text-emerald-600 dark:text-emerald-400',
  warning: 'text-amber-600 dark:text-amber-400',
  bad: 'text-rose-600 dark:text-rose-400',
};

export function StatCards({ node }: { node: NodeOf<'StatCards'> }) {
  const data = useViewData();
  return (
    <div className={clsx('grid grid-cols-2 gap-3', STAT_COLS[Math.min(node.stats.length, 4)])}>
      {node.stats.map((stat, i) => {
        const count = stat.query ? runQuery(data, stat.query.type, stat.query).length : undefined;
        const total = stat.of ? runQuery(data, stat.of.type, stat.of).length : undefined;
        const value = stat.value ?? count ?? '—';
        const zeroBad = stat.tone === 'bad' && count === 0;
        return (
          <div
            key={i}
            className="flex flex-col justify-between rounded-xl border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-800 dark:bg-neutral-900"
          >
            <div className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
              {stat.label}
            </div>
            <div
              className={clsx(
                'mt-1 text-2xl font-semibold tabular-nums',
                STAT_TONES[zeroBad ? 'neutral' : (stat.tone ?? 'neutral')],
              )}
            >
              {value}
              {total !== undefined && (
                <span className="text-base font-normal text-neutral-400"> / {total}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ProgressRing({ node }: { node: NodeOf<'ProgressRing'> }) {
  const data = useViewData();
  const { percent, done, total } = taskProgress(
    runQuery(data, 'task', { where: node.where }),
    data.project,
  );
  const r = 40;
  const c = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 100 100" className="size-24 shrink-0 -rotate-90">
        <circle
          cx="50"
          cy="50"
          r={r}
          strokeWidth="10"
          fill="none"
          className="stroke-neutral-100 dark:stroke-neutral-800"
        />
        <circle
          cx="50"
          cy="50"
          r={r}
          strokeWidth="10"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - percent / 100)}
          className="stroke-emerald-500 transition-all"
        />
        <text
          x="50"
          y="50"
          textAnchor="middle"
          dominantBaseline="central"
          transform="rotate(90 50 50)"
          className="fill-current text-xl font-semibold"
        >
          {percent}%
        </text>
      </svg>
      <div className="text-sm">
        {node.label && <div className="font-medium">{node.label}</div>}
        <div className="text-neutral-500 dark:text-neutral-400">
          {total ? `${done} of ${total} tasks done` : 'No tasks yet'}
        </div>
      </div>
    </div>
  );
}

const CALLOUTS: Record<string, { icon: typeof Info; className: string; tone: Tone }> = {
  info: {
    icon: Info,
    tone: 'blue',
    className:
      'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-100',
  },
  success: {
    icon: CircleCheck,
    tone: 'green',
    className:
      'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-100',
  },
  warning: {
    icon: TriangleAlert,
    tone: 'amber',
    className:
      'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-100',
  },
  danger: {
    icon: OctagonAlert,
    tone: 'red',
    className:
      'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-100',
  },
};

export function Callout({ node }: { node: NodeOf<'Callout'> }) {
  const { icon: Icon, className } = CALLOUTS[node.tone ?? 'info']!;
  const terms = useMarkdownTerms(node.terms);
  return (
    <div className={clsx('flex gap-3 rounded-xl border p-4', className)}>
      <Icon className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 space-y-1">
        {node.title && <div className="font-semibold">{node.title}</div>}
        <Markdown className="!text-current" {...terms}>
          {node.body}
        </Markdown>
      </div>
    </div>
  );
}

export function MarkdownBlock({ node }: { node: NodeOf<'Markdown'> }) {
  const { project } = useViewData();
  const terms = useMarkdownTerms(node.terms);
  const content = node.source === 'project.description' ? project.data.description : node.content;
  if (!content?.trim()) return <Empty>No description yet</Empty>;
  return <Markdown {...terms}>{content}</Markdown>;
}
