# Pharos

Generative UI project management: agents connect over MCP, store structured project data, and
compose views from a component catalog that the web UI renders live.

Read `docs/` before starting work:

- `docs/OVERVIEW.md` — problem, idea, principles, key decisions
- `docs/SCOPE.md` — what the initial v0.1 scope includes and excludes
- `docs/PLAN.md` — stack, repo layout, milestones
- `docs/TASKS.md` — historical task archive; **live progress is tracked in Pharos itself**

## Tracking progress

Pharos's own plan lives in the **Pharos** project in the local Pharos instance (`~/.pharos/pharos.db`,
server on port 4300). Keep it current as you work: mark tasks done or in progress, add tasks you
discover, record decisions, and move `currentStageId` when a milestone finishes. Use the MCP tools
(`project_snapshot`, `apply`) when connected, or `POST /api/apply` with
`x-pharos-author: agent:Claude Code`. Every update needs a message explaining why.

## Layout

- `packages/schema` — Zod schemas shared by server and web (the single source of types)
- `apps/server` — Hono on 127.0.0.1:4300: REST under `/api`, MCP (streamable HTTP) at `/mcp`,
  MCP over stdio via `src/stdio.ts`
  - `src/store/` — SQLite store: `database.ts` (migrations), `store.ts` (apply/revert/history/diff),
    `snapshot.ts` (`project_snapshot`)
  - `src/mcp.ts` — MCP tools and the instructions agents see
  - `src/views/` — catalog tools (`catalog.ts`), board widget operations (`board-ops.ts`), and the
    view service behind the `view_*` tools (`service.ts`)
  - `src/updates.ts` — the Updates page's data (`GET /api/updates`): revisions and agents' reads
    grouped into work sessions (one author, one project, gaps under 30 min), a week of counts;
    `src/lookups.ts` logs agents' MCP read calls (`LOOKUP_TOOLS`) in the `lookups` table (30 days,
    5000 rows; never revisions) for "looked up"
  - `src/agent-runner.ts` — runs an agent (Claude Code by default) for new questions
  - `src/routines.ts` — the Routines page's proxy (`/api/routines/*`) to the owner's Routines app
    (`PHAROS_ROUTINES_URL`, default http://127.0.0.1:4777): state, save (field edits checked
    against routines.json), run, file, log. Owner only; writes and runs need `human:…`. Tests use
    an in-process fake; never POST to the real one (it rewrites routines.json and starts paid runs).
    Routines are the owner's list (`routines`, `RoutineDef` in `packages/schema/src/routines.ts`;
    derived from `schedule` for an older app, then `editable: false`). State adds `pharos`: each
    Routines project's Pharos projects by repository folder, and report views named after a
    routine. The page's needs-you numbers are desk counts for those projects
    (`/desk?project=a,b`), never NEXT.md's. A routine's optional `days` (mon…sun) decides which
    nights it runs.
  - `src/routine-proposals.ts` — agents propose routines, the owner approves: MCP
    `routine_propose` puts one decision ("Add it" / "Not now") on the desk and keeps the proposal
    in the app setting `routines.proposals` (by decision id, never a revision). An "Add it" from
    anywhere (seen on the feed) is saved through the Routines client as the owner's action and
    noted on the decision; if Routines is down the decision reopens and the Routines page's next
    load retries
  - `src/feed.ts` — announces new revisions (including ones from other processes, by polling) to
    `GET /api/events` (SSE); the web app reloads affected data from it
  - `src/notifications.ts` — what Pharos tells the owner (desk items, failed runs, agent terminals
    that ended unwatched, pages an agent's change made stale, hand-backs nobody picked up, and one
    modal after a restart ended an agent terminal): the `notifications` table (no revisions), pushed
    on the feed as `notification`, listed at `GET /api/notifications`; preferences are the
    `notifications.prefs` app setting (`/api/settings/notifications`, owner only, never over MCP).
    Kinds, defaults and `deliveryOf` are in `packages/schema/src/notifications.ts`; the web side is
    `apps/web/src/notifications/` (bell, toasts, modal) and `pages/settings-notifications.tsx`
  - `src/presence.ts` — who is working where right now (v0.2 B5): view tool calls, agents'
    revisions and the answering run mark a project, view or block for 20 s (the run until it
    ends); sent on the feed as `presence`. In memory only: not project data, never a revision
  - `src/terminal/` — the agent panel (R17): the owner's agent CLI in a pseudo-terminal per
    project, over a WebSocket; local-only guard, fixed commands, sessions.
    docs/reframe/r17-agent-panel.md has the rules
