import { BOARD_COLUMNS, COMPONENT_INFO, type ComponentName } from '@pharos/schema';

/** A widget's box relative to the board's top-left corner, in pixels. */
export type Box = { left: number; right: number; top: number; bottom: number };

export const GAP = 16;
export const MIN_HEIGHT = 80;
/** How close (px) an edge must get to a neighbour's edge before it's pulled into line. */
export const MAGNET = 20;

export function columnWidth(boardWidth: number): number {
  return (boardWidth - GAP * (BOARD_COLUMNS - 1)) / BOARD_COLUMNS;
}

/** The x position of the right edge after `columns` columns. */
function columnEdge(columns: number, boardWidth: number): number {
  return columns * (columnWidth(boardWidth) + GAP) - GAP;
}

export function startColumn(left: number, boardWidth: number): number {
  return Math.round(left / (columnWidth(boardWidth) + GAP));
}

/**
 * Width while dragging a right edge. Widths always land on whole columns; if a neighbour's
 * edge is within reach, it wins over the nearest column (a weak magnet), and a guide marks
 * the alignment.
 */
export function snapWidth(opts: {
  boardWidth: number;
  left: number;
  rawRight: number;
  others: Box[];
  /** The narrowest the widget may get, in columns. */
  minColumns?: number;
}): {
  w: number;
  guide: number | null;
} {
  const { boardWidth, left, rawRight, others, minColumns = 1 } = opts;
  const start = startColumn(left, boardWidth);
  // Never narrower than the minimum (unless the row has less room than that left).
  const first = Math.min(start + minColumns, BOARD_COLUMNS);
  const choices = Array.from({ length: BOARD_COLUMNS - first + 1 }, (_, i) => first + i);
  const edges = others.flatMap((o) => [o.right]);
  const magnet = edges
    .filter((e) => Math.abs(e - rawRight) <= MAGNET)
    .map((e) => choices.find((c) => Math.abs(columnEdge(c, boardWidth) - e) < 2))
    .find((c) => c !== undefined);
  const nearest = choices.reduce((best, c) =>
    Math.abs(columnEdge(c, boardWidth) - rawRight) <
    Math.abs(columnEdge(best, boardWidth) - rawRight)
      ? c
      : best,
  );
  const end = magnet ?? nearest;
  const x = columnEdge(end, boardWidth);
  return { w: end - start, guide: edges.some((e) => Math.abs(e - x) < 2) ? x : null };
}

/**
 * Height while dragging a bottom edge: pulled to a neighbour's bottom when close, else 4px steps.
 * Never less than `minHeight` (the content's own height), so content is never cut off.
 */
export function snapHeight(opts: {
  top: number;
  rawHeight: number;
  others: Box[];
  minHeight?: number;
}): {
  h: number;
  guide: number | null;
  /** True when the drag is held at the minimum. */
  atMin: boolean;
} {
  const { top, rawHeight, others } = opts;
  const min = Math.max(MIN_HEIGHT, Math.ceil(opts.minHeight ?? 0));
  const rawBottom = top + rawHeight;
  const target = others
    .map((o) => o.bottom)
    .filter((b) => b - top >= min && Math.abs(b - rawBottom) <= MAGNET)
    .sort((a, b) => Math.abs(a - rawBottom) - Math.abs(b - rawBottom))[0];
  if (target !== undefined) return { h: Math.round(target - top), guide: target, atMin: false };
  const h = Math.round(rawHeight / 4) * 4;
  return h <= min ? { h: min, guide: null, atMin: true } : { h, guide: null, atMin: false };
}

/** Narrowest width, in columns, at which a component stays readable (shared with agents). */
export function minColumnsOf(component: string): number {
  return COMPONENT_INFO[component as ComponentName]?.minColumns ?? 3;
}
