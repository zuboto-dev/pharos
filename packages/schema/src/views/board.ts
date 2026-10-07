import { z } from 'zod';
import { NODE_SCHEMAS, ViewNode } from './catalog.js';

export const BOARD_COLUMNS = 12;

export const Widget = z
  .strictObject({
    id: z.string().min(1).describe('Stable id, unique within the board'),
    w: z
      .number()
      .int()
      .min(1)
      .max(BOARD_COLUMNS)
      .optional()
      .describe('Width in columns of 12 (default 12)'),
    x: z
      .number()
      .int()
      .min(0)
      .max(BOARD_COLUMNS - 1)
      .optional()
      .describe('Column to start at (0–11); omit to flow after the previous widget'),
    h: z
      .number()
      .int()
      .min(80)
      .max(4000)
      .optional()
      .describe(
        'Minimum height in pixels (the widget still grows to fit its content); omit to fit content',
      ),
    node: ViewNode,
  })
  .describe('A widget on a board: one catalog component with a size');
export type Widget = z.infer<typeof Widget>;

export const Board = z
  .strictObject({
    component: z.literal('Board'),
    widgets: z.array(Widget).superRefine((widgets, ctx) => {
      const seen = new Set<string>();
      widgets.forEach((w, i) => {
        if (seen.has(w.id))
          ctx.addIssue({
            code: 'custom',
            message: `Duplicate widget id "${w.id}"`,
            path: [i, 'id'],
          });
        seen.add(w.id);
      });
    }),
  })
  .describe('A 12-column board of widgets, laid out left to right, top to bottom');
export type Board = z.infer<typeof Board>;

/** What a view stores: a board of widgets, or (for older/simple specs) a single component tree. */
// Discriminated (not a plain union) so a bad spec reports the exact path that's wrong.
export const ViewSpec: z.ZodType<ViewSpec> = z.lazy(() =>
  z.discriminatedUnion('component', [Board, ...NODE_SCHEMAS()]),
);
export type ViewSpec = Board | ViewNode;

const LAYOUT = new Set(['Grid', 'Section']);

/**
 * Turns any spec into a board so every view can be laid out and edited the same way.
 * The top-level Section and Grid containers are flattened into widgets; a Grid child's
 * share of the columns becomes its width.
 */
export function toBoard(spec: ViewSpec): Board {
  if (spec.component === 'Board') return spec;
  const widgets: Widget[] = [];
  const add = (node: ViewNode, w: number) =>
    widgets.push({ id: `w${widgets.length + 1}`, w, node });
  const visit = (node: ViewNode, depth: number) => {
    if (node.component === 'Section' && depth < 2 && !(depth > 0 && node.title)) {
      for (const child of node.children) visit(child, depth + 1);
    } else if (node.component === 'Grid' && depth < 2 && !node.title) {
      const columns = node.columns ?? 2;
      for (const child of node.children) {
        const span = Math.min(child.span ?? 1, columns);
        add(
          LAYOUT.has(child.component) ? child : { ...child, span: undefined },
          Math.round((BOARD_COLUMNS / columns) * span),
        );
      }
    } else {
      add(node, BOARD_COLUMNS);
    }
  };
  visit(spec, 0);
  // Drop `span: undefined` keys left by the spread so specs stay clean.
  return {
    component: 'Board',
    widgets: widgets.map((w) => ({ ...w, node: JSON.parse(JSON.stringify(w.node)) })),
  };
}

/** A widget id not used on the board yet. */
export function nextWidgetId(board: Board): string {
  const used = new Set(board.widgets.map((w) => w.id));
  let n = board.widgets.length + 1;
  while (used.has(`w${n}`)) n++;
  return `w${n}`;
}
