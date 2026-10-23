import {
  CATALOG,
  COMPONENT_INFO,
  TEMPLATES,
  nextWidgetId,
  toBoard,
  type ActionResult,
  type ActionSubmission,
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
  Archive,
  BookmarkPlus,
  Check,
  FolderOpen,
  History,
  LayoutGrid,
  MessageCircleQuestion,
  Plus,
  RotateCcw,
  Undo2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
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
import { DecisionContextSlot, DetailDrawer } from '../catalog/drawer';
import { FileViewerProvider } from '../files/FileViewer';
import { EmptyState } from '../catalog/empty-state';
import { FilesPage } from '../files/FilesPage';
import { FolderRequestNotice } from '../files/FolderRequests';
import { ExpiryNotice } from '../files/expiry-notice';
import { dismissAnswer, keepAnswer } from './answers';
import { GetStarted, LoadError, ProjectSkeleton, isEmptyProject } from './onboarding';
import { EvidenceNote, WhatChanged, usePageFreshness } from './freshness';
import { AskDialog, RequestsButton } from './requests';
import { ViewTabs, ViewUpdated, isExpired, sortViews } from './ViewTabs';
import { ReportBar, ReportFrame, isReport } from './report';
import { DecisionPageContext, DocumentView, isDocument } from './document';
import { ArchivedNotice } from './hand-back';
import { notifyProjectsChanged } from './projects';
import { archiveChange, isArchived } from './sidebar-model';
import { ViewRenderer } from '../catalog/renderer';
import { findSourceFile } from '../catalog/source-file';
import { ICON_BUTTON, InfoTip, Tooltip } from '../catalog/tooltip';
import { BUTTON } from '../catalog/ui';
import { ApiError, getJson, postJson, useResource } from '../lib/api';
import { useRevisionEvents } from '../lib/events';
import { useExit } from '../lib/motion';
import { humanize, timeAgo } from '../lib/format';
import { AgentPanelButton, useNarrow, usePanelWidth, useTerminalStatus } from '../agent/AgentPanel';
import { AgentDock, askInPanel, entityTypeIn, useAgentDock } from '../agent/AgentDock';

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
      {/* Room for the question first; on a phone the buttons go below it. */}
      <div className="min-w-0 flex-1 basis-48">
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
  | { kind: 'answer'; text: string; viewId: string }
  /** A plain note; `history` adds a button that opens the project's history. */
  | { kind: 'info'; text: string; history?: boolean };

/** The revision that last changed an entity (the agent's answer to a block request). */
async function lastRevisionOf(entityId: string): Promise<number | null> {
  try {
    const [latest] = await getJson<{ id: number }[]>(
      `/api/history?entityId=${encodeURIComponent(entityId)}&limit=1`,
    );
    return latest?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * A project: its view tabs and the active view, or its Files page (`page="files"`, at
 * /projects/:projectId/files), with the detail drawer over either.
 */
/**
 * Which project this is, above its view tabs: with the sidebar collapsed to a rail, nothing else
 * on the page says so. The browser tab says it too.
 */
function ProjectName({ name }: { name: string }) {
  useEffect(() => {
    const before = document.title;
    document.title = `${name} · Pharos`;
    return () => {
      document.title = before;
    };
  }, [name]);
  return (
    <p data-project-name="" className="-mb-2 truncate text-base font-semibold text-ink">
      {name}
    </p>
  );
}

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
  // Freshness (R11): what changed since the reader last looked at the open view, and whether an
  // agent's page is stale. Opening the view marks it seen.
  const shownViewId = filesPage
    ? undefined
    : (viewId ??
      (dataset.data
        ? sortViews(dataset.data.views.filter((v) => !v.data.archived && !isExpired(v)))[0]?.id
        : undefined));
  const freshness = usePageFreshness(projectId, shownViewId);
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
  // "Ask about this block" (R10): when the agent changes the block (or says why it can't),
  // say so, with Undo for the change. The first load just records what is open.
  const seenRequests = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    if (!dataset.data) return;
    const blocks = (dataset.data.requests ?? []).filter((r) => r.data.mode === 'block');
    const seen = seenRequests.current;
    seenRequests.current = new Map(blocks.map((r) => [r.id, r.data.status]));
    if (!seen) return;
    const settled = blocks.find((r) => seen.get(r.id) === 'open' && r.data.status !== 'open');
    if (!settled) return;
    const about = settled.data.about ?? 'the block';
    const reply = settled.data.reply ? `: ${settled.data.reply}` : '';
    if (settled.data.status === 'dismissed') {
      setNotice({ kind: 'info', text: `Your agent didn’t change ${about}${reply}` });
      return;
    }
    void lastRevisionOf(settled.id).then((revision) =>
      setNotice(
        revision
          ? { kind: 'undo', text: `Your agent changed ${about}${reply}`, revision }
          : { kind: 'info', text: `Your agent changed ${about}${reply}` },
      ),
    );
  }, [dataset.data]);
  // Live updates: reload when anyone (an agent, another tab) changes this project.
  useRevisionEvents((event) => {
    if (projectId && (event.missed || event.projectIds.includes(projectId))) reload();
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
  // Action blocks (R10): one submission, one revision; the toast offers Undo.
  const act = useCallback(
    async (submission: ActionSubmission): Promise<ActionResult> => {
      ownChangeAt.current = Date.now();
      try {
        const res = await fetch(`/api/projects/${projectId}/actions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(submission),
        });
        const result = (await res.json()) as ActionResult;
        if (result.status === 'done' && result.revision)
          setNotice({ kind: 'undo', text: result.message, revision: result.revision });
        else if (result.status === 'done' || result.status === 'duplicate')
          setNotice(
            result.status === 'duplicate' && result.revision && !result.undone
              ? {
                  kind: 'undo',
                  text: `Already saved: ${result.message}`,
                  revision: result.revision,
                }
              : { kind: 'info', text: result.message },
          );
        return result;
      } finally {
        reload();
      }
    },
    [projectId, reload],
  );
  const [asking, setAsking] = useState<AskAbout | null>(null);
  // The agent panel (R17): the owner's agent CLI beside the page, where this computer has one.
  // Where it is, "Ask" on a block points the agent at it there instead of the questions dialog.
  const terminal = useTerminalStatus(projectId);
  const dock = useAgentDock(projectId, !!terminal?.running);
  // Arriving from the list of running agents (the rail): open its panel, once.
  const openTerminal = params.get('terminal') === '1' && !!terminal?.available;
  const { setOpen: setDockOpen } = dock;
  useEffect(() => {
    if (!openTerminal) return;
    setDockOpen(true);
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('terminal');
        return next;
      },
      { replace: true },
    );
  }, [openTerminal, setDockOpen, setParams]);
  // A decision's details show what its page says about it (its sheet's text, pictures, clips).
  const allViews = dataset.data?.views;
  const decisionContext = useCallback(
    (decisionId: string) =>
      allViews ? <DecisionPageContext views={allViews} decisionId={decisionId} /> : null,
    [allViews],
  );
  const [panelWidth, setPanelWidth] = usePanelWidth();
  const narrow = useNarrow();
  const terminalHere = terminal?.available === true;
  const entities = dataset.data;
  const ask = useCallback(
    (about: AskAbout) => {
      if (!terminalHere) return setAsking(about);
      dock.insert(askInPanel(about, entities?.views ?? [], (id) => entityTypeIn(entities, id)));
    },
    [terminalHere, dock, entities],
  );
  const actions = useMemo<ViewActions>(
    () => ({ apply, open, revert, act, ask, findSourceFile }),
    [apply, open, revert, act, ask],
  );
  const close = useCallback(() => setParams({}), [setParams]);

  useEffect(() => {
    if (notice?.kind !== 'undo' && notice?.kind !== 'info') return;
    const timer = setTimeout(() => setNotice((n) => (n === notice ? null : n)), 8000);
    return () => clearTimeout(timer);
  }, [notice]);

  if (dataset.status === 'loading') return <ProjectSkeleton files={filesPage} />;
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
    const what = notice?.kind === 'undo' ? notice.text : 'last change';
    setNotice(null);
    ownChangeAt.current = Date.now();
    try {
      await postJson(`/api/revisions/${revision}/revert`, { message: `Undo: ${what}` });
    } catch (err) {
      // Changed again since (R10.13): say so plainly and point at what changed, never force it.
      setNotice(
        err instanceof ApiError && err.status === 409
          ? {
              kind: 'info',
              text: `Can’t undo “${what}”: it was changed again since. Open History to see what changed and undo from there.`,
              history: true,
            }
          : {
              kind: 'error',
              text: err instanceof ApiError ? [err.message, ...err.issues].join('\n') : String(err),
            },
      );
    }
    reload();
  };

  const canReset = Boolean(active?.data.template && active.data.spec);
  // A report document (R14): blocks Pharos lays out as an article instead of the board.
  const docView = !isReport(active) && isDocument(active) ? active : undefined;
  // A report page (R13): the agent's own HTML in a locked frame instead of the board. Both are
  // reports: the report bar above, no board to customize.
  const report = isReport(active) ? active : docView;
  // A report has no board to customize: leave layout editing when one opens.
  if (report && editing) setEditing(false);
  // An archived project still opens and works; a small notice at the top can restore it.
  const archivedProject =
    dataset.data && isArchived(dataset.data.project) ? dataset.data.project : null;

  return (
    <ViewDataProvider data={dataset.data} version={dataset.version} actions={actions}>
      {/* One file viewer for the page, its Files page and the drawer (v0.2 A6). */}
      <FileViewerProvider>
        {/* The agent panel docks on the right: the page makes room for it (R17). */}
        <div
          className="md:pr-(--agent-panel)"
          style={
            {
              '--agent-panel': dock.open && terminalHere && !narrow ? `${panelWidth}px` : '0px',
            } as CSSProperties
          }
        >
          <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-8">
            {dataset.data && <ProjectName name={dataset.data.project.data.name} />}
            {archivedProject && (
              <p className="-mb-2 flex items-center gap-1.5 text-sm text-muted">
                <Archive className="size-3.5" aria-hidden />
                Archived ·
                <button
                  type="button"
                  onClick={() => {
                    const change = archiveChange(archivedProject, false);
                    void apply(change.message, change.operations, { undoable: true }).then(
                      notifyProjectsChanged,
                    );
                  }}
                  className="font-medium text-accent hover:underline"
                >
                  Restore
                </button>
              </p>
            )}
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
                        <Tooltip label="Reset layout">
                          <button
                            type="button"
                            onClick={() => void resetToTemplate()}
                            aria-label="Reset layout"
                            className={ICON_BUTTON.secondary}
                          >
                            <RotateCcw className="size-4" aria-hidden />
                          </button>
                        </Tooltip>
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
                      {picking && (
                        <WidgetPicker onPick={addWidget} onClose={() => setPicking(false)} />
                      )}
                    </>
                  ) : (
                    <>
                      <Tooltip label={filesPage ? 'Files (open now)' : 'Files'}>
                        <Link
                          to={`/projects/${projectId}/files`}
                          aria-current={filesPage ? 'page' : undefined}
                          aria-label="Files"
                          className={filesPage ? ICON_BUTTON.pressed : ICON_BUTTON.secondary}
                        >
                          <FolderOpen className="size-4" aria-hidden />
                        </Link>
                      </Tooltip>
                      <RequestsButton
                        projectId={projectId!}
                        requests={dataset.data.requests ?? []}
                        apply={apply}
                      />
                      <AgentPanelButton
                        projectId={projectId!}
                        status={terminal}
                        open={dock.open}
                        onToggle={() => dock.setOpen((o) => !o)}
                      />
                      <Tooltip label="History">
                        <button
                          type="button"
                          onClick={() => open({ history: true })}
                          className={ICON_BUTTON.secondary}
                          aria-label="History"
                        >
                          <History className="size-4" aria-hidden />
                        </button>
                      </Tooltip>
                      {!filesPage && !report && (
                        <Tooltip label="Customize">
                          <button
                            type="button"
                            onClick={() => setEditing(true)}
                            className={ICON_BUTTON.secondary}
                            aria-label="Customize"
                          >
                            <LayoutGrid className="size-4" aria-hidden />
                          </button>
                        </Tooltip>
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
            {active && !report && !editing && <ViewUpdated view={active} />}
            {active && !editing && <WhatChanged freshness={freshness} />}
            {editing && (
              // The how-to waits behind the (i): the grips, gears and crosses say it on the blocks.
              <p className="flex items-center gap-1 text-xs text-muted">
                <LayoutGrid className="size-3.5" aria-hidden /> Editing layout
                <InfoTip
                  label="How to edit the layout"
                  detail="Drag a widget’s grip (or use ↑ ↓) to move it, drag its edges or corner to resize (double-click the bottom edge to fit content), use the gear for its settings, or remove it with the cross. Changes are saved as revisions."
                />
              </p>
            )}
            {active?.data.kind === 'answer' && <AnswerHeader view={active} />}
            {active?.data.archived && active.data.kind !== 'answer' && (
              <ArchivedNotice view={active} />
            )}
            {active && !report && !editing && <EvidenceNote view={active} freshness={freshness} />}
            {report && (
              <ReportBar
                view={report}
                freshness={freshness}
                className={docView ? 'mx-auto max-w-[min(100%,60rem)]' : undefined}
              />
            )}
            {!filesPage &&
              !report &&
              active?.data.kind !== 'answer' &&
              !editing &&
              isEmptyProject(dataset.data) && (
                <GetStarted projectId={projectId!} name={dataset.data.project.data.name} />
              )}
            {!filesPage && !report && board.widgets.length === 0 && !editing && (
              <div className="rounded-block border border-dashed border-line-strong">
                <EmptyState
                  icon={LayoutGrid}
                  title="This view is empty"
                  hint="Add blocks yourself, or ask your agent to build it (for example, “make this a view of what’s left in the current stage”)."
                >
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(true);
                      setPicking(true);
                    }}
                    className={BUTTON.accent}
                  >
                    <Plus className="size-3.5" aria-hidden /> Add a block
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setAsking({
                        label: active ? `View “${active.data.name}”` : 'This view',
                        viewId: active?.id,
                        question: 'Build this view: ',
                      })
                    }
                    className={BUTTON.secondary}
                  >
                    <MessageCircleQuestion className="size-3.5" aria-hidden /> Ask an agent
                  </button>
                </EmptyState>
              </div>
            )}
            {report && (
              <div key={report.id} className="animate-fade-in">
                {docView ? <DocumentView view={docView} /> : <ReportFrame view={report} />}
              </div>
            )}
            {!filesPage && !report && (
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
        </div>
        {terminalHere && (
          <AgentDock
            projectId={projectId!}
            status={terminal}
            view={active ? { id: active.id, name: active.data.name } : undefined}
            dock={dock}
            width={panelWidth}
            onWidth={setPanelWidth}
            narrow={narrow}
          />
        )}
        {drawer.shown && (
          <DecisionContextSlot.Provider value={decisionContext}>
            <DetailDrawer
              target={drawer.shown}
              onClose={close}
              onBack={drawerDepth > 0 && !drawer.leaving ? () => navigate(-1) : undefined}
              leaving={drawer.leaving}
            />
          </DecisionContextSlot.Provider>
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
            {notice.kind === 'info' && notice.history && (
              <button
                type="button"
                onClick={() => {
                  open({ history: true });
                  setNotice(null);
                }}
                className="inline-flex items-center gap-1 font-semibold"
              >
                <History className="size-3.5" aria-hidden /> History
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
              className="-m-0.5 rounded-control p-0.5 opacity-80 hover:opacity-100"
              aria-label="Dismiss"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        )}
      </FileViewerProvider>
    </ViewDataProvider>
  );
}
