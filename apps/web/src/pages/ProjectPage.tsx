import {
  CATALOG,
  COMPONENT_INFO,
  TEMPLATES,
  nextWidgetId,
  toBoard,
  type Board,
  type ComponentName,
  type Entity,
  type Operation,
  type ProjectDataset,
  type ViewNode,
  type ViewSpec,
} from '@pharos/schema';
import clsx from 'clsx';
import {
  BookmarkPlus,
  Check,
  FolderOpen,
  History,
  LayoutGrid,
  MessageCircleQuestion,
  Plus,
  RotateCcw,
  Undo2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { widgetName } from '../catalog/board';
import {
  ViewDataProvider,
  useViewData,
  type ApplyOutcome,
  type AskAbout,
  type OpenTarget,
  type ViewActions,
} from '../catalog/context';
import { DetailDrawer } from '../catalog/drawer';
import { FilesPage } from '../files/FilesPage';
import { FolderRequestNotice } from '../files/FolderRequests';
import { ExpiryNotice } from '../files/expiry-notice';
import { dismissAnswer, keepAnswer } from './answers';
import { GetStarted, LoadError, ProjectSkeleton, isEmptyProject } from './onboarding';
import { AskDialog, RequestsButton } from './requests';
import { ViewTabs, ViewUpdated, isExpired, sortViews } from './ViewTabs';
import { ViewRenderer } from '../catalog/renderer';
import { findSourceFile } from '../catalog/source-file';
import { ICON_BUTTON, Tip } from '../catalog/tip';
import { BUTTON } from '../catalog/ui';
import { ApiError, postJson, useResource } from '../lib/api';
import { useRevisionEvents } from '../lib/events';
import { useExit } from '../lib/motion';
import { humanize, timeAgo } from '../lib/format';

/** The question an answer view answers, and how long it stays. */
function AnswerHeader({ view }: { view: Entity<'view'> }) {
  const { actions } = useViewData();
  const navigate = useNavigate();
  const expired = isExpired(view);
  const expires = view.data.expiresAt ? timeAgo(view.data.expiresAt) : null;
  const run = (change: { message: string; operations: Operation[] }) =>
    actions.apply(change.message, change.operations, { undoable: true });
  return (
    <div className="flex flex-wrap items-start gap-3 rounded-block border border-sky-200 bg-sky-50/70 px-4 py-3 dark:border-sky-900 dark:bg-sky-950/40">
      <MessageCircleQuestion className="mt-0.5 size-5 shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{view.data.question}</div>
        <div className="text-xs text-muted">
          Answer ·{' '}
          {expired ? 'expired' : view.data.archived ? 'dismissed' : `hidden ${expires} unless kept`}
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <button type="button" onClick={() => void run(keepAnswer(view))} className={BUTTON.primary}>
          <BookmarkPlus className="size-3.5" /> Keep as a view
        </button>
        {!view.data.archived && (
          <button
            type="button"
            onClick={() => {
              void run(dismissAnswer(view));
              navigate(`/projects/${view.data.projectId}`);
            }}
            className={BUTTON.secondary}
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}

function specOf(view: Entity<'view'>): ViewSpec {
  return view.data.spec ?? TEMPLATES[view.data.template ?? 'overview'];
}

function targetFrom(params: URLSearchParams): OpenTarget | null {
  const entity = params.get('entity');
  if (entity) return { entity };
  if (params.get('history')) return { history: true };
  const revision = Number(params.get('revision'));
  return revision ? { revision } : null;
}

const PICKABLE = (Object.keys(CATALOG) as ComponentName[]).filter(
  (c) => !['Grid', 'Section', 'Tabs'].includes(c),
);

function componentLabel(name: string): string {
  return humanize(name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase());
}

function WidgetPicker({
  onPick,
  onClose,
}: {
  onPick: (name: ComponentName) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="absolute top-full right-0 z-40 mt-2 max-h-[min(24rem,70vh)] w-80 animate-pop-in max-w-[calc(100vw-2rem)] overflow-y-auto rounded-block border border-line-strong bg-surface p-1 shadow-popover">
        {PICKABLE.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => onPick(name)}
            className="block w-full rounded-tile px-3 py-2 text-left hover:bg-neutral-50 dark:hover:bg-neutral-800"
          >
            <div className="text-sm font-medium">{componentLabel(name)}</div>
            <div className="text-xs text-muted">{CATALOG[name].description}</div>
          </button>
        ))}
      </div>
    </>
  );
}

/** How long after the owner's own change a reload counts as theirs, not a live update. */
const OWN_CHANGE_MS = 2500;

type Notice =
  | { kind: 'error'; text: string }
  | { kind: 'undo'; text: string; revision: number }
  | { kind: 'answer'; text: string; viewId: string };

/**
 * A project: its view tabs and the active view, or its Files page (`page="files"`, at
 * /projects/:projectId/files), with the detail drawer over either.
 */
export function ProjectPage({ page }: { page?: 'files' } = {}) {
  const filesPage = page === 'files';
  const { projectId, viewId } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const dataset = useResource<ProjectDataset>(`/api/projects/${projectId}/data`);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  // A widget just added: scrolled into view once the reloaded data has rendered it.
  const reveal = useRef<string | null>(null);
  useEffect(() => {
    const el = reveal.current && document.querySelector(`[data-widget="${reveal.current}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    reveal.current = null;
  }, [dataset.version]);
  const { reload } = dataset;
  // When the owner last changed something from this page: the reload that follows isn't a live
  // update, so the blocks it changes aren't marked (v0.2 B4).
  const ownChangeAt = useRef(0);
  const quiet = useCallback(() => Date.now() - ownChangeAt.current < OWN_CHANGE_MS, []);
  // Announce answers that arrive while this page is open (the first load just records what exists).
  const seenAnswers = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!dataset.data) return;
    const answers = dataset.data.views.filter(
      (v) => v.data.kind === 'answer' && !v.data.archived && !isExpired(v),
    );
    if (seenAnswers.current) {
      const fresh = answers.find((v) => !seenAnswers.current!.has(v.id));
      if (fresh && fresh.id !== viewId) {
        setNotice({
          kind: 'answer',
          text: fresh.data.question ?? fresh.data.name,
          viewId: fresh.id,
        });
      }
    }
    seenAnswers.current = new Set(answers.map((v) => v.id));
  }, [dataset.data, viewId]);
  // Live updates: reload when anyone (an agent, another tab) changes this project.
  useRevisionEvents((event) => {
    if (projectId && event.projectIds.includes(projectId)) reload();
  });

  const apply = useCallback(
    async (
      message: string,
      operations: Operation[],
      options?: { undoable?: boolean },
    ): Promise<ApplyOutcome> => {
      ownChangeAt.current = Date.now();
      try {
        const result = await postJson<{
          revision: { id: number } | null;
          created: Record<string, string>;
        }>('/api/apply', {
          message,
          operations,
        });
        const revision = result.revision?.id ?? null;
        setNotice(options?.undoable && revision ? { kind: 'undo', text: message, revision } : null);
        return { ok: true, revision, created: result.created };
      } catch (err) {
        setNotice({
          kind: 'error',
          text: err instanceof ApiError ? [err.message, ...err.issues].join('\n') : String(err),
        });
        return { ok: false };
      } finally {
        reload();
      }
    },
    [reload],
  );
  // How many details deep the drawer is: opening one from another adds a history entry, so Back
  // (in the drawer or the browser) returns to the previous one.
  const location = useLocation();
  const drawerDepth = (location.state as { drawerDepth?: number } | null)?.drawerDepth ?? 0;
  // The drawer's target, kept for a moment after it closes so the drawer can slide out.
  const paramsKey = params.toString();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `params` changes with `paramsKey`.
  const openTarget = useMemo(() => targetFrom(params), [paramsKey]);
  const drawer = useExit(openTarget);
  const drawerOpen = openTarget !== null;
  const open = useCallback(
    (target: OpenTarget) =>
      setParams(
        'entity' in target
          ? { entity: target.entity }
          : 'revision' in target
            ? { revision: String(target.revision) }
            : { history: '1' },
        { state: { drawerDepth: drawerOpen ? drawerDepth + 1 : 0 } },
      ),
    [setParams, drawerOpen, drawerDepth],
  );
  const revert = useCallback<NonNullable<ViewActions['revert']>>(
    async (revision, message) => {
      ownChangeAt.current = Date.now();
      try {
        const result = await postJson<{ revision: { id: number } | null }>(
          `/api/revisions/${revision}/revert`,
          { message },
        );
        const id = result.revision?.id ?? null;
        setNotice(id ? { kind: 'undo', text: message, revision: id } : null);
        return { ok: true, revision: id };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof ApiError ? [err.message, ...err.issues].join('\n') : String(err),
        };
      } finally {
        reload();
      }
    },
    [reload],
  );
  const [asking, setAsking] = useState<AskAbout | null>(null);
  const actions = useMemo<ViewActions>(
    () => ({ apply, open, revert, ask: setAsking, findSourceFile }),
    [apply, open, revert],
  );
  const close = useCallback(() => setParams({}), [setParams]);

  useEffect(() => {
    if (notice?.kind !== 'undo') return;
    const timer = setTimeout(() => setNotice((n) => (n === notice ? null : n)), 8000);
    return () => clearTimeout(timer);
  }, [notice]);

  if (dataset.status === 'loading') return <ProjectSkeleton />;
  if (!dataset.data) {
    const notFound = dataset.error instanceof ApiError && dataset.error.status === 404;
    return <LoadError notFound={notFound} what="Project" />;
  }

  const views = sortViews(
    dataset.data.views.filter((v) => (!v.data.archived && !isExpired(v)) || v.id === viewId),
  );
  const active = filesPage ? undefined : (views.find((v) => v.id === viewId) ?? views[0]);
  if (viewId && !views.some((v) => v.id === viewId))
    return <Navigate to={`/projects/${projectId}`} replace />;
  const spec: ViewSpec = active ? specOf(active) : TEMPLATES.overview;
  const board = toBoard(spec);

  /** Saves a layout change. A template view keeps its template, so it can be reset later. */
  const saveBoard = async (next: Board, message: string) => {
    if (!active) return;
    const outcome = await apply(`${message} in ${active.data.name}`, [
      { op: 'update', type: 'view', id: active.id, data: { spec: next } },
    ]);
    if (outcome.ok && outcome.revision)
      setNotice({ kind: 'undo', text: message, revision: outcome.revision });
  };
  const addWidget = (name: ComponentName) => {
    setPicking(false);
    // Start from the component's documented example, so it shows something useful right away.
    const example = COMPONENT_INFO[name].example as ViewNode;
    const node = { ...example, title: example.title ?? componentLabel(name) } as ViewNode;
    const widget = { id: nextWidgetId(board), w: 6, node };
    reveal.current = widget.id;
    void saveBoard(
      { ...board, widgets: [...board.widgets, widget] },
      `Add “${widgetName(widget)}” widget`,
    );
  };
  const resetToTemplate = async () => {
    if (!active) return;
    const outcome = await apply(`Reset ${active.data.name} to the default layout`, [
      { op: 'update', type: 'view', id: active.id, data: { spec: null } },
    ]);
    if (outcome.ok && outcome.revision)
      setNotice({ kind: 'undo', text: 'Reset to the default layout', revision: outcome.revision });
  };
  const undo = async (revision: number) => {
    setNotice(null);
    ownChangeAt.current = Date.now();
    try {
      await postJson(`/api/revisions/${revision}/revert`, {
        message: `Undo: ${notice?.kind === 'undo' ? notice.text : 'last change'}`,
      });
    } catch (err) {
      setNotice({
        kind: 'error',
        text: err instanceof ApiError ? [err.message, ...err.issues].join('\n') : String(err),
      });
    }
    reload();
  };

  const canReset = Boolean(active?.data.template && active.data.spec);

  return (
    <ViewDataProvider data={dataset.data} version={dataset.version} actions={actions}>
      <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-8">
        {/* One line at every width (v0.2 B1): the tabs give way (into More), never the icons. */}
        <div className="flex flex-nowrap items-end gap-2 border-b border-line">
          <ViewTabs
            projectId={projectId!}
            views={dataset.data.views}
            active={active}
            onCreated={() => setEditing(true)}
          />
          {(active || filesPage) && (
            <div className="relative mb-1.5 flex shrink-0 items-center gap-1.5">
              {editing ? (
                <>
                  {canReset && (
                    <Tip label="Reset layout" align="end">
                      <button
                        type="button"
                        onClick={() => void resetToTemplate()}
                        aria-label="Reset layout"
                        className={ICON_BUTTON.secondary}
                      >
                        <RotateCcw className="size-4" aria-hidden />
                      </button>
                    </Tip>
                  )}
                  <button
                    type="button"
                    onClick={() => setPicking((p) => !p)}
                    aria-expanded={picking}
                    className={BUTTON.secondary}
                  >
                    <Plus className="size-3.5" aria-hidden />
                    <span className="hidden sm:inline">Add widget</span>
                    <span className="sr-only sm:hidden">Add widget</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(false)}
                    className={BUTTON.primary}
                  >
                    <Check className="size-3.5" aria-hidden /> Done
                  </button>
                  {picking && <WidgetPicker onPick={addWidget} onClose={() => setPicking(false)} />}
                </>
              ) : (
                <>
                  <Tip label={filesPage ? 'Files (open now)' : 'Files'} align="end">
                    <Link
                      to={`/projects/${projectId}/files`}
                      aria-current={filesPage ? 'page' : undefined}
                      aria-label="Files"
                      className={filesPage ? ICON_BUTTON.pressed : ICON_BUTTON.secondary}
                    >
                      <FolderOpen className="size-4" aria-hidden />
                    </Link>
                  </Tip>
                  <RequestsButton
                    projectId={projectId!}
                    requests={dataset.data.requests ?? []}
                    apply={apply}
                  />
                  <Tip label="History" align="end">
                    <button
                      type="button"
                      onClick={() => open({ history: true })}
                      className={ICON_BUTTON.secondary}
                      aria-label="History"
                    >
                      <History className="size-4" aria-hidden />
                    </button>
                  </Tip>
                  {!filesPage && (
                    <Tip label="Customize" align="end">
                      <button
                        type="button"
                        onClick={() => setEditing(true)}
                        className={ICON_BUTTON.secondary}
                        aria-label="Customize"
                      >
                        <LayoutGrid className="size-4" aria-hidden />
                      </button>
                    </Tip>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        {/* An agent waiting for a folder for this project (R7.12): approve it here. */}
        <FolderRequestNotice projectId={projectId!} onAnswered={reload} />
        {/* Files that expired or expire within 60 days (R7.15). */}
        {!editing && <ExpiryNotice />}
        {filesPage && <FilesPage onAdded={reload} />}
        {active && !editing && <ViewUpdated view={active} />}
        {editing && (
          <p className="text-xs text-muted">
            <span className="hidden md:inline">
              Drag a widget’s grip (or use ↑ ↓) to move it, drag its edges or corner to resize
              (double-click the bottom edge to fit content), use ⚙ for its settings, or remove it
              with ✕.
            </span>
            <span className="md:hidden">
              Use ↑ ↓ to move widgets, ⚙ for settings, and ✕ to remove them.
            </span>{' '}
            Changes are saved as revisions.
          </p>
        )}
        {active?.data.kind === 'answer' && <AnswerHeader view={active} />}
        {!filesPage &&
          active?.data.kind !== 'answer' &&
          !editing &&
          isEmptyProject(dataset.data) && (
            <GetStarted projectId={projectId!} name={dataset.data.project.data.name} />
          )}
        {!filesPage && board.widgets.length === 0 && !editing && (
          <div className="rounded-block border border-dashed border-neutral-300 p-10 text-center text-sm text-muted dark:border-neutral-700">
            This view is empty. Use <strong>Customize</strong> → Add widget, or ask your agent to
            build it (for example, “make this a view of what’s left in the current stage”).
          </div>
        )}
        {!filesPage && (
          // A tab switch fades the new view in (opacity only, so nothing shifts).
          <div key={active?.id} className="animate-fade-in">
            <ViewRenderer
              view={active ? { id: active.id, name: active.data.name } : undefined}
              spec={board}
              editing={editing}
              onChange={(next, message) => void saveBoard(next, message)}
              quiet={quiet}
            />
          </div>
        )}
      </div>
      {drawer.shown && (
        <DetailDrawer
          target={drawer.shown}
          onClose={close}
          onBack={drawerDepth > 0 && !drawer.leaving ? () => navigate(-1) : undefined}
          leaving={drawer.leaving}
        />
      )}
      {asking && (
        <AskDialog
          projectId={projectId!}
          about={asking}
          apply={apply}
          onClose={() => setAsking(null)}
          answers={dataset.data.views.filter(
            (v) => v.data.kind === 'answer' && !v.data.archived && !isExpired(v),
          )}
          onOpenAnswer={(id) => navigate(`/projects/${projectId}/views/${id}`)}
        />
      )}
      {notice && (
        <div
          role={notice.kind === 'error' ? 'alert' : 'status'}
          className={clsx(
            'fixed right-4 bottom-4 z-50 flex max-w-md items-start gap-3 rounded-tile px-4 py-3 text-sm whitespace-pre-line shadow-popover',
            notice.kind === 'error' ? 'bg-rose-600 text-white' : 'bg-inverse text-on-inverse',
          )}
        >
          <span className="min-w-0 flex-1">
            {notice.kind === 'error'
              ? `Couldn’t save: ${notice.text}`
              : notice.kind === 'answer'
                ? `New answer: ${notice.text}`
                : notice.text}
          </span>
          {notice.kind === 'answer' && (
            <button
              type="button"
              onClick={() => {
                navigate(`/projects/${projectId}/views/${notice.viewId}`);
                setNotice(null);
              }}
              className="inline-flex items-center gap-1 font-semibold"
            >
              Open
            </button>
          )}
          {notice.kind === 'undo' && (
            <button
              type="button"
              onClick={() => void undo(notice.revision)}
              className="inline-flex items-center gap-1 font-semibold"
            >
              <Undo2 className="size-3.5" /> Undo
            </button>
          )}
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="font-semibold"
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}
    </ViewDataProvider>
  );
}
