import {
  Board,
  ENTITIES,
  ReportPage,
  TEMPLATES,
  type DocBlock,
  type DocLeafBlock,
  type ReportDoc,
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
import {
  allDocWarnings,
  docReadsNothing,
  lenientDoc,
  mapDocLeaves,
  parseDoc,
  previewDoc,
  sheetSummaries,
} from './doc.js';
import { ReportAssets, previewPage } from './report.js';

/**
 * The board a view currently shows: its own spec, or its template's. A report page (R13) or a
 * report document (R14) has no board: an empty one, so block tools find nothing on it.
 */
export function effectiveBoard(view: Entity<'view'>): Board {
  if (view.data.page || view.data.doc) return { component: 'Board', widgets: [] };
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
    // The owner finished this review document and handed it back: read its sheets' answers.
    ...(view.data.handedBack ? { handedBack: view.data.handedBack } : {}),
    order,
    layout: view.data.page
      ? 'report page'
      : view.data.doc
        ? 'report document'
        : spec
          ? template
            ? `customized from template "${template}"`
            : 'custom'
          : `template "${template ?? 'overview'}"`,
    ...(view.data.page
      ? {
          ...(view.data.page.summary ? { summary: view.data.page.summary } : {}),
          reads: Object.keys(view.data.page.data ?? {}),
        }
      : view.data.doc
        ? {
            ...(view.data.doc.summary ? { summary: view.data.doc.summary } : {}),
            blocks: docOutline(view.data.doc),
            reads: Object.keys(view.data.doc.data ?? {}),
          }
        : { widgets: summarizeBoard(effectiveBoard(view)) }),
  };
}

/** view_get shows a page's HTML up to this many characters (the rest is the agent's own copy). */
export const PAGE_HTML_SHOWN = 50_000;

/** A document's blocks in one line each: id, kind and what it is (for view lists). */
function docOutline(doc: ReportDoc): string[] {
  const line = (b: DocLeafBlock) => {
    switch (b.kind) {
      case 'block':
        return `${b.id}: ${b.node.component}${b.node.title ? ` "${b.node.title}"` : ''}`;
      case 'drawing':
        return `${b.id}: drawing${b.caption ? ` "${b.caption}"` : ''}`;
      case 'embed':
        return `${b.id}: embed ${b.url}`;
      case 'figure':
        return `${b.id}: figure${b.layout ? ` ${b.layout}` : ''} (${b.items.map((i) => i.src).join(', ')})`;
      case 'steps':
        return `${b.id}: steps${b.title ? ` "${b.title}"` : ''} (${b.items.length})`;
    }
  };
  const inner = (blocks: DocBlock[]): string => blocks.map(outer).join('; ');
  const outer = (b: DocBlock): string => {
    switch (b.kind) {
      case 'columns':
        return `${b.id}: columns [${b.columns.map((c) => c.map(line).join('; ')).join(' | ')}]`;
      case 'details':
        return `${b.id}: details "${b.summary}" [${inner(b.blocks as DocBlock[])}]`;
      case 'sheet':
        return `${b.id}: sheet "${b.title}"${b.time ? ` (${b.time})` : ''} [${inner(b.blocks as DocBlock[])}]`;
      default:
        return line(b);
    }
  };
  return doc.blocks.map(outer);
}

