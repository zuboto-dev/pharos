import type { Entity, RevisionSummary } from '@pharos/schema';
import clsx from 'clsx';
import {
  Archive,
  ArchiveRestore,
  BookmarkPlus,
  ChevronDown,
  MessageCircleQuestion,
  MoreHorizontal,
  Newspaper,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useViewData } from '../catalog/context';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '../catalog/menu';
import { AUTHOR_ICONS } from '../catalog/history';
import { PresenceDot, viewsWithPresence, workingLine } from '../catalog/presence';
import { usePresence } from '../lib/events';
import { useResource } from '../lib/api';
import { timeAgo } from '../lib/format';
import { useChangedViews } from '../lib/freshness';
import { dismissAnswer, keepAnswer } from './answers';
import { CHANGED_TEXT, ChangedDot } from './freshness';

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
      className="inline-flex max-w-full items-center gap-1.5 text-xs text-muted hover:text-ink"
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
 * Which tabs fit on one line (v0.2 B1). `widths` are the tabs' widths in order, `available` the
 * room for them, `more` the width of the "More" button that holds the rest. Tabs stay in order;
 * the active one is always kept, replacing the last ones that fit when it would fall under More.
 * Returns the indexes to show: every index when everything fits (or nothing is measured yet).
 */
export function fitTabs(
  widths: readonly number[],
  available: number,
  active: number,
  more: number,
): number[] {
  const all = widths.map((_, i) => i);
  const total = widths.reduce((sum, w) => sum + w, 0);
  if (available <= 0 || total <= available) return all;
  const budget = available - more;
  const shown: number[] = [];
  let used = 0;
  for (const i of all) {
    if (used + widths[i]! > budget) break;
    shown.push(i);
    used += widths[i]!;
  }
  if (active < 0 || active >= widths.length || shown.includes(active)) return shown;
  // Make room for the active tab by moving the last ones that fit under More.
  while (shown.length && used + widths[active]! > budget) used -= widths[shown.pop()!]!;
  return [...shown, active].sort((a, b) => a - b);
}

/** ← → Home End move between the tabs and the More button. */
function moveBetweenTabs(e: KeyboardEvent<HTMLElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  const stops = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-tabstop]')];
  const index = stops.indexOf(document.activeElement as HTMLElement);
  if (index < 0) return;
  e.preventDefault();
  const next =
    e.key === 'Home'
      ? 0
      : e.key === 'End'
        ? stops.length - 1
        : Math.max(0, Math.min(stops.length - 1, index + (e.key === 'ArrowRight' ? 1 : -1)));
  stops[next]!.focus();
}

const TAB =
  'relative inline-flex max-w-56 min-w-0 items-center gap-1.5 border-b-2 py-2 pl-3 text-sm font-medium whitespace-nowrap transition-colors duration-(--motion-base) ease-calm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-400';
const ICON =
  'mb-1 inline-flex shrink-0 items-center rounded-control p-1.5 text-faint hover:bg-subtle hover:text-ink-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-400';

/** A tab's icons and name (shared by the tab and its hidden measuring copy). */
function TabLabel({ view }: { view: Entity<'view'> }) {
  return (
    <>
      {view.data.pinned && <Pin className="size-3 shrink-0" />}
      {isAnswer(view) && (
        <MessageCircleQuestion className="size-3.5 shrink-0 text-sky-500" aria-label="Answer" />
      )}
      {/* A report (R13 page, R14 document): told apart from working pages. */}
      {(view.data.page || view.data.doc) && !isAnswer(view) && (
        <Newspaper className="size-3.5 shrink-0 text-faint" aria-label="Report" />
      )}
      <span className="truncate">{view.data.name}</span>
    </>
  );
}

