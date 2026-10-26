import { SessionNotes } from './session-notes.js';
import { projectBrief } from './brief.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  RoutineProposal,
  AGENT_FILE_CREATE_FIELDS,
  AskOwner,
  RunReport,
  ENTITY_TYPES,
  EntityType,
  FILES_UNADDED_TOOL,
  FILE_TEXT_TOOL,
  FOLDER_REQUEST_STATUS_TOOL,
  FOLDER_REQUEST_TOOL,
  FolderRequestInput,
  ActionSubmission,
  applyInputFor,
  OWNER_TASK_FIELDS,
  type ApplyInput,
  type Author,
  type Entity,
  PACK_GUIDE,
} from '@pharos/schema';
import { z } from 'zod';
import { VERSION } from './version.js';
import { RunLog, answersSince, askOwner, deskOf } from './desk.js';
import { StandingApprovals } from './approvals.js';
import { proposeRoutine } from './routine-proposals.js';
import { LOOKUP_TOOLS, LookupLog } from './lookups.js';
import { ActionService } from './actions/service.js';
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
import { MCP_ASSET_NOTE, REPORT_GUIDE, registerGuidance } from './guidance.js';
import type { Presence, PresenceTarget } from './presence.js';
import { PackApplyInput, applyPack, listPacks } from './packs/service.js';
import { changesSince, handedBackLines, unseenCount } from './views/changes.js';
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
  previewAny,
  updateView,
} from './views/service.js';

import { ReportAssets, decodeBase64, reportView } from './views/report.js';

/**
 * Agents edit views with the view tools, which keeps apply's schema small, and only fill in the
 * details of files the owner added (the store refuses the rest too).
 */
const AgentApplyInput = applyInputFor(
  ENTITY_TYPES.filter((t) => t !== 'view'),
  { file: AGENT_READONLY_FILE_FIELDS },
  { file: AGENT_FILE_CREATE_FIELDS },
  // Only the owner replies to a task or puts it off; the store refuses an agent's anyway.
  { task: OWNER_TASK_FIELDS },
);