/** A document with each drawing's HTML cut to PAGE_HTML_SHOWN characters, saying so. */
function docShown(doc: ReportDoc): ReportDoc & { htmlTruncated?: string } {
  const cut: string[] = [];
  const blocks = mapDocLeaves(doc.blocks, (b) => {
    if (b.kind !== 'drawing' || b.html.length <= PAGE_HTML_SHOWN) return [b];
    cut.push(b.id);
    return [{ ...b, html: b.html.slice(0, PAGE_HTML_SHOWN) }];
  });
  return {
    ...doc,
    blocks,
    ...(cut.length
      ? {
          htmlTruncated: `Shown: the first ${PAGE_HTML_SHOWN} characters of drawing ${cut.map((id) => `"${id}"`).join(', ')}. To change the document, send the whole doc again with each drawing's whole HTML; never send this cut copy back.`,
        }
      : {}),
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
  const page = view.data.page;
  if (page) {
    const cut = page.html.length > PAGE_HTML_SHOWN;
    return {
      ...summary(view),
      projectId: view.data.projectId,
      url: viewUrl(view),
      /** A report page has no blocks (kept so every view has a board). */
      board: effectiveBoard(view),
      page: {
        ...page,
        html: cut ? page.html.slice(0, PAGE_HTML_SHOWN) : page.html,
        ...(cut
          ? {
              htmlTruncated: `Shown: the first ${PAGE_HTML_SHOWN} of ${page.html.length} characters. To change the page, send the whole HTML again with view_update (page); never send this cut copy back.`,
            }
          : {}),
      },
      doc: undefined,
      sheets: undefined,
      assets: new ReportAssets(store).list(view.id),
    };
  }
  const sheets = view.data.doc ? sheetSummaries(store, view.data.projectId, view.data.doc) : [];
  if (view.data.doc)
    return {
      ...summary(view),
      projectId: view.data.projectId,
      url: viewUrl(view),
      /** A report document has no board blocks (kept so every view has a board). */
      board: effectiveBoard(view),
      page: undefined,
      doc: docShown(view.data.doc),
      /**
       * Its sheets (R15): each with its state and the reader's answers (the option chosen, their
       * own words, a later date; checklist ticks), so one call reads them all.
       */
      sheets: sheets.length ? sheets : undefined,
      assets: new ReportAssets(store).list(view.id),
    };
  return {
    ...summary(view),
    projectId: view.data.projectId,
    url: viewUrl(view),
    board: effectiveBoard(view),
    page: undefined,
    doc: undefined,
    sheets: undefined,
    assets: undefined,
  };
}

function parsePage(page: unknown): ReportPage {
  const result = ReportPage.safeParse(page);
  if (!result.success) {
    throw new PharosError(
      'invalid',
      'Invalid page',
      result.error.issues.map(
        (i) => `page${i.path.length ? `.${formatPath(i.path)}` : ''}: ${i.message}`,
      ),
    );
  }
  return result.data;
}

const PageInput = z
  .unknown()
  .optional()
  .describe(
    'A report page instead of widgets (R13): {html: the whole HTML document, data?: {name: {type, filter?}} read live with pharos.data(name), summary?: one or two sentences}. Only when the whole page needs a design no document can give; for a report, write doc instead. Call report_guide first.',
  );

const DocInput = z
  .unknown()
  .optional()
  .describe(
    'A report document (R14), the way to write a report: {blocks: [{kind: "block", id, node: {component: "Text", content, values}} | {kind: "columns", id, columns: [[blocks], [blocks]]} | {kind: "drawing", id, html, reads?, height} | {kind: "embed", id, url} | {kind: "figure", id, layout?, items: [{src, alt, caption?}]} | {kind: "steps", id, items: [{text, command?, expect?}]} | {kind: "details", id, summary, blocks} | {kind: "sheet", id, title, time?, decisions?, blocks}], data?: {name: {type, filter?}} for drawings, summary}. Pharos draws it in its own style; figures show screenshots you upload, sheets are items for the owner to review or answer; a drawing is for one visual no component can draw. Call report_guide first ("Report documents", "Rich documents and the review desk").',
  );

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
    .optional()
    .describe(
      'Board widgets: [{id, w?, x?, h?, node}]; see catalog_list. Or give doc (a report) or page instead',
    ),
  page: PageInput,
  doc: DocInput,
  message: z.string().trim().min(1).describe('Why this view is being made'),
});

