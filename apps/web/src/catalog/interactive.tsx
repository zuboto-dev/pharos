import {
  ENTITIES,
  findOption,
  meaningOf,
  optionKeyOf,
  valueFor,
  type Entity,
  type EntityType,
} from '@pharos/schema';
import clsx from 'clsx';
import { Check, Circle, CircleDot } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { formatDate, humanize, plural } from '../lib/format';
import { toDay } from './timeline';
import { useViewData } from './context';
import { useOpenItem } from './open-item';
import { OptionBadge } from './options';
import { StatusBadge } from './ui';

export const TYPE_LABELS: Record<EntityType, string> = {
  section: 'Section',
  repository: 'Repository',
  assignee: 'Assignee',
  project: 'Project',
  goal: 'Goal',
  scope_item: 'Scope item',
  stage: 'Stage',
  task: 'Task',
  artifact: 'Artifact',
  decision: 'Decision',
  view: 'View',
  request: 'Request',
  claim: 'Claim',
  term: 'Term',
  file: 'File',
  record: 'Record',
};

export function labelOf(entity: Entity): string {
  const value = (entity.data as Record<string, unknown>)[ENTITIES[entity.type].label];
  return typeof value === 'string' ? value : entity.id;
}

/** Link to an entity's detail drawer, preserving the current page. */
export function entityHref(id: string): string {
  return `?entity=${encodeURIComponent(id)}`;
}

/** Plain left clicks only; modified clicks keep the browser's default (e.g. open in a new tab). */
function isPlainClick(e: MouseEvent): boolean {
  return !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey;
}

/**
 * Makes a block open an entity's details on click or Enter. Nested buttons and links keep
 * working; the block itself isn't a link so it can contain them.
 */
export function Clickable({
  id,
  children,
  className,
  title,
  onOpen,
  pressed,
}: {
  id: string;
  children: ReactNode;
  className?: string;
  title?: string;
  /** Replaces opening the entity in the drawer (e.g. a FileList showing a file in a FileView). */
  onOpen?: () => void;
  /** Marks the item shown elsewhere on the board right now. */
  pressed?: boolean;
}) {
  // An artifact opens its document; anything else its drawer (R7.12, `useOpenItem`).
  const openItem = useOpenItem({ fileInDrawer: true });
  const open = () => (onOpen ? onOpen() : openItem(id));
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const nested = (e.target as HTMLElement).closest('button, a, select, input, [data-no-open]');
    if (nested && nested !== e.currentTarget) return;
    open();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && e.target === e.currentTarget) open();
  };
  return (
    <div
      role="button"
      tabIndex={0}
      title={title}
      aria-pressed={pressed}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={clsx(
        'cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-sky-400',
        className,
      )}
    >
      {children}
    </div>
  );
}

const GLANCE_DELAY = 300;

/** A short preview of an entity, shown on hover. */
function GlanceCard({ entity }: { entity: Entity }) {
  const data = entity.data as Record<string, unknown>;
  const status = typeof data.status === 'string' ? data.status : undefined;
  const start = typeof data.startDate === 'string' ? data.startDate : undefined;
  const end = typeof data.targetDate === 'string' ? data.targetDate : undefined;
  const text = [data.summary, data.description, data.body, data.rationale].find(
    (v): v is string => typeof v === 'string' && v.trim().length > 0,
  );
  return (
    <div className="w-72 space-y-1.5 rounded-tile border border-line-strong bg-surface p-3 text-left shadow-popover">
      <div className="flex items-center justify-between gap-2 text-xs text-muted">
        <span>{TYPE_LABELS[entity.type]}</span>
        {status &&
          (optionKeyOf(entity.type, 'status') ? (
            <OptionBadge field={optionKeyOf(entity.type, 'status')!} value={status} />
          ) : (
            <StatusBadge value={status} />
          ))}
      </div>
      <div className="text-sm font-medium">{labelOf(entity)}</div>
      {(start || end) && (
        <p className="text-xs text-ink-soft tabular-nums">
          {start && end
            ? `${formatDate(start)} → ${formatDate(end)}`
            : start
              ? `Starts ${formatDate(start)}`
              : `Due ${formatDate(end!)}`}
          {start && end && (
            <span className="text-neutral-400">
              {' '}
              · {plural(toDay(end) - toDay(start) + 1, 'day')}
            </span>
          )}
        </p>
      )}
      {text && <p className="line-clamp-3 text-xs text-muted">{text}</p>}
      <div className="text-xs text-neutral-400">Click for details</div>
    </div>
  );
}

