import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  ENTITY_TYPES,
  EntityType,
  applyInputFor,
  type ApplyInput,
  type Author,
} from '@pharos/schema';
import { z } from 'zod';
import { VERSION } from './version.js';
import { PharosError } from './store/errors.js';
import { projectSnapshot } from './store/snapshot.js';
import type { Store } from './store/store.js';
import { registerGuidance } from './guidance.js';
import { changesSince, unseenCount } from './views/changes.js';
import { catalogDescribe, catalogList } from './views/catalog.js';
import {
  ViewAnswerInput,
  ViewCreateInput,
  ViewPreviewInput,
  ViewUpdateInput,
  answerView,
  createView,
  deleteView,
  getView,
  listViews,
  previewView,
  updateView,
} from './views/service.js';

/** Agents edit views with the view tools, which keeps apply's schema small. */
const AgentApplyInput = applyInputFor(ENTITY_TYPES.filter((t) => t !== 'view'));

const INSTRUCTIONS = `Pharos stores structured project data (projects, goals, scope, stages, tasks, assignees, artifacts, decisions, claims) with git-like history, and shows it to the user as visual views made of widgets. You can both change the data and generate the views.

Getting oriented:
- list {type: "project"} to find projects, then project_snapshot for the full picture in one call (including its views, custom options, and open requests from people).
- get {id} for one entity's full details (descriptions are left out of snapshots).

Changing data:
- Data writes go through apply: a required message (why, like a commit message) plus a list of operations. One apply = one revision.
- Batch related changes into one apply. A create can set ref: "s1" and later operations in the same call can use "$s1" as an id, so a whole project (stages, tasks, dependencies) can be set up in one call.
- Prefer updating existing entities over creating duplicates; check project_snapshot first.
- Statuses, priorities, scope groups, and artifact kinds can be customized per project (project.options); use values from the project's options, shown in project_snapshot.
- When you start work on a task, claim it in one apply: set its assigneeId to you and its status to in progress (project_snapshot lists assignees; if none has your name, create one in the same apply with kind "agent" and use its ref). Mark it done when you finish, and leave tasks assigned to someone else alone unless the user hands them to you.
- Findings are claims (one plain sentence, with checkedOn, sourceIds and authorId) and terms explain a word. A claim's certainty is "reading" (your analysis; the default), "verified" (From source: needs a source artifact with an http(s) uri and a checkedOn date that is not in the future) or "confirmed" (Confirmed by you: needs confirmedById, a decision the owner accepted in Pharos themselves; you can't confirm one yourself). Pharos refuses a claim that doesn't meet its certainty: without a linked source you read and a checkedOn date, keep it at "reading". For a finding the owner should confirm, create the decision with status "proposed" (the default, "accepted", records no acceptance by the owner, so it can never back a confirmed claim), ask the owner to accept it in Pharos, and only then set the claim to "confirmed" with confirmedById. apply warns about a claim with no source, so add sourceIds.
- Record meaningful choices as decisions so the reasoning stays traceable: set decidedById (the assignee who made the call, usually the person who asked, not you unless you decided) and decisionDate.
- The sidebar groups projects under repositories (shown as folders) and optional sections (type "section"); projects and repositories have an "order", and projects can be "pinned". Change these only when the user asks.

Generating views (what the user sees):
- Read the resource pharos://guide/views (design guidelines) and pharos://examples/answers (worked examples) before your first view in a session.
- A view is a board of widgets; each widget is one catalog component bound to live data. The user's browser updates as soon as you save.
- Start with catalog_list (components, when to use them, sizes, board and filter rules), then catalog_describe for the exact props of the components you pick.
- view_list / view_get show existing views; view_create makes a new one; view_update edits one with small ops (add, update, move, remove widgets) or resets it to its template; view_delete removes one.
- People can also ask questions from the Pharos UI: project_snapshot lists them under "requests". Answer each open one with view_answer and its requestId (that marks it answered), or dismiss it with apply (request status "dismissed") if it no longer applies.
- When the user asks a question about the project ("what's overdue?", "what's blocking stage 2?", "who is on what?"), answer with view_answer: a focused answer view that leads with the answer (a Text or Callout), then the evidence (a table, chart, or list). Then reply in at most two sentences (the answer and the link); the view carries the details, so don't restate it in chat. Answers expire after a week unless the user keeps them.
- When the user needs to understand something (research, a concept, what a result means) rather than track work, build an explanation view: the point first in one short sentence (a ClaimCard with size "headline"), then the picture (Layers), every finding stored as a claim with its source, words the reader may not know stored as terms, certainty always shown, and detail on demand. The "Explanation views" part of pharos://guide/views has the rules and a worked example; the preview warns when a rule is broken. Ordinary project views (task boards, stages) are not checked.
- Prefer adjusting an existing view when the user asks to change "the board" or "the overview"; create a new view when they want a different angle (e.g. "a view for this week's work").
- view_create, view_answer, and view_update return a preview of the saved view: read it before telling the user the view is ready, and fix unknown fields, empty widgets you didn't intend, and its warnings (per widget, and for the whole view). Use view_preview for drafts or other views.
- People can rearrange views too, so read a view with view_get before editing it, and keep widget ids stable.

History:
- At the start of a session, call changes_since for the project you work on: it lists what people and other agents changed since you last looked (Pharos remembers your place), e.g. tasks they finished or questions they asked.
- history_list shows revisions (filter by projectId or entityId), history_diff shows net changes between revisions, history_revert undoes one revision as a new revision.`;

