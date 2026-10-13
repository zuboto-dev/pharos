import { BOARD_COLUMNS, type Board, type Widget } from '@pharos/schema';
import clsx from 'clsx';
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  MessageCircleQuestion,
  Settings2,
  X,
} from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { humanize } from '../lib/format';
import { EXIT_MS } from '../lib/motion';
import { GAP, minColumnsOf, snapHeight, snapWidth, startColumn, type Box } from './layout';
import { BoardActionsProvider } from './action-board';
import { BoardFilesProvider, WidgetIdProvider } from './board-files';
import { AskHereProvider } from './empty-state';
import { useViewData } from './context';
import { useLiveBoard } from './live';
import { BLOCK_PRESENCE_OUTLINE, BlockPresence, ViewPresence, useViewPresence } from './presence';
import { Node } from './renderer';
import { WidgetSettings } from './settings';

export type BoardChange = (board: Board, message: string) => void;

/** The widgets to draw: the board's, with the ones just removed back at their old places. */
export function withLeaving(
  widgets: readonly Widget[],
  leaving: readonly { widget: Widget; index: number }[],
): { widget: Widget; index: number; gone: boolean }[] {
  const list = widgets.map((widget, index) => ({ widget, index, gone: false }));
  for (const g of [...leaving].sort((a, b) => a.index - b.index))
    list.splice(Math.min(g.index, list.length), 0, { widget: g.widget, index: -1, gone: true });
  return list;
}

type Preview = { id: string; w: number; h: number | undefined; atMin?: boolean };
type Guides = { x: number | null; y: number | null };
type Drop = { id: string; side: 'before' | 'after' };

const DRAG_TYPE = 'application/x-pharos-widget';

export function widgetName(widget: Widget): string {
  return (
    widget.node.title ??
    humanize(widget.node.component.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase())
  );
}

/**
 * The height a widget's content needs on its own, ignoring the row stretching it and any saved
 * minimum. Measured synchronously by briefly letting the widget size to its content.
 */
function contentHeight(el: HTMLElement): number {
  const { alignSelf, minHeight } = el.style;
  el.style.alignSelf = 'start';
  el.style.minHeight = '0px';
  const height = el.getBoundingClientRect().height;
  el.style.alignSelf = alignSelf;
  el.style.minHeight = minHeight;
  return height;
}

function placement(widget: Widget, preview: Preview | null): CSSProperties {
  const w = preview?.id === widget.id ? preview.w : (widget.w ?? BOARD_COLUMNS);
  const h = preview?.id === widget.id ? preview.h : widget.h;
  return {
    '--col': widget.x !== undefined ? `${widget.x + 1} / span ${w}` : `span ${w}`,
    ...(h ? { '--h': `${h}px` } : {}),
  } as CSSProperties;
}

type BoardProps = {
  board: Board;
  editing: boolean;
  onChange: BoardChange;
  /** The view this board belongs to, so widgets can say where a question was asked from. */
  view?: { id: string; name: string };
  /**
   * Whether the latest update is the owner's own (made on this page), so changed blocks aren't
   * marked; live updates from agents and other tabs are (v0.2 B4). Edit mode is always quiet.
   */
  quiet?: () => boolean;
};

const NEVER_QUIET = () => false;

/**
 * A 12-column board of widgets. In edit mode, widgets can be reordered by dragging their grip,
 * resized from the right edge, bottom edge, or corner (snapping to columns and to neighbours'
 * edges), and removed. Every change is reported through `onChange` as a whole new board.
 */
export function BoardView(props: BoardProps) {
  // FileLists can show a file in a FileView on the same board (R7.11).
  return (
    <BoardFilesProvider widgets={props.board.widgets}>
      <BoardActionsProvider viewId={props.view?.id} widgets={props.board.widgets}>
        <BoardGrid {...props} />
      </BoardActionsProvider>
    </BoardFilesProvider>
  );
}

