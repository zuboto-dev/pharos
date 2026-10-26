import { runQuery, type ProjectDataset, type ReportRead } from '@pharos/schema';
import { FileWarning, RefreshCw, ShieldAlert } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useViewData } from '../catalog/context';
import { BUTTON } from '../catalog/ui';
import { useFileViewer } from '../files/viewer-context';
import { useReportAssetEvents } from '../lib/events';

// The locked frame shared by report pages (R13) and the drawings of report documents (R14):
// agent HTML in a sandboxed frame (opaque origin, scripts only) whose bridge script the app
// answers (rows for its named reads, the theme, "the data changed", files and links), and the
// guard that stops a frame that leaves its page (R13.6). docs/reframe/r13-report-pages.md has
// the bridge messages, which must match apps/server/src/views/bridge.ts exactly.

/**
 * What the frame may do: run its scripts and show alerts. Never `allow-same-origin` (the page
 * must not reach the app's origin, its API or its storage) and never popups (R13.6): its links
 * open through Pharos (the `link` message), where the reader sees where they go.
 */
export const REPORT_SANDBOX = 'allow-scripts allow-modals';

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

/**
 * Messages the page's bridge script sends (anything else is ignored). Each carries the token the
 * bridge chose for its document, so the parent answers only the document that said `ready`.
 */
type FromFrame = { pharos: 1; token: string } & (
  | { kind: 'ready' }
  | { kind: 'data'; id: string | number; name: string }
  | { kind: 'openFile'; fileId: string }
  | { kind: 'link'; url: string }
  | { kind: 'size'; height: number }
  | { kind: 'leaving' }
);

function readMessage(data: unknown): FromFrame | null {
  if (!data || typeof data !== 'object') return null;
  const m = data as Record<string, unknown>;
  if (m.pharos !== 1) return null;
  if (typeof m.token !== 'string' || !/^[0-9a-f]{16,64}$/.test(m.token)) return null;
  const token = m.token;
  if (m.kind === 'ready' || m.kind === 'leaving') return { pharos: 1, token, kind: m.kind };
  if (
    m.kind === 'data' &&
    (typeof m.id === 'string' || typeof m.id === 'number') &&
    typeof m.name === 'string'
  )
    return { pharos: 1, token, kind: 'data', id: m.id, name: m.name };
  if (m.kind === 'openFile' && typeof m.fileId === 'string')
    return { pharos: 1, token, kind: 'openFile', fileId: m.fileId };
  if (m.kind === 'link' && typeof m.url === 'string')
    return { pharos: 1, token, kind: 'link', url: m.url };
  if (m.kind === 'size' && typeof m.height === 'number' && Number.isFinite(m.height))
    return { pharos: 1, token, kind: 'size', height: m.height };
  return null;
}

/** The tallest a drawing may make its frame by reporting its size. */
export const FRAME_MAX_HEIGHT = 4000;

/** Links a page may ask Pharos to open: http(s) only, at most this long. */
export const LINK_MAX_CHARS = 2000;
/** A plain link (opened at once on a click) has no query or fragment and a path this short. */
export const PLAIN_PATH_MAX_CHARS = 120;
/** At most this many links open at once in LINK_WINDOW_MS; more ask first. */
export const LINK_BURST = 3;
export const LINK_WINDOW_MS = 10_000;

/**
 * A link the page asks to open: null when refused (not http/https, too long), else its address
 * and whether it is plain (no query, no fragment, no user name, a short path). A plain link opens
 * at once when the reader just clicked; anything else shows the reader the whole address first.
 */
export function linkDecision(raw: string): { url: string; plain: boolean } | null {
  if (raw.length > LINK_MAX_CHARS) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.href.length > LINK_MAX_CHARS) return null;
  const plain =
    !url.search &&
    !url.hash &&
    !raw.includes('#') &&
    !raw.includes('?') &&
    !url.username &&
    !url.password &&
    url.pathname.length <= PLAIN_PATH_MAX_CHARS;
  return { url: url.href, plain };
}

