import type { Entity, RevisionSummary } from '@pharos/schema';
import clsx from 'clsx';
import {
  Archive,
  ArchiveRestore,
  BookmarkPlus,
  MessageCircleQuestion,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useViewData } from '../catalog/context';
import { Menu, MenuItem } from '../catalog/menu';
import { AUTHOR_ICONS } from '../catalog/history';
import { useResource } from '../lib/api';
import { timeAgo } from '../lib/format';
import { dismissAnswer, keepAnswer } from './answers';

/** Pinned views first, then by order. */
const isAnswer = (v: Entity<'view'>) => v.data.kind === 'answer';

/** Answer views past their expiry; they're hidden unless kept. */
export function isExpired(view: Entity<'view'>, now = Date.now()): boolean {
  return isAnswer(view) && !!view.data.expiresAt && Date.parse(view.data.expiresAt) <= now;
}

/** What a tab's tooltip says: the question or description, and when the view last changed. */
export function tabTitle(view: Entity<'view'>, now = Date.now()): string {
  return [view.data.question ?? view.data.description, `Updated ${timeAgo(view.updatedAt, now)}`]
    .filter(Boolean)
    .join('\n');
}

/**
 * When the active view last changed and who changed it, so similarly named views can be told
 * apart. Opens the view's details and history.
 */
export function ViewUpdated({ view }: { view: Entity<'view'> }) {
  const { version, actions } = useViewData();
  const latest = useResource<RevisionSummary[]>(
    `/api/history?entityId=${view.id}&limit=1&v=${version}`,
  );
  const rev = latest.data?.[0];
  const Icon = rev ? AUTHOR_ICONS[rev.author.kind] : null;
  return (
    <button
      type="button"
      onClick={() => actions.open({ entity: view.id })}
      title={rev ? `#${rev.id} · ${rev.message}` : 'Show this view’s history'}
      className="inline-flex max-w-full items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
    >
      {Icon && <Icon className="size-3.5 shrink-0" aria-hidden />}
      <span className="truncate">
        Updated {timeAgo(view.updatedAt)}
        {rev && ` by ${rev.author.name}`}
        {rev && <span className="hidden sm:inline"> · {rev.message}</span>}
      </span>
    </button>
  );
}

/** Saved views first (pinned, then by order), then answers, newest first. */
export function sortViews(views: Entity<'view'>[]): Entity<'view'>[] {
  return [...views].sort(
    (a, b) =>
      Number(isAnswer(a)) - Number(isAnswer(b)) ||
      (isAnswer(a)
        ? b.createdRev - a.createdRev
        : Number(b.data.pinned) - Number(a.data.pinned) || a.data.order - b.data.order),
  );
}

/**
 * The project's view tabs. The active tab's ⋯ menu renames, pins, archives, or deletes it;
 * "+" adds a blank view; archived views can be restored from their own menu.
 */
