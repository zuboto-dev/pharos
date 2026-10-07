import {
  BOARD_COLUMNS,
  Board,
  ViewNode,
  Widget,
  nextWidgetId,
  type ViewSpec,
} from '@pharos/schema';
import { z } from 'zod';
import { PharosError, formatPath } from '../store/errors.js';

/**
 * Small edits to a board, so agents don't have to rewrite whole views. Widgets are addressed by
 * id; `before`/`after` place a widget next to another one (default: at the end).
 */
const Placement = {
  before: z.string().optional().describe('Put it before this widget id'),
  after: z.string().optional().describe('Put it after this widget id'),
};

export const WidgetOp = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('add'),
    widget: z
      .strictObject({
        id: z.string().min(1).optional().describe('Defaults to a generated id'),
        w: Widget.shape.w,
        x: Widget.shape.x,
        h: Widget.shape.h,
        node: z
          .unknown()
          .describe(
            'A catalog component node, e.g. {"component": "KanbanBoard", "groupBy": "stage"}',
          ),
      })
      .describe('The widget to add'),
    ...Placement,
  }),
  z.strictObject({
    op: z.literal('update'),
    id: z.string(),
    w: z
      .number()
      .int()
      .min(1)
      .max(BOARD_COLUMNS)
      .nullable()
      .optional()
      .describe('null resets to full width'),
    x: z
      .number()
      .int()
      .min(0)
      .max(BOARD_COLUMNS - 1)
      .nullable()
      .optional()
      .describe('null lets it flow'),
    h: z.number().int().min(80).max(4000).nullable().optional().describe('null fits content'),
    set: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        "Component props to change, merged into the node; null removes a prop. `component` can't change",
      ),
  }),
  z.strictObject({ op: z.literal('move'), id: z.string(), ...Placement }),
  z.strictObject({ op: z.literal('remove'), id: z.string() }),
]);
export type WidgetOp = z.infer<typeof WidgetOp>;

function issues(error: z.ZodError, prefix: (string | number)[]): string[] {
  return error.issues.map((i) => `${formatPath([...prefix, ...i.path])}: ${i.message}`);
}

function parseNode(node: unknown, path: (string | number)[]): ViewNode {
  const result = ViewNode.safeParse(node);
  if (!result.success)
    throw new PharosError('invalid', 'Invalid widget', issues(result.error, path));
  return result.data;
}

function insert(
  widgets: Widget[],
  widget: Widget,
  placement: { before?: string; after?: string },
  path: string,
) {
  const anchor = placement.before ?? placement.after;
  if (anchor === undefined) return [...widgets, widget];
  const index = widgets.findIndex((w) => w.id === anchor);
  if (index === -1)
    throw new PharosError('invalid', `${path}: no widget "${anchor}" on this board`);
  const at = placement.before !== undefined ? index : index + 1;
  return [...widgets.slice(0, at), widget, ...widgets.slice(at)];
}

/** Applies widget operations in order; throws with the path of the first bad operation. */
export function applyWidgetOps(board: Board, ops: WidgetOp[]): Board {
  let widgets = [...board.widgets];
  ops.forEach((op, i) => {
    const path = `ops[${i}]`;
    const find = (id: string) => {
      const widget = widgets.find((w) => w.id === id);
      if (!widget) {
        throw new PharosError('not_found', `${path}: no widget "${id}" on this board`, [
          `Widgets: ${widgets.map((w) => w.id).join(', ') || '(none)'}`,
        ]);
      }
      return widget;
    };
    switch (op.op) {
      case 'add': {
        const id = op.widget.id ?? nextWidgetId({ component: 'Board', widgets });
        if (widgets.some((w) => w.id === id))
          throw new PharosError('invalid', `${path}: widget id "${id}" is already used`);
        const node = parseNode(op.widget.node, [path, 'widget', 'node']);
        const widget: Widget = { id, node };
        if (op.widget.w !== undefined) widget.w = op.widget.w;
        if (op.widget.x !== undefined) widget.x = op.widget.x;
        if (op.widget.h !== undefined) widget.h = op.widget.h;
        widgets = insert(widgets, widget, op, path);
        break;
      }
      case 'update': {
        const widget = { ...find(op.id) };
        for (const key of ['w', 'x', 'h'] as const) {
          if (op[key] === null) delete widget[key];
          else if (op[key] !== undefined) widget[key] = op[key];
        }
        if (op.set) {
          if ('component' in op.set)
            throw new PharosError(
              'invalid',
              `${path}.set.component: can't change a widget's component; add a new widget instead`,
            );
          const node: Record<string, unknown> = { ...widget.node };
          for (const [key, value] of Object.entries(op.set)) {
            if (value === null) delete node[key];
            else node[key] = value;
          }
          widget.node = parseNode(node, [path, 'set']);
        }
        widgets = widgets.map((w) => (w.id === op.id ? widget : w));
        break;
      }
      case 'move': {
        const { x: _x, ...widget } = find(op.id);
        void _x;
        if (op.before === op.id || op.after === op.id) break;
        widgets = insert(
          widgets.filter((w) => w.id !== op.id),
          widget,
          op,
          path,
        );
        break;
      }
      case 'remove':
        find(op.id);
        widgets = widgets.filter((w) => w.id !== op.id);
        break;
    }
  });
  const result = Board.safeParse({ component: 'Board', widgets });
  if (!result.success) throw new PharosError('invalid', 'Invalid board', issues(result.error, []));
  return result.data;
}

/** A compact description of a board for listings: widget ids, components, titles, and sizes. */
export function summarizeBoard(spec: ViewSpec | Board) {
  const board = spec as Board;
  return board.widgets.map((w) => ({
    id: w.id,
    component: w.node.component,
    ...(w.node.title ? { title: w.node.title } : {}),
    w: w.w ?? BOARD_COLUMNS,
    ...(w.x !== undefined ? { x: w.x } : {}),
    ...(w.h !== undefined ? { h: w.h } : {}),
  }));
}
