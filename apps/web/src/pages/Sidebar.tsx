import type { Entity, Operation } from '@pharos/schema';
import clsx from 'clsx';
import {
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
  Plus,
  SquarePlus,
  Trash2,
  Undo2,
} from 'lucide-react';
import { useEffect, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, useLocation, useNavigate } from 'react-router';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '../catalog/menu';
import { BUTTON, Dot, toneOf } from '../catalog/ui';
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
  projectSiblings,
  type Container,
  type Item,
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

const FIELD =
  'w-full rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900';

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
        className="relative w-full max-w-sm space-y-4 rounded-xl bg-white p-5 shadow-xl dark:bg-neutral-900"
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
        className="relative w-full max-w-sm space-y-4 rounded-xl bg-white p-5 shadow-xl dark:bg-neutral-900"
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <h2 className="text-base font-semibold">Delete “{project.data.name}”?</h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
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
        className="w-full rounded border border-sky-300 bg-white px-1.5 py-0.5 text-sm dark:border-sky-800 dark:bg-neutral-900"
      />
    </form>
  );
}

const ROW = 'group/row relative flex items-center gap-1 rounded-md pr-1 text-sm';
const MORE =
  'shrink-0 rounded p-0.5 text-neutral-400 opacity-0 hover:bg-neutral-200 hover:text-neutral-700 focus:opacity-100 group-hover/row:opacity-100 dark:hover:bg-neutral-700 dark:hover:text-neutral-200';

/**
 * The project sidebar: pinned projects, folders (repositories), loose projects, and sections.
 * Every item has a ⋯ menu (and can be dragged) to rename, pin, reorder, move, add, or remove;
 * each change is saved as a revision with an Undo.
 */