export function openInNewTab(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** Whether the reader is interacting with the page now (a click in the frame counts too). */
function readerActive(): boolean {
  const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } })
    .userActivation;
  // Without the API (older browsers) nothing opens without asking.
  return activation ? activation.isActive : false;
}

/** The named reads a frame may ask for, by name. */
export type FrameReads = Record<string, ReportRead>;

/**
 * The answer to `pharos.data(name)`: rows of the named read, or why there are none. `what` names
 * the frame in the message ("page", "drawing").
 */
export function readRowsFrom(
  reads: FrameReads,
  data: ProjectDataset,
  name: string,
  what = 'page',
): { rows: unknown[]; error?: string } {
  const read = Object.hasOwn(reads, name) ? reads[name] : undefined;
  if (!read) return { rows: [], error: `This ${what} has no read named “${name}”` };
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

export type FrameStatus = 'loading' | 'shown' | 'missing' | 'failed' | 'stopped';

/** How long uploads must pause before an open page reloads: a batch of files is one reload. */
export const ASSET_RELOAD_DELAY_MS = 1500;

/**
 * Counts reloads of a view's page for its uploaded files (R13.5): each burst of report-assets
 * events for the view, once quiet for ASSET_RELOAD_DELAY_MS, adds one.
 */
export function useAssetReloads(viewId: string): number {
  const [reloads, setReloads] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useReportAssetEvents((event) => {
    if (event.viewId !== viewId) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setReloads((n) => n + 1), ASSET_RELOAD_DELAY_MS);
  });
  useEffect(() => () => clearTimeout(timer.current), [viewId]);
  return reloads;
}

/**
 * One load of the page in the frame: what the parent knows of the document in it. The bridge of
 * the page's own document says `ready` once with its token; a second `ready`, a second `load`
 * or the bridge saying it is leaving means the frame went somewhere else (R13.6), and the frame
 * is stopped: nothing more is answered or posted to it.
 */
type FrameLife = { src: string; loads: number; token: string | null; dead: boolean };

export type BridgeFrame = {
  /** The frame element; it gets `src`, REPORT_SANDBOX, `referrerPolicy="no-referrer"`, onLoad. */
  frame: RefObject<HTMLIFrameElement | null>;
  /** Where the current load is. */
  shown: FrameStatus;
  onLoad: () => void;
  /** A link the page asked to open that the reader must confirm (one at a time). */
  confirm: string | null;
  setConfirm: (url: string | null) => void;
  /** The height a drawing reported it needs, for this load (null until it does). */
  height: number | null;
};

/**
 * Answers the bridge of the page at `src` in a locked frame. `reads` are the named reads it may
 * ask for (`what` names the frame in errors); they read `projectId`'s data as agents see it. A
 * new `src` is a new load: the old one is no longer answered.
 */