/** Shows a glance card near the hovered element. Uses a portal so scroll containers don't clip it. */
export function useGlance(id: string | undefined) {
  const { entityById } = useViewData();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const entity = id ? entityById.get(id) : undefined;
  const handlers = {
    onMouseEnter: (e: MouseEvent<HTMLElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setAnchor(rect), GLANCE_DELAY);
    },
    onMouseLeave: () => {
      clearTimeout(timer.current);
      setAnchor(null);
    },
  };
  let card: ReactNode = null;
  if (anchor && entity) {
    const below = anchor.bottom + 200 < window.innerHeight;
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - 296));
    card = createPortal(
      <div
        className="pointer-events-none fixed z-50"
        style={
          below
            ? { left, top: anchor.bottom + 6 }
            : { left, bottom: window.innerHeight - anchor.top + 6 }
        }
      >
        <GlanceCard entity={entity} />
      </div>,
      document.body,
    );
  }
  return { handlers, card };
}

/** An inline reference to another entity: hover to glance, click to open. */
export function EntityRef({ id, className }: { id: string; className?: string }) {
  const { entityById } = useViewData();
  const openItem = useOpenItem();
  const { handlers, card } = useGlance(id);
  const entity = entityById.get(id);
  if (!entity) return <span className="text-xs text-neutral-400">{id}</span>;
  return (
    <>
      <a
        href={entityHref(id)}
        {...handlers}
        onClick={(e) => {
          if (!isPlainClick(e)) return;
          e.preventDefault();
          e.stopPropagation();
          openItem(id);
        }}
        className={clsx(
          'inline-flex max-w-full items-center truncate rounded-control bg-subtle px-1.5 py-0.5 text-xs text-ink-soft hover:bg-sky-100 hover:text-sky-800 dark:hover:bg-sky-950 dark:hover:text-sky-300',
          className,
        )}
      >
        <span className="truncate">{labelOf(entity)}</span>
      </a>
      {card}
    </>
  );
}

export function useTaskActions() {
  const { actions, project } = useViewData();
  return {
    /** Sets a task to the project's first status with this meaning (e.g. "done"). */
    setStatus: (task: Entity<'task'>, meaning: string) => {
      const status = valueFor(project, 'task.status', meaning);
      const label = findOption(project, 'task.status', status)?.label ?? humanize(status);
      return actions.apply(`Mark “${task.data.title}” as ${label.toLowerCase()}`, [
        { op: 'update', type: 'task', id: task.id, data: { status } },
      ]);
    },
    setField: (task: Entity<'task'>, field: string, value: string | null, label: string) =>
      actions.apply(`Move “${task.data.title}” to ${label}`, [
        { op: 'update', type: 'task', id: task.id, data: { [field]: value } },
      ]),
  };
}

/** A round checkbox that marks a task done (or reopens it). */
export function TaskCheck({ task, className }: { task: Entity<'task'>; className?: string }) {
  const { setStatus } = useTaskActions();
  const { project } = useViewData();
  const meaning = meaningOf(project, 'task.status', task.data.status);
  const done = meaning === 'done';
  const Icon = done ? Check : meaning === 'in_progress' ? CircleDot : Circle;
  return (
    <button
      type="button"
      aria-label={done ? `Reopen “${task.data.title}”` : `Mark “${task.data.title}” done`}
      title={done ? 'Reopen' : 'Mark done'}
      onClick={(e) => {
        e.stopPropagation();
        void setStatus(task, done ? 'todo' : 'done');
      }}
      className={clsx(
        'flex size-5 shrink-0 items-center justify-center rounded-full border transition',
        done
          ? 'border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-600'
          : 'border-neutral-300 text-neutral-400 hover:border-emerald-500 hover:text-emerald-500 dark:border-neutral-600',
        className,
      )}
    >
      <Icon className={clsx(done ? 'size-3.5' : 'size-3')} strokeWidth={done ? 3 : 2} />
    </button>
  );
}
