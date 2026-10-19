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
  - `src/agent-runner.ts` — runs an agent (Claude Code by default) for new questions
  - `src/feed.ts` — announces new revisions (including ones from other processes, by polling) to
    `GET /api/events` (SSE); the web app reloads affected data from it
  - `src/presence.ts` — who is working where right now (v0.2 B5): view tool calls, agents'
    revisions and the answering run mark a project, view or block for 20 s (the run until it
    ends); sent on the feed as `presence`. In memory only: not project data, never a revision
- `apps/web` — Vite + React + Tailwind on port 5173; proxies `/api` to the server
  - `src/catalog/` — view renderer (`renderer.tsx`) and one React component per catalog entry
    (`components/`, registered in `components/index.ts`)
  - `src/pages/` — project list and project page (view tabs)

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

Questions asked in the web app are answered automatically: when Claude Code (`claude`) is
installed, the server runs it for new questions, connected to this server over MCP (each answer uses that
agent's usage; the cost depends on the agent and model, so don't quote a price). `PHAROS_AGENT_COMMAND` replaces that command with your own, and `PHAROS_AGENT_COMMAND=off`
turns it off. `src/agent-runner.ts` runs one at a time, with `PHAROS_PROMPT` (from
`answerBrief` in `guidance.ts`), `PHAROS_PROJECT_IDS`, `PHAROS_REQUEST_IDS`, and `PHAROS_URL` in the environment, logging to `~/.pharos/agent.log`
(`PHAROS_AGENT_LOG`). Only the environment decides the command; the API can't change it. The
Settings page (`/settings`) can only pause or resume it, saved with `Store.setSetting` in the
`settings` table (app settings, not project data, so not revisions).

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

## Files

- Project files (R7) stay on the owner's disk, inside folders added on the Settings page. The
  contract is `packages/schema/src/files.ts`: folders are an app setting (`FOLDERS_SETTING`,
  never revisions, never over MCP) with a level (hidden / details / contents); a `file` entity
  records where a file is (`rootId` + relative `path`) and its details; the `file_scan` table is
  a cache, not project data.
- Read-only. File routes carry ids, never paths (`FILE_ROUTES`); mime types come from
  `FILE_TYPES` only. Agents see details only and may never add, remove or move a file
  (`Store.apply` refuses it). Tests use made-up folders and files only.

## Project files

- What agents see of project files goes through `AgentFiles` (`apps/server/src/store/agent-files.ts`):
  every MCP read and every REST read with an `X-Pharos-Author` other than `human:…`. That header is
  a declared role, not authentication; agents are refused the owner's file and folder routes.

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
