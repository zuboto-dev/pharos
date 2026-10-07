import {
  Board,
  ENTITIES,
  TEMPLATES,
  toBoard,
  type Author,
  type Entity,
  type ViewSpec,
} from '@pharos/schema';
import { z } from 'zod';
import { PharosError, formatPath } from '../store/errors.js';
import type { ApplyResult, Store } from '../store/store.js';
import { WidgetOp, applyWidgetOps, summarizeBoard } from './board-ops.js';
import { previewBoard } from './preview.js';

/** The board a view currently shows: its own spec, or its template's. */
export function effectiveBoard(view: Entity<'view'>): Board {
  const spec: ViewSpec = view.data.spec ?? TEMPLATES[view.data.template ?? 'overview'];
  return toBoard(spec);
}

/** Answer views stop showing after this many days unless someone keeps them. */
export const ANSWER_DAYS = 7;

export function isExpired(view: Entity<'view'>, now = Date.now()): boolean {
  return (
    view.data.kind === 'answer' && !!view.data.expiresAt && Date.parse(view.data.expiresAt) <= now
  );
}

/** Where the web app shows a view, for agents to point people to. */
export function viewUrl(view: Entity<'view'>): string {
  const base = (process.env.PHAROS_WEB_URL ?? 'http://localhost:5173').replace(/\/$/, '');
  return `${base}/projects/${view.data.projectId}/views/${view.id}`;
}

function summary(view: Entity<'view'>) {
  const { name, description, pinned, archived, order, template, spec, kind, question, expiresAt } =
    view.data;
  return {
    id: view.id,
    name,
    ...(kind === 'answer'
      ? { kind, question, expiresAt, ...(isExpired(view) ? { expired: true } : {}) }
      : {}),
    ...(description ? { description } : {}),
    pinned,
    ...(archived ? { archived } : {}),
    order,
    layout: spec
      ? template
        ? `customized from template "${template}"`
        : 'custom'
      : `template "${template ?? 'overview'}"`,
    widgets: summarizeBoard(effectiveBoard(view)),
  };
}

export function listViews(store: Store, projectId: string, includeArchived = false) {
  store.getOfType('project', projectId);
  return store
    .list('view', { projectId })
    .filter((v) => includeArchived || (!v.data.archived && !isExpired(v)))
    .sort((a, b) => Number(b.data.pinned) - Number(a.data.pinned) || a.data.order - b.data.order)
    .map(summary);
}

export function getView(store: Store, viewId: string) {
  const view = store.getOfType('view', viewId);
  return {
    ...summary(view),
    projectId: view.data.projectId,
    url: viewUrl(view),
    board: effectiveBoard(view),
  };
}

function parseWidgets(widgets: unknown): Board {
  const result = Board.safeParse({ component: 'Board', widgets });
  if (!result.success) {
    throw new PharosError(
      'invalid',
      'Invalid widgets',
      result.error.issues.map((i) => `${formatPath(i.path)}: ${i.message}`),
    );
  }
  return result.data;
}

export const ViewCreateInput = z.object({
  projectId: z.string(),
  name: z.string().min(1).describe('Tab name, short (e.g. "This week", "Release")'),
  description: z.string().optional().describe('What question this view answers'),
  pinned: z.boolean().optional(),
  widgets: z
    .array(z.unknown())
    .describe('Board widgets: [{id, w?, x?, h?, node}]; see catalog_list'),
  message: z.string().trim().min(1).describe('Why this view is being made'),
});

export function createView(store: Store, author: Author, input: z.infer<typeof ViewCreateInput>) {
  const board = parseWidgets(input.widgets);
  const result = store.apply(author, {
    message: input.message,
    operations: [
      {
        op: 'create',
        type: 'view',
        ref: 'view',
        data: {
          projectId: input.projectId,
          name: input.name,
          ...(input.description ? { description: input.description } : {}),
          ...(input.pinned !== undefined ? { pinned: input.pinned } : {}),
          spec: board,
        },
      },
    ],
  });
  return withView(store, result, result.created.view!);
}

export const ViewAnswerInput = z.object({
  projectId: z.string(),
  question: z.string().trim().min(1).describe("The person's question, in their words"),
  name: z
    .string()
    .min(1)
    .max(40)
    .optional()
    .describe('Short tab label (default: from the question)'),
  widgets: z
    .array(z.unknown())
    .describe('Board widgets that answer it; lead with the answer (e.g. a Text or Callout)'),
  requestId: z
    .string()
    .optional()
    .describe('The request (from project_snapshot.requests) this answers; marks it answered'),
  expiresInDays: z.number().int().min(1).max(90).optional().describe(`Default ${ANSWER_DAYS}`),
});

/** Creates an answer view: a focused view for one question, which expires unless kept. */
export function answerView(
  store: Store,
  author: Author,
  input: z.infer<typeof ViewAnswerInput>,
  now = Date.now(),
) {
  const board = parseWidgets(input.widgets);
  const name =
    input.name ??
    (input.question.length > 40 ? `${input.question.slice(0, 39).trimEnd()}…` : input.question);
  const result = store.apply(author, {
    message: `Answer: ${input.question}`,
    operations: [
      {
        op: 'create',
        type: 'view',
        ref: 'view',
        data: {
          projectId: input.projectId,
          name,
          kind: 'answer',
          question: input.question,
          expiresAt: new Date(
            now + (input.expiresInDays ?? ANSWER_DAYS) * 86_400_000,
          ).toISOString(),
          spec: board,
        },
      },
      ...(input.requestId
        ? [
            {
              op: 'update' as const,
              type: 'request' as const,
              id: input.requestId,
              data: { status: 'answered', answerViewId: '$view' },
            },
          ]
        : []),
    ],
  });
  const answer = withView(store, result, result.created.view!);
  // Agents in evaluations restated whole views in chat; the reply belongs in the view.
  return {
    ...answer,
    reply: `Reply in at most two sentences: the answer itself, then this link: ${answer.view.url}. Don't repeat the view's details in chat.`,
  };
}