- `apps/web` — Vite + React + Tailwind on port 5173; proxies `/api` (and its WebSockets) to the server
  - `src/catalog/` — view renderer (`renderer.tsx`) and one React component per catalog entry
    (`components/`, registered in `components/index.ts`)
  - `src/pages/` — project list and project page (view tabs)
  - `src/agent/` — the agent panel, its terminal (xterm.js) and the picker (R17)

## Commands

pnpm is pinned in `packageManager`. If `pnpm` isn't installed, replace `pnpm` in commands with
`npx pnpm@12.9.1` (for example, `npx pnpm@12.9.1 install --frozen-lockfile`).

- `pnpm install`
- `pnpm dev` — server (tsx watch) + web (Vite)
- `pnpm build` / `pnpm typecheck` / `pnpm lint` / `pnpm format` / `pnpm test`
- `pnpm --filter @pharos/server mcp:stdio` — MCP over stdio
- `node eval/compat/run.mjs --agent claude|codex --url http://127.0.0.1:<port>` — agent
  compatibility scenarios (`eval/compat/`) with a real agent CLI against an isolated server you
  start (never 4300; answering off); checkers are unit-tested in `apps/server/src/compat.test.ts`
- `node eval/report-refresh/run.mjs [--agent stub|claude] [--port 4392] [--shots <dir>]` — the
  report-page refresh loop end to end (after `pnpm build`): starts its own server on a temp
  database, installs the "Spending story" sample, makes it stale, asks to refresh, and checks the
  page was rewritten (one more version, newer evidence, fresh); `stub-agent.mjs` is the no-model
  answering agent, `--agent claude` uses Claude Code (its usage)
- `node eval/report-doc/run.mjs --agent claude|codex [--port 4394] [--out <dir>]` — a real agent
  writes a report document (R14) over MCP (after `pnpm build`): its own server on a temp database
  with answering off, a made-up garden season (`fixture.mjs`), per-run MCP config as in
  eval/compat; checks the doc is valid, previews with no warnings, and uses live values and a
  chart or table; saves the agent's doc to `--out` (default `eval/results/report-doc/`)
- `pnpm agents install|status|remove` — teaches this computer's agents to use Pharos for reports,
  reviews and details: a Claude Code skill (`agents/claude/pharos-report`, installed to
  `~/.claude/skills`) and a marked block in Codex's `~/.codex/AGENTS.md` (`agents/codex`). Only
  what Pharos wrote is replaced or removed. The same rule is in the MCP instructions (`mcp.ts`)
  and the panel's brief (`terminalBrief`), so a connected agent sees it without the install too
- `pnpm service install|status|update|autoupdate on|off|start|stop|restart|log|uninstall` — run
  the built server as a launchd user agent on macOS (`scripts/pharos-service.sh`): starts at
  login, restarts on exit, logs to `~/.pharos/server.log`. The built server also serves
  `apps/web/dist`. It shares port 4300 with `pnpm dev`, so stop one before starting the other;
  the server exits with a clear message on a port conflict. `tsx watch` doesn't restart a crashed
  process until a file changes, which is why the service exists.
  - The service runs from a deploy copy, never this checkout: git worktrees of local `main` in
    `~/.pharos/slots/{a,b}`, with `~/.pharos/app` pointing at the deployed one
    (`~/.pharos/deployed` has its commit). The `dev.pharos.updater` job (`autoupdate on`, set by
    `install`) runs `update` when `.git/refs/heads/main` or `packed-refs` changes and every 5
    minutes: it builds the new main in the other slot (`pnpm install --frozen-lockfile`,
    `pnpm build`), backs up the database to `~/.pharos/backups` (last 5), switches, restarts,
    and switches back if the server isn't healthy within 20 s. A failed build or start leaves
    the old version running and that commit is skipped until main moves again; updates wait
    while the answering agent is queued or running. Log: `~/.pharos/update.log`. Merging to main
    deploys; no re-install needed.
  - Never test against the live service. Every name is overridable: `LABEL`, `UPDATER_LABEL`,
    `PORT`, `PHAROS_HOME` (its database and logs go there too), and `PHAROS_SOURCE` (a throwaway
    `git clone --local` whose main you move).

Data lives in `~/.pharos/pharos.db` (override with `PHAROS_DB`). The HTTP server and stdio MCP
processes can share it.