/**
 * The project's view tabs, on one line at every width (v0.2 B1): tabs that don't fit go under
 * "More", and the active tab always stays in sight. The active tab's ⋯ menu renames, pins,
 * archives, or deletes it; "+" adds a blank view; archived views are restored from More (or from
 * "Archived" when every tab fits). ← → move between the tabs.
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
  // Views an agent is working on right now (v0.2 B5): view id → agents.
  const working = viewsWithPresence(usePresence());
  // Views changed since the reader last looked (R11); the open one counts as seen.
  const changedIds = useChangedViews().projects[projectId];
  const changed = new Set((changedIds ?? []).filter((id) => id !== active?.id));
  const [menu, setMenu] = useState<{ kind: 'view' | 'more'; anchor: DOMRect } | null>(null);
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

  // Every tab is measured once from a hidden copy; the row then shows the ones that fit.
  const nav = useRef<HTMLElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  const [sizes, setSizes] = useState<{ tabs: number[]; plus: number; more: number }>({
    tabs: [],
    plus: 0,
    more: 0,
  });
  const shape = `${active?.id}|${visible.map((v) => `${v.id}:${v.data.name}:${v.data.pinned ? 1 : 0}`).join('|')}`;
  useLayoutEffect(() => {
    const row = nav.current;
    const copy = measure.current;
    if (!row || !copy) return;
    const read = () => {
      const width = (el: Element | null | undefined) => el?.getBoundingClientRect().width ?? 0;
      setRoom(row.clientWidth);
      setSizes({
        tabs: [...copy.querySelectorAll('[data-measure="tab"]')].map(width),
        plus: width(copy.querySelector('[data-measure="plus"]')),
        more: width(copy.querySelector('[data-measure="more"]')),
      });
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    // The row's width changes with the window; the copy's when the fonts finish loading.
    const observer = new ResizeObserver(read);
    observer.observe(row);
    observer.observe(copy);
    return () => observer.disconnect();
  }, [shape]);
  const activeIndex = visible.findIndex((v) => v.id === active?.id);
  const measured = room > 0 && sizes.tabs.length === visible.length;
  // With archived views the button is always there, so its room is kept from the start.
  const shownIndexes = measured
    ? fitTabs(
        sizes.tabs,
        room - sizes.plus - (archived.length ? sizes.more : 0),
        activeIndex,
        archived.length ? 0 : sizes.more,
      )
    : visible.map((_, i) => i);
  const shown = shownIndexes.map((i) => visible[i]!);
  const overflow = visible.filter((_, i) => !shownIndexes.includes(i));

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

  const restore = (view: Entity<'view'>) => {
    close();
    if (isAnswer(view)) {
      const { message, operations } = keepAnswer(view);
      void actions.apply(message, operations, { undoable: true });
    } else void update(view, { archived: null }, `Restore view “${view.data.name}”`);
    navigate(`/projects/${projectId}/views/${view.id}`);
  };

  return (
    <nav
      ref={nav}
      aria-label="Views"
      onKeyDown={moveBetweenTabs}
      className="relative -mb-px flex min-w-0 flex-1 items-end gap-1 overflow-hidden"
    >
      {/* The hidden copy every tab is measured from: the same classes, never seen or read. */}
      <div
        ref={measure}
        aria-hidden
        className="pointer-events-none invisible absolute top-0 left-0 flex h-0 w-max items-end gap-1 overflow-hidden"
      >
        {visible.map((view, i) => (
          <span key={view.id} data-measure="tab" className="flex shrink-0 items-center">
            {isAnswer(view) && i > 0 && !isAnswer(visible[i - 1]!) && (
              <span className="mx-1.5 h-5 w-px" />
            )}
            <span className={clsx(TAB, view.id === active?.id ? 'pr-1' : 'pr-3')}>
              <TabLabel view={view} />
            </span>
            {view.id === active?.id && <span className="size-6 shrink-0" />}
          </span>
        ))}
        <span data-measure="plus" className={ICON}>
          <Plus className="size-4" />
        </span>
        <span data-measure="more" className={clsx(ICON, 'gap-1 px-2 text-xs')}>
          More <span className="px-1.5">{visible.length}</span>
          <ChevronDown className="size-3.5" />
        </span>
      </div>
      {shown.map((view) => {
        const i = visible.indexOf(view);
        const isActive = view.id === active?.id;
        const firstAnswer = isAnswer(view) && (i === 0 || !isAnswer(visible[i - 1]!));
        return (
          <div
            key={view.id}
            // The open tab gives way on a narrow screen (its name truncates), so More stays in sight.
            className={clsx('relative flex min-w-0 items-center', isActive ? 'shrink' : 'shrink-0')}
          >
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
                  className="w-36 rounded-control border border-sky-300 bg-surface px-2 py-1 text-sm dark:border-sky-800"
                />
              </form>
            ) : (
              <Link
                to={`/projects/${projectId}/views/${view.id}`}
                title={tabTitle(view)}
                data-tabstop
                aria-current={isActive ? 'page' : undefined}
                onDoubleClick={() => isActive && setRenaming(true)}
                className={clsx(
                  TAB,
                  isActive
                    ? 'border-inverse pr-1 text-ink'
                    : 'border-transparent pr-3 text-muted hover:text-ink',
                )}
              >
                <TabLabel view={view} />
                {working.has(view.id) ? (
                  <>
                    <PresenceDot className="absolute top-1.5 right-0.5 size-1.5" />
                    <span className="sr-only"> ({workingLine(working.get(view.id)!, 'it')})</span>
                  </>
                ) : (
                  changed.has(view.id) && (
                    <>
                      <ChangedDot className="absolute top-1.5 right-0.5" />
                      <span className="sr-only"> ({CHANGED_TEXT})</span>
                    </>
                  )
                )}
              </Link>
            )}
            {isActive && !renaming && (
              <button
                type="button"
                aria-label={`Options for ${view.data.name}`}
                aria-haspopup="menu"
                aria-expanded={menu?.kind === 'view'}
                onClick={(e) =>
                  setMenu(
                    menu ? null : { kind: 'view', anchor: e.currentTarget.getBoundingClientRect() },
                  )
                }
                className="mb-0.5 shrink-0 rounded-control p-1 text-faint hover:bg-subtle hover:text-ink-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-sky-400"
              >
                <MoreHorizontal className="size-4" />
              </button>
            )}
            {isActive && menu?.kind === 'view' && isAnswer(view) && (
              <Menu anchor={menu.anchor} onClose={close} label={`Options for ${view.data.name}`}>
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
              <Menu anchor={menu.anchor} onClose={close} label={`Options for ${view.data.name}`}>
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
      {(overflow.length > 0 || archived.length > 0) && (
        <button
          type="button"
          data-tabstop
          aria-haspopup="menu"
          aria-expanded={menu?.kind === 'more'}
          aria-label={
            overflow.length
              ? `More views (${overflow.length}${archived.length ? `, ${archived.length} archived` : ''})`
              : `Archived (${archived.length})`
          }
          onClick={(e) =>
            setMenu(menu ? null : { kind: 'more', anchor: e.currentTarget.getBoundingClientRect() })
          }
          className={clsx(ICON, 'relative gap-1 px-2 text-xs text-muted')}
        >
          {overflow.some((v) => working.has(v.id)) ? (
            <PresenceDot className="absolute top-0.5 right-0.5 size-1.5" />
          ) : (
            overflow.some((v) => changed.has(v.id)) && (
              <>
                <ChangedDot className="absolute top-0.5 right-0.5" />
                <span className="sr-only"> (some {CHANGED_TEXT})</span>
              </>
            )
          )}
          {overflow.length ? (
            <>
              More
              <span className="rounded-full bg-subtle px-1.5 text-ink-soft">{overflow.length}</span>
              <ChevronDown className="size-3.5" aria-hidden />
            </>
          ) : (
            <>
              <Archive className="size-3.5" aria-hidden /> Archived ({archived.length})
            </>
          )}
        </button>
      )}
      <button
        type="button"
        aria-label="New view"
        title="New view"
        onClick={() => void create()}
        className={ICON}
      >
        <Plus className="size-4" />
      </button>
      {menu?.kind === 'more' && (
        <Menu anchor={menu.anchor} onClose={close} label="More views">
          {overflow.map((view) => (
            <MenuItem
              key={view.id}
              icon={
                isAnswer(view)
                  ? MessageCircleQuestion
                  : view.data.page || view.data.doc
                    ? Newspaper
                    : view.data.pinned
                      ? Pin
                      : undefined
              }
              onClick={() => {
                close();
                navigate(`/projects/${projectId}/views/${view.id}`);
              }}
            >
              {view.data.name}
              {working.has(view.id) && (
                <>
                  <PresenceDot className="ml-1.5 size-1.5 align-middle" />
                  <span className="sr-only"> ({workingLine(working.get(view.id)!, 'it')})</span>
                </>
              )}
              {!working.has(view.id) && changed.has(view.id) && (
                <>
                  <ChangedDot className="ml-1.5 align-middle" />
                  <span className="sr-only"> ({CHANGED_TEXT})</span>
                </>
              )}
            </MenuItem>
          ))}
          {overflow.length > 0 && archived.length > 0 && <MenuSeparator />}
          {archived.length > 0 && <MenuLabel>Archived</MenuLabel>}
          {archived.map((view) => (
            <MenuItem
              key={view.id}
              icon={isAnswer(view) ? BookmarkPlus : ArchiveRestore}
              onClick={() => restore(view)}
            >
              {isAnswer(view)
                ? `Keep “${view.data.name}”${isExpired(view) ? ' (expired)' : ''}`
                : `Restore “${view.data.name}”`}
            </MenuItem>
          ))}
        </Menu>
      )}
    </nav>
  );
}
