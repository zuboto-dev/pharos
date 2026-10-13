import { runQuery, type EntityDiff, type NodeOf, type RevisionSummary } from '@pharos/schema';
import { Bot, Cog, File, FileText, Link2, Package, Palette, User } from 'lucide-react';
import { useResource } from '../../lib/api';
import { formatDate, localToday, plural, timeAgo } from '../../lib/format';
import { useViewData } from '../context';
import { Clickable, EntityRef } from '../interactive';
import { LinkedFiles } from '../linked-files';
import { defaultsFrom, QuickAdd, useCreate } from '../quickadd';
import { OptionBadge, useOptions } from '../options';
import { Empty, Uri } from '../ui';

const ARTIFACT_ICONS = { file: File, link: Link2, doc: FileText, design: Palette, other: Package };

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
            className="flex min-w-0 flex-col gap-2 rounded-tile border border-line p-3 transition hover:border-neutral-300 hover:shadow-sm dark:hover:border-neutral-700"
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
              <p className="line-clamp-2 text-xs text-muted">{artifact.data.description}</p>
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
      <div className="flex items-center rounded-tile border border-dashed border-line p-1">
        {addArtifact}
      </div>
    </div>
  );
}

/**
 * Markdown as one line of plain text, for a short excerpt: keeps the words of links, emphasis and
 * code, drops the marks, headings, list bullets, quotes, images and HTML.
 */
export function plainExcerpt(markdown: string): string {
  return markdown
    .replace(/```[^\n]*\n?/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    .replace(/^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d+[.)][ \t]+)/gm, '')
    .replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, ' ')
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/(?<![\p{L}\p{N}])(\*|_)(?=\S)([\s\S]*?\S)\1(?![\p{L}\p{N}])/gu, '$2')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1')
    .replace(/`+([^`]*)`+/g, '$1')
    .replace(/\\([\\`*_{}[\]()#+\-.!~>|])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
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
        const excerpt = decision.data.body ? plainExcerpt(decision.data.body) : '';
        return (
          <li key={decision.id}>
            <Clickable
              id={decision.id}
              className="flex items-start justify-between gap-3 rounded-control px-2 py-2 hover:bg-sunken"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium">{decision.data.title}</span>
                {excerpt && <span className="line-clamp-1 text-xs text-muted">{excerpt}</span>}
                <LinkedFiles ids={decision.data.fileIds} className="mt-1" />
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-right text-xs text-neutral-400">
                  {decider && <span className="text-ink-soft">{decider} · </span>}
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
                className="flex w-full gap-3 rounded-control px-2 py-1.5 text-left hover:bg-sunken"
              >
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-subtle">
                  <Icon className="size-3.5 text-muted" />
                </span>
                <span className="min-w-0 text-sm">
                  <span className="block text-ink">{rev.message}</span>
                  <span className="block text-xs text-muted">
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
        className="mt-2 text-xs text-accent hover:underline"
      >
        All changes
      </button>
    </div>
  );
}
