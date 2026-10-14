# R11 · Live and calm: freshness and true run states

2026-10-13 · v0.2 track A, batch 5. Proposed; the owner accepts it in the v0.2 review (this folds
in W5.8 and W7.8).

## Changed since you looked (R11.1–R11.5)

- **Seen mark.** Per view and per reader, the latest revision the reader had when they last opened
  the view. Stored as one app setting (`views.seen`: `{ baseline, views }`), never a revision, never
  over MCP. A local install has one reader, the owner (`human:me`). The first read sets `baseline`
  to the latest revision, so an existing install starts calm; views never opened count from there.
  Marks only move forward. Opening a view marks it seen, and so does each change that arrives while
  it is open.
- **What counts as a change.** A revision after the mark, by anyone but the reader and not by Pharos
  itself, that changed the view (blocks, name, …) or data a block reads: an item that matched one
  of the block's queries before or after the change (`where`/`anyOf`, following references), an
  item a block names by id (ClaimCard, DecisionBlock, StartHere evidence, …), the project for a
  ProjectHeader. An ActivityFeed reads everything, so the default Overview changes with any change.
  Views and requests are not data.
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
  (view_create, view_answer, view_update replacing all widgets or answering a refresh). Pharos
  sets it; `apply` refuses it from anyone. Changing one block leaves it alone (the rest of the page
  is as old as it was). Views made by a person have none; answer views without one show "Evidence
  unknown".
- **Live versus written.** Blocks always show today's data; what the agent wrote (Text, Callout,
  headlines) is a snapshot as of the evidence revision.
- **Stale.** A later revision by anyone (the owner included) changed data the page's blocks read.
  The page then says "May be out of date", names what changed and offers **Refresh**.
- **Refresh.** Creates a request with `mode: "refresh"` and the view's question. The answering
  agent answers again in the same view (view_update with expectedRevision and the requestId),
  which sets a new evidence revision. Its brief lists what changed since the evidence revision.
- **Reuse.** The brief offers an earlier answer for reuse only when it is fresh (unknown ones with
  a caution); a stale one is named with "Don't link it: answer again". Each choice is written to the
  agent log. `project_snapshot.views[].evidence` says fresh, stale or unknown.
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
- **W7.9.** `enabled` is true only when answering really is on (set up and not paused); `paused` is
  the stored switch.
- **W7.10.** A hint beside the disabled switch says why; the Server row says how to change the port
  under the launchd service (`PHAROS_SERVICE=1`, set by `pnpm service install`).
