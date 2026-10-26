import type { Entity, ProjectDataset, RevisionSummary, ViewFreshness } from '@pharos/schema';
import clsx from 'clsx';
import { VersionsLink } from './versions';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import { useViewData } from '../catalog/context';
import { Loading, SkeletonShape } from '../catalog/skeleton';
import { useResource } from '../lib/api';
import { timeAgo } from '../lib/format';
import {
  FrameStopped,
  FrameUnavailable,
  LinkConfirm,
  REPORT_SANDBOX,
  readRowsFrom,
  useAssetReloads,
  useBridgeFrame,
} from './frame-bridge';
import { authorName, staleSentence, RefreshButton } from './freshness';

// Report pages (R13, docs/reframe/r13-report-pages.md): the agent wrote the whole page as HTML.
// Pharos shows it in a locked frame (opaque origin, scripts only) with a slim bar above it, and
// answers the page's bridge script (frame-bridge.tsx): rows for its named reads, the theme, and
// "the data changed".

export {
  ASSET_RELOAD_DELAY_MS,
  LINK_BURST,
  LINK_MAX_CHARS,
  LINK_WINDOW_MS,
  PLAIN_PATH_MAX_CHARS,
  REPORT_SANDBOX,
  agentDataset,
  linkDecision,
  useAssetReloads,
  useShownTheme,
} from './frame-bridge';

/** Whether a view is a report page (its `page` wins over any board). */
export const isReport = (view: Entity<'view'> | undefined): boolean => Boolean(view?.data.page);

/**
 * Where the server serves a report page; `updatedAt` makes a new version load fresh, and
 * `reload` (bumped when its files are uploaded) makes the same version load again.
 */
export function reportUrl(view: Entity<'view'>, reload = 0): string {
  const version = reload ? `${view.updatedAt}-${reload}` : view.updatedAt;
  return `/api/views/${encodeURIComponent(view.id)}/page/?v=${encodeURIComponent(version)}`;
}

/** The answer to `pharos.data(name)`: rows of the page's named read, or why there are none. */
export function readRows(
  view: Entity<'view'>,
  data: ProjectDataset,
  name: string,
): { rows: unknown[]; error?: string } {
  return readRowsFrom(view.data.page?.data ?? {}, data, name, 'page');
}

const NO_READS = {};

/**
 * The page in its locked frame, tall enough to fill the window below it (the page scrolls inside),
 * with a skeleton while it loads and a plain message when it can't be served or was stopped.
 */
export function ReportFrame({ view }: { view: Entity<'view'> }) {
  const reloads = useAssetReloads(view.id);
  // "Reload page" after the page was stopped: a fresh frame at a fresh address.
  const [restarts, setRestarts] = useState(0);
  const src = reportUrl(view, reloads + restarts);
  const { frame, shown, onLoad, confirm, setConfirm } = useBridgeFrame({
    src,
    projectId: view.data.projectId,
    reads: view.data.page?.data ?? NO_READS,
  });

  // Fill the window below the frame's top; never shorter than a comfortable page.
  const box = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const fit = () => {
      const el = box.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      setHeight(Math.max(480, Math.round(window.innerHeight - top - 16)));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [confirm]);

  if (shown === 'stopped') return <FrameStopped onReload={() => setRestarts((n) => n + 1)} />;
  if (shown === 'missing' || shown === 'failed') return <FrameUnavailable status={shown} />;

  return (
    <div className="space-y-2">
      {confirm && <LinkConfirm url={confirm} onDone={() => setConfirm(null)} />}
      <div
        ref={box}
        className="relative overflow-hidden rounded-block border border-line bg-surface"
        style={{ height: height ?? '75vh' }}
      >
        {shown === 'loading' && (
          <Loading label="Loading page" className="absolute inset-0 space-y-4 p-6">
            <SkeletonShape className="h-7 w-2/3 rounded-tile" />
            <SkeletonShape style={{ width: '85%' }} />
            <SkeletonShape style={{ width: '72%' }} />
            <SkeletonShape className="mt-6 h-40 w-full rounded-tile" />
          </Loading>
        )}
        <iframe
          key={src}
          ref={frame}
          src={src}
          title={view.data.name}
          sandbox={REPORT_SANDBOX}
          referrerPolicy="no-referrer"
          onLoad={onLoad}
          className="block size-full border-0 transition-opacity duration-(--motion-base) ease-calm"
          style={{ opacity: shown === 'loading' ? 0 : 1 }}
        />
      </div>
    </div>
  );
}

/**
 * The slim bar above a report (a page, R13, or a document, R14): what it says, when and by whom
 * it was last written (opening its history, where any version can be undone), whether the data
 * it read changed since (with "Ask to refresh"), and for a page a link to open it on its own.
 * A document's summary isn't repeated here: the document opens with its own words.
 */
export function ReportBar({
  view,
  freshness,
  className,
}: {
  view: Entity<'view'>;
  freshness: ViewFreshness | null;
  className?: string;
}) {
  const { version, actions } = useViewData();
  const latest = useResource<RevisionSummary[]>(
    `/api/history?entityId=${view.id}&limit=1&v=${version}`,
  );
  const rev = latest.data?.[0];
  const evidence = freshness?.evidence;
  const stale = evidence && !('unknown' in evidence) ? evidence.stale : undefined;
  const summary = view.data.page?.summary;
  return (
    <div data-report-bar="" className={clsx('space-y-2', className)}>
      {summary && <p className="max-w-3xl text-sm text-ink-soft">{summary}</p>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted">
        <button
          type="button"
          onClick={() => actions.open({ entity: view.id })}
          title={rev ? `#${rev.id} · ${rev.message}` : 'Show this page’s history'}
          className="min-w-0 text-left hover:text-ink"
        >
          Updated {timeAgo(view.updatedAt)}
          {rev && ` by ${authorName(rev.author, false)}`}
        </button>
        <VersionsLink view={view} />
        {stale && (
          <span
            data-evidence="stale"
            className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-medium text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-100"
          >
            <AlertTriangle className="size-3" aria-hidden /> Out of date
          </span>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          {stale && <RefreshButton view={view} label="Ask to refresh" />}
          {view.data.page && (
            <a
              href={reportUrl(view)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-control font-medium text-accent hover:underline"
            >
              <ExternalLink className="size-3.5" aria-hidden /> Open in new tab
            </a>
          )}
        </span>
      </div>
      {stale && (
        <p className="text-xs text-muted">
          Since it was written, {staleSentence(stale)}. Its live numbers are today’s; its text may
          be out of date.
        </p>
      )}
    </div>
  );
}
