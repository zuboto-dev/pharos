import { DeskLink } from './DeskPage';
import { UpdatesLink } from './UpdatesPage';
import type { Entity, Operation } from '@pharos/schema';
import clsx from 'clsx';
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  ChevronRight,
  CornerUpLeft,
  FolderGit2,
  FolderPlus,
  Layers,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  SquareTerminal,
  Plus,
  SquarePlus,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { useEffect, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useLocation, useNavigate } from 'react-router';
import { Loading, SkeletonShape } from '../catalog/skeleton';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '../catalog/menu';
import { workingLine } from '../catalog/presence';
import { TerminalDot } from '../agent/RunningAgents';
import { useTerminalHints, type TerminalHint } from '../agent/running';
import { ICON_GHOST, InfoTip, Tooltip } from '../catalog/tooltip';
import { BUTTON, Dot, toneOf } from '../catalog/ui';
import { usePresence } from '../lib/events';
import { useChangedViews } from '../lib/freshness';
import { CHANGED_TEXT, ChangedDot } from './freshness';
import { ApiError, getJson, postJson } from '../lib/api';
import { plural } from '../lib/format';
import { NewProjectDialog } from './NewProjectDialog';
import { notifyProjectsChanged, useWorkspace, type Workspace } from './projects';
import {
  containerOf,
  folderSiblings,
  moveFolderOps,
  moveProjectOps,
  nudgeOps,
  placeOps,
  archiveChange,
  isArchived,
  projectSiblings,
  removeSectionOps,
  sectionAndInside,
  sectionParents,
  sectionPath,
  sectionSiblings,
  type Container,
  type Item,
  type SectionNode,
} from './sidebar-model';

type Project = Entity<'project'>;
type Repository = Entity<'repository'>;
type Section = Entity<'section'>;
type Target =
  | { type: 'project'; entity: Project }
  | { type: 'repository'; entity: Repository }
  | { type: 'section'; entity: Section };
type Drag = { type: 'project' | 'repository'; id: string };
type Notice = { kind: 'undo' | 'error'; text: string; revision?: number };

const DRAG_TYPE = 'application/x-pharos-sidebar';
const COLLAPSED_KEY = 'pharos-sidebar-collapsed';
/** The Archived group is closed by default, so the remembered set holds it while it's open. */
const ARCHIVED_OPEN = 'archived-open';

function readCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

/** Collapsed folders and sections, remembered per browser (it's a view preference, not project data). */
function useCollapsed(): [Set<string>, (id: string) => void] {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      } catch {
        // Storage may be unavailable; collapsing still works for this page.
      }
      return next;
    });
  return [collapsed, toggle];
}

const FIELD = 'w-full rounded-control border border-line-strong bg-surface px-2.5 py-1.5 text-sm';