export function ViewTabs({
  projectId,
  views,
  active,
  onCreated,
}: {
  projectId: string;
  views: Entity<'view'>[];
  active: Entity<'view'> | undefined;
  onCreated: () => void;
}) {
  const { actions } = useViewData();
  const navigate = useNavigate();
  const [menu, setMenu] = useState<{ kind: 'view' | 'archived'; anchor: DOMRect } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const visible = sortViews(
    views.filter((v) => !v.data.archived && (!isExpired(v) || v.id === active?.id)),
  );
  // Archived views plus answers that were dismissed or have expired.
  const archived = views.filter((v) => v.data.archived || isExpired(v));
  const close = () => {
    setMenu(null);
    setConfirmDelete(false);
  };

  const update = (view: Entity<'view'>, data: Record<string, unknown>, message: string) =>
    actions.apply(message, [{ op: 'update', type: 'view', id: view.id, data }], { undoable: true });

  const create = async () => {
    const outcome = await actions.apply(
      'Add a view',
      [
        {
          op: 'create',
          type: 'view',
          ref: 'view',
          data: { projectId, name: 'New view', spec: { component: 'Board', widgets: [] } },
        },
      ],
      { undoable: true },
    );
    if (outcome.ok && outcome.created.view) {
      navigate(`/projects/${projectId}/views/${outcome.created.view}`);
      onCreated();
    }
  };

  return (
    <nav className="-mb-px flex min-w-0 basis-full items-end gap-1 overflow-x-auto md:flex-1 md:basis-auto">
      {visible.map((view, i) => {
        const isActive = view.id === active?.id;
        const firstAnswer = isAnswer(view) && (i === 0 || !isAnswer(visible[i - 1]!));
        return (
          <div key={view.id} className="relative flex shrink-0 items-center">
            {firstAnswer && i > 0 && (
              <span
                aria-hidden
                className="mx-1.5 mb-2 h-5 w-px self-end bg-neutral-200 dark:bg-neutral-700"
              />
            )}
            {isActive && renaming ? (
              <form
                className="px-1 py-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = new FormData(e.currentTarget).get('name')?.toString().trim();
                  setRenaming(false);
                  if (name && name !== view.data.name)
                    void update(view, { name }, `Rename view “${view.data.name}” to “${name}”`);
                }}
              >
                <input
                  name="name"
                  aria-label="View name"
                  autoFocus
                  defaultValue={view.data.name}
                  onBlur={(e) => e.currentTarget.form?.requestSubmit()}
                  onKeyDown={(e) => e.key === 'Escape' && setRenaming(false)}
                  className="w-36 rounded-md border border-sky-300 bg-white px-2 py-1 text-sm dark:border-sky-800 dark:bg-neutral-900"
                />
              </form>
            ) : (
              <Link
                to={`/projects/${projectId}/views/${view.id}`}
                title={tabTitle(view)}
                onDoubleClick={() => isActive && setRenaming(true)}
                className={clsx(
                  'inline-flex items-center gap-1.5 border-b-2 py-2 pl-3 text-sm font-medium whitespace-nowrap',
                  isActive
                    ? 'border-neutral-900 pr-1 text-neutral-900 dark:border-neutral-100 dark:text-neutral-100'
                    : 'border-transparent pr-3 text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200',
                )}
              >
                {view.data.pinned && <Pin className="size-3" />}
                {isAnswer(view) && (
                  <MessageCircleQuestion className="size-3.5 text-sky-500" aria-label="Answer" />
                )}
                {view.data.name}
              </Link>
            )}
            {isActive && !renaming && (
              <button
                type="button"
                aria-label={`Options for ${view.data.name}`}
                onClick={(e) =>
                  setMenu(
                    menu ? null : { kind: 'view', anchor: e.currentTarget.getBoundingClientRect() },
                  )
                }
                className="mb-0.5 rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
              >
                <MoreHorizontal className="size-4" />
              </button>
            )}
            {isActive && menu?.kind === 'view' && isAnswer(view) && (
              <Menu anchor={menu.anchor} onClose={close}>
                <MenuItem
                  icon={BookmarkPlus}
                  onClick={() => {
                    close();
                    const { message, operations } = keepAnswer(view);
                    void actions.apply(message, operations, { undoable: true });
                  }}
                >
                  Keep as a view
                </MenuItem>
                <MenuItem icon={Pencil} onClick={() => (close(), setRenaming(true))}>
                  Rename
                </MenuItem>
                <MenuItem
                  icon={X}
                  danger
                  onClick={() => {
                    close();
                    const { message, operations } = dismissAnswer(view);
                    void actions.apply(message, operations, { undoable: true });
                    navigate(`/projects/${projectId}`);
                  }}
                >
                  Dismiss
                </MenuItem>
              </Menu>
            )}
            {isActive && menu?.kind === 'view' && !isAnswer(view) && (
              <Menu anchor={menu.anchor} onClose={close}>
                <MenuItem icon={Pencil} onClick={() => (close(), setRenaming(true))}>
                  Rename
                </MenuItem>
                <MenuItem
                  icon={view.data.pinned ? PinOff : Pin}
                  onClick={() => {
                    close();
                    void update(
                      view,
                      { pinned: !view.data.pinned },
                      `${view.data.pinned ? 'Unpin' : 'Pin'} view “${view.data.name}”`,
                    );
                  }}
                >
                  {view.data.pinned ? 'Unpin' : 'Pin'}
                </MenuItem>
                {visible.length > 1 && (
                  <>
                    <MenuItem
                      icon={Archive}
                      onClick={() => {
                        close();
                        void update(view, { archived: true }, `Archive view “${view.data.name}”`);
                        navigate(`/projects/${projectId}`);
                      }}
                    >
                      Archive
                    </MenuItem>
                    {confirmDelete ? (
                      <MenuItem
                        icon={Trash2}
                        danger
                        onClick={() => {
                          close();
                          void actions.apply(
                            `Delete view “${view.data.name}”`,
                            [{ op: 'delete', type: 'view', id: view.id }],
                            { undoable: true },
                          );
                          navigate(`/projects/${projectId}`);
                        }}
                      >
                        Click again to delete
                      </MenuItem>
                    ) : (
                      <MenuItem icon={Trash2} danger onClick={() => setConfirmDelete(true)}>
                        Delete…
                      </MenuItem>
                    )}
                  </>
                )}
              </Menu>
            )}
          </div>
        );
      })}
      <button
        type="button"
        aria-label="New view"
        title="New view"
        onClick={() => void create()}
        className="mb-1 shrink-0 rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
      >
        <Plus className="size-4" />
      </button>
      {archived.length > 0 && (
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={(e) =>
              setMenu(
                menu ? null : { kind: 'archived', anchor: e.currentTarget.getBoundingClientRect() },
              )
            }
            className="mb-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <Archive className="size-3.5" /> Archived ({archived.length})
          </button>
          {menu?.kind === 'archived' && (
            <Menu anchor={menu.anchor} onClose={close}>
              {archived.map((view) =>
                isAnswer(view) ? (
                  <MenuItem
                    key={view.id}
                    icon={BookmarkPlus}
                    onClick={() => {
                      close();
                      const { message, operations } = keepAnswer(view);
                      void actions.apply(message, operations, { undoable: true });
                      navigate(`/projects/${projectId}/views/${view.id}`);
                    }}
                  >
                    Keep “{view.data.name}”{isExpired(view) ? ' (expired)' : ''}
                  </MenuItem>
                ) : (
                  <MenuItem
                    key={view.id}
                    icon={ArchiveRestore}
                    onClick={() => {
                      close();
                      void update(view, { archived: null }, `Restore view “${view.data.name}”`);
                      navigate(`/projects/${projectId}/views/${view.id}`);
                    }}
                  >
                    Restore “{view.data.name}”
                  </MenuItem>
                ),
              )}
            </Menu>
          )}
        </div>
      )}
    </nav>
  );
}