function BoardGrid({ board, editing, onChange, view, quiet = NEVER_QUIET }: BoardProps) {
  const { actions, version } = useViewData();
  // Blocks an agent is editing right now (v0.2 B5).
  const present = useViewPresence(view?.id);
  const container = useLiveBoard<HTMLDivElement>(
    version,
    board.widgets.map((w) => w.id),
    quiet,
    editing,
  );
  // Widgets just removed stay a moment to fade out where they were (not when the whole board was
  // swapped for new widgets: then the new ones simply fade in).
  const [seen, setSeen] = useState(board.widgets);
  const [leaving, setLeaving] = useState<{ widget: Widget; index: number }[]>([]);
  if (seen !== board.widgets) {
    const now = new Set(board.widgets.map((w) => w.id));
    const before = new Set(seen.map((w) => w.id));
    const gone = seen.flatMap((widget, index) => (now.has(widget.id) ? [] : [{ widget, index }]));
    const added = board.widgets.some((w) => !before.has(w.id));
    setSeen(board.widgets);
    if (gone.length && !added) setLeaving(gone);
  }
  useEffect(() => {
    if (!leaving.length) return;
    const timer = setTimeout(() => setLeaving([]), EXIT_MS);
    return () => clearTimeout(timer);
  }, [leaving]);
  const elements = useRef(new Map<string, HTMLDivElement>());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [guides, setGuides] = useState<Guides>({ x: null, y: null });
  const [drop, setDrop] = useState<Drop | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [configuring, setConfiguring] = useState<string | null>(null);

  const moveBy = (widget: Widget, by: -1 | 1) => {
    const index = board.widgets.findIndex((w) => w.id === widget.id);
    const target = index + by;
    if (target < 0 || target >= board.widgets.length) return;
    const widgets = [...board.widgets];
    const { x: _x, ...flowing } = widgets[index]!;
    void _x;
    widgets.splice(index, 1);
    widgets.splice(target, 0, flowing);
    onChange(
      { ...board, widgets },
      `Move “${widgetName(widget)}” widget ${by < 0 ? 'up' : 'down'}`,
    );
  };
  const ICON_BUTTON = 'rounded-full p-0.5 hover:bg-subtle disabled:opacity-30';

  const update = (widget: Widget, patch: Partial<Widget>, message: string) => {
    const next = { ...widget, ...patch };
    for (const key of Object.keys(patch) as (keyof Widget)[])
      if (patch[key] === undefined) delete next[key];
    onChange(
      { ...board, widgets: board.widgets.map((w) => (w.id === widget.id ? next : w)) },
      message,
    );
  };

  const boxes = (except: string): Box[] => {
    const origin = container.current!.getBoundingClientRect();
    return [...elements.current.entries()]
      .filter(([id]) => id !== except)
      .map(([, el]) => {
        const r = el.getBoundingClientRect();
        return {
          left: r.left - origin.left,
          right: r.right - origin.left,
          top: r.top - origin.top,
          bottom: r.bottom - origin.top,
        };
      });
  };

  const startResize = (e: ReactPointerEvent, widget: Widget, mode: 'w' | 'h' | 'wh') => {
    e.preventDefault();
    e.stopPropagation();
    const el = elements.current.get(widget.id)!;
    const origin = container.current!.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const others = boxes(widget.id);
    const boardWidth = origin.width;
    const left = rect.left - origin.left;
    const top = rect.top - origin.top;
    const start = { x: e.clientX, y: e.clientY };
    const minHeight = contentHeight(el);
    const minColumns = minColumnsOf(widget.node.component);
    let result: Preview = { id: widget.id, w: widget.w ?? BOARD_COLUMNS, h: widget.h };

    const move = (ev: PointerEvent) => {
      const g: Guides = { x: null, y: null };
      if (mode !== 'h') {
        const snapped = snapWidth({
          boardWidth,
          left,
          rawRight: rect.right - origin.left + ev.clientX - start.x,
          others,
          minColumns,
        });
        result = {
          ...result,
          w: Math.min(snapped.w, BOARD_COLUMNS - (widget.x ?? startColumn(left, boardWidth))),
        };
        g.x = snapped.guide;
      }
      if (mode !== 'w') {
        const snapped = snapHeight({
          top,
          rawHeight: rect.height + ev.clientY - start.y,
          others,
          minHeight,
        });
        result = { ...result, h: snapped.h, atMin: snapped.atMin };
        g.y = snapped.guide;
      }
      setPreview(result);
      setGuides(g);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setPreview(null);
      setGuides({ x: null, y: null });
      // Released at the content's height: save "fit content" so it keeps following the content.
      const h = result.atMin ? undefined : result.h;
      const changed = result.w !== (widget.w ?? BOARD_COLUMNS) || h !== widget.h;
      if (changed) {
        update(
          widget,
          { w: result.w === BOARD_COLUMNS ? undefined : result.w, h },
          `Resize “${widgetName(widget)}” widget`,
        );
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const sideOf = (e: DragEvent, widget: Widget): Drop['side'] => {
    const r = elements.current.get(widget.id)!.getBoundingClientRect();
    const fullWidth = (widget.w ?? BOARD_COLUMNS) === BOARD_COLUMNS;
    return (fullWidth ? e.clientY < r.top + r.height / 2 : e.clientX < r.left + r.width / 2)
      ? 'before'
      : 'after';
  };

  const onDrop = (target: Widget, side: Drop['side'], movedId: string) => {
    const moved = board.widgets.find((w) => w.id === movedId);
    if (!moved || moved.id === target.id) return;
    const rest = board.widgets.filter((w) => w.id !== movedId);
    const index = rest.findIndex((w) => w.id === target.id) + (side === 'after' ? 1 : 0);
    // A moved widget flows into its new place rather than keeping a fixed column.
    const { x: _x, ...flowing } = moved;
    void _x;
    rest.splice(index, 0, flowing);
    if (rest.every((w, i) => w.id === board.widgets[i]!.id)) return;
    onChange({ ...board, widgets: rest }, `Move “${widgetName(moved)}” widget`);
  };

  return (
    <div
      ref={container}
      className={clsx('relative grid grid-cols-1 md:grid-cols-12', editing && 'pb-4')}
      style={{ gap: GAP }}
    >
      {!editing && present.agents.length > 0 && <ViewPresence agents={present.agents} />}
      {withLeaving(board.widgets, leaving).map(({ widget, index, gone }) => {
        if (gone)
          return (
            <div
              key={`leaving-${widget.id}`}
              aria-hidden
              inert
              data-leaving={widget.id}
              style={placement(widget, null)}
              className="pointer-events-none flex min-w-0 animate-fade-out flex-col *:flex-1 md:[grid-column:var(--col)]"
            >
              <Node node={widget.node} />
            </div>
          );
        const name = widgetName(widget);
        const resizing = preview?.id === widget.id;
        return (
          <div
            key={widget.id}
            ref={(el) => {
              if (el) elements.current.set(widget.id, el);
              else elements.current.delete(widget.id);
            }}
            data-widget={widget.id}
            style={placement(widget, preview)}
            onDragOver={(e) => {
              if (!editing || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
              e.preventDefault();
              setDrop({ id: widget.id, side: sideOf(e, widget) });
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as globalThis.Node)) setDrop(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDrop(null);
              onDrop(widget, sideOf(e, widget), e.dataTransfer.getData(DRAG_TYPE));
            }}
            data-presence-block={(!editing && present.widgets.get(widget.id)) || undefined}
            className={clsx(
              'group/widget relative flex min-w-0 flex-col *:flex-1 md:[grid-column:var(--col)]',
              !editing && present.widgets.has(widget.id) && BLOCK_PRESENCE_OUTLINE,
              // A saved height is a minimum: content that grows later is never cut off.
              (resizing ? preview.h : widget.h) && 'md:min-h-(--h)',
              editing &&
                'rounded-block outline-2 outline-offset-4 outline-transparent outline-dashed hover:outline-sky-300 dark:hover:outline-sky-800',
              resizing && 'outline-sky-400!',
              dragging === widget.id && 'opacity-40',
            )}
          >
            <WidgetIdProvider id={widget.id}>
              <AskHereProvider
                ask={
                  actions.ask
                    ? (question) =>
                        actions.ask!({
                          label: view ? `${name} in ${view.name}` : name,
                          viewId: view?.id,
                          widgetId: widget.id,
                          question,
                        })
                    : null
                }
              >
                <Node node={widget.node} />
              </AskHereProvider>
            </WidgetIdProvider>
            {!editing && present.widgets.has(widget.id) && (
              <BlockPresence agent={present.widgets.get(widget.id)!} />
            )}
            {!editing && actions.ask && (
              <button
                type="button"
                aria-label={`Ask about ${name}`}
                title="Ask your agent about this"
                onClick={() =>
                  actions.ask!({
                    label: view ? `${name} in ${view.name}` : name,
                    viewId: view?.id,
                    widgetId: widget.id,
                  })
                }
                className={clsx(
                  'tap-area absolute right-2 z-10 inline-flex items-center gap-1 rounded-control border border-line-strong bg-white/90 px-1.5 py-0.5 text-xs text-muted opacity-0 shadow-xs transition group-hover/widget:opacity-100 hover:text-accent-strong focus:opacity-100 pointer-coarse:opacity-100 dark:bg-neutral-900/90',
                  // Below the "is editing…" mark when an agent is at work here, never under it.
                  !editing && present.widgets.has(widget.id) ? 'top-5' : 'top-2',
                )}
              >
                <MessageCircleQuestion className="size-3.5" aria-hidden />{' '}
                <span className="pointer-coarse:sr-only">Ask</span>
              </button>
            )}
            {editing && (
              <>
                {drop?.id === widget.id && (
                  <div
                    className={clsx(
                      'pointer-events-none absolute z-20 rounded-full bg-sky-500',
                      (widget.w ?? BOARD_COLUMNS) === BOARD_COLUMNS
                        ? clsx('inset-x-0 h-1', drop.side === 'before' ? '-top-2.5' : '-bottom-2.5')
                        : clsx(
                            'inset-y-0 w-1',
                            drop.side === 'before' ? '-left-2.5' : '-right-2.5',
                          ),
                    )}
                  />
                )}
                <div className="absolute -top-3 right-3 z-20 flex items-center gap-0.5 rounded-full border border-line-strong bg-surface px-1 py-0.5 text-muted shadow-sm">
                  <span
                    draggable
                    role="button"
                    tabIndex={-1}
                    aria-label={`Move ${name}`}
                    title="Drag to move"
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG_TYPE, widget.id);
                      e.dataTransfer.effectAllowed = 'move';
                      setDragging(widget.id);
                    }}
                    onDragEnd={() => setDragging(null)}
                    className="cursor-grab rounded-full p-0.5 hover:bg-subtle active:cursor-grabbing"
                  >
                    <GripVertical className="size-3.5" />
                  </span>
                  <span className="max-w-40 truncate px-1 text-xs">
                    {resizing
                      ? `${preview.w}/${BOARD_COLUMNS}${preview.h ? ` · ${preview.h}px` : ''}${preview.atMin ? ' · fits content' : ''}`
                      : name}
                  </span>
                  <button
                    type="button"
                    aria-label={`Move ${name} up`}
                    title="Move up"
                    disabled={index === 0}
                    onClick={() => moveBy(widget, -1)}
                    className={ICON_BUTTON}
                  >
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${name} down`}
                    title="Move down"
                    disabled={index === board.widgets.length - 1}
                    onClick={() => moveBy(widget, 1)}
                    className={ICON_BUTTON}
                  >
                    <ArrowDown className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Settings for ${name}`}
                    title="Widget settings"
                    onClick={() => setConfiguring(widget.id)}
                    className={ICON_BUTTON}
                  >
                    <Settings2 className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${name}`}
                    title="Remove widget"
                    onClick={() =>
                      onChange(
                        { ...board, widgets: board.widgets.filter((w) => w.id !== widget.id) },
                        `Remove “${name}” widget`,
                      )
                    }
                    className="rounded-full p-0.5 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
                <div
                  aria-hidden
                  title="Drag to resize width"
                  onPointerDown={(e) => startResize(e, widget, 'w')}
                  className="absolute inset-y-4 -right-2.5 z-10 hidden w-2 cursor-ew-resize rounded-full hover:bg-sky-400/60 md:block"
                />
                <div
                  aria-hidden
                  title="Drag to resize height · double-click to fit content"
                  onPointerDown={(e) => startResize(e, widget, 'h')}
                  onDoubleClick={() =>
                    widget.h && update(widget, { h: undefined }, `Fit “${name}” widget to content`)
                  }
                  className="absolute inset-x-4 -bottom-2.5 z-10 hidden h-2 cursor-ns-resize rounded-full hover:bg-sky-400/60 md:block"
                />
                <div
                  aria-hidden
                  title="Drag to resize"
                  onPointerDown={(e) => startResize(e, widget, 'wh')}
                  className="absolute -right-2.5 -bottom-2.5 z-10 hidden size-4 cursor-nwse-resize rounded-full border-2 border-sky-400 bg-surface md:block"
                />
              </>
            )}
          </div>
        );
      })}
      {configuring &&
        (() => {
          const widget = board.widgets.find((w) => w.id === configuring);
          if (!widget) return null;
          return (
            <WidgetSettings
              node={widget.node}
              onClose={() => setConfiguring(null)}
              onSave={(node) => {
                setConfiguring(null);
                update(
                  widget,
                  { node },
                  `Change “${widgetName({ ...widget, node })}” widget settings`,
                );
              }}
            />
          );
        })()}
      {guides.x !== null && (
        <div
          className="pointer-events-none absolute inset-y-0 z-30 w-px bg-fuchsia-500"
          style={{ left: guides.x }}
        />
      )}
      {guides.y !== null && (
        <div
          className="pointer-events-none absolute inset-x-0 z-30 h-px bg-fuchsia-500"
          style={{ top: guides.y }}
        />
      )}
      {editing && preview && (
        <div
          className="pointer-events-none absolute inset-0 -z-10 hidden grid-cols-12 md:grid"
          style={{ gap: GAP }}
        >
          {Array.from({ length: BOARD_COLUMNS }, (_, i) => (
            <div key={i} className="rounded bg-sky-100/50 dark:bg-sky-950/30" />
          ))}
        </div>
      )}
    </div>
  );
}