The server must never die from a background callback: `RevisionFeed.check`, SSE writes, and the
agent runner catch and log their own errors, and `index.ts` logs unhandled rejections without
exiting (an uncaught exception still exits, after logging, so the service restarts it). Keep new
timers, event listeners, and fire-and-forget promises in the server to that rule.

Questions asked in the web app are answered automatically by a built-in agent that is installed:
Claude Code (`claude`) or Codex (`codex`), found with `command -v` at start. Each runs once per
batch, non-interactively, connected over MCP to this server only (each answer uses that agent's
usage; the cost depends on the agent and model, so don't quote a price). Their commands are fixed
in `presetCommand` (`src/agent-runner.ts`); Codex runs like eval/compat does (`codex exec
--ignore-user-config --ephemeral --sandbox read-only`, this server and its tool approval passed
with `-c`), never touching the user's `~/.codex` config. Settings picks the preset (`agent.preset`
app setting; Claude Code by default, else Codex): `PUT /api/settings/agent` takes `{ preset }` only
for an installed one, refuses agents (`X-Pharos-Author: agent:…`), and applies from the next run.
`PHAROS_AGENT_COMMAND` replaces the presets with your own command (Settings then shows it and
offers no choice), and `PHAROS_AGENT_COMMAND=off` turns it off. `AgentRunner` runs one at a time,
with `PHAROS_PROMPT` (from `answerBrief` in `guidance.ts`), `PHAROS_PROJECT_IDS`,
`PHAROS_REQUEST_IDS`, and `PHAROS_URL` in the environment, logging to `~/.pharos/agent.log`
(`PHAROS_AGENT_LOG`). Only the environment decides commands; the API can only pick a preset. The
Settings page (`/settings`) can also pause or resume answering; both are saved with
`Store.setSetting` in the `settings` table (app settings, not project data, so not revisions).

## Data model and history

- Entity types and their fields, defaults, and references are defined once in
  `packages/schema/src/entities.ts` (`ENTITIES`). Adding a field or type starts there.
- Entities are stored as JSON in one `entities` table; every write goes through `Store.apply`
  (or `revert`), which records a revision with full before/after snapshots in `changes`.
- References are checked at the end of each transaction; `onDelete` in `ENTITIES` decides whether
  deleting a referenced entity cascades or unsets the field.
- Schema changes to SQLite tables need a new entry in `MIGRATIONS` (never edit an applied one).

## Views

- A view is an entity (`type: "view"`) holding `template` (a built-in template, kept up to date)
  and/or `spec`, which wins when set. A spec is a `Board` of widgets (`packages/schema/src/views/board.ts`)
  or a component tree, which `toBoard` converts. New projects get a default Overview view;
  customizing it stores a spec and keeps the template so it can be reset.
- Catalog component props are defined in `packages/schema/src/views/catalog.ts`; adding a
  component means adding its schema there, its guidance in `catalog-info.ts` (used by agents and
  for resize limits), a React component in `apps/web/src/catalog/components`, and a sample in
  `renderer.test.tsx` (the test fails if one is missing).
- Agents edit views only through the `view_*` MCP tools; the REST `/api/apply` (used by the web
  app) still accepts view operations.
- Components read data through filters evaluated by `runQuery` against the project dataset
  (`GET /api/projects/:id/data`); they never copy data into the spec.

## Actions and block asks (R10)

- An Action block ("Log a service", "Mark paid") is defined by its props in the page
  (`packages/schema/src/actions.ts`); the form is generated from the record type. A submission
  (`ActionSubmission`, versioned) goes to `POST /api/projects/:id/actions` or MCP `action_run`,
  is run by `apps/server/src/actions/service.ts` as one revision, and answers done, duplicate
  (idempotency key, `action_submissions` table), invalid, stale (expectedRevision), not_found or
  failed. docs/reframe/r10-notes.md has the contract.
- A request with `mode: "block"` asks an agent to change one block; while it is open, agents may
  change only that block of that view (`apps/server/src/views/block-ask.ts`, checked by
  view_update and REST apply). `view_update` takes `expectedRevision` and refuses stale writes.

## Freshness and run states (R11)

- `apps/server/src/views/freshness.ts` works out, from the change log, what changed on each view
  since the reader last looked (seen marks: the `views.seen` app setting, never revisions) and
  whether an agent-built view is stale (`view.evidenceRevision`, set only by Pharos: `Store.apply`
  refuses it, the view service passes `{ evidence: true }`). What a page reads comes from
  `boardReads` in `packages/schema/src/views/reads.ts`; a new component that reads data by a prop
  other than a query or filter needs a case there. docs/reframe/r11-notes.md has the model.