const INSTRUCTIONS = `Pharos stores structured project data (projects, goals, scope, stages, tasks, assignees, artifacts, decisions, claims) with git-like history, and shows it to the user as visual views made of widgets. You can both change the data and generate the views.

Reports go here: an update on work you did, a review, research results or findings, a status or progress update, a summary, or more details on a project (asked for, or at the end of a piece of work) are written in Pharos instead of a long chat answer: a report document (view_create with doc; report_guide first) that shows before it tells, or a review desk (sheets with decisions and tasks) when they must choose or act. Then answer in chat with one or two lines and the page's link. Little to show is no reason to skip it: a short page with what there is and what is missing is the report. Only a one-line factual answer stays in chat.

Every project keeps one report document named "Updates", newest first: after a version or batch of merged work, a night run, a search or research pass, or an evaluation, add a dated section at its top (what changed, before and after; the numbers; what needs the owner) with view_update. Create it once if missing; never a new page per update.

Write for the owner in Pharos, not in local files: a plan, research, a review, notes, a handoff or a summary goes in a Pharos document (doc), never a new Markdown file in the project folder. Files are only for what belongs with the code (README, CLAUDE.md, code docs); when you mention one, link it.

Writing for the owner (everything people read in Pharos: titles, descriptions, comments, reports, decisions, run reports, chat):
- Say what is literally true, in plain words. No metaphors, idioms or figures of speech: write "merged into main", "released", "the tests pass", "running", "stopped", "waiting for your answer", not "landed", "shipped", "green", "in flight", "parked", "on ice", "blocked on a gate".
- Name things by what they are: the command, the file, the page, the number, the person. No internal labels or code names (task codes, milestone codes, "ship check", "nightshift", "daybreak", "gate", "auto/review/ask") unless the same sentence says what they mean.
- Say who does what, by when, and what happens if nobody does. A deadline is a date, not "today" or "tonight".
- If a word could be read two ways, use the longer exact phrase. A reader who has to ask what you meant costs a whole round of conversation.

Getting oriented:
- Start with project_brief: the project's brief (where it stands, the owner's rules, recent answers, hand-backs, what waits on them). When the owner gives a standing rule or feedback, add it to project.rules (apply) so every session gets it.
- First, what the owner answered or handed back: project_snapshot's handedBack and desk_list({since}) answersSince. Act on those before new work; a review handed back to you is yours to pick up.
- list {type: "project"} to find projects, then project_snapshot for the full picture in one call (including its views, custom options, and open requests from people).
- get {id} for one entity's full details (descriptions are left out of snapshots).

Changing data:
- Data writes go through apply: a required message (why, like a commit message) plus a list of operations. One apply = one revision.
- Batch related changes into one apply. A create can set ref: "s1" and later operations in the same call can use "$s1" as an id, so a whole project (stages, tasks, dependencies) can be set up in one call.
- Prefer updating existing entities over creating duplicates; check project_snapshot first.
- Statuses, priorities, scope groups, and artifact kinds can be customized per project (project.options); use values from the project's options, shown in project_snapshot.
- Keep things connected: link each task to the goals it serves (goalIds; several when it serves several) and to the tasks it waits on (dependsOn). The Map widget and each object's Connected list are drawn from these links, so a task on no goal shows up as a gap.
- Every task you create is written so a person could check the work without asking. description: only context (background, why, links to related pages and documents), never the steps. actions: the steps, in order, each one concrete enough that anyone could follow it; anything to copy (a command, a path, a value) goes in a fenced code block, which Pharos shows with a copy button. acceptance: checkable "done when" statements; they show as a checklist, and you tick one by adding its exact text to acceptanceMet when you have shown it holds; when every one is ticked Pharos marks the task done (unticking one moves it back). Results and evidence (what you found, test output, links, screenshots) go in comments on the task: create a comment with {taskId, body} in markdown; deliverables are only short links to what it left behind ({label, kind: file|page|link|commit|record|other, ref}). When the work is finished but must be checked before it counts, set the status to the "review" meaning (Needs review) and say in a comment what to check. When the owner must allow commands for agents in a project (a night run was refused them), put those commands, exactly as agents run them, in the task's allowCommands: Pharos shows them with their risk and one Allow button that writes the rules to that project's folder, so the steps never send the owner to Settings. A task for the owner (ask_owner) needs at least actions and acceptance, and is written for them, not for agents: the title says what they do in plain words; the description opens with why it needs them and what happens if they do nothing; no words only agents use ("daytime session", "unattended", "ship check", task codes); when there are two ways, say which needs them present and which doesn't (e.g. "now, with me in a Claude Code session: say … and approve its prompts" or "before tonight: add … to …"); a deadline gives its date, not "today", since they may read it tomorrow. Pharos shows when and by whom every item was raised, so don't repeat it. apply warns when a task is created or moved to in progress without them, and when it is marked done with a deliverable that has no ref.
- When you start work on a task, claim it in one apply: set its assigneeId to you and its status to in progress (project_snapshot lists assignees; if none has your name, create one in the same apply with kind "agent" and use its ref). Mark it done when you finish, and leave tasks assigned to someone else alone unless the user hands them to you.
- Findings are claims (one plain sentence, with checkedOn, sourceIds and authorId) and terms explain a word. A claim's certainty is "reading" (your analysis; the default), "verified" (From source: needs a source artifact with an http(s) uri and a checkedOn date that is not in the future) or "confirmed" (Confirmed by you: needs confirmedById, a decision the owner accepted in Pharos themselves; you can't confirm one yourself). Pharos refuses a claim that doesn't meet its certainty: without a linked source you read and a checkedOn date, keep it at "reading". For a finding the owner should confirm, create the decision with status "proposed" (the default, "accepted", records no acceptance by the owner, so it can never back a confirmed claim), ask the owner to accept it in Pharos, and only then set the claim to "confirmed" with confirmedById. Show what a claim rests on: a "verified" claim carries quote, the exact passage from the source, word for word (max 300 characters; quoteSourceId names which of its sourceIds when there are several), and a "reading" claim carries assumption, the one assumption it rests on (max 200). Add locator (max 60 characters, e.g. "§7 Completion", "line 42", "commit deb7096") so the reader finds the quote in its source; figure {value, unit, label} when the claim states a number a FindingChart draws (on "verified", the value must appear in the quote); and weakBecause ("one-source", "indirect" or "disagree") when the evidence is thin, which shows after the mark. apply warns about a claim with no source, a "verified" claim without a quote, a "reading" claim without an assumption, a "verified" figure missing from its quote, and weakBecause "one-source" on a claim without exactly one source.
- Record meaningful choices as decisions so the reasoning stays traceable: set decidedById (the assignee who made the call, usually the person who asked, not you unless you decided) and decisionDate. When the owner has to choose, give the decision options (2–5), recommendedOptionId and recommendationReason, and show it in a DecisionBlock; only the owner chooses (see "Decisions for the reader" in pharos://guide/views). When a choice applies to a set of things (folders a cleanup moves, files to send), list them in items {list: [{id, label, detail}], appliesTo: the option}: the owner unticks the ones to keep, and after they choose, items.selected (get, desk_list since, view_get) holds the ids to act on; act on exactly those, and never set selected yourself. When a decision builds on others (it only makes sense once they are answered, or its options assume their answer), list them in dependsOn: Pharos tells the owner when one is still open, and marks it as maybe outdated when one changes after it was decided.
- Files (type "file", in project_snapshot.files) are documents on the owner's disk, in folders the owner shares with Pharos. You see only their details (title, kind, issuer, issuedDate, expiryDate, tags, size, taskIds): never their notes, or anything from folders the owner hid. ${FILE_TEXT_TOOL} returns a file's text only when its folder allows it (canReadText in the snapshot) and it is a .txt, .csv or .md file. To bring documents in: if no folder holds them, ask with ${FOLDER_REQUEST_TOOL} {path, level, reason, projectId} and tell the owner in one line to click Approve in Pharos; check with ${FOLDER_REQUEST_STATUS_TOOL}. Once approved, ${FILES_UNADDED_TOOL} lists the files you can add; add them with apply (create type "file" with only ${AGENT_FILE_CREATE_FIELDS.join(', ')}; rootId is the folderId) and set kind, tags, issuer and dates with updates in the same apply ("$ref"). You can't remove or move files. Link files to the tasks, decisions, goals, stages and claims they belong to with fileIds (ids of files you can see). Don't look for the files on disk yourself. Sources (artifacts) never show an absolute local path in uri; a uri relative to the project's approved folder (e.g. "records/2024/certificate.pdf") is fine, and Pharos links it to the file once the file is added. Sources and findings taken only from hidden files aren't shown, and a quote taken from a file whose folder allows details only is left out. To manage a set of documents (e.g. business registration papers): add and tag them, link the related tasks and decisions, then build one view with a StartHere, a FileList filtered to the tag and the linked tasks and decisions. A FileList alone is enough: the reader taps a file to open it in the file viewer (preview, actions, details). Add a FileView (and the FileList's showIn: its id) only when one key document should always be on the page; "Document sets" in pharos://guide/views has the recipe.
- Files of the project's code repository (project.repositoryId → repository.path): whenever Markdown you write (a task or decision description, a Text block, notes) mentions one, write it as a repo link so the owner can open it in Pharos: [FORMAL_MODEL.md](repo:docs/research/FORMAL_MODEL.md@review/formal-model). The path is relative to the repository; add @<branch> when the file isn't on the checked-out branch (a review branch, a worktree branch), and #L10-L40 to point at lines. A bare path is linked only when Pharos finds it, so don't rely on that.
- Records (type "record") are a project's own kinds of things, such as a car service or a bill: recordType (a key of project.recordTypes, listed in project_snapshot.recordTypes), title, fields (by field key: text, number, money {amount in cents, currency}, date, option, reference (a record id), file, meter) and, for record types that repeat, interval {every: {n, unit}, meter: {n, from}, lastDate, lastMeter}. An update's fields are merged into the record's. To set up a project for a kind of life admin (a car, money, music, study, company documents), use pack_list and pack_apply instead of inventing record types; pack_list returns the pack guide (also pharos://guide/packs): follow it step by step, and read the guide pack_apply returns.
- The sidebar groups projects under repositories (shown as folders) and optional sections (type "section"); projects and repositories have an "order", and projects can be "pinned". Change these only when the user asks.

- The owner's desk lists everything waiting on them across projects. When you need the owner (a choice of taste or direction, a secret, a payment, a push, personal data), ask with ask_owner in one call (options make it a one-tap decision) instead of writing the question into a page or a file; on your next turn read their answer with desk_list({since}). A routine or night run reports itself with run_report (start, then finish with an outcome).
- When the owner asks for a routine (something run on a schedule: "every Friday at 5, review the week"), propose it with routine_propose; it goes on their desk and they add it with one tap. Never edit routines.json yourself.

Generating views (what the user sees):
- Read the resource pharos://guide/views (design guidelines) and pharos://examples/answers (worked examples) before your first view in a session.
- A view is a board of widgets; each widget is one catalog component bound to live data. The user's browser updates as soon as you save.
- Start with catalog_list (components, when to use them, sizes, board and filter rules), then catalog_describe for the exact props of the components you pick.
- view_list / view_get show existing views; view_create makes a new one; view_update edits one with small ops (add, update, move, remove widgets) or resets it to its template; view_delete removes one.
- People can also ask questions from the Pharos UI: project_snapshot lists them under "requests". Answer each open one with view_answer and its requestId (that marks it answered), or dismiss it with apply (request status "dismissed") if it no longer applies.
- When the user asks a question about the project ("what's overdue?", "what's blocking stage 2?", "who is on what?"), answer with view_answer: a focused answer view that leads with the answer (a Text or Callout), then the evidence (a table, chart, or list). When the question asks to explain, report on or compare something ("why is stage 2 late?", "how did the spring go?", "compare March and April"), answer with a report document instead: call report_guide, then view_answer with doc. Then reply in at most two sentences (the answer and the link); the view carries the details, so don't restate it in chat. Answers expire after a week unless the user keeps them.
- A board report (telling the reader what was found or what needs them, never a log of what was done) has one purpose and opens with a StartHere: the purpose, why the work exists (one line), a headline sentence with its evidence, the reader's part (one line, said nowhere else on the page), where it sits (stage or goal, date), and a reading path of 2–4 steps pointing at widgets below. Keep it short: about 150 words before anything the reader opens, one short line per finding, few underlined terms. Show rather than tell: a process as a Layers flow (with per-step task progress), a change as a BeforeAfter, numbers as a FindingChart whose title is a stored claim, shares as mini bars (StatCards with \`of\`, Text \`{bar}\`). The "Report pages: start here" and "Pictures" parts of pharos://guide/views have the rules.
- For a saved research board (not an answer to a why, how or compare question, which gets a report document), when the user needs to understand something (research, a concept, what a result means) rather than track work, build an explanation view: the point first in one short sentence (a StartHere stating the headline claim), then the picture (Layers), every finding stored as a claim with its source, words the reader may not know stored as terms, certainty always shown, and detail on demand. The "Explanation views" part of pharos://guide/views has the rules and a worked example; the preview warns when a rule is broken. Ordinary project views (task boards, stages) are not checked.
- Research about anything visual (UI, products, places, cars, diagrams) must show its examples as pictures: store each as an artifact with image (an https address, or a project image file id), alt, uri (the page it comes from) and a shared tag, and show them in a Gallery filtered on the tag; layout "compare" puts two side by side for before/after or option A/B. "Pictures" in pharos://guide/views has the recipe.
- Prefer adjusting an existing view when the user asks to change "the board" or "the overview"; create a new view when they want a different angle (e.g. "a view for this week's work").
- view_create, view_answer, and view_update return a preview of the saved view: read it before telling the user the view is ready, and fix unknown fields, empty widgets you didn't intend, and its warnings (per widget, and for the whole view). Use view_preview for drafts or other views.
- Query checks: every filter, sort, group, sum and column in a view is checked against the project's fields (record fields included) before it is saved. An unknown field, record type or option value, a sum over something that isn't a number, an unreadable relative date, or a value that doesn't fit its field (e.g. a range on money; use "fields.amount.amount" in cents) refuses the save; the error gives the JSON path, the allowed values, the closest match and a corrected example, so fix exactly that and retry. A record query without recordType, or a field only some of its record types have, only warns. Empty results, custom option values and mixed currencies are fine.
- People can rearrange views too, so read a view with view_get before editing it, keep widget ids stable, and pass its revision as view_update's expectedRevision: if a person changed the view since, nothing is saved and you read it again and redo your change on what it shows now.
- Actions (R10): an Action block is a button and a short form people use to change records from a page ("Log a service", "Mark paid"); the form is built from the record type. Offer one only on a page about records the owner keeps up by hand, for what they do often (pack pages have theirs; pharos://guide/packs). project_snapshot.actions lists them; action_run submits one that only adds a record as one revision. Marking a record done (Mark paid, Log a service with its reminder) is the owner's to do on the page: agents are refused, also with apply (interval.lastDate/lastMeter) and Undo.
- Kinds of pages. A board (widgets) is a live working page the owner uses day to day: tasks, money this month, files, quick answers. A report, something to read (an explanation, research, a summary of work, a story with its evidence), is a report document: view_create or view_update with doc, blocks in reading order (Text with live values, Stat, charts, Callout, columns; figures of screenshots or recordings you upload, numbered steps, details) that Pharos draws in its own style; anything that needs the owner's review or answer goes in sheets (one per item, with its pictures, how to check it and a DecisionBlock), and view_get reads their answers back; an embed block shows another website in place; a drawing block (your HTML, live data through pharos.data) is for one visual no component can draw. Documents are the only way to write a report: HTML report pages (page) are refused, and the original content is made with Pharos's blocks. A document is marked out of date when its data changes. Call report_guide before writing one; upload pictures with report_asset_put. A refresh request is answered with view_update and the whole document as doc. A few older views are HTML report pages: a refresh of one may send the whole page as page again, but when you rewrite one, write it as doc.
- A request with mode "block" asks you to change one block (its widgetId) in place: view_update with requestId and ops on that block only (other blocks and the view are refused while it is open), and a short reply. If it can't be done in that block, dismiss the request with a reply saying why.

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

/**
 * The owner's call (2026-10-23): agents write every report as a document (doc), never as an HTML
 * report page (page). view_create and view_answer refuse page; view_update changes only a view
 * that already is a page (the owner's existing pages and their refresh). REST is unchanged.
 */
export const PAGE_REFUSED =
  'Reports are documents now: use doc (report_guide). To show another website inside a report, use an embed block in a doc.';
/** Added to view_update's result when an agent writes an existing page as page again. */
export const PAGE_WRITTEN_NOTE =
  'This view is an HTML page; write it as doc next time (send doc instead of page to turn it into a document).';

const refusedPage = z
  .unknown()
  .optional()
  .describe(
    'Not accepted: reports are documents (doc). To show another website, use an embed block in a doc',
  );
const AgentViewCreateInput = ViewCreateInput.extend({ page: refusedPage });
const AgentViewAnswerInput = ViewAnswerInput.extend({ page: refusedPage });
const AgentViewUpdateInput = ViewUpdateInput.extend({
  page: z
    .unknown()
    .optional()
    .describe(
      'Only for a view that already is an HTML report page: replaces it whole, {html, data?, summary?} (e.g. to refresh it). Refused on a board or a document. When you rewrite a page, send doc instead: it turns the page into a document',
    ),
});

function refuse(text: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text }] };
}

/** Said when a file's text can't be read; never names where the file is. */
const FILE_UNREADABLE =
  "This file can't be read now; ask the owner to check it in Pharos. Its details are in project_snapshot.";

const Scalar = z.union([z.string(), z.number(), z.boolean()]);

export type McpOptions = {
  /** The owner's home folder, for checking requested folders (tests pass a temp dir). */
  home?: string;
  /** Who is working where (v0.2 B5): the view tools mark the view and blocks they touch. */
  presence?: Presence;
  /** This session's id for its presence marks, cleared when the session closes. */
  presenceSource?: string;
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

  // "Looked up" on the Updates page: every read tool below logs its call (LOOKUP_TOOLS) before
  // it runs. The log never fails the call; it isn't a revision.
  const lookups = new LookupLog(store);
  const register = server.registerTool.bind(server) as (...args: unknown[]) => unknown;
  server.registerTool = ((name: string, config: unknown, handler: (...a: unknown[]) => unknown) =>
    register(
      name,
      config,
      LOOKUP_TOOLS[name]
        ? (...a: unknown[]) => {
            lookups.record(author().name, name, a[0]);
            return handler(...a);
          }
        : handler,
    )) as unknown as typeof server.registerTool;

  // Presence (v0.2 B5): a view tool call marks the agent as working on that view (and the
  // blocks an update names) for a short while. Never stops the call: a bad id is the tool's
  // own error to report.
  const mark = (targets: () => PresenceTarget[]) => {
    const presence = options.presence;
    if (!presence) return;
    try {
      for (const target of targets())
        presence.touch(author().name, target, options.presenceSource ?? author().name);
    } catch {
      // An unknown view or project: nothing to mark.
    }
  };
  const viewTarget = (viewId: string, activity: PresenceTarget['activity']): PresenceTarget => {
    const view = store.get(viewId);
    if (view?.type !== 'view') throw new Error('not a view');
    return { projectId: (view.data as { projectId: string }).projectId, viewId, activity };
  };

  server.registerTool(
    'project_snapshot',
    {
      title: 'Project snapshot',
      description:
        'Compact structured summary of a project: status, progress, goals tree, scope, stages, tasks, artifacts, decisions, and recent revisions; `handedBack` lists review documents the owner finished (every sheet answered) and handed back to you since you last looked.',
      inputSchema: { projectId: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ projectId }) =>
      run(() => {
        const agent = author().name;
        const handedBack = handedBackLines(store, agent, projectId);
        return {
          ...projectSnapshot(store, projectId),
          // Nudges the agent to catch up on what people (and other agents) did since it last looked.
          unseenChanges: unseenCount(store, agent, projectId),
          // Review documents the owner finished and handed back since then (all answered).
          ...(handedBack.length ? { handedBack } : {}),
        };
      }),
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

  // R16: the owner's desk. One call puts something on it; the next turn reads the answer.
  const runs = new RunLog(store);
  const approvals = new StandingApprovals(store);
  server.registerTool(
    'ask_owner',
    {
      title: 'Ask the owner',
      description:
        "Put something on the owner's desk (the one list of everything waiting on them, across projects) in one call. With 2–5 options it is a decision they answer in one tap (mark your pick with recommendedOptionId); without, a task for them, with actions (the steps for them) and acceptance (what makes it done). Ask only what needs them: a choice of taste or direction, a secret, a payment, a push, personal data. Give minutes (about how long) and gate for things only they can do. Read the answer on your next turn with desk_list({since}); when the owner's standing approval answers it at once, the result has `answered` and you go ahead.",
      inputSchema: AskOwner.shape,
    },
    (input) => run(() => approvals.withAnswer(askOwner(store, author(), AskOwner.parse(input)))),
  );

  server.registerTool(
    'routine_propose',
    {
      title: 'Propose a routine',
      description:
        "Propose a routine to the owner (a job run unattended on a schedule, in each project's folder): its name, time (HH:MM), days (mon…sun; leave out for every day), what it does in the owner's words, which Routines projects (folder names, or \"enrolled\") and why. It puts one decision on the owner's desk (Add it / Not now); when they choose Add it, Pharos adds it to their routines. Agents never change routines.json themselves.",
      inputSchema: RoutineProposal.shape,
    },
    (input) => run(() => proposeRoutine(store, author(), input)),
  );

  server.registerTool(
    'project_brief',
    {
      title: 'Project brief',
      description:
        "Start here: one project's brief in a few lines: what it is and where it stands, the owner's standing rules, what they answered lately, reviews handed back to pick up, what waits on them, and who is working on what. Every session (Claude Code, Codex, night runs) reads the same one.",
      inputSchema: { projectId: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ projectId }) =>
      run(() =>
        projectBrief(store, projectId, {
          runs,
          notes: new SessionNotes(store),
          ...(options.presence ? { presence: options.presence } : {}),
        }),
      ),
  );

  server.registerTool(
    'desk_list',
    {
      title: "The owner's desk",
      description:
        'What waits on the owner (open decisions, review sheets, their tasks, runs that need a look), for one project or all, with how long each has waited; and with `since` (a revision id) what people did after it, so you see their answers. latestRevision is the `since` for next time.',
      inputSchema: {
        projectId: z.string().optional().describe('One project (yours); omit for every project'),
        since: z.number().int().nonnegative().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    ({ projectId, since }) =>
      run(() => ({
        ...deskOf(store, runs, { projectId }),
        ...(since !== undefined ? { answersSince: answersSince(store, since, projectId) } : {}),
        latestRevision: store.latestRevisionId(),
      })),
  );

  server.registerTool(
    'run_report',
    {
      title: 'Report a run',
      description:
        "Report a run that happens without the owner (a night run, a routine): call it when it starts (it returns the id) and again with the id and an outcome (ok, partial, failed) when it ends, with a one-line summary and counts. The desk shows each name's latest run; a failed or partial one waits there until the owner has looked.",
      inputSchema: RunReport.shape,
    },
    (input) => run(() => runs.report(author(), RunReport.parse(input))),
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
    ({ viewId }) => {
      mark(() => [viewTarget(viewId, 'viewing')]);
      return run(() => getView(store, viewId));
    },
  );

  server.registerTool(
    'view_create',
    {
      title: 'Create view',
      description:
        'Add a saved view (a new tab): a board of widgets or a report document (doc); to answer a question, use view_answer instead. Example widget: {"id": "work", "w": 8, "node": {"component": "KanbanBoard", "filter": {"where": {"stageId": "$currentStage"}}}}. For a report, write doc (blocks Pharos draws in its own style: text, charts, figures of uploaded screenshots, steps, and sheets for what the owner should review or answer; an embed block to show another website; a drawing block for one visual no component can draw). Call report_guide first. HTML report pages (page) are refused. Returns a preview with warnings that did not block the save; fix them.',
      inputSchema: AgentViewCreateInput.shape,
    },
    (input) => {
      if (input.page !== undefined) return refuse(PAGE_REFUSED);
      mark(() => [{ projectId: input.projectId, activity: 'editing' }]);
      return run(() => createView(store, author(), input));
    },
  );

  server.registerTool(
    'view_answer',
    {
      title: 'Answer with a view',
      description:
        'Answer a question about the project with a focused view (shown to the user as an answer, apart from saved views). Lead with the answer, then the evidence. Pick the kind by the question: a quick status lookup ("what\'s blocked?", "what\'s due this week?") gets widgets; a question asking to explain, report on or compare something ("why …", "how did … go", "compare …") gets doc, a report document (call report_guide first). HTML report pages (page) are refused. Returns the view, its URL, and a preview of what it shows. Expires after 7 days unless kept.',
      inputSchema: AgentViewAnswerInput.shape,
    },
    (input) => {
      if (input.page !== undefined) return refuse(PAGE_REFUSED);
      mark(() => [{ projectId: input.projectId, activity: 'editing' }]);
      return run(() => answerView(store, author(), input));
    },
  );

  server.registerTool(
    'view_preview',
    {
      title: 'Preview a view',
      description:
        'Check a view (saved, or a draft before saving) against live data: what each widget shows (counts, values, filled text), which would be empty, and warnings such as unknown fields, widths below the minimum, or rows that leave columns unused. For a report page (one with a StartHere, ClaimCard or Layers) it also warns when the StartHere opening is missing, not first, or repeated, its headline is over 160 characters or has no evidence, it has no why (under 100 characters) or yourPart (under 120), another widget also tells the reader their part, the page shows more than 150 words before any detail, a card shows more than 25, a row puts 3 or more wordy claim cards side by side, the page underlines more than 5 terms, its reading path has fewer than 2 or more than 4 steps or a step points at a widget not on the board, when the point comes too late (more than 30 words or another block before it), a claim is shown without a source, quote or assumption, a claim id is not in the project, or a layer shows nothing. For files it warns when the file of a FileView is not in the project or not set, and when the showIn of a FileList names no FileView on the board. For a Gallery it warns when no pictures match, a picture has no alt text, or an image is not https. A report document (doc, saved or a draft) gets the same checks per block plus its drawings (missing assets, blocked hosts, navigation, pharos.data names a drawing does not list), embeds that are not https, drawing reads missing from doc.data, figure files not uploaded yet, a compare figure that is not two pictures, sheet decisions that are missing, have no options or no DecisionBlock in their sheet, and sheets with no time; a report page (page) gets the page checks.',
      inputSchema: ViewPreviewInput.shape,
      annotations: { readOnlyHint: true },
    },
    (input) => {
      mark(() =>
        input.viewId
          ? [viewTarget(input.viewId, 'viewing')]
          : input.projectId
            ? [{ projectId: input.projectId, activity: 'editing' }]
            : [],
      );
      return run(() => previewAny(store, input));
    },
  );

  server.registerTool(
    'view_update',
    {
      title: 'Update view',
      description:
        'Change a view: rename, pin, archive, reorder, and edit widgets with ops (add, update props/size, move, remove), replace all widgets, or reset to its template. A report document is replaced whole with doc (with figures and sheets for what the owner reviews, an embed block for another website, a drawing block for one visual). page only changes a view that already is an HTML report page (to refresh it); when you rewrite one, send doc instead, which turns it into a document. One call = one revision.',
      inputSchema: AgentViewUpdateInput.shape,
      annotations: { destructiveHint: true },
    },
    (input) => {
      mark(() => {
        const view = viewTarget(input.viewId, 'editing');
        const ids = (input.ops ?? []).flatMap((op) =>
          op.op === 'add'
            ? op.widget.id
              ? [op.widget.id]
              : []
            : op.op === 'remove'
              ? []
              : [op.id],
        );
        return [view, ...ids.map((widgetId) => ({ ...view, widgetId }))];
      });
      if (input.page !== undefined) {
        const current = store.get(input.viewId);
        if (current?.type === 'view' && !(current as Entity<'view'>).data.page)
          return refuse(PAGE_REFUSED);
      }
      return run(() => {
        const result = updateView(store, author(), input);
        return input.page !== undefined ? { ...result, note: PAGE_WRITTEN_NOTE } : result;
      });
    },
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
    (input) => {
      mark(() => [{ ...viewTarget(input.viewId, 'editing'), viewId: undefined }]);
      return run(() => deleteView(store, author(), input));
    },
  );

  server.registerTool(
    'report_guide',
    {
      title: 'How to write a report',
      description:
        'The guide to reports: report documents (doc: blocks Pharos draws in its own style, the one way to write a report, with a complete example; figures, steps, details and sheets for the review desk, with a complete example; embed blocks for another website; drawing blocks for one visual, with the pharos API, assets and the frame’s limits). Read it before view_create, view_answer or view_update with doc.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => ({ content: [{ type: 'text', text: REPORT_GUIDE }] }),
  );

  const assets = new ReportAssets(store);
  server.registerTool(
    'report_asset_put',
    {
      title: 'Upload a report asset',
      description: `Save (or replace) a picture, clip, sound, font, stylesheet or script a report page or document ships, by its relative path (e.g. "shots/after.png"). A report document's figure blocks show pictures, clips and sounds by that path (screenshots before and after, a recording); its drawings and a report page refer to files with that relative URL. Types: png jpg jpeg gif webp avif svg css js json woff woff2 ttf otf mp4 webm mp3 m4a ogg wav; at most 10 MB each and 64 MB per page. ${MCP_ASSET_NOTE} Assets are page files, not project data: they have no history; after the view is deleted they are kept for 30 days, so undoing the delete restores the page.`,
      inputSchema: {
        viewId: z.string().describe('A report page or document (a view with page or doc)'),
        path: z.string().describe('Relative path, e.g. "img/hero.png" (no "..", no leading /)'),
        base64: z.string().describe('The file, base64-encoded (a data: URL is fine)'),
      },
      annotations: { destructiveHint: true },
    },
    ({ viewId, path, base64 }) => {
      mark(() => [viewTarget(viewId, 'editing')]);
      return run(() => {
        const saved = assets.put(author(), viewId, path, decodeBase64(base64));
        return { saved, assets: assets.list(viewId).length };
      });
    },
  );
  server.registerTool(
    'report_asset_list',
    {
      title: 'List report assets',
      description:
        "A report document's or report page's assets: path, type, size and when each was saved.",
      inputSchema: { viewId: z.string() },
      annotations: { readOnlyHint: true },
    },
    ({ viewId }) =>
      run(() => {
        const view = reportView(store, viewId);
        return assets.list(view.id);
      }),
  );

  const actions = new ActionService(store);
  server.registerTool(
    'action_run',
    {
      title: 'Run a page action',
      description:
        'Submit an Action block\'s form that adds a record, in one revision: project_snapshot.actions lists them, record fields come from the record type. Actions that mark a record done ("Mark paid", "Log a service" with its reminder) are the owner\'s to use on the page; agents are refused. Returns status done, duplicate (same idempotencyKey: nothing new), invalid (fieldErrors), stale (the record changed: read it and decide again), not_found or failed.',
      inputSchema: ActionSubmission.shape,
      annotations: { destructiveHint: true },
    },
    (input) => {
      const result = actions.run(author(), input);
      return result.status === 'done' || result.status === 'duplicate'
        ? json(result)
        : { isError: true, content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.registerTool(
    'pack_list',
    {
      title: 'List packs',
      description:
        'Packs a project can start from (car, money, music, study, company documents): each sets up record types, option lists and a hand-made page. Returns the packs and the pack guide: how to set up a pack project from scratch (apply, records, files, the page, the checks).',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => run(() => ({ guide: PACK_GUIDE, packs: listPacks() })),
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