export const ViewUpdateInput = z.object({
  viewId: z.string(),
  message: z.string().trim().min(1).describe('Why the view is changing'),
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  order: z.number().optional().describe('Tab position among views with the same pinned state'),
  ops: z
    .array(WidgetOp)
    .optional()
    .describe('Widget edits, applied in order. Prefer these over replacing all widgets'),
  widgets: z.array(z.unknown()).optional().describe('Replace all widgets at once (instead of ops)'),
  resetToTemplate: z
    .boolean()
    .optional()
    .describe("Drop customizations and show the view's template again"),
  keep: z
    .boolean()
    .optional()
    .describe('Turn an answer view into a saved view (a regular tab that does not expire)'),
});

export function updateView(store: Store, author: Author, input: z.infer<typeof ViewUpdateInput>) {
  const view = store.getOfType('view', input.viewId);
  const data: Record<string, unknown> = {};
  for (const key of ['name', 'description', 'pinned', 'archived', 'order'] as const) {
    if (input[key] !== undefined) data[key] = input[key];
  }
  if (input.keep) {
    if (view.data.kind !== 'answer')
      throw new PharosError('invalid', `View "${view.data.name}" is not an answer view`);
    // Keeping an answer makes it a regular tab; the question stays as its description.
    Object.assign(data, { kind: null, expiresAt: null, archived: null });
    if (!view.data.description && view.data.question) data.description = view.data.question;
  }
  const changesLayout = [input.ops, input.widgets, input.resetToTemplate].filter(
    (x) => x !== undefined && x !== false,
  );
  if (changesLayout.length > 1) {
    throw new PharosError(
      'invalid',
      'Use only one of ops, widgets, or resetToTemplate in one update',
    );
  }
  if (input.resetToTemplate) {
    if (!view.data.template)
      throw new PharosError('invalid', `View "${view.data.name}" has no template to reset to`);
    data.spec = null;
  } else if (input.widgets) {
    data.spec = parseWidgets(input.widgets);
  } else if (input.ops) {
    data.spec = applyWidgetOps(effectiveBoard(view), input.ops);
  }
  if (!Object.keys(data).length) throw new PharosError('invalid', 'Nothing to change');
  const result = store.apply(author, {
    message: input.message,
    operations: [{ op: 'update', type: 'view', id: view.id, data }],
  });
  return withView(store, result, view.id);
}

export function deleteView(
  store: Store,
  author: Author,
  input: { viewId: string; message: string },
) {
  const view = store.getOfType('view', input.viewId);
  const result = store.apply(author, {
    message: input.message,
    operations: [{ op: 'delete', type: 'view', id: view.id }],
  });
  return { revision: result.revision, deleted: view.id };
}

/**
 * The saved view, with a preview of what it shows, so agents can check it without another call
 * (evaluations showed a view_preview after nearly every save).
 */
function withView(store: Store, result: ApplyResult, viewId: string) {
  const entity = store.getOfType('view', viewId);
  return {
    revision: result.revision,
    view: getView(store, viewId),
    preview: previewBoard(store, entity.data.projectId, effectiveBoard(entity)),
  };
}

export const ViewPreviewInput = z.object({
  viewId: z.string().optional().describe('A saved view to check'),
  projectId: z.string().optional().describe('With widgets: the project to check a draft against'),
  widgets: z.array(z.unknown()).optional().describe('A draft board to check before saving it'),
});

/** Previews a saved view, or a draft board against a project, without saving anything. */
export function previewView(store: Store, input: z.infer<typeof ViewPreviewInput>) {
  if (input.viewId) {
    const view = store.getOfType('view', input.viewId);
    return {
      view: view.data.name,
      ...previewBoard(store, view.data.projectId, effectiveBoard(view)),
    };
  }
  if (!input.projectId || !input.widgets) {
    throw new PharosError('invalid', 'Give a viewId, or a projectId with draft widgets');
  }
  store.getOfType('project', input.projectId);
  return { view: '(draft)', ...previewBoard(store, input.projectId, parseWidgets(input.widgets)) };
}

/**
 * What a request from the UI was asked about, spelled out for an agent: the widget (its component,
 * title, and settings) and the view it sits in, and the item it was asked from.
 */
export function requestContext(store: Store, request: Entity<'request'>): string[] {
  const lines: string[] = [];
  const view = request.data.viewId ? store.get(request.data.viewId) : null;
  if (view?.type === 'view') {
    const v = view as Entity<'view'>;
    const kind =
      v.data.kind === 'answer'
        ? `an answer view to "${v.data.question ?? v.data.name}"`
        : 'a saved view';
    const widget = request.data.widgetId
      ? effectiveBoard(v).widgets.find((w) => w.id === request.data.widgetId)
      : undefined;
    if (widget) {
      lines.push(
        `Widget "${widget.id}": ${widget.node.component}${widget.node.title ? ` "${widget.node.title}"` : ''}, ${widget.w ?? 12} of 12 columns wide, in view "${v.data.name}" (${v.id}, ${kind}). Its settings: ${JSON.stringify(widget.node)}`,
      );
    } else {
      lines.push(`View "${v.data.name}" (${v.id}, ${kind})`);
    }
  }
  const item = request.data.aboutId ? store.get(request.data.aboutId) : null;
  if (item) {
    const label = ENTITIES[item.type].label;
    lines.push(
      `Item: ${item.type} "${String((item.data as Record<string, unknown>)[label])}" (${item.id})`,
    );
  }
  return lines;
}