- The answering agent's `state` (off, unavailable, paused, idle, queued, running, stopping) and
  `lastRun.outcome` are what Settings and the questions list show; pausing stops the run.

## Report pages (R13)

- Agents can no longer create report pages (owner's call 2026-10-23): MCP view_create and
  view_answer refuse `page`, and view_update writes `page` only on a view that already is one.
  Reports are documents (R14); other websites go in an `embed` block. REST is unchanged.
- A view with `page` (`packages/schema/src/views/report.ts`) is a report page: HTML an agent
  wrote whole, served by `apps/server/src/views/report-routes.ts` at `/api/views/:id/page/` in a
  locked frame (CSP with `sandbox`, no network, no popups) with the bridge from `views/bridge.ts`
  injected first; it defines `window.pharos` (data, onData, theme, onTheme, openFile, openLink).
  Links open through the parent (`link`); the app's pages send `frame-src 'self'`
  (`APP_PAGE_HEADERS`), so the frame can't navigate to another site; the web app stops a frame
  that leaves its page and answers only the bridge token that said `ready` (R13.6).
  docs/reframe/r13-report-pages.md has the contract and the bridge messages, which the web app
  must match exactly.
- A view has a page or a board, never both (the store refuses `page` with `spec`); a page has no
  blocks, so block asks on it are refused. Its named reads (`page.data`) get the same query
  checks as blocks and are what R11 freshness tracks (`pageReads` in `reads.ts`).
- Report assets (pictures, fonts, scripts) are in the `report_assets` table, not revisions. They
  outlive a view delete (served only while the view exists), so undoing the delete restores the
  whole page; `scheduleAssetPurge` removes those of views gone 30+ days, at start and daily.
  Uploads aren't revisions: the feed polls for them and sends `report-assets` (`{ viewId, at }`),
  and an open frame of that view reloads once a burst of uploads goes quiet. `views/report.ts` has the limits, path checks and the page preview; agents use
  `report_asset_put`, `report_asset_list` and `report_guide`.

## Report documents (R14)

- A view with `doc` (`packages/schema/src/views/doc.ts`) is a report document: blocks in reading
  order (catalog components, `columns`, `drawing`, `embed`) that Pharos draws in its own style.
  It is the default for a report; `page` (R13) is only for a whole bespoke design. A view has one
  of `spec`, `page` or `doc` (the store refuses two); block asks on a document are refused.
  docs/reframe/r14-report-documents.md has the contract.
- Server side is `apps/server/src/views/doc.ts` (parse, preview, block lookup) with the view
  service: `doc` in view_create/view_update/view_preview, evidenceRevision and R11 freshness from
  `docReads` (components' queries plus `doc.data`), and the refresh loop (`pageRefreshSteps`
  covers documents; `updateView` refuses a refresh that sends widgets or page, or reads nothing).
- A drawing is served at `/api/views/:id/doc/:blockId/` like a report page (same CSP with the
  drawing's own path as its source, same bridge, the view's assets under that path), with the
  bridge limited to the names it lists in `reads` (`injectBridge(html, theme, reads)`). An embed
  gets a script-free wrapper at `/api/views/:id/embed/:blockId` whose CSP (`embedCsp`) frames only
  the embed's origin; `APP_PAGE_HEADERS` stays `frame-src 'self'`.
- A `diff` block shows a code change like a code review (`parseDiff` in
  `packages/schema/src/views/diff.ts`, drawn by `apps/web/src/pages/document-diff.tsx`). The guide
  asks for every reported change as before and after: shots or a clip for a screen, the piece of
  UI drawn twice, a diff for code, old and new values for data.
- `view_preview` of a document runs the board checks on its components and the page checks on
  each drawing; a draft's non-https embeds and drawing reads missing from `doc.data` are warnings
  there (the save refuses them). `report_guide` leads with "Report documents" (`DOC_EXAMPLE` in
  `guidance.ts`, tested to preview clean). `node eval/report-doc/run.mjs --agent claude|codex`
  checks that a real agent writes one (own server on a temp database, port 4394 by default).
- A review document is tentative: when the owner's last answer completes its sheets, the web app
  (`pages/hand-back.tsx`) offers "Archive and tell the agent": one revision setting `archived`
  and `handedBack` (`Archive “<view>”: all N answered — over to <agent>`), which agents see in
  changes_since and in project_snapshot's `handedBack` (`handedBackLines` in `views/changes.ts`).
- R15 (docs/reframe/r15-review-documents.md) adds `figure`, `steps`, `details` and `sheet`
  blocks: leaves go anywhere, columns hold leaves, details hold leaves and columns, sheets (top
  level only) hold all of those. Walk blocks with `docBlocks`/`docLeaves` (schema) or
  `mapDocLeaves` (server `views/doc.ts`), never by hand. `docReads` adds sheet decisions to ids.
  `view_get` on a document returns `sheets` (`sheetSummaries`: state, each decision's answer, the
  ticks of TaskChecklists inside it). Freshness drops the reader's answers (`withoutAnswers` in
  `freshness.ts`: owner-only decision fields plus status/decidedById/decisionDate, and status-only
  changes of tasks a TaskChecklist in the document shows). A document's pictures, clips and sounds
  are served at `/api/views/:id/assets/<path>` (`ASSET_CSP`, Range); `REVIEW_EXAMPLE` in
  `guidance.ts` is the guide's review desk, tested to preview clean. Sample media:
  `samples/make-review-desk-media.mjs` (headless Chrome screenshots of a made-up app, a WAV).

