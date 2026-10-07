import { runQuery, type EntityDiff, type NodeOf, type RevisionSummary } from '@pharos/schema';
import {
  Bot,
  Cog,
  ExternalLink,
  File,
  FileText,
  Link2,
  Package,
  Palette,
  User,
} from 'lucide-react';
import { useResource } from '../../lib/api';
import { formatDate, localToday, plural, timeAgo } from '../../lib/format';
import { useViewData } from '../context';
import { Clickable, EntityRef } from '../interactive';
import { defaultsFrom, QuickAdd, useCreate } from '../quickadd';
import { OptionBadge, useOptions } from '../options';
import { Empty } from '../ui';

const ARTIFACT_ICONS = { file: File, link: Link2, doc: FileText, design: Palette, other: Package };

function Uri({ uri }: { uri: string }) {
  if (/^https?:\/\//.test(uri)) {
    return (
      <a
        href={uri}
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-w-0 items-center gap-1 text-xs text-sky-600 hover:underline dark:text-sky-400"
      >
        <span className="truncate">{uri.replace(/^https?:\/\//, '')}</span>
        <ExternalLink className="size-3 shrink-0" />
      </a>
    );
  }
  return <code className="truncate text-xs text-neutral-500">{uri}</code>;
}

export function ArtifactGallery({ node }: { node: NodeOf<'ArtifactGallery'> }) {
  const data = useViewData();
  const options = useOptions();
  const artifacts = runQuery(data, 'artifact', node.filter);
  const create = useCreate();
  const addArtifact = (
    <QuickAdd
      label="Add artifact"
      onAdd={(title) =>
        create('artifact', {
          ...defaultsFrom(node.filter?.where, data.project.data.currentStageId),
          title,
        })
      }
    />
  );
  if (!artifacts.length) {
    return (
      <>
        <Empty>No artifacts yet</Empty>
        {addArtifact}
      </>
    );
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {artifacts.map((artifact) => {
        const Icon =
          ARTIFACT_ICONS[
            options.meaning('artifact.kind', artifact.data.kind) as keyof typeof ARTIFACT_ICONS
          ] ?? Package;
        const { stageId, taskId } = artifact.data;
        return (
          <Clickable
            key={artifact.id}
            id={artifact.id}
            className="flex min-w-0 flex-col gap-2 rounded-lg border border-neutral-200 p-3 transition hover:border-neutral-300 hover:shadow-sm dark:border-neutral-800 dark:hover:border-neutral-700"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <Icon className="size-4 shrink-0 text-neutral-400" />
                <span className="truncate text-sm font-medium" title={artifact.data.title}>
                  {artifact.data.title}
                </span>
              </div>
              <OptionBadge field="artifact.status" value={artifact.data.status} />
            </div>
            {artifact.data.description && (
              <p className="line-clamp-2 text-xs text-neutral-500 dark:text-neutral-400">
                {artifact.data.description}
              </p>
            )}
            {artifact.data.uri && <Uri uri={artifact.data.uri} />}
            {(stageId || taskId) && (
              <div className="flex flex-wrap gap-1">
                {stageId && <EntityRef id={stageId} />}
                {taskId && <EntityRef id={taskId} />}
              </div>
            )}
          </Clickable>
        );
      })}
      <div className="flex items-center rounded-lg border border-dashed border-neutral-200 p-1 dark:border-neutral-800">
        {addArtifact}
      </div>
    </div>
  );
}

export function DecisionLog({ node }: { node: NodeOf<'DecisionLog'> }) {
  const data = useViewData();
  const create = useCreate();
  const addDecision = (
    <QuickAdd
      label="Record a decision"
      onAdd={(title) => create('decision', { title, decisionDate: localToday() })}
    />
  );
  // Newest first unless the view asks for a specific order.
  const { limit, ...filter } = node.filter ?? {};
  let decisions = runQuery(data, 'decision', filter);
  if (!filter.sort) decisions = [...decisions].sort((a, b) => b.createdRev - a.createdRev);
  decisions = decisions.slice(0, limit);
  if (!decisions.length) {
    return (
      <>
        <Empty>No decisions recorded yet</Empty>
        {addDecision}
      </>
    );
  }
  return (
    <ul className="-mx-2 space-y-0.5">
      {decisions.map((decision) => {
        const decidedBy = decision.data.decidedById
          ? data.assigneeById.get(decision.data.decidedById)
          : undefined;
        const decider = decidedBy?.data.name;
        return (
          <li key={decision.id}>
            <Clickable
              id={decision.id}
              className="flex items-start justify-between gap-3 rounded-md px-2 py-2 hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium">{decision.data.title}</span>
                {decision.data.body && (
                  <span className="line-clamp-1 text-xs text-neutral-500 dark:text-neutral-400">
                    {decision.data.body}
                  </span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-right text-xs text-neutral-400">
                  {decider && (
                    <span className="text-neutral-600 dark:text-neutral-300">{decider} · </span>
                  )}
                  {formatDate(decision.data.decisionDate ?? decision.createdAt.slice(0, 10), true)}
                </span>
                <OptionBadge field="decision.status" value={decision.data.status} />
              </span>
            </Clickable>
          </li>
        );
      })}
      <li>{addDecision}</li>
    </ul>
  );
}

const AUTHOR_ICONS = { human: User, agent: Bot, system: Cog };

function summarize(changes: EntityDiff[]): string {
  const counts = { create: 0, update: 0, delete: 0 };
  for (const c of changes) counts[c.op]++;
  return [
    counts.create && `${counts.create} added`,
    counts.update && `${counts.update} updated`,
    counts.delete && `${counts.delete} removed`,
  ]
    .filter(Boolean)
    .join(', ');
}

export function ActivityFeed({ node }: { node: NodeOf<'ActivityFeed'> }) {
  const { project, version, actions } = useViewData();
  const history = useResource<RevisionSummary[]>(
    `/api/history?projectId=${project.id}&limit=${node.limit ?? 10}&v=${version}`,
  );
  if (history.status === 'loading') return <Empty>Loading…</Empty>;
  if (!history.data) return <Empty>Couldn’t load activity</Empty>;
  if (!history.data.length) return <Empty>No activity yet</Empty>;
  return (
    <div>
      <ol className="-mx-2 space-y-0.5">
        {history.data.map((rev) => {
          const Icon = AUTHOR_ICONS[rev.author.kind];
          const labels = rev.changes
            .filter((c) => c.type !== 'view' && c.label)
            .slice(0, 3)
            .map((c) => c.label);
          return (
            <li key={rev.id}>
              <button
                type="button"
                onClick={() => actions.open({ revision: rev.id })}
                className="flex w-full gap-3 rounded-md px-2 py-1.5 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800/60"
              >
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800">
                  <Icon className="size-3.5 text-neutral-500" />
                </span>
                <span className="min-w-0 text-sm">
                  <span className="block text-neutral-800 dark:text-neutral-200">
                    {rev.message}
                  </span>
                  <span className="block text-xs text-neutral-500 dark:text-neutral-400">
                    {rev.author.name} · {timeAgo(rev.createdAt)} ·{' '}
                    {summarize(rev.changes) || plural(0, 'change')}
                    {rev.revertOf && ` · reverts #${rev.revertOf}`}
                  </span>
                  {labels.length > 0 && (
                    <span className="block truncate text-xs text-neutral-400">
                      {labels.join(' · ')}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        onClick={() => actions.open({ history: true })}
        className="mt-2 text-xs text-sky-600 hover:underline dark:text-sky-400"
      >
        All changes
      </button>
    </div>
  );
}