/** A small dialog asking for a few text values (new folder, new section). */
function PromptDialog({
  title,
  fields,
  submitLabel,
  onSubmit,
  onClose,
}: {
  title: string;
  fields: { name: string; label: string; placeholder?: string; required?: boolean }[];
  submitLabel: string;
  onSubmit: (values: Record<string, string>) => void;
  onClose: () => void;
}) {
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    onSubmit(
      Object.fromEntries(fields.map((f) => [f.name, String(form.get(f.name) ?? '').trim()])),
    );
  };
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="absolute inset-0 bg-neutral-900/30 dark:bg-black/50" onClick={onClose} />
      <form
        onSubmit={submit}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        className="relative w-full max-w-sm space-y-4 rounded-block bg-surface p-5 shadow-overlay"
      >
        <h2 className="text-base font-semibold">{title}</h2>
        {fields.map((f, i) => (
          <label key={f.name} className="block space-y-1">
            <span className="text-sm font-medium">{f.label}</span>
            <input
              name={f.name}
              autoFocus={i === 0}
              required={f.required}
              placeholder={f.placeholder}
              className={FIELD}
            />
          </label>
        ))}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={BUTTON.secondary}>
            Cancel
          </button>
          <button type="submit" className={BUTTON.primary}>
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Confirms deleting a project, saying how much goes with it. */
function DeleteProjectDialog({
  project,
  onConfirm,
  onClose,
}: {
  project: Project;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [counts, setCounts] = useState<string | null>(null);
  useEffect(() => {
    getJson<{
      tasks: unknown[];
      stages: unknown[];
      goals: unknown[];
      views: unknown[];
      decisions: unknown[];
    }>(`/api/projects/${project.id}/data`).then(
      (d) =>
        setCounts(
          [
            plural(d.tasks.length, 'task'),
            plural(d.stages.length, 'stage'),
            plural(d.goals.length, 'goal'),
            plural(d.views.length, 'view'),
            plural(d.decisions.length, 'decision'),
          ].join(', '),
        ),
      () => setCounts(null),
    );
  }, [project.id]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="alertdialog"
      aria-modal="true"
      aria-label="Delete project"
    >
      <div className="absolute inset-0 bg-neutral-900/30 dark:bg-black/50" onClick={onClose} />
      <div
        className="relative w-full max-w-sm space-y-4 rounded-block bg-surface p-5 shadow-overlay"
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <h2 className="text-base font-semibold">Delete “{project.data.name}”?</h2>
        <p className="text-sm text-ink-soft">
          This deletes the project and everything in it{counts ? `: ${counts}` : ''}. You can undo
          it right after, and it stays in the history.
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" autoFocus onClick={onClose} className={BUTTON.secondary}>
            Cancel
          </button>
          <button type="button" onClick={onConfirm} className={BUTTON.danger}>
            Delete project
          </button>
        </div>
      </div>
    </div>
  );
}

function RenameInput({ value, onDone }: { value: string; onDone: (name: string | null) => void }) {
  return (
    <form
      className="flex-1 px-1"
      onSubmit={(e) => {
        e.preventDefault();
        const name = new FormData(e.currentTarget).get('name')?.toString().trim();
        onDone(name && name !== value ? name : null);
      }}
    >
      <input
        name="name"
        aria-label="New name"
        autoFocus
        defaultValue={value}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={(e) => e.currentTarget.form?.requestSubmit()}
        onKeyDown={(e) => e.key === 'Escape' && onDone(null)}
        className="w-full rounded border border-sky-300 bg-surface px-1.5 py-0.5 text-sm dark:border-sky-800"
      />
    </form>
  );
}

const ROW = 'group/row relative flex items-center gap-1 rounded-control pr-1 text-sm';
/** The row's pin toggle: shown on hover or focus like ⋯, left to the menu on touch screens. */
const PIN =
  'shrink-0 rounded p-1 text-faint opacity-0 hover:bg-neutral-200 hover:text-ink-soft focus:opacity-100 group-hover/row:opacity-100 pointer-coarse:hidden dark:hover:bg-neutral-700';
const MORE =
  'shrink-0 rounded p-0.5 text-faint opacity-0 hover:bg-neutral-200 hover:text-ink-soft focus:opacity-100 group-hover/row:opacity-100 pointer-coarse:opacity-100 dark:hover:bg-neutral-700';

/**
 * The project sidebar: pinned projects, folders (repositories), loose projects, and sections.
 * Every item has a ⋯ menu (and can be dragged) to rename, pin, reorder, move, add, or remove;
 * each change is saved as a revision with an Undo.
 */
export function Sidebar() {
  // Projects an agent is working in right now (v0.2 B5): a pulsing halo on the status dot.
  const presence = usePresence();
  const terminals = useTerminalHints().hints;
  /** The agent running for a folder's projects (they share one), if any. */
  const folderHint = (projects: Project[]) =>
    projects.map((p) => terminals.get(p.id)).find(Boolean);
  /** An agent running for any project in a section or a section inside it (shown while closed). */
  const sectionHint = (sectionId: string) => {
    if (!terminals.size) return undefined;
    const inside = sectionAndInside(w.sections, sectionId);
    const within = (id: string | undefined) => Boolean(id && inside.has(id));
    return folderHint(
      w.projects.filter(
        (p) =>
          within(p.data.sectionId) ||
          (p.data.repositoryId && within(repositoryById.get(p.data.repositoryId)?.data.sectionId)),
      ),
    );
  };
  // Projects with views changed since the reader last looked (R11).
  const changedViews = useChangedViews().projects;
  const ws = useWorkspace();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, toggleCollapsed] = useCollapsed();
  const [menu, setMenu] = useState<{ target: Target | 'add'; anchor: DOMRect } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    | { kind: 'project'; container: Container }
    | { kind: 'folder'; sectionId?: string }
    | { kind: 'section'; parentId?: string }
    | { kind: 'delete'; project: Project }
    | null
  >(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dropOn, setDropOn] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (notice?.kind !== 'undo') return;
    const timer = setTimeout(() => setNotice((n) => (n === notice ? null : n)), 8000);
    return () => clearTimeout(timer);
  }, [notice]);

  if (ws.status === 'error')
    return <p className="px-4 text-sm text-rose-600">Can’t reach the Pharos server.</p>;
  if (!ws.workspace)
    return (
      <Loading label="Loading projects" className="space-y-3 px-4 py-2">
        {[70, 55, 80, 60].map((w) => (
          <SkeletonShape key={w} style={{ width: `${w}%` }} />
        ))}
      </Loading>
    );
  const w: Workspace = ws.workspace;
  const repositoryById = new Map(w.repositories.map((r) => [r.id, r]));
  const sectionById = new Map(w.sections.map((s) => [s.id, s]));
  const archivedOpen = collapsed.has(ARCHIVED_OPEN);

  const apply = async (message: string, operations: Operation[]) => {
    if (!operations.length) return;
    setMenu(null);
    try {
      const result = await postJson<{
        revision: { id: number } | null;
        created: Record<string, string>;
      }>('/api/apply', { message, operations });
      if (result.revision) setNotice({ kind: 'undo', text: message, revision: result.revision.id });
      return result;
    } catch (err) {
      setNotice({
        kind: 'error',
        text: err instanceof ApiError ? [err.message, ...err.issues].join('\n') : String(err),
      });
    } finally {
      notifyProjectsChanged();
    }
  };
  const send = (change: { message: string; operations: Operation[] }) =>
    apply(change.message, change.operations);
  const undo = async (revision: number, text: string) => {
    setNotice(null);
    try {
      await postJson(`/api/revisions/${revision}/revert`, { message: `Undo: ${text}` });
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof ApiError ? err.message : String(err) });
    }
    notifyProjectsChanged();
  };

  const containerName = (c: Container) =>
    c.repositoryId
      ? `folder “${repositoryById.get(c.repositoryId)?.data.name}”`
      : c.sectionId
        ? `section “${sectionById.get(c.sectionId)?.data.name}”`
        : 'the top level';

  // ---------------------------------------------------------------- actions

  const rename = (target: Target, name: string) => {
    const noun = target.type === 'repository' ? 'folder' : target.type;
    void apply(`Rename ${noun} “${target.entity.data.name}” to “${name}”`, [
      { op: 'update', type: target.type, id: target.entity.id, data: { name } },
    ]);
  };
  const siblingsOf = (target: Target) =>
    target.type === 'project'
      ? projectSiblings(w.projects, w.repositories, containerOf(target.entity))
      : target.type === 'repository'
        ? folderSiblings(w.repositories, target.entity.data.sectionId)
        : sectionSiblings(w.sections, sectionParents(w.sections).get(target.entity.id));
  const nudge = (target: Target, by: -1 | 1) => {
    const noun = target.type === 'repository' ? 'folder' : target.type;
    void apply(
      `Move ${noun} “${target.entity.data.name}” ${by < 0 ? 'up' : 'down'}`,
      nudgeOps(target.entity, siblingsOf(target), by),
    );
  };
  const moveProject = (project: Project, to: Container) =>
    void apply(
      `Move project “${project.data.name}” to ${containerName(to)}`,
      moveProjectOps(project, w.projects, w.repositories, to),
    );
  const moveFolder = (repository: Repository, sectionId: string | undefined) =>
    void apply(
      `Move folder “${repository.data.name}” to ${containerName({ sectionId })}`,
      moveFolderOps(repository, w.repositories, sectionId),
    );
  const removeFolder = (repository: Repository) => {
    // Its projects stay where the folder was: in its section, or at the top level.
    const keep: Operation[] = w.projects
      .filter((p) => p.data.repositoryId === repository.id)
      .map((p) => ({
        op: 'update',
        type: 'project',
        id: p.id,
        data: { sectionId: repository.data.sectionId ?? null },
      }));
    void apply(`Remove folder “${repository.data.name}” (its projects stay)`, [
      ...keep,
      { op: 'delete', type: 'repository', id: repository.id },
    ]);
  };
  const deleteProject = async (project: Project) => {
    setDialog(null);
    await apply(`Delete project “${project.data.name}”`, [
      { op: 'delete', type: 'project', id: project.id },
    ]);
    if (location.pathname.startsWith(`/projects/${project.id}`)) navigate('/');
  };

  // ---------------------------------------------------------------- drag and drop

  const dragProps = (d: Drag) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(d));
      e.dataTransfer.effectAllowed = 'move';
      setDrag(d);
    },
    onDragEnd: () => {
      setDrag(null);
      setDropOn(null);
    },
  });
  /** Drop handling for a target; `accepts` says which dragged kinds it takes. */
  const dropProps = (
    key: string,
    accepts: Drag['type'][],
    onDrop: (d: Drag) => Operation[] | void,
    message: (d: Drag) => string,
  ) => ({
    onDragOver: (e: DragEvent) => {
      if (!drag || !accepts.includes(drag.type) || drag.id === key) return;
      e.preventDefault();
      e.stopPropagation();
      setDropOn(key);
    },
    onDragLeave: (e: DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node))
        setDropOn((k) => (k === key ? null : k));
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDropOn(null);
      const d = JSON.parse(e.dataTransfer.getData(DRAG_TYPE) || 'null') as Drag | null;
      if (!d || !accepts.includes(d.type) || d.id === key) return;
      const ops = onDrop(d);
      if (ops?.length) void apply(message(d), ops);
    },
  });
  /** Names of this folder's pinned projects, which are listed under Pinned instead. */
  const pinnedIn = (repositoryId: string) =>
    w.tree.pinned
      .filter((p) => p.data.repositoryId === repositoryId)
      .map((p) => p.data.name)
      .join(', ');
  const projectById = (id: string) => w.projects.find((p) => p.id === id)!;
  const nameOf = (d: Drag) =>
    d.type === 'project' ? projectById(d.id).data.name : repositoryById.get(d.id)!.data.name;
  const dropHighlight = (key: string) =>
    dropOn === key && 'bg-sky-100 ring-1 ring-sky-300 dark:bg-sky-950 dark:ring-sky-800';

  // ---------------------------------------------------------------- rendering

  const openMenu = (target: Target | 'add', e: { currentTarget: HTMLElement }) =>
    setMenu({ target, anchor: e.currentTarget.getBoundingClientRect() });

  const togglePin = (p: Project) =>
    apply(`${p.data.pinned ? 'Unpin' : 'Pin'} project “${p.data.name}”`, [
      { op: 'update', type: 'project', id: p.id, data: { pinned: p.data.pinned ? null : true } },
    ]);

  /** A project row; pinned and archived rows are fixed in place (no drag, no drop). */
  const projectRow = (
    project: Project,
    depth: number,
    place: 'list' | 'pinned' | 'archived' = 'list',
  ) => {
    const inPinned = place !== 'list';
    const target: Target = { type: 'project', entity: project };
    const agents = [
      ...new Set(presence.filter((e) => e.projectId === project.id).map((e) => e.agent)),
    ];
    const container = containerOf(project);
    const siblings = projectSiblings(w.projects, w.repositories, container);
    return (
      <li
        key={project.id}
        {...(inPinned
          ? {}
          : dropProps(
              project.id,
              ['project'],
              (d) =>
                placeOps(
                  projectById(d.id),
                  siblings,
                  siblings.findIndex((s) => s.id === project.id),
                  container.repositoryId
                    ? { repositoryId: container.repositoryId, sectionId: null }
                    : { repositoryId: null, sectionId: container.sectionId ?? null },
                ),
              (d) => `Move project “${nameOf(d)}” before “${project.data.name}”`,
            ))}
      >
        <div
          className={clsx(ROW, dropHighlight(project.id))}
          style={{ paddingLeft: depth * 12 }}
          {...(inPinned ? {} : dragProps({ type: 'project', id: project.id }))}
        >
          {renaming === project.id ? (
            <RenameInput
              value={project.data.name}
              onDone={(name) => (setRenaming(null), name && rename(target, name))}
            />
          ) : (
            <NavLink
              to={`/projects/${project.id}`}
              onDoubleClick={() => setRenaming(project.id)}
              className={({ isActive }) =>
                clsx(
                  'flex min-w-0 flex-1 items-center gap-2 rounded-control px-2 py-1.5',
                  isActive ? 'bg-subtle font-medium text-ink' : 'text-ink-soft hover:bg-sunken',
                )
              }
            >
              <span className="relative inline-flex shrink-0">
                <Dot tone={toneOf(project.data.status)} />
                {agents.length > 0 && (
                  <span
                    aria-hidden
                    data-presence-dot=""
                    className="pointer-events-none absolute -inset-1 animate-presence rounded-full ring-2 ring-presence"
                  />
                )}
              </span>
              <span className="truncate">{project.data.name}</span>
              {agents.length > 0 && <span className="sr-only"> ({workingLine(agents, 'it')})</span>}
              {terminals.get(project.id) &&
                !(
                  project.data.repositoryId &&
                  repositoryById.get(project.data.repositoryId)?.data.path
                ) && (
                  // Its own agent (no folder): the mark is on the project.
                  <TerminalMark hint={terminals.get(project.id)!} />
                )}
              {changedViews[project.id]?.length ? (
                <>
                  <ChangedDot className="shrink-0" />
                  <span className="sr-only">
                    {' '}
                    ({plural(changedViews[project.id]!.length, 'view')} {CHANGED_TEXT})
                  </span>
                </>
              ) : null}
              {place === 'pinned' && project.data.repositoryId && (
                <span className="ml-auto truncate text-xs text-faint">
                  {repositoryById.get(project.data.repositoryId)?.data.name}
                </span>
              )}
            </NavLink>
          )}
          {renaming !== project.id && (
            // Pin or unpin straight from the row on hover, as well as from the ⋯ menu; a touch
            // screen keeps it in the menu, so the row isn't crowded.
            <Tooltip
              label={project.data.pinned ? 'Unpin' : 'Pin to top'}
              className="pointer-coarse:hidden"
            >
              <button
                type="button"
                aria-label={`${project.data.pinned ? 'Unpin' : 'Pin'} ${project.data.name}`}
                data-pin-toggle=""
                aria-pressed={!!project.data.pinned}
                className={PIN}
                onClick={() => void togglePin(project)}
              >
                {project.data.pinned ? (
                  <PinOff className="size-3.5" aria-hidden />
                ) : (
                  <Pin className="size-3.5" aria-hidden />
                )}
              </button>
            </Tooltip>
          )}
          <Tooltip label="Options">
            <button
              type="button"
              aria-label={`Options for ${project.data.name}`}
              className={MORE}
              onClick={(e) => openMenu(target, e)}
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </button>
          </Tooltip>
        </div>
      </li>
    );
  };

  const folderBlock = (folder: Extract<Item, { kind: 'folder' }>, depth: number) => {
    const { repository, projects } = folder;
    const target: Target = { type: 'repository', entity: repository };
    const open = !collapsed.has(repository.id);
    const siblings = folderSiblings(w.repositories, repository.data.sectionId);
    return (
      <li key={repository.id}>
        <div
          className={clsx(ROW, 'text-xs font-medium text-muted', dropHighlight(repository.id))}
          style={{ paddingLeft: depth * 12 }}
          {...dragProps({ type: 'repository', id: repository.id })}
          {...dropProps(
            repository.id,
            ['project', 'repository'],
            (d) =>
              d.type === 'project'
                ? moveProjectOps(projectById(d.id), w.projects, w.repositories, {
                    repositoryId: repository.id,
                  })
                : placeOps(
                    repositoryById.get(d.id)!,
                    siblings,
                    siblings.findIndex((s) => s.id === repository.id),
                    { sectionId: repository.data.sectionId ?? null },
                  ),
            (d) =>
              d.type === 'project'
                ? `Move project “${nameOf(d)}” to folder “${repository.data.name}”`
                : `Move folder “${nameOf(d)}” before “${repository.data.name}”`,
          )}
        >
          {renaming === repository.id ? (
            <RenameInput
              value={repository.data.name}
              onDone={(name) => (setRenaming(null), name && rename(target, name))}
            />
          ) : (
            <Tooltip
              label={repository.data.name}
              detail={repository.data.path ?? repository.data.url}
              className="min-w-0 flex-1"
            >
              <button
                type="button"
                onClick={() => toggleCollapsed(repository.id)}
                onDoubleClick={() => setRenaming(repository.id)}
                aria-expanded={open}
                className="flex min-w-0 flex-1 items-center gap-1.5 rounded-control px-2 py-1 text-left hover:text-ink"
              >
                <ChevronRight
                  className={clsx('size-3 shrink-0 transition', open && 'rotate-90')}
                  aria-hidden
                />
                <FolderGit2 className="size-3.5 shrink-0" aria-hidden />
                <span className="truncate">{repository.data.name}</span>
                {!open && <span className="font-normal text-faint">{projects.length}</span>}
                {folderHint(projects) && (
                  // One agent runs for the whole folder (its projects share it).
                  <TerminalMark hint={folderHint(projects)!} where="this folder" />
                )}
              </button>
            </Tooltip>
          )}
          <Tooltip label="Options">
            <button
              type="button"
              aria-label={`Options for folder ${repository.data.name}`}
              className={MORE}
              onClick={(e) => openMenu(target, e)}
            >
              <MoreHorizontal className="size-4" aria-hidden />
            </button>
          </Tooltip>
        </div>
        {open && (
          <ul>
            {projects.map((p) => projectRow(p, depth + 1))}
            {!projects.length && (
              <li className="py-1 text-xs text-faint" style={{ paddingLeft: (depth + 1) * 12 + 8 }}>
                {pinnedIn(repository.id)
                  ? `${pinnedIn(repository.id)} pinned above`
                  : 'No projects'}
              </li>
            )}
          </ul>
        )}
      </li>
    );
  };

  const items = (list: Item[], depth: number) =>
    list.map((item) =>
      item.kind === 'folder' ? folderBlock(item, depth) : projectRow(item.project, depth),
    );

  // ---------------------------------------------------------------- menus

  /** Where a section can go: into another one (not itself or one inside it), or the top level. */
  const sectionMoves = (s: Section) => {
    const inside = sectionAndInside(w.sections, s.id);
    const parentId = sectionParents(w.sections).get(s.id);
    const into = w.sections.filter((o) => !inside.has(o.id) && o.id !== parentId);
    const move = (to: string | undefined) =>
      void apply(
        `Move section “${s.data.name}” ${to ? `into “${sectionPath(w.sections, to)}”` : 'to the top level'}`,
        placeOps(s, sectionSiblings(w.sections, to), Number.MAX_SAFE_INTEGER, {
          parentId: to ?? null,
        }),
      );
    if (!into.length && !parentId) return null;
    return (
      <>
        <MenuSeparator />
        <MenuLabel>Move into</MenuLabel>
        {into.map((o) => (
          <MenuItem key={o.id} icon={Layers} onClick={() => move(o.id)}>
            {sectionPath(w.sections, o.id)}
          </MenuItem>
        ))}
        {parentId && (
          <MenuItem icon={CornerUpLeft} onClick={() => move(undefined)}>
            Top level
          </MenuItem>
        )}
      </>
    );
  };

  let menuContent: ReactNode = null;
  if (menu?.target === 'add') {
    menuContent = (
      <>
        <MenuItem
          icon={SquarePlus}
          onClick={() => (setMenu(null), setDialog({ kind: 'project', container: {} }))}
        >
          New project
        </MenuItem>
        <MenuItem icon={FolderPlus} onClick={() => (setMenu(null), setDialog({ kind: 'folder' }))}>
          New folder
        </MenuItem>
        <MenuItem icon={Layers} onClick={() => (setMenu(null), setDialog({ kind: 'section' }))}>
          New section
        </MenuItem>
      </>
    );
  } else if (menu) {
    const target = menu.target;
    const siblings = siblingsOf(target);
    const index = siblings.findIndex((s) => s.id === target.entity.id);
    const close = () => setMenu(null);
    const common = (
      <>
        <MenuItem icon={Pencil} onClick={() => (close(), setRenaming(target.entity.id))}>
          Rename
        </MenuItem>
        {!(target.type === 'project' && target.entity.data.pinned) && (
          <>
            <MenuItem icon={ArrowUp} disabled={index <= 0} onClick={() => nudge(target, -1)}>
              Move up
            </MenuItem>
            <MenuItem
              icon={ArrowDown}
              disabled={index === siblings.length - 1}
              onClick={() => nudge(target, 1)}
            >
              Move down
            </MenuItem>
          </>
        )}
      </>
    );
    if (target.type === 'project' && isArchived(target.entity)) {
      const p = target.entity;
      menuContent = (
        <>
          <MenuItem icon={ArchiveRestore} onClick={() => void send(archiveChange(p, false))}>
            Restore
          </MenuItem>
          <MenuItem icon={Pencil} onClick={() => (close(), setRenaming(p.id))}>
            Rename
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            icon={Trash2}
            danger
            onClick={() => (close(), setDialog({ kind: 'delete', project: p }))}
          >
            Delete project…
          </MenuItem>
        </>
      );
    } else if (target.type === 'project') {
      const p = target.entity;
      const here = containerOf(p);
      menuContent = (
        <>
          <MenuItem icon={p.data.pinned ? PinOff : Pin} onClick={() => void togglePin(p)}>
            {p.data.pinned ? 'Unpin' : 'Pin to top'}
          </MenuItem>
          {common}
          <MenuItem
            icon={SquarePlus}
            onClick={() => (close(), setDialog({ kind: 'project', container: here }))}
          >
            New project next to it
          </MenuItem>
          <MenuSeparator />
          <MenuLabel>Move to</MenuLabel>
          {w.repositories
            .filter((r) => r.id !== here.repositoryId)
            .map((r) => (
              <MenuItem
                key={r.id}
                icon={FolderGit2}
                onClick={() => moveProject(p, { repositoryId: r.id })}
              >
                {r.data.name}
              </MenuItem>
            ))}
          {w.sections
            .filter((s) => here.repositoryId || s.id !== here.sectionId)
            .map((s) => (
              <MenuItem
                key={s.id}
                icon={Layers}
                onClick={() => moveProject(p, { sectionId: s.id })}
              >
                {s.data.name}
              </MenuItem>
            ))}
          {(here.repositoryId || here.sectionId) && (
            <MenuItem icon={CornerUpLeft} onClick={() => moveProject(p, {})}>
              Top level
            </MenuItem>
          )}
          <MenuSeparator />
          <MenuItem icon={Archive} onClick={() => void send(archiveChange(p, true))}>
            Archive
          </MenuItem>
          <MenuItem
            icon={Trash2}
            danger
            onClick={() => (close(), setDialog({ kind: 'delete', project: p }))}
          >
            Delete project…
          </MenuItem>
        </>
      );
    } else if (target.type === 'repository') {
      const r = target.entity;
      menuContent = (
        <>
          <MenuItem
            icon={SquarePlus}
            onClick={() => (
              close(),
              setDialog({ kind: 'project', container: { repositoryId: r.id } })
            )}
          >
            New project here
          </MenuItem>
          {common}
          {(w.sections.length > 0 || r.data.sectionId) && <MenuSeparator />}
          {(w.sections.length > 0 || r.data.sectionId) && <MenuLabel>Move to</MenuLabel>}
          {w.sections
            .filter((s) => s.id !== r.data.sectionId)
            .map((s) => (
              <MenuItem key={s.id} icon={Layers} onClick={() => moveFolder(r, s.id)}>
                {sectionPath(w.sections, s.id)}
              </MenuItem>
            ))}
          {r.data.sectionId && (
            <MenuItem icon={CornerUpLeft} onClick={() => moveFolder(r, undefined)}>
              Top level
            </MenuItem>
          )}
          <MenuSeparator />
          <MenuItem icon={Trash2} danger onClick={() => removeFolder(r)}>
            Remove folder
          </MenuItem>
        </>
      );
    } else {
      const s = target.entity;
      menuContent = (
        <>
          <MenuItem
            icon={SquarePlus}
            onClick={() => (
              close(),
              setDialog({ kind: 'project', container: { sectionId: s.id } })
            )}
          >
            New project here
          </MenuItem>
          <MenuItem
            icon={FolderPlus}
            onClick={() => (close(), setDialog({ kind: 'folder', sectionId: s.id }))}
          >
            New folder here
          </MenuItem>
          <MenuItem
            icon={Layers}
            onClick={() => (close(), setDialog({ kind: 'section', parentId: s.id }))}
          >
            New section inside
          </MenuItem>
          {common}
          {sectionMoves(s)}
          <MenuSeparator />
          <MenuItem
            icon={Trash2}
            danger
            onClick={() =>
              void apply(
                `Remove section “${s.data.name}” (what it held moves up a level)`,
                removeSectionOps(s, w.sections, w.repositories, w.projects),
              )
            }
          >
            Remove section
          </MenuItem>
        </>
      );
    }
  }

  /**
   * A section, what it holds, then the sections inside it. A section's header lines up with what
   * sits beside it (`at`); what it holds sits at `inside`: the same for a top-level section (its
   * folders line up with its name), a step further in for a section inside another.
   */
  const sectionBlock = (
    { section, items: list, children }: SectionNode,
    at: number,
    inside = at,
  ) => (
    <div key={section.id}>
      {sectionHeader(section, at)}
      {!collapsed.has(section.id) && (
        <>
          <ul>
            {items(list, inside)}
            {!list.length && !children.length && (
              <li
                className="flex items-center gap-1 py-1 pr-2 text-xs text-faint"
                style={{ paddingLeft: inside * 12 + 8 }}
              >
                Empty
                <InfoTip
                  label={`About section ${section.data.name}`}
                  detail="Drag projects or folders here, or move one here from its ⋯ menu."
                />
              </li>
            )}
          </ul>
          {children.map((child) => sectionBlock(child, inside, inside + 1))}
        </>
      )}
    </div>
  );

  const sectionHeader = (section: Section, depth = 0) => {
    const open = !collapsed.has(section.id);
    const target: Target = { type: 'section', entity: section };
    return (
      <div
        className={clsx(
          ROW,
          depth ? 'mt-1' : 'mt-2',
          'text-[11px] font-semibold tracking-wide text-faint uppercase',
          dropHighlight(section.id),
        )}
        style={{ paddingLeft: depth * 12 }}
        {...dropProps(
          section.id,
          ['project', 'repository'],
          (d) =>
            d.type === 'project'
              ? moveProjectOps(projectById(d.id), w.projects, w.repositories, {
                  sectionId: section.id,
                })
              : moveFolderOps(repositoryById.get(d.id)!, w.repositories, section.id),
          (d) =>
            `Move ${d.type === 'project' ? 'project' : 'folder'} “${nameOf(d)}” to section “${section.data.name}”`,
        )}
      >
        {renaming === section.id ? (
          <RenameInput
            value={section.data.name}
            onDone={(name) => (setRenaming(null), name && rename(target, name))}
          />
        ) : (
          <button
            type="button"
            onClick={() => toggleCollapsed(section.id)}
            onDoubleClick={() => setRenaming(section.id)}
            aria-expanded={open}
            className="flex min-w-0 flex-1 items-center gap-1 px-2 py-1 text-left hover:text-ink-soft"
          >
            <ChevronRight
              className={clsx('size-3 shrink-0 transition', open && 'rotate-90')}
              aria-hidden
            />
            <Layers className="size-3 shrink-0" aria-hidden />
            <span className="truncate">{section.data.name}</span>
            {!open && sectionHint(section.id) && (
              // Closed: the agent running in a folder inside still shows.
              <TerminalMark hint={sectionHint(section.id)!} where="this section" />
            )}
          </button>
        )}
        <Tooltip label="Options">
          <button
            type="button"
            aria-label={`Options for section ${section.data.name}`}
            className={MORE}
            onClick={(e) => openMenu(target, e)}
          >
            <MoreHorizontal className="size-4" aria-hidden />
          </button>
        </Tooltip>
      </div>
    );
  };

  return (
    <>
      <div className="px-2 pb-1">
        <DeskLink />
        <UpdatesLink />
        {/* One plus for everything new in the sidebar: a project, a folder or a section. */}
        <div className="mt-2 flex items-center justify-between pl-2">
          <span className="text-[11px] font-semibold tracking-wide text-faint uppercase">
            Projects
          </span>
          <Tooltip label="New project, folder or section">
            <button
              type="button"
              data-hover-shot=""
              aria-label="New project, folder or section"
              aria-haspopup="menu"
              aria-expanded={menu?.target === 'add'}
              onClick={(e) => openMenu('add', e)}
              className={clsx(ICON_GHOST, 'pointer-coarse:p-2')}
            >
              <Plus className="size-4" aria-hidden />
            </button>
          </Tooltip>
        </div>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-2 pb-4" aria-label="Projects">
        {w.tree.pinned.length > 0 && (
          <div className="pb-2">
            <div className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold tracking-wide text-faint uppercase">
              <Pin className="size-3" /> Pinned
            </div>
            <ul>{w.tree.pinned.map((p) => projectRow(p, 0, 'pinned'))}</ul>
          </div>
        )}
        <ul>{items(w.tree.root, 0)}</ul>
        {w.tree.sections.map((node) => sectionBlock(node, 0))}
        {drag && (w.tree.sections.length > 0 || drag.type === 'project') && (
          <div
            className={clsx(
              'mt-2 rounded-control border border-dashed border-neutral-300 px-2 py-2 text-center text-xs text-faint dark:border-neutral-700',
              dropHighlight('top'),
            )}
            {...dropProps(
              'top',
              ['project', 'repository'],
              (d) =>
                d.type === 'project'
                  ? moveProjectOps(projectById(d.id), w.projects, w.repositories, {})
                  : moveFolderOps(repositoryById.get(d.id)!, w.repositories, undefined),
              (d) =>
                `Move ${d.type === 'project' ? 'project' : 'folder'} “${nameOf(d)}” to the top level`,
            )}
          >
            Drop here for the top level
          </div>
        )}
        {w.tree.archived.length > 0 && (
          <div className="pt-2">
            <div
              className={clsx(ROW, 'text-[11px] font-semibold tracking-wide text-faint uppercase')}
            >
              <button
                type="button"
                onClick={() => toggleCollapsed(ARCHIVED_OPEN)}
                aria-expanded={archivedOpen}
                className="flex min-w-0 flex-1 items-center gap-1 px-2 py-1 text-left hover:text-ink-soft"
              >
                <ChevronRight
                  className={clsx('size-3 shrink-0 transition', archivedOpen && 'rotate-90')}
                  aria-hidden
                />
                <Archive className="size-3 shrink-0" aria-hidden />
                <span className="truncate">Archived ({w.tree.archived.length})</span>
              </button>
            </div>
            {archivedOpen && <ul>{w.tree.archived.map((p) => projectRow(p, 0, 'archived'))}</ul>}
          </div>
        )}
      </nav>

      {menu && (
        <Menu anchor={menu.anchor} onClose={() => setMenu(null)}>
          {menuContent}
        </Menu>
      )}
      {/* Dialogs and the toast render at the top of the page: the sidebar is sticky, which makes it
          its own stacking context, so anything inside it would sit behind the main view. */}
      {createPortal(
        <>
          {dialog?.kind === 'project' && (
            <NewProjectDialog initial={dialog.container} onClose={() => setDialog(null)} />
          )}
          {dialog?.kind === 'folder' && (
            <PromptDialog
              title="New folder"
              submitLabel="Create folder"
              fields={[
                { name: 'name', label: 'Name', required: true, placeholder: 'e.g. my-app' },
                { name: 'path', label: 'Local path (optional)', placeholder: '~/code/my-app' },
              ]}
              onClose={() => setDialog(null)}
              onSubmit={({ name, path }) => {
                setDialog(null);
                void apply(`Add folder “${name}”`, [
                  {
                    op: 'create',
                    type: 'repository',
                    data: {
                      name: name!,
                      ...(path ? { path } : {}),
                      ...(dialog.sectionId ? { sectionId: dialog.sectionId } : {}),
                    },
                  },
                ]);
              }}
            />
          )}
          {dialog?.kind === 'section' && (
            <PromptDialog
              title="New section"
              submitLabel="Create section"
              fields={[{ name: 'name', label: 'Name', required: true, placeholder: 'e.g. Work' }]}
              onClose={() => setDialog(null)}
              onSubmit={({ name }) => {
                setDialog(null);
                const parentId = dialog.parentId;
                void apply(
                  parentId
                    ? `Add section “${name}” inside “${sectionPath(w.sections, parentId)}”`
                    : `Add section “${name}”`,
                  [
                    {
                      op: 'create',
                      type: 'section',
                      data: { name: name!, ...(parentId ? { parentId } : {}) },
                    },
                  ],
                );
              }}
            />
          )}
          {dialog?.kind === 'delete' && (
            <DeleteProjectDialog
              project={dialog.project}
              onClose={() => setDialog(null)}
              onConfirm={() => void deleteProject(dialog.project)}
            />
          )}
          {notice && (
            <div
              role={notice.kind === 'error' ? 'alert' : 'status'}
              className={clsx(
                'fixed bottom-4 left-4 z-50 flex max-w-sm items-start gap-3 rounded-tile px-4 py-3 text-sm whitespace-pre-line shadow-popover',
                notice.kind === 'error' ? 'bg-rose-600 text-white' : 'bg-inverse text-on-inverse',
              )}
            >
              <span className="min-w-0 flex-1">
                {notice.kind === 'error' ? `Couldn’t save: ${notice.text}` : notice.text}
              </span>
              {notice.kind === 'undo' && notice.revision && (
                <button
                  type="button"
                  onClick={() => void undo(notice.revision!, notice.text)}
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
        </>,
        document.body,
      )}
    </>
  );
}

/** A running agent terminal's mark: the dot says it printed since a panel here showed it. */
function TerminalMark({ hint, where }: { hint: TerminalHint; where?: string }) {
  const label = `${hint.agent} terminal running${where ? ` in ${where}` : ''}${hint.unseen ? ', new output' : ''}`;
  return (
    <span
      data-terminal-mark=""
      title={label}
      className="relative ml-auto inline-flex shrink-0 text-faint"
    >
      <SquareTerminal aria-hidden className="size-3.5" />
      <span className="sr-only"> ({label})</span>
      <TerminalDot unseen={hint.unseen} className="-top-1 -right-1 size-1.5" />
    </span>
  );
}