export function useBridgeFrame({
  src,
  projectId,
  reads,
  what = 'page',
}: {
  src: string;
  projectId: string;
  reads: FrameReads;
  what?: string;
}): BridgeFrame {
  const data = useViewData();
  const viewer = useFileViewer();
  const theme = useShownTheme();
  const frame = useRef<HTMLIFrameElement>(null);
  const [status, setStatus] = useState<{ src: string; value: FrameStatus }>({
    src,
    value: 'loading',
  });
  const shown = status.src === src ? status.value : 'loading';
  const life = useRef<FrameLife>({ src, loads: 0, token: null, dead: false });
  const [confirm, setConfirm] = useState<string | null>(null);
  // The height a drawing reported for itself (size), for this load.
  const [fitted, setFitted] = useState<{ src: string; height: number } | null>(null);
  // When links opened at once lately, for the rate limit.
  const opened = useRef<number[]>([]);
  // The latest of what message handlers need, without re-subscribing on every reload.
  const latest = useRef({ reads, projectId, data, viewer, theme, what });
  useLayoutEffect(() => {
    latest.current = { reads, projectId, data, viewer, theme, what };
  });
  // The agent-visible dataset for the current data version; requests wait for it.
  const visible = useRef<{ version: unknown; rows: Promise<ProjectDataset> } | null>(null);
  const visibleData = useCallback(() => {
    const { projectId, data } = latest.current;
    if (!visible.current || visible.current.version !== data.version)
      visible.current = { version: data.version, rows: agentDataset(projectId) };
    return visible.current.rows;
  }, []);

  /** Posts to the frame only while this load is the current one and its page said ready. */
  const post = useCallback((which: FrameLife, message: Record<string, unknown>) => {
    if (which.dead || which.token === null || life.current !== which) return;
    frame.current?.contentWindow?.postMessage({ pharos: 1, ...message }, '*');
  }, []);

  /** The frame left its page: stop answering first, then empty the frame and say so. */
  const stop = useCallback((which: FrameLife) => {
    if (which.dead) return;
    which.dead = true;
    const el = frame.current;
    if (el && el.getAttribute('src') === which.src) el.setAttribute('src', 'about:blank');
    setConfirm(null);
    setStatus({ src: which.src, value: 'stopped' });
  }, []);

  /** A link the page asked to open: at once when plain and clicked, else the reader confirms. */
  const openLink = useCallback((raw: string) => {
    const link = linkDecision(raw);
    if (!link) return;
    const now = Date.now();
    opened.current = opened.current.filter((t) => now - t < LINK_WINDOW_MS);
    if (link.plain && readerActive() && opened.current.length < LINK_BURST) {
      opened.current.push(now);
      openInNewTab(link.url);
      return;
    }
    setConfirm((pending) => pending ?? link.url);
  }, []);

  useEffect(() => {
    const mine: FrameLife = { src, loads: 0, token: null, dead: false };
    life.current = mine;
    const onMessage = (event: MessageEvent) => {
      const win = frame.current?.contentWindow;
      if (!win || event.source !== win) return;
      if (life.current !== mine || mine.dead) return;
      const message = readMessage(event.data);
      if (!message) return;
      if (message.kind === 'ready') {
        // One bridge per document says ready once: another one is another document.
        if (mine.token !== null) return stop(mine);
        mine.token = message.token;
        setStatus({ src, value: 'shown' });
        post(mine, { kind: 'theme', theme: latest.current.theme });
        return;
      }
      // Only the document that said ready is answered.
      if (mine.token === null || message.token !== mine.token) return;
      const { reads, what } = latest.current;
      if (message.kind === 'leaving') stop(mine);
      else if (message.kind === 'data') {
        void visibleData()
          .then((visible) => readRowsFrom(reads, visible, message.name, what))
          .catch((err: unknown) => ({
            rows: [] as unknown[],
            error: `The project's data couldn't be loaded: ${String(err)}`,
          }))
          .then(({ rows, error }) =>
            post(mine, {
              kind: 'data',
              id: message.id,
              name: message.name,
              rows,
              ...(error ? { error } : {}),
            }),
          );
      } else if (message.kind === 'openFile') {
        // Only files the page's author could see (never one in a hidden folder), through the
        // viewer, and only while this load is still the current one.
        const fileId = message.fileId;
        void visibleData()
          .then((visible) => {
            const { viewer } = latest.current;
            if (mine.dead || life.current !== mine || !viewer) return;
            if ((visible.files ?? []).some((f) => f.id === fileId)) viewer.open(fileId);
          })
          .catch(() => {});
      } else if (message.kind === 'link') openLink(message.url);
      else if (message.kind === 'size')
        // A drawing's own height, so it shows whole without scrolling (bounded).
        setFitted({
          src,
          height: Math.min(FRAME_MAX_HEIGHT, Math.max(24, Math.ceil(message.height))),
        });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [src, post, stop, openLink, visibleData]);

  // The project's data reloaded (the app refetches on the change feed): the page asks again.
  const version = useRef(data.version);
  useEffect(() => {
    if (version.current === data.version) return;
    version.current = data.version;
    post(life.current, { kind: 'changed' });
  }, [data.version, post]);

  const sentTheme = useRef(theme);
  useEffect(() => {
    if (sentTheme.current === theme) return;
    sentTheme.current = theme;
    post(life.current, { kind: 'theme', theme });
  }, [theme, post]);

  const onLoad = () => {
    const mine = life.current;
    if (mine.src !== src || mine.dead) return;
    mine.loads += 1;
    // Each address loads once; a second load is the page navigating its own frame.
    if (mine.loads > 1) return stop(mine);
    if (mine.token !== null) return;
    // Loaded without a word from the bridge: either the page has none (shown as it is) or the
    // server answered with an error, which the frame can't tell us; ask the route itself.
    const loaded = src;
    void fetch(loaded, { method: 'HEAD' })
      .then((res) => {
        const value: FrameStatus =
          res.status === 404 ? 'missing' : res.ok || res.status === 405 ? 'shown' : 'failed';
        setStatus((s) => (s.src === loaded && s.value === 'loading' ? { src, value } : s));
      })
      .catch(() =>
        setStatus((s) =>
          s.src === loaded && s.value === 'loading' ? { src, value: 'failed' } : s,
        ),
      );
  };

  return {
    frame,
    shown,
    onLoad,
    confirm,
    setConfirm,
    height: fitted?.src === src ? fitted.height : null,
  };
}

const NOTICE_BOX =
  'flex items-start gap-3 rounded-block border border-line-strong bg-surface px-4 py-6 text-sm';

/** In place of a frame that left its page (R13.6), with a way to load it again. */
export function FrameStopped({
  onReload,
  what = 'page',
  className = NOTICE_BOX,
}: {
  onReload: () => void;
  what?: string;
  className?: string;
}) {
  return (
    <div role="alert" data-report-error="stopped" className={className}>
      <ShieldAlert className="mt-0.5 size-5 shrink-0 text-faint" aria-hidden />
      <div className="min-w-0 space-y-2">
        <p className="font-medium">This {what} tried to leave Pharos, so it was stopped.</p>
        <p className="text-muted">
          A report {what} stays inside Pharos; its links open in a new tab. Reload it to see it
          again. If this keeps happening, ask your agent to use plain links instead.
        </p>
        <button type="button" onClick={onReload} className={BUTTON.secondary}>
          <RefreshCw className="size-3.5" aria-hidden /> Reload {what}
        </button>
      </div>
    </div>
  );
}

/** In place of a frame whose page the server couldn't serve. */
export function FrameUnavailable({
  status,
  what = 'page',
  className = NOTICE_BOX,
}: {
  status: 'missing' | 'failed';
  what?: string;
  className?: string;
}) {
  return (
    <div role="alert" data-report-error={status} className={className}>
      <FileWarning className="mt-0.5 size-5 shrink-0 text-faint" aria-hidden />
      <div className="min-w-0 space-y-1">
        <p className="font-medium">
          {status === 'missing' ? `This ${what} isn’t there` : `This ${what} couldn’t be loaded`}
        </p>
        <p className="text-muted">
          {status === 'missing'
            ? `Pharos has no ${what} to show for this view. Ask your agent to write it again.`
            : 'Something went wrong serving it. Reload to try again; if it keeps failing, check that Pharos is running.'}
        </p>
      </div>
    </div>
  );
}

/** "This page wants to open: …" with Open / Cancel, for a link that needs the reader's yes. */
export function LinkConfirm({
  url,
  onDone,
  what = 'page',
}: {
  url: string;
  onDone: () => void;
  what?: string;
}) {
  return (
    <div
      role="alertdialog"
      aria-label={`Open a link from this ${what}`}
      data-report-link=""
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-block border border-line-strong bg-surface px-3 py-2 text-sm"
    >
      <p className="min-w-0 flex-1">
        <span className="text-muted">This {what} wants to open: </span>
        <span className="font-mono text-xs break-all">{url}</span>
      </p>
      <span className="flex shrink-0 gap-2">
        <button
          type="button"
          onClick={() => {
            openInNewTab(url);
            onDone();
          }}
          className={BUTTON.primary}
        >
          Open
        </button>
        <button type="button" onClick={onDone} className={BUTTON.secondary}>
          Cancel
        </button>
      </span>
    </div>
  );
}