function json(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function run(fn: () => unknown): CallToolResult {
  try {
    return json(fn());
  } catch (err) {
    if (err instanceof PharosError)
      return { isError: true, content: [{ type: 'text', text: err.message }] };
    throw err;
  }
}

const Scalar = z.union([z.string(), z.number(), z.boolean()]);

export function createMcpServer(store: Store): McpServer {
  const server = new McpServer(
    { name: 'pharos', version: VERSION },
    { instructions: INSTRUCTIONS },
  );
  const author = (): Author => ({
    kind: 'agent',
    name: server.server.getClientVersion()?.name ?? 'mcp-agent',
  });

  server.registerTool(
    'project_snapshot',
    {
      title: 'Project snapshot',
      description:
        'Compact structured summary of a project: status, progress, goals tree, scope, stages, tasks, artifacts, decisions, and recent revisions.',
      inputSchema: { projectId: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ projectId }) =>
      run(() => ({
        ...projectSnapshot(store, projectId),
        // Nudges the agent to catch up on what people (and other agents) did since it last looked.
        unseenChanges: unseenCount(store, author().name, projectId),
      })),
  );

  server.registerTool(
    'list',
    {
      title: 'List entities',
      description:
        'List entities of one type. Project-scoped types can be filtered by projectId; `where` filters by field equality, e.g. {"status": "blocked"}.',
      inputSchema: {
        type: EntityType,
        projectId: z.string().optional().describe('Required in practice for project-scoped types'),
        where: z.record(z.string(), Scalar).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ type, projectId, where }) =>
      run(() =>
        store
          .list(type, { projectId, where })
          .map(({ id, data, updatedAt }) => ({ id, ...data, updatedAt })),
      ),
  );

  server.registerTool(
    'get',
    {
      title: 'Get entity',
      description: 'Get one entity by id, with all fields and metadata.',
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ id }) =>
      run(() => {
        const entity = store.get(id);
        if (!entity) throw new PharosError('not_found', `${id} not found`);
        return entity;
      }),
  );

  server.registerTool(
    'apply',
    {
      title: 'Apply changes',
      description:
        "Create, update, or delete entities atomically as one revision. Updates are partial; set a field to null to clear it. Deletes cascade (e.g. deleting a project deletes its tasks) and clear references (e.g. deleting a stage unsets tasks' stageId). The result's warnings list things to fix that didn't block the save, e.g. a claim without a source.",
      inputSchema: AgentApplyInput.shape,
      annotations: { destructiveHint: true },
    },
    (input) => run(() => store.apply(author(), input as ApplyInput)),
  );

  server.registerTool(
    'history_list',
    {
      title: 'List revisions',
      description:
        'Revisions newest first, each with author, message, and the entities it changed.',
      inputSchema: {
        projectId: z.string().optional(),
        entityId: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional().describe('Default 20'),
        before: z.number().int().optional().describe('Only revisions older than this id (paging)'),
        after: z.number().int().optional().describe('Only revisions newer than this id'),
        authorKind: z
          .enum(['human', 'agent', 'system'])
          .optional()
          .describe('Only revisions by this kind of author'),
      },
      annotations: { readOnlyHint: true },
    },
    (query) => run(() => store.history(query)),
  );

  server.registerTool(
    'changes_since',
    {
      title: 'Changes since you last looked',
      description:
        'What people and other agents changed in a project since you last called this (Pharos remembers your place), then marks them as seen. Call it at the start of a session; project_snapshot.unseenChanges says how many are waiting.',
      inputSchema: {
        projectId: z.string(),
        onlyPeople: z.boolean().optional().describe('Only changes made by people'),
        mark: z.boolean().optional().describe('Mark as seen (default true); false just peeks'),
      },
      annotations: { readOnlyHint: false },
    },
    ({ projectId, onlyPeople, mark }) =>
      run(() => changesSince(store, author().name, projectId, { onlyPeople, mark })),
  );

  server.registerTool(
    'history_diff',
    {
      title: 'Diff revisions',
      description:
        'Net field-level changes after revision `from` up to and including `to` (default: latest). For a single revision N use from: N-1, to: N.',
      inputSchema: {
        from: z.number().int().min(0),
        to: z.number().int().optional(),
        projectId: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    (options) => run(() => store.diff(options)),
  );

  server.registerTool(
    'history_revert',
    {
      title: 'Revert revision',
      description:
        'Undo one revision by recording its inverse as a new revision. Fails with a list of conflicts if later revisions changed the same things.',
      inputSchema: {
        revision: z.number().int(),
        message: z.string().optional().describe('Why it is being reverted'),
      },
      annotations: { destructiveHint: true },
    },
    ({ revision, message }) => run(() => store.revert(revision, author(), message)),
  );

  server.registerTool(
    'catalog_list',
    {
      title: 'List view components',
      description:
        'Every component a view can use, with when to use it and its sizes, plus how boards, widgets, and filters work. Read this before making or changing views.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => run(() => catalogList()),
  );

  server.registerTool(
    'catalog_describe',
    {
      title: 'Describe view components',
      description:
        'JSON Schema of the props for the named components, with guidance and a complete example node.',
      inputSchema: {
        names: z
          .array(z.string())
          .min(1)
          .describe('Component names, e.g. ["KanbanBoard", "Timeline"]'),
      },
      annotations: { readOnlyHint: true },
    },
    ({ names }) => run(() => catalogDescribe(names)),
  );

  server.registerTool(
    'view_list',
    {
      title: 'List views',
      description:
        "A project's views (tabs) in display order, each with its widgets (id, component, title, size).",
      inputSchema: {
        projectId: z.string(),
        includeArchived: z.boolean().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ projectId, includeArchived }) => run(() => listViews(store, projectId, includeArchived)),
  );

  server.registerTool(
    'view_get',
    {
      title: 'Get view',
      description:
        'One view with its full board (every widget and its props), as currently shown to the user.',
      inputSchema: { viewId: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ viewId }) => run(() => getView(store, viewId)),
  );

  server.registerTool(
    'view_create',
    {
      title: 'Create view',
      description:
        'Add a saved view (a new tab) made of widgets; to answer a question, use view_answer instead. Example widget: {"id": "work", "w": 8, "node": {"component": "KanbanBoard", "filter": {"where": {"stageId": "$currentStage"}}}}. Returns a preview with warnings that did not block the save; fix them.',
      inputSchema: ViewCreateInput.shape,
    },
    (input) => run(() => createView(store, author(), input)),
  );

  server.registerTool(
    'view_answer',
    {
      title: 'Answer with a view',
      description:
        'Answer a question about the project with a focused view (shown to the user as an answer, apart from saved views). Lead with the answer, then the evidence. Returns the view, its URL, and a preview of what it shows. Expires after 7 days unless kept.',
      inputSchema: ViewAnswerInput.shape,
    },
    (input) => run(() => answerView(store, author(), input)),
  );

  server.registerTool(
    'view_preview',
    {
      title: 'Preview a view',
      description:
        'Check a view (saved, or a draft before saving) against live data: what each widget shows (counts, values, filled text), which would be empty, and warnings such as unknown fields, widths below the minimum, or rows that leave columns unused. For an explanation view (one with a ClaimCard or Layers) it also warns when the point comes too late (no headline ClaimCard first, or more than 30 words or another block before it), a claim is shown without a source, a claim id is not in the project, or a layer shows nothing.',
      inputSchema: ViewPreviewInput.shape,
      annotations: { readOnlyHint: true },
    },
    (input) => run(() => previewView(store, input)),
  );

  server.registerTool(
    'view_update',
    {
      title: 'Update view',
      description:
        'Change a view: rename, pin, archive, reorder, and edit widgets with ops (add, update props/size, move, remove), replace all widgets, or reset to its template. One call = one revision.',
      inputSchema: ViewUpdateInput.shape,
      annotations: { destructiveHint: true },
    },
    (input) => run(() => updateView(store, author(), input)),
  );

  server.registerTool(
    'view_delete',
    {
      title: 'Delete view',
      description: 'Remove a view. Undo with history_revert if needed.',
      inputSchema: {
        viewId: z.string(),
        message: z.string().trim().min(1).describe('Why it is being removed'),
      },
      annotations: { destructiveHint: true },
    },
    (input) => run(() => deleteView(store, author(), input)),
  );

  registerGuidance(server, store);

  return server;
}