/** A new view's one layout: a board (widgets), a report document (doc) or a report page (page). */
function layoutOf(input: { widgets?: unknown; page?: unknown; doc?: unknown }) {
  const given = [input.widgets, input.page, input.doc].filter((x) => x !== undefined).length;
  if (given !== 1)
    throw new PharosError(
      'invalid',
      'Give one of widgets (a working page of blocks), doc (a report document Pharos draws) or page (a whole page written as HTML)',
    );
  return input.page !== undefined
    ? { page: parsePage(input.page) }
    : input.doc !== undefined
      ? { doc: parseDoc(input.doc) }
      : { spec: parseWidgets(input.widgets) };
}

export function createView(store: Store, author: Author, input: z.infer<typeof ViewCreateInput>) {
  const layout = layoutOf(input);
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
            ...layout,
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
    .optional()
    .describe(
      'Board widgets that answer a quick status question; lead with the answer (a Text or Callout). Or give doc instead',
    ),
  doc: DocInput.describe(
    'A report document that answers a question asking to explain, report on or compare something (R14): {blocks, data?, summary}. Call report_guide first ("Report documents")',
  ),
  page: PageInput,
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
  if (request?.data.mode === 'refresh') {
    const target = request.data.viewId ? store.get(request.data.viewId) : null;
    const data = target?.type === 'view' ? (target as Entity<'view'>).data : null;
    const again = data?.page
      ? 'the whole page as page'
      : data?.doc
        ? 'the whole document as doc'
        : 'the whole page as widgets';
    throw new PharosError(
      'invalid',
      `Request ${request.id} asks to refresh ${data?.page ? 'report page' : data?.doc ? 'report document' : 'view'} ${request.data.viewId}: answer again in that same view with view_update (its revision as expectedRevision, the requestId and ${again}), not in a new one`,
    );
  }
  const layout = layoutOf(input);
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
            ...layout,
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
  page: z
    .unknown()
    .optional()
    .describe(
      'Replace the whole report page (R13): {html, data?, summary?}. Makes a board or document a report page; widgets or resetToTemplate make it a board again',
    ),
  doc: z
    .unknown()
    .optional()
    .describe(
      'Replace the whole report document (R14): {blocks, data?, summary?}, sent whole. Makes a board or page a document; widgets or resetToTemplate make it a board again',
    ),
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
  const isPage = !!view.data.page;
  const isDoc = !!view.data.doc;
  if (request) {
    if (request.data.projectId !== view.data.projectId)
      throw new PharosError('invalid', `Request ${request.id} is about another project`);
    if (request.data.status !== 'open')
      throw new PharosError('invalid', `Request ${request.id} is already ${request.data.status}`);
    if (request.data.mode === 'block' && (isPage || isDoc))
      throw new PharosError(
        'invalid',
        `Request ${request.id} asks about one block, but view "${view.data.name}" is a ${isPage ? 'report page' : 'report document'}, which has no blocks to ask about: dismiss the request with a reply, or answer it as a question`,
      );
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
    if (
      request.data.mode === 'refresh' &&
      input.widgets === undefined &&
      input.page === undefined &&
      input.doc === undefined
    )
      throw new PharosError(
        'invalid',
        isPage
          ? `Request ${request.id} asks to refresh this report page: write it again with the whole page as page (check every number and sentence against the data now), or dismiss the request with a reply saying why`
          : isDoc
            ? `Request ${request.id} asks to refresh this report document: write it again with the whole document as doc (check every number and sentence against the data now), or dismiss the request with a reply saying why`
            : `Request ${request.id} asks to refresh this view: answer it again with the whole page as widgets (check every number and sentence against the data now), or dismiss the request with a reply saying why`,
      );
    // A refresh of a report page writes the same page again: widgets would turn it into a board,
    // and a page without its named reads would read nothing, so nothing could mark it stale again.
    if (request.data.mode === 'refresh' && isPage) {
      if (input.widgets !== undefined)
        throw new PharosError(
          'invalid',
          `Request ${request.id} asks to refresh report page "${view.data.name}": send the whole page again as page, not widgets (widgets would turn it into a board)`,
        );
      const before = Object.keys(view.data.page?.data ?? {});
      const sent = (input.page as { data?: Record<string, unknown> } | undefined)?.data;
      if (before.length && !Object.keys(sent ?? {}).length)
        throw new PharosError(
          'invalid',
          `Request ${request.id} asks to refresh report page "${view.data.name}": send page.data again with its named reads (${before.map((n) => `"${n}"`).join(', ')}), so the page still reads its data live and Pharos can tell when it goes out of date`,
        );
      if (input.doc !== undefined)
        throw new PharosError(
          'invalid',
          `Request ${request.id} asks to refresh report page "${view.data.name}": send the whole page again as page, not doc`,
        );
    }
    // The same for a report document (R14): rewrite it as a document that still reads its data.
    if (request.data.mode === 'refresh' && isDoc) {
      if (input.widgets !== undefined || input.page !== undefined)
        throw new PharosError(
          'invalid',
          `Request ${request.id} asks to refresh report document "${view.data.name}": send the whole document again as doc, not ${input.widgets !== undefined ? 'widgets (they would turn it into a board)' : 'page (it would turn it into an HTML page)'}`,
        );
      if (
        input.doc !== undefined &&
        !docReadsNothing(view.data.doc!) &&
        docReadsNothing(parseDoc(input.doc))
      )
        throw new PharosError(
          'invalid',
          `Request ${request.id} asks to refresh report document "${view.data.name}": the new document reads nothing from the project. Keep its live values, charts and named reads (blocks with queries), so it still shows the data now and Pharos can tell when it goes out of date`,
        );
    }
  }
  if (input.reply && !request) throw new PharosError('invalid', 'reply needs a requestId');
  const data: Record<string, unknown> = {};
  for (const key of ['name', 'description', 'pinned', 'archived', 'order'] as const) {
    if (input[key] !== undefined) data[key] = input[key];
  }
  // Restoring a view ends its hand-back.
  if (input.archived === false && view.data.handedBack) data.handedBack = null;
  if (input.keep) {
    if (view.data.kind !== 'answer')
      throw new PharosError('invalid', `View "${view.data.name}" is not an answer view`);
    // Keeping an answer makes it a regular tab; the question stays as its description.
    Object.assign(data, { kind: null, expiresAt: null, archived: null });
    if (!view.data.description && view.data.question) data.description = view.data.question;
  }
  const changesLayout = [
    input.ops,
    input.widgets,
    input.resetToTemplate,
    input.page,
    input.doc,
  ].filter((x) => x !== undefined && x !== false);
  if (changesLayout.length > 1) {
    throw new PharosError(
      'invalid',
      'Use only one of ops, widgets, page, doc, or resetToTemplate in one update',
    );
  }
  if (input.ops && (isPage || isDoc))
    throw new PharosError(
      'invalid',
      isPage
        ? `View "${view.data.name}" is a report page: it has no widgets for ops. Send the whole page again as page`
        : `View "${view.data.name}" is a report document: it has no widgets for ops. Send the whole document again as doc`,
    );
  if (input.page !== undefined) {
    // A view is a board, a page or a document (R13, R14): the new one replaces the others; the
    // template stays so a reset can bring it back.
    data.page = parsePage(input.page);
    if (view.data.spec) data.spec = null;
    if (isDoc) data.doc = null;
  } else if (input.doc !== undefined) {
    data.doc = parseDoc(input.doc);
    if (view.data.spec) data.spec = null;
    if (isPage) data.page = null;
  } else if (input.resetToTemplate) {
    if (!view.data.template)
      throw new PharosError('invalid', `View "${view.data.name}" has no template to reset to`);
    data.spec = null;
    if (isPage) data.page = null;
    if (isDoc) data.doc = null;
  } else if (input.widgets) {
    data.spec = parseWidgets(input.widgets);
    if (isPage) data.page = null;
    if (isDoc) data.doc = null;
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
    if (data.page !== undefined || data.doc !== undefined)
      throw new PharosError(
        'invalid',
        `${scope}; leave the rest of the view as it is (use ops on that block)`,
      );
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
    (input.widgets !== undefined ||
      input.page !== undefined ||
      input.doc !== undefined ||
      input.resetToTemplate)
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
        author.kind === 'agent' &&
        (input.widgets !== undefined || input.page !== undefined || input.doc !== undefined) &&
        request?.data.mode !== 'block',
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
  const view = getView(store, viewId);
  return {
    revision: result.revision,
    // The agent just sent the page or document: it needn't come back (it can be megabytes).
    view: view.page
      ? { ...view, page: { summary: view.page.summary, data: view.page.data } }
      : view.doc
        ? { ...view, doc: undefined }
        : view,
    preview: entity.data.page
      ? previewPage(store, entity.data.projectId, entity.data.page, entity.id)
      : entity.data.doc
        ? docPreview(store, entity.data.projectId, entity.data.doc, entity.id)
        : previewBoard(store, entity.data.projectId, effectiveBoard(entity)),
  };
}

/** A document's preview with every warning (per block too) listed once at the top. */
function docPreview(
  store: Store,
  projectId: string,
  doc: ReportDoc,
  viewId?: string,
  extra: string[] = [],
) {
  const preview = previewDoc(store, projectId, doc, viewId, extra);
  return { ...preview, warnings: allDocWarnings(preview) };
}

export const ViewPreviewInput = z.object({
  viewId: z.string().optional().describe('A saved view to check'),
  projectId: z.string().optional().describe('With widgets: the project to check a draft against'),
  widgets: z.array(z.unknown()).optional().describe('A draft board to check before saving it'),
  page: z
    .unknown()
    .optional()
    .describe('With projectId (or a viewId, to check against its assets): a draft report page'),
  doc: z
    .unknown()
    .optional()
    .describe('With projectId (or a viewId, to check against its assets): a draft report document'),
});

/**
 * view_preview: a report page (saved, or a draft page) gets the page checks (R13), anything else
 * the board preview.
 */
export function previewAny(store: Store, input: z.infer<typeof ViewPreviewInput>) {
  return previewReport(store, input) ?? previewView(store, input);
}

/**
 * The page checks for a draft page or a saved report page, the document checks for a draft or
 * saved report document; null for a board.
 */
export function previewReport(store: Store, input: z.infer<typeof ViewPreviewInput>) {
  if (input.doc !== undefined) {
    const { doc, warnings } = lenientDoc(input.doc);
    const view = input.viewId ? store.getOfType('view', input.viewId) : undefined;
    const projectId = view?.data.projectId ?? input.projectId;
    if (!projectId)
      throw new PharosError('invalid', 'Give a projectId (or a viewId) with the draft doc');
    store.getOfType('project', projectId);
    return {
      view: view ? view.data.name : '(draft)',
      ...docPreview(store, projectId, doc, view?.id, warnings),
    };
  }
  if (input.page !== undefined) {
    const page = parsePage(input.page);
    const view = input.viewId ? store.getOfType('view', input.viewId) : undefined;
    const projectId = view?.data.projectId ?? input.projectId;
    if (!projectId)
      throw new PharosError('invalid', 'Give a projectId (or a viewId) with the draft page');
    store.getOfType('project', projectId);
    return {
      view: view ? view.data.name : '(draft)',
      ...previewPage(store, projectId, page, view?.id),
    };
  }
  if (input.viewId && !input.widgets) {
    const view = store.getOfType('view', input.viewId);
    if (view.data.page)
      return {
        view: view.data.name,
        ...previewPage(store, view.data.projectId, view.data.page, view.id),
      };
    if (view.data.doc)
      return {
        view: view.data.name,
        ...docPreview(store, view.data.projectId, view.data.doc, view.id),
      };
  }
  return null;
}

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
 * How to answer a refresh of a report page (R13 + R11): write the same page again from the data
 * now, with the same named reads, so the page keeps its look, its assets and what R11 tracks.
 * Shown in the answering brief and in project_snapshot's request context.
 */
export function pageRefreshSteps(view: Entity<'view'>, requestId: string): string[] {
  if (view.data.doc) return docRefreshSteps(view, requestId);
  const page = view.data.page;
  if (!page) return [];
  const reads = page.data ?? {};
  const names = Object.keys(reads);
  return [
    `Refresh this report page: the data its named reads (${names.length ? names.map((n) => `"${n}"`).join(', ') : 'none'}) return changed since it was written, so its numbers, headings, sentences and summary may be out of date. Write the same page again from the data now:`,
    `1. report_guide (how a report page works).`,
    `2. view_get ${view.id}: the current page (html, data, summary), its assets and its revision. If html is cut (htmlTruncated), write the whole page again from what is shown; never send the cut copy back.`,
    `3. Read the data each named read selects now (list with its type, projectId and the filter's where; view_preview {viewId: "${view.id}"} says how many rows each read returns) and work out again every number, claim, heading and the summary the page states in words.`,
    `4. view_update {viewId: "${view.id}", expectedRevision: <the revision from view_get>, requestId: "${requestId}", page: {html: <the whole new HTML>, data: ${JSON.stringify(reads)}, summary: <one or two sentences, from the data now>}, reply: <one sentence: what changed>, message}. Keep page.data the same named reads (the page's scripts ask for them by name with pharos.data) and keep its look and structure. Its assets stay with the view: don't upload them again unless one must change. Never send widgets: that would turn the page into a board.`,
  ];
}

/**
 * How to answer a refresh of a report document (R14 + R11): write the same document again from
 * the data now, keeping its structure, its block ids and what it reads.
 */
function docRefreshSteps(view: Entity<'view'>, requestId: string): string[] {
  const doc = view.data.doc!;
  const reads = doc.data ?? {};
  const names = Object.keys(reads);
  return [
    `Refresh this report document: data it reads changed since it was written, so its words, headings, figures stated in prose and its summary may be out of date (its components and live values already show the data now). Write the same document again from the data now:`,
    `1. report_guide (the "Report documents" section).`,
    `2. view_get ${view.id}: the current doc (blocks, data, summary) and its revision. If a drawing's html is cut (htmlTruncated), write that drawing again whole; never send the cut copy back.`,
    `3. view_preview {viewId: "${view.id}"}: what every block shows now. Read the data its blocks${names.length ? ` and named reads (${names.map((n) => `"${n}"`).join(', ')})` : ''} select (list with the same filters) and work out again every claim, heading and sentence.`,
    `4. view_update {viewId: "${view.id}", expectedRevision: <the revision from view_get>, requestId: "${requestId}", doc: {blocks: <every block, the same ids, words rewritten>, data: ${JSON.stringify(reads)}, summary: <one or two sentences, from the data now>}, reply: <one sentence: what changed>, message}. Keep its live values, charts and named reads (a document that reads nothing is refused) and its order. Never send widgets or page: they would turn it into a board or an HTML page.`,
  ];
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
    if (v.data.page) {
      lines.push(
        `Report page "${v.data.name}" (${v.id}, ${kind}): HTML an agent wrote${v.data.page.summary ? `; it says: ${v.data.page.summary}` : ''}. To change or refresh it, view_get it, then view_update with its revision as expectedRevision and the whole page as page (report_guide has how to write one).`,
      );
      if (request.data.mode === 'refresh') lines.push(...pageRefreshSteps(v, request.id));
    } else if (v.data.doc) {
      lines.push(
        `Report document "${v.data.name}" (${v.id}, ${kind}): blocks an agent wrote that Pharos draws${v.data.doc.summary ? `; it says: ${v.data.doc.summary}` : ''}. To change or refresh it, view_get it, then view_update with its revision as expectedRevision and the whole document as doc (report_guide has how to write one).`,
      );
      if (request.data.mode === 'refresh') lines.push(...pageRefreshSteps(v, request.id));
    } else if (widget) {
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
