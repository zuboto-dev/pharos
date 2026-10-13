import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  AGENT_FILE_CREATE_FIELDS,
  ENTITY_TYPES,
  EntityType,
  FILES_UNADDED_TOOL,
  FILE_TEXT_TOOL,
  FOLDER_REQUEST_STATUS_TOOL,
  FOLDER_REQUEST_TOOL,
  FolderRequestInput,
  applyInputFor,
  type ApplyInput,
  type Author,
} from '@pharos/schema';
import { z } from 'zod';
import { VERSION } from './version.js';
import { forAgent, requestFolder, savedRequests } from './files/requests.js';
import {
  AGENT_READONLY_FILE_FIELDS,
  AgentFiles,
  readAgentFileText,
  unaddedFiles,
} from './store/agent-files.js';
import { PharosError } from './store/errors.js';
import { projectSnapshot } from './store/snapshot.js';
import type { Store } from './store/store.js';
import { registerGuidance } from './guidance.js';
import { PackApplyInput, applyPack, listPacks } from './packs/service.js';
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

/**
 * Agents edit views with the view tools, which keeps apply's schema small, and only fill in the
 * details of files the owner added (the store refuses the rest too).
 */
const AgentApplyInput = applyInputFor(
  ENTITY_TYPES.filter((t) => t !== 'view'),
  { file: AGENT_READONLY_FILE_FIELDS },
  { file: AGENT_FILE_CREATE_FIELDS },
);

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
- Findings are claims (one plain sentence, with checkedOn, sourceIds and authorId) and terms explain a word. A claim's certainty is "reading" (your analysis; the default), "verified" (From source: needs a source artifact with an http(s) uri and a checkedOn date that is not in the future) or "confirmed" (Confirmed by you: needs confirmedById, a decision the owner accepted in Pharos themselves; you can't confirm one yourself). Pharos refuses a claim that doesn't meet its certainty: without a linked source you read and a checkedOn date, keep it at "reading". For a finding the owner should confirm, create the decision with status "proposed" (the default, "accepted", records no acceptance by the owner, so it can never back a confirmed claim), ask the owner to accept it in Pharos, and only then set the claim to "confirmed" with confirmedById. Show what a claim rests on: a "verified" claim carries quote, the exact passage from the source, word for word (max 300 characters; quoteSourceId names which of its sourceIds when there are several), and a "reading" claim carries assumption, the one assumption it rests on (max 200). Add locator (max 60 characters, e.g. "§7 Completion", "line 42", "commit deb7096") so the reader finds the quote in its source; figure {value, unit, label} when the claim states a number a FindingChart draws (on "verified", the value must appear in the quote); and weakBecause ("one-source", "indirect" or "disagree") when the evidence is thin, which shows after the mark. apply warns about a claim with no source, a "verified" claim without a quote, a "reading" claim without an assumption, a "verified" figure missing from its quote, and weakBecause "one-source" on a claim without exactly one source.
- Record meaningful choices as decisions so the reasoning stays traceable: set decidedById (the assignee who made the call, usually the person who asked, not you unless you decided) and decisionDate. When the owner has to choose, give the decision options (2–5), recommendedOptionId and recommendationReason, and show it in a DecisionBlock; only the owner chooses (see "Decisions for the reader" in pharos://guide/views).
- Files (type "file", in project_snapshot.files) are documents on the owner's disk, in folders the owner shares with Pharos. You see only their details (title, kind, issuer, issuedDate, expiryDate, tags, size, taskIds): never their notes, or anything from folders the owner hid. ${FILE_TEXT_TOOL} returns a file's text only when its folder allows it (canReadText in the snapshot) and it is a .txt, .csv or .md file. To bring documents in: if no folder holds them, ask with ${FOLDER_REQUEST_TOOL} {path, level, reason, projectId} and tell the owner in one line to click Approve in Pharos; check with ${FOLDER_REQUEST_STATUS_TOOL}. Once approved, ${FILES_UNADDED_TOOL} lists the files you can add; add them with apply (create type "file" with only ${AGENT_FILE_CREATE_FIELDS.join(', ')}; rootId is the folderId) and set kind, tags, issuer and dates with updates in the same apply ("$ref"). You can't remove or move files. Link files to the tasks, decisions, goals, stages and claims they belong to with fileIds (ids of files you can see). Don't look for the files on disk yourself. Sources (artifacts) never show an absolute local path in uri; a uri relative to the project's approved folder (e.g. "records/2024/certificate.pdf") is fine, and Pharos links it to the file once the file is added. Sources and findings taken only from hidden files aren't shown, and a quote taken from a file whose folder allows details only is left out. To manage a set of documents (e.g. business registration papers): add and tag them, link the related tasks and decisions, then build one view with a StartHere, a FileList filtered to the tag (showIn: the FileView's id), a FileView of the key document and the linked tasks and decisions; "Document sets" in pharos://guide/views has the recipe.
- Records (type "record") are a project's own kinds of things, such as a car service or a bill: recordType (a key of project.recordTypes, listed in project_snapshot.recordTypes), title, fields (by field key: text, number, money {amount in cents, currency}, date, option, reference (a record id), file, meter) and, for record types that repeat, interval {every: {n, unit}, meter: {n, from}, lastDate, lastMeter}. An update's fields are merged into the record's. To set up a project for a kind of life admin (a car, money), use pack_list and pack_apply instead of inventing record types; read the guide it returns.
- The sidebar groups projects under repositories (shown as folders) and optional sections (type "section"); projects and repositories have an "order", and projects can be "pinned". Change these only when the user asks.

Generating views (what the user sees):
- Read the resource pharos://guide/views (design guidelines) and pharos://examples/answers (worked examples) before your first view in a session.
- A view is a board of widgets; each widget is one catalog component bound to live data. The user's browser updates as soon as you save.
- Start with catalog_list (components, when to use them, sizes, board and filter rules), then catalog_describe for the exact props of the components you pick.
- view_list / view_get show existing views; view_create makes a new one; view_update edits one with small ops (add, update, move, remove widgets) or resets it to its template; view_delete removes one.
- People can also ask questions from the Pharos UI: project_snapshot lists them under "requests". Answer each open one with view_answer and its requestId (that marks it answered), or dismiss it with apply (request status "dismissed") if it no longer applies.
- When the user asks a question about the project ("what's overdue?", "what's blocking stage 2?", "who is on what?"), answer with view_answer: a focused answer view that leads with the answer (a Text or Callout), then the evidence (a table, chart, or list). Then reply in at most two sentences (the answer and the link); the view carries the details, so don't restate it in chat. Answers expire after a week unless the user keeps them.
- A report page (telling the reader what was done, what was found, or what needs them) has one purpose and opens with a StartHere: the purpose, why the work exists (one line), a headline sentence with its evidence, the reader's part (one line, said nowhere else on the page), where it sits (stage or goal, date), and a reading path of 2–4 steps pointing at widgets below. Keep it short: about 150 words before anything the reader opens, one short line per finding, few underlined terms. Show rather than tell: a process as a Layers flow (with per-step task progress), a change as a BeforeAfter, numbers as a FindingChart whose title is a stored claim, shares as mini bars (StatCards with \`of\`, Text \`{bar}\`). The "Report pages: start here" and "Pictures" parts of pharos://guide/views have the rules.
- When the user needs to understand something (research, a concept, what a result means) rather than track work, build an explanation view: the point first in one short sentence (a StartHere stating the headline claim), then the picture (Layers), every finding stored as a claim with its source, words the reader may not know stored as terms, certainty always shown, and detail on demand. The "Explanation views" part of pharos://guide/views has the rules and a worked example; the preview warns when a rule is broken. Ordinary project views (task boards, stages) are not checked.
- Research about anything visual (UI, products, places, cars, diagrams) must show its examples as pictures: store each as an artifact with image (an https address, or a project image file id), alt, uri (the page it comes from) and a shared tag, and show them in a Gallery filtered on the tag; layout "compare" puts two side by side for before/after or option A/B. "Pictures" in pharos://guide/views has the recipe.
- Prefer adjusting an existing view when the user asks to change "the board" or "the overview"; create a new view when they want a different angle (e.g. "a view for this week's work").
- view_create, view_answer, and view_update return a preview of the saved view: read it before telling the user the view is ready, and fix unknown fields, empty widgets you didn't intend, and its warnings (per widget, and for the whole view). Use view_preview for drafts or other views.
- Query checks: every filter, sort, group, sum and column in a view is checked against the project's fields (record fields included) before it is saved. An unknown field, record type or option value, a sum over something that isn't a number, an unreadable relative date, or a value that doesn't fit its field (e.g. a range on money; use "fields.amount.amount" in cents) refuses the save; the error gives the JSON path, the allowed values, the closest match and a corrected example, so fix exactly that and retry. A record query without recordType, or a field only some of its record types have, only warns. Empty results, custom option values and mixed currencies are fine.
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

/** Said when a file's text can't be read; never names where the file is. */
const FILE_UNREADABLE =
  "This file can't be read now; ask the owner to check it in Pharos. Its details are in project_snapshot.";

const Scalar = z.union([z.string(), z.number(), z.boolean()]);

export type McpOptions = {
  /** The owner's home folder, for checking requested folders (tests pass a temp dir). */
  home?: string;
};

export function createMcpServer(store: Store, options: McpOptions = {}): McpServer {
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
        new AgentFiles(store)
          .list(type, { projectId, where })
          .map((seen) => ({ id: seen.id, ...seen.data, updatedAt: seen.updatedAt })),
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
        const found = store.get(id);
        const entity = found && new AgentFiles(store).entity(found);
        if (!entity) throw new PharosError('not_found', `${id} not found`);
        return entity;
      }),
  );

  server.registerTool(
    'apply',
    {
      title: 'Apply changes',
      description:
        "Create, update, or delete entities atomically as one revision. Updates are partial; set a field to null to clear it. Deletes cascade (e.g. deleting a project deletes its tasks) and clear references (e.g. deleting a stage unsets tasks' stageId). The result's warnings list things to fix that didn't block the save, e.g. a claim without a source, quote or assumption.",
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
    (query) =>
      run(() => {
        const files = new AgentFiles(store);
        if (query.entityId && !files.visible(query.entityId)) return [];
        return files.revisions(store.history(query));
      }),
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
    (options) => run(() => new AgentFiles(store).diffs(store.diff(options))),
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
    FILE_TEXT_TOOL,
    {
      title: 'Read a file’s text',
      description:
        'The text of a project file (.txt, .csv or .md, up to 512 KB; `truncated` says when there is more), only when the owner set its folder to allow it (canReadText in project_snapshot.files). Refuses every other file; its details are in project_snapshot.',
      inputSchema: { fileId: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ fileId }) => {
      try {
        return json(await readAgentFileText(store, fileId));
      } catch (err) {
        // Refusals are path-free; any other failure (open, read, close) would name the path on
        // disk, so agents get a path-free refusal instead (R7.9).
        const refusal =
          err instanceof PharosError ? err : new PharosError('not_found', FILE_UNREADABLE);
        return run(() => {
          throw refusal;
        });
      }
    },
  );

  server.registerTool(
    FOLDER_REQUEST_TOOL,
    {
      title: 'Ask the owner for a folder',
      description:
        'Ask the owner to share a folder of documents with Pharos (they approve or decline with one click in Pharos). Returns the request: pending, approved (with folderId) or declined. Asking again for the same folder returns the same request; a declined folder stays declined. A folder inside one the owner already shares is approved at once. Name the project (projectId) so its relative artifact uris resolve inside the folder. You can never approve it yourself.',
      inputSchema: FolderRequestInput.shape,
    },
    (input) => run(() => forAgent(requestFolder(store, input, author().name, options.home))),
  );

  server.registerTool(
    FOLDER_REQUEST_STATUS_TOOL,
    {
      title: 'Folder requests',
      description:
        'Whether the owner approved your folder requests: one by requestId, or all (newest first), each with what to do next.',
      inputSchema: { requestId: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    ({ requestId }) =>
      run(() => {
        const all = savedRequests(store)
          .filter((r) => !requestId || r.id === requestId)
          .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
        if (requestId && !all.length)
          throw new PharosError('not_found', `Folder request ${requestId} not found`);
        return all.map(forAgent);
      }),
  );

  server.registerTool(
    FILES_UNADDED_TOOL,
    {
      title: 'Files you can add',
      description:
        'Files in folders the owner shares with agents that are not in the project yet: folderId, path, name, size, modifiedAt and type (never their contents). Add one with apply: {op: "create", type: "file", ref: "f1", data: {projectId, rootId: folderId, path, title, kind, tags}}; the scan fills in the rest. Empty when no folder is shared: ask with folder_request.',
      inputSchema: {
        projectId: z.string(),
        folderId: z.string().optional().describe('Only this folder'),
        query: z.string().optional().describe('Part of the path, e.g. "registration"'),
        limit: z.number().int().min(1).max(500).optional().describe('Default 200'),
      },
      annotations: { readOnlyHint: true },
    },
    ({ projectId, ...rest }) => run(() => unaddedFiles(store, projectId, rest)),
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
        'Check a view (saved, or a draft before saving) against live data: what each widget shows (counts, values, filled text), which would be empty, and warnings such as unknown fields, widths below the minimum, or rows that leave columns unused. For a report page (one with a StartHere, ClaimCard or Layers) it also warns when the StartHere opening is missing, not first, or repeated, its headline is over 160 characters or has no evidence, it has no why (under 100 characters) or yourPart (under 120), another widget also tells the reader their part, the page shows more than 150 words before any detail, a card shows more than 25, a row puts 3 or more wordy claim cards side by side, the page underlines more than 5 terms, its reading path has fewer than 2 or more than 4 steps or a step points at a widget not on the board, when the point comes too late (more than 30 words or another block before it), a claim is shown without a source, quote or assumption, a claim id is not in the project, or a layer shows nothing. For files it warns when the file of a FileView is not in the project or not set, and when the showIn of a FileList names no FileView on the board. For a Gallery it warns when no pictures match, a picture has no alt text, or an image is not https.',
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

  server.registerTool(
    'pack_list',
    {
      title: 'List packs',
      description:
        'Packs a project can start from (R8): each sets up record types (e.g. car services, bills), option lists and a hand-made page.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => run(() => listPacks()),
  );

  server.registerTool(
    'pack_apply',
    {
      title: 'Apply a pack',
      description:
        "Start a new project from a pack (name) or add a pack to a project (projectId), in one revision that history_revert undoes. Returns the pages it made and the pack's guide: read it before adding records.",
      inputSchema: PackApplyInput.shape,
      annotations: { destructiveHint: true },
    },
    (input) => run(() => applyPack(store, author(), input)),
  );

  registerGuidance(server, store);

  return server;
}
