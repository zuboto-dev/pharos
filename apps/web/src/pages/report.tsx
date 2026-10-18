import {
  runQuery,
  type Entity,
  type ProjectDataset,
  type RevisionSummary,
  type ViewFreshness,
} from '@pharos/schema';
import { AlertTriangle, ExternalLink, FileWarning } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useViewData } from '../catalog/context';
import { Loading, SkeletonShape } from '../catalog/skeleton';
import { useFileViewer } from '../files/viewer-context';
import { useResource } from '../lib/api';
import { timeAgo } from '../lib/format';
import { authorName, staleSentence, RefreshButton } from './freshness';

// Report pages (R13, docs/reframe/r13-report-pages.md): the agent wrote the whole page as HTML.
// Pharos shows it in a locked frame (opaque origin, scripts only) with a slim bar above it, and
// answers the page's bridge script: rows for its named reads, the theme, and "the data changed".

/** Whether a view is a report page (its `page` wins over any board). */
export const isReport = (view: Entity<'view'> | undefined): boolean => Boolean(view?.data.page);

/** Where the server serves a report page; `updatedAt` makes a new version load fresh. */
export function reportUrl(view: Entity<'view'>): string {
  return `/api/views/${encodeURIComponent(view.id)}/page/?v=${encodeURIComponent(view.updatedAt)}`;
}

/**
 * What the frame may do: run its scripts, open links in a new tab and show alerts. Never
 * `allow-same-origin`: the page must not reach the app's origin, its API or its storage.
 */
export const REPORT_SANDBOX =
  'allow-scripts allow-popups allow-popups-to-escape-sandbox allow-modals';

type Theme = 'light' | 'dark';

