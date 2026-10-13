import type { ProjectDataset } from '@pharos/schema';
import { Check, Copy, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { Loading, SkeletonShape, SkeletonBlock, SkeletonRows } from '../catalog/skeleton';
import { BUTTON } from '../catalog/ui';

const MCP_COMMAND = 'claude mcp add --transport http pharos http://localhost:4300/mcp';

/**
 * True for a project with nothing planned yet: no goals, stages, tasks, or scope. A project that
 * keeps records (started from a pack, R8) isn't a plan to fill in, so it never is.
 */
export function isEmptyProject(data: ProjectDataset): boolean {
  if (data.project.data.recordTypes?.length) return false;
  return !data.goals.length && !data.stages.length && !data.tasks.length && !data.scopeItems.length;
}

function dismissKey(projectId: string) {
  return `pharos-onboarding-dismissed:${projectId}`;
}

function readDismissed(projectId: string): boolean {
  try {
    return localStorage.getItem(dismissKey(projectId)) === '1';
  } catch {
    return false;
  }
}

function CopyLine({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-2 rounded-tile bg-neutral-900 p-3 text-sm text-neutral-100 dark:bg-neutral-800">
      <code className="min-w-0 flex-1 break-words whitespace-pre-wrap">{text}</code>
      <button
        type="button"
        aria-label={`Copy ${label}`}
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => setCopied(true));
        }}
        className="shrink-0 rounded p-1 text-faint hover:bg-neutral-700 hover:text-white"
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}

/** Shown on a new, empty project: how to get it planned, by an agent or by hand. */
export function GetStarted({ projectId, name }: { projectId: string; name: string }) {
  const [dismissed, setDismissed] = useState(() => readDismissed(projectId));
  if (dismissed) return null;
  const prompt = `Set up the "${name}" project in Pharos from my notes (or this repo's docs): write its description, then add goals, scope, stages with dates, and tasks.`;
  return (
    <section
      aria-label="Get started"
      className="relative space-y-4 rounded-block border border-sky-200 bg-sky-50/60 p-5 dark:border-sky-900 dark:bg-sky-950/30"
    >
      <button
        type="button"
        aria-label="Hide getting started"
        onClick={() => {
          try {
            localStorage.setItem(dismissKey(projectId), '1');
          } catch {
            // Hidden for this visit only.
          }
          setDismissed(true);
        }}
        className="absolute top-3 right-3 rounded p-1 text-faint hover:bg-white hover:text-ink-soft dark:hover:bg-neutral-800"
      >
        <X className="size-4" />
      </button>
      <div className="space-y-1 pr-8">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Sparkles className="size-4 text-sky-500" /> Get {name} planned
        </h2>
        <p className="text-sm text-muted">
          This project is empty. Your agent can plan it in one go, and the views below fill in as it
          works.
        </p>
      </div>
      <ol className="space-y-3 text-sm">
        <li className="space-y-1.5">
          <div className="font-medium">1. Connect your agent (once)</div>
          <CopyLine label="MCP command" text={MCP_COMMAND} />
        </li>
        <li className="space-y-1.5">
          <div className="font-medium">2. Ask it to plan the project</div>
          <CopyLine label="prompt" text={prompt} />
        </li>
      </ol>
      <p className="text-sm text-muted">
        Prefer to do it yourself? Use <strong>Add</strong> in the widgets below to add stages,
        tasks, and goals.
      </p>
    </section>
  );
}

/** Placeholder while a project loads: the tab row and a board of block-shaped placeholders. */
export function ProjectSkeleton({ files = false }: { files?: boolean } = {}) {
  return (
    <Loading
      label={files ? 'Loading files' : 'Loading project'}
      className="mx-auto max-w-7xl space-y-5 p-4 md:p-8"
    >
      <div className="flex items-end gap-4 border-b border-line pb-2.5">
        <SkeletonShape className="h-4 w-20" />
        <SkeletonShape className="h-4 w-14" />
        <SkeletonShape className="hidden h-4 w-16 sm:block" />
        <span className="flex-1" />
        <SkeletonShape className="size-7 rounded-control" />
        <SkeletonShape className="size-7 rounded-control" />
      </div>
      {files ? (
        <>
          <div className="space-y-2">
            <SkeletonShape className="h-5 w-24" />
            <SkeletonShape className="w-2/3 max-w-md" />
          </div>
          <div className="rounded-block border border-line bg-surface p-panel">
            <SkeletonRows rows={5} label="Loading files" />
          </div>
        </>
      ) : (
        <>
          <SkeletonBlock lines={2} />
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="space-y-3 rounded-block border border-line bg-surface p-tile">
                <SkeletonShape className="h-2.5 w-1/2" />
                <SkeletonShape className="h-6 w-1/3" />
              </div>
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <SkeletonBlock lines={4} />
            <SkeletonBlock lines={4} className="md:col-span-2" />
          </div>
        </>
      )}
    </Loading>
  );
}

/** Placeholder project cards while the workspace loads. */
export function HomeSkeleton() {
  return (
    <Loading label="Loading projects" className="mx-auto max-w-5xl space-y-6 p-6 md:p-8">
      <SkeletonShape className="h-6 w-40" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <SkeletonBlock key={i} lines={2} />
        ))}
      </div>
    </Loading>
  );
}

/** The server can't be reached, or the project doesn't exist. */
export function LoadError({ notFound, what }: { notFound: boolean; what: string }) {
  return (
    <div className="mx-auto max-w-xl space-y-3 p-8">
      <h1 className="text-lg font-semibold">
        {notFound ? `${what} not found` : 'Can’t reach the Pharos server'}
      </h1>
      <p className="text-sm text-muted">
        {notFound
          ? 'It may have been deleted. Pick another one from the sidebar.'
          : 'Start it with `pnpm dev` (or check that it is running on port 4300). This page reconnects when you come back to it.'}
      </p>
      {!notFound && (
        <button type="button" onClick={() => window.location.reload()} className={BUTTON.secondary}>
          Try again
        </button>
      )}
    </div>
  );
}