## The desk (R16)

- `/desk` lists everything waiting on the owner across projects (`apps/server/src/desk.ts`,
  `packages/schema/src/desk.ts`, `apps/web/src/pages/DeskPage.tsx`); docs/reframe/r16-desk.md has
  the design. Items are derived, never stored: open review sheets, decisions with options nobody
  answered, tasks for a person that an agent asked for (`task.desk`, set by `ask_owner`) or due by
  tomorrow, and a failed or partial run nobody has seen. Overdue after 48 h, folded after 14 days.
- Runs are an operational log in the `runs` table (not revisions); runners report with MCP
  `run_report` or `POST /api/runs`; only a person marks one seen. Agents ask with MCP `ask_owner`
  and read answers with `desk_list({since})`; the owner answers in place via `POST /api/desk/answer`.
- A task the owner is asked to do has answers besides done (`packages/schema/src/task-answers.ts`):
  won't do (the cancelled meaning), later (`deferredUntil`, back on the desk that day) and a reply
  (`reply`); the last two are owner-only (`OWNER_TASK_FIELDS`, refused for agents like a
  decision's). `taskAnswerState` drives the sheet state, the desk and view_get's sheet tasks;
  `taskAnswerChange` is the one update and message (`Won't do “…”`, `Later (day): “…”`, `Reply on
“…”: …`) the document's TaskChecklist and the desk share. These answers don't make a document stale.

## Standing approvals and the pulse

- Standing approvals (`packages/schema/src/approvals.ts`, `apps/server/src/approvals.ts`): the
  owner's rules (words in a decision's question, projects, a wait) answer matching decisions with
  the agent's recommendation, as `human` author `rule: <name>`, one revision each. The list of
  answers is read from those revisions (no separate log); undo reverts one (`POST
/api/approvals/undo`), and a decision a rule ever answered is never answered by a rule again.
  `Store.apply`'s `check` rechecks the decision inside the write transaction. Rules are the `approvals.rules` app setting, changed only by the owner
  (Settings; never over MCP). `approvalBlock` keeps gates, item picks, notes, non-yes picks and
  NEVER_WORDS (delete, send, publish, pay, production…) with the owner. `sweep` runs after every
  commit and on index.ts's 60 s timer; ask_owner returns `answered` when a rule answered at once.
- The pulse (`packages/schema/src/pulse.ts`, `apps/server/src/pulse.ts`, `GET /api/pulse`):
  per project, computed from records, the change log, the desk and the run log, never written by
  an agent; the home page lists them (`PortfolioPulse`), the project page shows its own line.

## Main page, project-management views and versions

- A view with `kind: "main"` is the project's main page (`packages/schema/src/views/versions.ts`):
  one per project, a document, the first tab, and the page a project opens on. The store refuses a
  second one or a board as main; agents can't archive, delete or demote it (they revise it with
  view_update). view_create's `main: true` makes it; project_brief points agents at it, or asks
  them to write it. The owner moves it with "Make this the main page" (one revision).