/** The theme the app shows now (the `dark` class on <html>, kept by `useTheme`). */
function currentTheme(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/** The app's theme, live: follows the class on <html> as Settings or the OS changes it. */
export function useShownTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(currentTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

/** Messages the page's bridge script sends (anything else is ignored). */
type FromFrame =
  | { pharos: 1; kind: 'ready' }
  | { pharos: 1; kind: 'data'; id: string | number; name: string }
  | { pharos: 1; kind: 'openFile'; fileId: string };

function readMessage(data: unknown): FromFrame | null {
  if (!data || typeof data !== 'object') return null;
  const m = data as Record<string, unknown>;
  if (m.pharos !== 1) return null;
  if (m.kind === 'ready') return { pharos: 1, kind: 'ready' };
  if (
    m.kind === 'data' &&
    (typeof m.id === 'string' || typeof m.id === 'number') &&
    typeof m.name === 'string'
  )
    return { pharos: 1, kind: 'data', id: m.id, name: m.name };
  if (m.kind === 'openFile' && typeof m.fileId === 'string')
    return { pharos: 1, kind: 'openFile', fileId: m.fileId };
  return null;
}

/** The answer to `pharos.data(name)`: rows of the page's named read, or why there are none. */
export function readRows(
  view: Entity<'view'>,
  data: ProjectDataset,
  name: string,
): { rows: unknown[]; error?: string } {
  const reads = view.data.page?.data ?? {};
  const read = Object.hasOwn(reads, name) ? reads[name] : undefined;
  if (!read) return { rows: [], error: `This page has no read named “${name}”` };
  try {
    return { rows: runQuery(data, read.type, read.filter ?? {}) };
  } catch (err) {
    return { rows: [], error: `The read “${name}” failed: ${String(err)}` };
  }
}

/**
 * What the page may read: the project as agents see it (the server's AgentFiles view: a file's
 * details only, nothing from hidden folders, no local paths). The page was written by an agent,
 * so it gets no more than its author could read; it is fetched again whenever the data changes.
 */
export function agentDataset(projectId: string): Promise<ProjectDataset> {
  return fetch(`/api/projects/${encodeURIComponent(projectId)}/data`, {
    headers: { 'x-pharos-author': 'agent:Report page' },
  }).then((res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<ProjectDataset>;
  });
}

type Status = 'loading' | 'shown' | 'missing' | 'failed';

/**
 * The page in its locked frame, tall enough to fill the window below it (the page scrolls inside),
 * with a skeleton while it loads and a plain message when it can't be served.
 */
export function ReportFrame({ view }: { view: Entity<'view'> }) {
  const data = useViewData();
  const viewer = useFileViewer();
  const theme = useShownTheme();
  const frame = useRef<HTMLIFrameElement>(null);
  const src = reportUrl(view);
  const [status, setStatus] = useState<{ src: string; value: Status }>({ src, value: 'loading' });
  const shown = status.src === src ? status.value : 'loading';
  // The bridge said ready (per frame load); until then nothing is posted.
  const ready = useRef(false);
  // The latest of what message handlers need, without re-subscribing on every reload.
  const latest = useRef({ view, data, viewer, theme });
  useLayoutEffect(() => {
    latest.current = { view, data, viewer, theme };
  });
  // The agent-visible dataset for the current data version; requests wait for it.
  const visible = useRef<{ version: unknown; rows: Promise<ProjectDataset> } | null>(null);
  const visibleData = useCallback(() => {
    const { view, data } = latest.current;
    if (!visible.current || visible.current.version !== data.version)
      visible.current = { version: data.version, rows: agentDataset(view.data.projectId) };
    return visible.current.rows;
  }, []);

  const post = useCallback((message: Record<string, unknown>) => {
    frame.current?.contentWindow?.postMessage({ pharos: 1, ...message }, '*');
  }, []);

  useEffect(() => {
    ready.current = false;
    const onMessage = (event: MessageEvent) => {
      const win = frame.current?.contentWindow;
      if (!win || event.source !== win) return;
      const message = readMessage(event.data);
      if (!message) return;
      const { view, data, viewer, theme } = latest.current;
      if (message.kind === 'ready') {
        ready.current = true;
        setStatus({ src, value: 'shown' });
        post({ kind: 'theme', theme });
      } else if (message.kind === 'data') {
        void visibleData()
          .then((visible) => readRows(view, visible, message.name))
          .catch((err: unknown) => ({
            rows: [] as unknown[],
            error: `The project's data couldn't be loaded: ${String(err)}`,
          }))
          .then(({ rows, error }) =>
            post({
              kind: 'data',
              id: message.id,
              name: message.name,
              rows,
              ...(error ? { error } : {}),
            }),
          );
      } else if (message.kind === 'openFile') {
        // Only this project's files, and only through the viewer.
        if (viewer && (data.files ?? []).some((f) => f.id === message.fileId))
          viewer.open(message.fileId);
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [src, post, visibleData]);

  // The project's data reloaded (the app refetches on the change feed): the page asks again.
  const version = useRef(data.version);
  useEffect(() => {
    if (version.current === data.version) return;
    version.current = data.version;
    if (ready.current) post({ kind: 'changed' });
  }, [data.version, post]);

  const sentTheme = useRef(theme);
  useEffect(() => {
    if (sentTheme.current === theme) return;
    sentTheme.current = theme;
    if (ready.current) post({ kind: 'theme', theme });
  }, [theme, post]);

  // Loaded without a word from the bridge: either the page has none (shown as it is) or the
  // server answered with an error, which the frame can't tell us; ask the route itself.
  const onLoad = () => {
    if (ready.current) return;
    const loaded = src;
    void fetch(loaded, { method: 'HEAD' })
      .then((res) => {
        const value: Status =
          res.status === 404 ? 'missing' : res.ok || res.status === 405 ? 'shown' : 'failed';
        setStatus((s) => (s.src === loaded && s.value === 'loading' ? { src, value } : s));
      })
      .catch(() =>
        setStatus((s) =>
          s.src === loaded && s.value === 'loading' ? { src, value: 'failed' } : s,
        ),
      );
  };

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
  }, []);

  if (shown === 'missing' || shown === 'failed')
    return (
      <div
        role="alert"
        data-report-error={shown}
        className="flex items-start gap-3 rounded-block border border-line-strong bg-surface px-4 py-6 text-sm"
      >
        <FileWarning className="mt-0.5 size-5 shrink-0 text-faint" aria-hidden />
        <div className="min-w-0 space-y-1">
          <p className="font-medium">
            {shown === 'missing' ? 'This page isn’t there' : 'This page couldn’t be loaded'}
          </p>
          <p className="text-muted">
            {shown === 'missing'
              ? 'Pharos has no page to show for this view. Ask your agent to write it again.'
              : 'Something went wrong serving it. Reload to try again; if it keeps failing, check that Pharos is running.'}
          </p>
        </div>
      </div>
    );

  return (
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
  );
}

/**
 * The slim bar above a report: what it says, when and by whom it was last written, whether the
 * data it read changed since (with "Ask to refresh"), and a link to open it on its own.
 */
export function ReportBar({
  view,
  freshness,
}: {
  view: Entity<'view'>;
  freshness: ViewFreshness | null;
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
    <div data-report-bar="" className="space-y-2">
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
          <a
            href={reportUrl(view)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-control font-medium text-accent hover:underline"
          >
            <ExternalLink className="size-3.5" aria-hidden /> Open in new tab
          </a>
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