export function Sidebar() {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, toggleCollapsed] = useCollapsed();
  const [menu, setMenu] = useState<{ target: Target | 'add'; anchor: DOMRect } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dialog, setDialog] = useState<
    | { kind: 'project'; container: Container }
    | { kind: 'folder'; sectionId?: string }
    | { kind: 'section' }
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
      <div
        role="status"
        aria-label="Loading projects"
        className="animate-pulse space-y-2 px-4 py-2"
      >
        {[70, 55, 80, 60].map((w) => (
          <div
            key={w}
            className="h-4 rounded bg-neutral-200/70 dark:bg-neutral-800"
            style={{ width: `${w}%` }}
          />
        ))}
      </div>
    );
  const w: Workspace = ws.workspace;
  const repositoryById = new Map(w.repositories.map((r) => [r.id, r]));
  const sectionById = new Map(w.sections.map((s) => [s.id, s]));

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
        : [...w.sections].sort((a, b) => a.data.order - b.data.order);
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

  const projectRow = (project: Project, depth: number, inPinned = false) => {
    const target: Target = { type: 'project', entity: project };
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
                  'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5',
                  isActive
                    ? 'bg-neutral-100 font-medium text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100'
                    : 'text-neutral-600 hover:bg-neutral-50 dark:text-neutral-300 dark:hover:bg-neutral-800/60',
                )
              }
            >
              <Dot tone={toneOf(project.data.status)} />
              <span className="truncate">{project.data.name}</span>
              {inPinned && project.data.repositoryId && (
                <span className="ml-auto truncate text-xs text-neutral-400">
                  {repositoryById.get(project.data.repositoryId)?.data.name}
                </span>
              )}
            </NavLink>
          )}
          <button
            type="button"
            aria-label={`Options for ${project.data.name}`}
            className={MORE}
            onClick={(e) => openMenu(target, e)}
          >
            <MoreHorizontal className="size-4" />
          </button>
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
          className={clsx(
            ROW,
            'text-xs font-medium text-neutral-500 dark:text-neutral-400',
            dropHighlight(repository.id),
          )}
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
            <button
              type="button"
              onClick={() => toggleCollapsed(repository.id)}
              onDoubleClick={() => setRenaming(repository.id)}
              title={repository.data.path ?? repository.data.url}
              aria-expanded={open}
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1 text-left hover:text-neutral-800 dark:hover:text-neutral-200"
            >
              <ChevronRight className={clsx('size-3 shrink-0 transition', open && 'rotate-90')} />
              <FolderGit2 className="size-3.5 shrink-0" />
              <span className="truncate">{repository.data.name}</span>
              {!open && <span className="font-normal text-neutral-400">{projects.length}</span>}
            </button>
          )}
          <button
            type="button"
            aria-label={`Options for folder ${repository.data.name}`}
            className={MORE}
            onClick={(e) => openMenu(target, e)}
          >
            <MoreHorizontal className="size-4" />
          </button>
        </div>
        {open && (
          <ul>
            {projects.map((p) => projectRow(p, depth + 1))}
            {!projects.length && (
              <li
                className="py-1 text-xs text-neutral-400"
                style={{ paddingLeft: (depth + 1) * 12 + 8 }}
              >
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
    if (target.type === 'project') {
      const p = target.entity;
      const here = containerOf(p);
      menuContent = (
        <>
          <MenuItem
            icon={p.data.pinned ? PinOff : Pin}
            onClick={() =>
              void apply(`${p.data.pinned ? 'Unpin' : 'Pin'} project “${p.data.name}”`, [
                {
                  op: 'update',
                  type: 'project',
                  id: p.id,
                  data: { pinned: p.data.pinned ? null : true },
                },
              ])
            }
          >
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
                {s.data.name}
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
          {common}
          <MenuSeparator />
          <MenuItem
            icon={Trash2}
            danger
            onClick={() =>
              void apply(`Remove section “${s.data.name}” (its contents move to the top level)`, [
                { op: 'delete', type: 'section', id: s.id },
              ])
            }
          >
            Remove section
          </MenuItem>
        </>
      );
    }
  }

  const sectionHeader = (section: Section) => {
    const open = !collapsed.has(section.id);
    const target: Target = { type: 'section', entity: section };
    return (
      <div
        className={clsx(
          ROW,
          'mt-2 text-[11px] font-semibold tracking-wide text-neutral-400 uppercase',
          dropHighlight(section.id),
        )}
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
            className="flex min-w-0 flex-1 items-center gap-1 px-2 py-1 text-left hover:text-neutral-600 dark:hover:text-neutral-300"
          >
            <ChevronRight className={clsx('size-3 shrink-0 transition', open && 'rotate-90')} />
            <span className="truncate">{section.data.name}</span>
          </button>
        )}
        <button
          type="button"
          aria-label={`Options for section ${section.data.name}`}
          className={MORE}
          onClick={(e) => openMenu(target, e)}
        >
          <MoreHorizontal className="size-4" />
        </button>
      </div>
    );
  };

  return (
    <>
      <div className="px-2 pb-1">
        <button
          type="button"
          onClick={(e) => openMenu('add', e)}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          <Plus className="size-3.5" /> New…
        </button>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-2 pb-4" aria-label="Projects">
        {w.tree.pinned.length > 0 && (
          <div className="pb-2">
            <div className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold tracking-wide text-neutral-400 uppercase">
              <Pin className="size-3" /> Pinned
            </div>
            <ul>{w.tree.pinned.map((p) => projectRow(p, 0, true))}</ul>
          </div>
        )}
        <ul>{items(w.tree.root, 0)}</ul>
        {w.tree.sections.map(({ section, items: list }) => (
          <div key={section.id}>
            {sectionHeader(section)}
            {!collapsed.has(section.id) && (
              <ul>
                {items(list, 0)}
                {!list.length && (
                  <li className="px-2 py-1 text-xs text-neutral-400">
                    Empty: drag projects or folders here
                  </li>
                )}
              </ul>
            )}
          </div>
        ))}
        {drag && (w.tree.sections.length > 0 || drag.type === 'project') && (
          <div
            className={clsx(
              'mt-2 rounded-md border border-dashed border-neutral-300 px-2 py-2 text-center text-xs text-neutral-400 dark:border-neutral-700',
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
                void apply(`Add section “${name}”`, [
                  { op: 'create', type: 'section', data: { name: name! } },
                ]);
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
                'fixed bottom-4 left-4 z-50 flex max-w-sm items-start gap-3 rounded-lg px-4 py-3 text-sm whitespace-pre-line shadow-lg',
                notice.kind === 'error'
                  ? 'bg-rose-600 text-white'
                  : 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900',
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
                className="font-semibold"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          )}
        </>,
        document.body,
      )}
    </>
  );
}
