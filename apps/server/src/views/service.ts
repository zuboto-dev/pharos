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
import { AgentFiles } from '../store/agent-files.js';
import { PharosError, formatPath } from '../store/errors.js';
import type { ApplyResult, Store } from '../store/store.js';
import { askedBlocks, blockChangeIssue } from './block-ask.js';
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
    /** Send it back as view_update's expectedRevision (R10). */
    revision: view.updatedRev,
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
  const result = store.apply(
    author,
    {
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
    },
    { evidence: author.kind === 'agent' },
  );
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
    .describe(
      'Board widgets that answer it; lead with the answer (a Text or Callout, or a headline ClaimCard when explaining)',
    ),
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
  const found = input.requestId ? store.get(input.requestId) : null;
  const request = found?.type === 'request' ? (found as Entity<'request'>) : null;
  if (request?.data.mode === 'refresh')
    throw new PharosError(
      'invalid',
      `Request ${request.id} asks to refresh view ${request.data.viewId}: answer again in that same view with view_update (its revision as expectedRevision, the requestId and the whole page as widgets), not in a new one`,
    );
  const board = parseWidgets(input.widgets);
  const name =
    input.name ??
    (input.question.length > 40 ? `${input.question.slice(0, 39).trimEnd()}…` : input.question);
  const result = store.apply(
    author,
    {
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
    },
    { evidence: author.kind === 'agent' },
  );
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
  expectedRevision: z
    .number()
    .int()
    .optional()
    .describe(
      "The view's revision from view_get; if a person changed the view since, nothing is saved: read it again and redo your change. Needed to replace all widgets (or reset) a view someone else changed last",
    ),
  requestId: z
    .string()
    .optional()
    .describe(
      'The request this change answers (marks it answered). For an "ask about this block" request, change only its widgetId',
    ),
  reply: z
    .string()
    .min(1)
    .max(300)
    .optional()
    .describe('With requestId: one or two sentences to the person about what you changed'),
});

export function updateView(store: Store, author: Author, input: z.infer<typeof ViewUpdateInput>) {
  const view = store.getOfType('view', input.viewId);
  // A person (or another agent) changed the view since this one read it: refuse, never overwrite.
  if (input.expectedRevision !== undefined && view.updatedRev !== input.expectedRevision)
    throw new PharosError(
      'conflict',
      `View "${view.data.name}" changed since revision ${input.expectedRevision} (it is at ${view.updatedRev} now). Read it again with view_get and redo your change on what it shows now`,
    );
  const request = input.requestId ? store.getOfType('request', input.requestId) : undefined;
  if (request) {
    if (request.data.projectId !== view.data.projectId)
      throw new PharosError('invalid', `Request ${request.id} is about another project`);
    if (request.data.status !== 'open')
      throw new PharosError('invalid', `Request ${request.id} is already ${request.data.status}`);
    if (request.data.mode === 'block' && request.data.viewId !== view.id)
      throw new PharosError(
        'invalid',
        `Request ${request.id} asks about block "${request.data.widgetId}" in view ${request.data.viewId}; change that view`,
      );
    if (request.data.mode === 'refresh' && request.data.viewId !== view.id)
      throw new PharosError(
        'invalid',
        `Request ${request.id} asks to refresh view ${request.data.viewId}; answer again in that view`,
      );
    // R11 review, gap 2: a refresh is answered by writing the page again from the data now, not
    // by a rename or a few ops (they would leave old words looking fresh).
    if (request.data.mode === 'refresh' && input.widgets === undefined)
      throw new PharosError(
        'invalid',
        `Request ${request.id} asks to refresh this view: answer it again with the whole page as widgets (check every number and sentence against the data now), or dismiss the request with a reply saying why`,
      );
  }
  if (input.reply && !request) throw new PharosError('invalid', 'reply needs a requestId');
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
  // R10.8: while a person waits for a change to one block, an agent changes only that block; with
  // a requestId, only the block that request names (the store checks the same, v0.2 review gap 3).
  const allowed =
    author.kind !== 'agent'
      ? new Set<string>()
      : request?.data.mode === 'block' && request.data.widgetId
        ? new Set([request.data.widgetId])
        : askedBlocks(store, view);
  if (allowed.size) {
    const scope = `View "${view.data.name}" has an open request to change only block ${[...allowed].map((id) => `"${id}"`).join(', ')}`;
    const viewFields = Object.keys(data).filter((k) => k !== 'spec');
    if (viewFields.length || data.spec === null)
      throw new PharosError(
        'invalid',
        `${scope}; leave ${viewFields.length ? viewFields.join(', ') : 'its template'} as it is (use ops on that block)`,
      );
    if (data.spec) {
      const issue = blockChangeIssue(effectiveBoard(view), toBoard(data.spec as ViewSpec), allowed);
      if (issue) throw new PharosError('invalid', issue);
    }
  }
  // v0.2 review, gap 4: replacing the whole layout from a copy read earlier would drop a newer
  // edit by a person (or another agent). When someone else changed the view last, an agent must
  // say which version it read. (ops apply to the board as it is now, so they need no revision.)
  if (
    author.kind === 'agent' &&
    input.expectedRevision === undefined &&
    (input.widgets !== undefined || input.resetToTemplate)
  ) {
    const last = store.history({ entityId: view.id, limit: 1 })[0]?.author;
    if (last && last.kind !== 'system' && !(last.kind === 'agent' && last.name === author.name))
      throw new PharosError(
        'conflict',
        `View "${view.data.name}" was last changed by ${last.kind === 'human' ? 'a person' : 'someone else'} (it is at revision ${view.updatedRev}). Read it with view_get, redo your change on what it shows now, and pass that revision as expectedRevision (or change single blocks with ops)`,
      );
  }
  const result = store.apply(
    author,
    {
      message: input.message,
      operations: [
        { op: 'update', type: 'view', id: view.id, data },
        ...(request
          ? [
              {
                op: 'update' as const,
                type: 'request' as const,
                id: request.id,
                data: { status: 'answered', ...(input.reply ? { reply: input.reply } : {}) },
              },
            ]
          : []),
      ],
    },
    {
      // R11: an agent that rewrites the whole page (a refresh answers that way) built it from the
      // data as it is now; changing one block, even as a whole board under a block request,
      // leaves the rest as old as it was.
      evidence:
        author.kind === 'agent' && input.widgets !== undefined && request?.data.mode !== 'block',
    },
  );
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
    if (widget && request.data.mode === 'block')
      lines.push(
        `Change this block in place (R10): view_get ${v.id}, then view_update {viewId: "${v.id}", expectedRevision, requestId: "${request.id}", ops: [{op: "update", id: "${widget.id}", …}], reply}. Only this block may change; edits to other blocks or the view are refused. If it can't be done in this block, apply {op: "update", type: "request", id: "${request.id}", data: {status: "dismissed", reply: "<why, in one sentence>"}}.`,
      );
  }
  const found = request.data.aboutId ? store.get(request.data.aboutId) : null;
  // Asked from a file in a hidden folder: agents don't learn it exists (R7.5).
  const item = found && new AgentFiles(store).entity(found);
  if (item) {
    const label = ENTITIES[item.type].label;
    lines.push(
      `Item: ${item.type} "${String((item.data as Record<string, unknown>)[label])}" (${item.id})`,
    );
  }
  return lines;
}