- `isProjectManagementView`: the built-in Overview, or a board mostly of task, stage and goal
  blocks (`PM_COMPONENTS`). Those wait under More ("Project management") once the project has
  another page, unless pinned; only the owner pins one (the store refuses an agent's pin), and a
  new project's Overview starts unpinned.
- A view's versions are its revisions (`apps/server/src/views/versions.ts`, `GET
/api/views/:id/versions[/:rev]`); the web app shows them in place of the page (`?versions=`; the page line's "Versions · N", the updated line and the tab menu open it; the toolbar clock is "Project history"),
  the picked version compared with the one before (`compareDocs`: blocks added, changed with
  word changes, removed). Restoring one is `POST /api/views/:id/versions/:rev/restore` (owner only):
  a new, undoable change that also brings back the evidence the text was written from
  (`Store.apply`'s `evidenceAt`); a board version can't be restored onto a main page. Agents get
  version messages filtered like /api/history (`AgentFiles`).

## Files

- Project files (R7) stay on the owner's disk, inside folders added on the Settings page. The
  contract is `packages/schema/src/files.ts`: folders are an app setting (`FOLDERS_SETTING`,
  never revisions, never over MCP) with a level (hidden / details / contents); a `file` entity
  records where a file is (`rootId` + relative `path`) and its details; the `file_scan` table is
  a cache, not project data.
- Read-only. File routes carry ids, never paths (`FILE_ROUTES`); mime types come from
  `FILE_TYPES` only. Agents see details only and may never add, remove or move a file
  (`Store.apply` refuses it). Tests use made-up folders and files only.

## Repository file links

- `repo:<path>[@<ref>][#L10-L40]` in any Markdown Pharos renders opens a file of the project's
  repository (project.repositoryId → repository.path) in the file viewer; plain-text and
  inline-code paths the repository has are linked too (`apps/web/src/files/repo-links.tsx`).
  Contract and parsing: `packages/schema/src/repo-files.ts`. Server:
  `apps/server/src/files/repo-files.ts` (`FILE_ROUTES.repoFile`/`repoPaths`, owner only like the
  file routes; refs checked by name and `rev-parse --verify --end-of-options`, the working tree
  read through `openInside`).

## Project files

- What agents see of project files goes through `AgentFiles` (`apps/server/src/store/agent-files.ts`):
  every MCP read and every REST read with an `X-Pharos-Author` other than `human:…`. That header is
  a declared role, not authentication; agents are refused the owner's file and folder routes.

## Claude Code permissions (Settings → Agent permissions)

- `apps/server/src/permissions/` reads Claude Code transcripts (`~/.claude/projects/*/*.jsonl` and
  subagents', read-only, cached by size and mtime) for tool calls that needed approval or were
  refused (`permissionDecision`, `toolDenialKind`, or the older error texts; see `transcripts.ts`),
  groups them per folder into a rule (`rules.ts`: shells, `rm`, `git push`, `curl`, `.claude/**`
  edits and the like are Deny only), and writes Allow / Deny into the folder's
  `.claude/settings.local.json` or `.claude/settings.json` with a backup (last 5) and Undo.
- Agents never write their own permissions: `/api/permissions*` needs `X-Pharos-Author: human:…`
  from the Pharos page, writes only rules it suggested, and has no MCP tool. Tests use a temp home;
  `PHAROS_CLAUDE_HOME` points a test server at fixture transcripts. Never test against `~/.claude`.
- Live asks: `agents/claude/hooks/permission-ask.mjs` is a Claude Code `PermissionRequest` hook
  (installed only by the owner with `pnpm agents install`, into `~/.claude/settings.json` after a
  backup; `pnpm agents remove` takes it out). It posts the prompt to `POST /api/permission-asks`
  (no browser headers allowed), waits on `GET /api/permission-asks/:id/wait`, and prints allow or
  deny; otherwise exit 2 leaves Claude Code's own prompt. `permissions/asks.ts` keeps asks in
  memory, notifies (a desk gate), and takes the owner's answer on `/api/permissions/asks/:id/*`.

## Options

- Option fields (task status/priority, stage/goal/artifact/decision status, scope kind, artifact
  kind) store a project-specific value. Their lists live in `project.data.options`; defaults are in
  `packages/schema/src/options.ts`.
- Never compare option values to built-in names directly. Use the meaning (`meaningOf`, or
  `useOptions().meaning` in the web app), and `valueFor` to pick a value for a meaning. Queries
  already match by value or meaning.

## Conventions

- TypeScript is pinned to 6.0 because typescript-eslint doesn't support 7 yet.
- `@pharos/schema` exports `src/` under the `development` condition (tsx, Vite dev) and `dist/`
  otherwise, so run `pnpm build` before `pnpm --filter @pharos/server start`.
- Server code uses NodeNext resolution: relative imports need a `.js` extension.
- New dependency build scripts must be allowed under `allowBuilds` in `pnpm-workspace.yaml`.
