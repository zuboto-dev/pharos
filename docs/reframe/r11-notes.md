# R11 · Live and calm: freshness and true run states

2026-10-13 · v0.2 track A, batch 5. Proposed; the owner accepts it in the v0.2 review (this folds
in W5.8 and W7.8).

## Changed since you looked (R11.1–R11.5)

- **Seen mark.** Per view and per reader, the latest revision the reader had when they last opened
  the view. Stored as one app setting (`views.seen`: `{ baseline, views }`), never a revision, never
  over MCP. A local install has one reader, the owner (`human:me`). The first read sets `baseline`
  to the latest revision (the server does it when it starts), so an existing install starts calm;
  views never opened count from there.
  Marks only move forward. Opening a view marks it seen, and so does each change that arrives while
  it is open. A damaged setting is repaired when read: a baseline or view mark that isn't a
  whole number ≥ 0 is dropped (the baseline starts again from the latest revision), and the seen
  route refuses a body that isn't JSON (an empty body still means "the latest").
- **What counts as a change.** A revision after the mark, by anyone but the reader and not by Pharos
  itself, that changed the view (blocks, name, …) or data a block reads (fix round F2 widened this):
  - an item one of the block's queries selects before or after the change (`where`/`anyOf`,
    following references); for a query cut by `limit` or `onePer`, only when the row is shown
    before or after (an older mix behind the newest one doesn't count);
  - an item linked from one the query selects (a task's stage in a `stage.status` filter or a
    `stage.name` column, the vehicle a service names), judged with the linked item before and
    after the change;
  - an item a block names by id (ClaimCard, DecisionBlock, StartHere evidence, …), or one such an
    item links to (a claim card's file);
  - the project, for a ProjectHeader; its current stage, for "$currentStage" queries and stage
    lists; its option lists, for any block that reads items; its record types (field labels,
    units), for record blocks;
  - any edit to an item of a type whose query filters or sorts by `createdAt`/`updatedAt`.
    Each revision is judged on its own calendar day, so "$today" means the day it was made. An
    ActivityFeed reads everything, so the default Overview changes with any change. Views and
    requests are not data. Where exact tracking would be costly, it errs toward a spare dot.
- **Where it shows.** A small blue dot on the tab, on More (and the item inside it), and on the
  project in the sidebar; the open view never has one. On the page, one line: "Since you last
  looked: Opus 5.5 changed “Oil change” and this page", with History. The line stays while the
  page is open and can be hidden.
- **API.** `GET /api/freshness` (changed views per project), `GET /api/projects/:id/freshness`
  (`?view=&since=`), `PUT /api/views/:id/seen`. Reader-only: requests that declare an agent get 403.
- **Cost.** Computed from the change log on request. 1000 revisions and 20 views: about 20–40 ms;
  the test's budget is 500 ms.

## Evidence and stale answers (R11.2, R11.3, R11.5, R11.6)

- **Evidence revision.** `view.evidenceRevision`: the last revision before an agent built the view
  (view_create, view_answer, view_update replacing all widgets). Pharos sets it; `apply` refuses
  it from anyone. Ops, renames and a reply to a block request (even sent as a whole board) leave
  it alone: the rest of the page is as old as it was. Views made by a person have none; answer
  views without one show "Evidence unknown".
- **What the words depend on.** The data the page read when it was built (its board in the
  revision that set the evidence revision) together with what it reads now. Removing a block never
  makes old words fresh. An answer that reads no data at all (only Text) has nothing to check:
  "Evidence unknown" (`reason: "no_data"`).
- **Live versus written.** Blocks always show today's data; what the agent wrote (Text, Callout,
  headlines) is a snapshot as of the evidence revision.
- **Stale.** A later revision by anyone (the owner included) changed data the page read. Also,
  with no revision at all: a page with date-relative blocks ("$today", due dates) written on an
  earlier day whose blocks select other items today (`stale.calendar: { from, to }`). The page
  then says "May be out of date", names what changed and offers **Refresh**.
- **Refresh.** Creates a request with `mode: "refresh"` and the view's question. The answering
  agent answers again in the same view: view_update with expectedRevision, the requestId and the
  whole page as `widgets`, which sets a new evidence revision. Ops or a rename with that requestId
  are refused, view_answer refuses it, and `apply` refuses marking it answered unless the same
  write rebuilds its view (so linking an answer never closes it). Dismissing with a reply still
  works. Its brief lists what changed since the evidence revision.
- **Reuse.** The brief offers an earlier answer for linking only when it is fresh. A stale one is
  named with "Don't link it: answer again"; an unknown one with "Pharos can't tell whether what it
  says still holds … answer again". Each choice is written to the agent log.
  `project_snapshot.views[].evidence` says fresh, stale or unknown.
- **What agents see.** Evidence for agents (the snapshot, the answer brief and its Refresh lines)
  is worked out as agents see the data, through `AgentFiles`: changes to hidden files and to fields
  agents can't read (a file's notes) don't exist for it. The owner's page uses the full log.
- **Expiry** is unchanged: answers hide after their days unless kept; keeping keeps the evidence.

## Run states (W7)

- **Pause stops the run.** Pausing in Settings aborts the run in progress (the signal reaches the
  child process with SIGTERM), clears the queue and starts nothing new. Its questions stay open.
- **States.** `off`, `unavailable`, `paused`, `idle`, `queued`, `running`, and `stopping` (paused
  during a run, until the process exits). `GET /api/agent` and the feed's `agent` event carry
  `state`, `paused`, `run` (project and request ids, start time) and `lastRun` (`outcome`
  finished, failed, timed_out or stopped, with request ids and times).
- **Late results.** A stopped process that exits later is recorded as stopped. Anything it saved
  before it stopped stays (each write is its own revision, with Undo).
- **Retry.** A request a run left open shows why (failed, timed out, stopped) and "Try again",
  which runs the open questions again.
- **Waiting, not queued.** A question says "Queued for the next run" only when its project is in
  the agent's queue. Otherwise (for example after a restart: the runner's queue and last outcome
  live in memory, and startup doesn't start a run for questions that were already open) it says
  "Waiting: no run is set for it yet" with "Try again".
- **Ordered loads.** The page's freshness and the shared changed-dot list drop a response that
  finishes after a newer one.
- **W7.9.** `enabled` is true only when answering really is on (set up and not paused); `paused` is
  the stored switch.
- **W7.10.** A hint beside the disabled switch says why; the Server row says how to change the port
  under the launchd service (`PHAROS_SERVICE=1`, set by `pnpm service install`).
