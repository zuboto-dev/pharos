# Pharos: independent review of “Live and calm”

2026-10-13 · written by GPT-6.1-Sol · commit 3f144b3

**Verdict: needs fixes before the owner trusts “nothing has changed” or Refresh.**
The reader-only routes refuse agents, and normal run states work. But agents can infer hidden
file changes through snapshots, an old answer can become “fresh” without being rewritten, and
several changes to displayed data produce neither a dot nor a stale warning.

This checks only additions between `bd6ca04` and `3f144b3`, after the previous review's fixes.
Product code was left unchanged. The new tests use made-up data, temporary folders, in-memory
databases and requests directly to the app. “Evidence” below means the stored data behind an
answer; a seen mark records how far the owner has read.

## Gaps, highest severity first

### 1. High — hidden files can be probed through snapshot freshness

**What:** an agent creates a FileList with a guessed file title as its filter. The agent's file
list stays empty, but the page's snapshot evidence changes from fresh to stale when the hidden
file is edited. This confirms that the guessed title matched a hidden item. A notes-only edit
in a Details folder also changes agent-visible evidence, even though agents cannot read notes.
The same calculation supplies the reuse brief. This is an inference channel, not a reproduced
download of hidden contents or a direct list of hidden filenames.

**Reproduce:** [boundary tests](../../apps/server/src/views/boundaries.r11review.test.ts):
`does not let MCP evidence reveal a guessed hidden filename changing` and
`does not expose withheld note changes through snapshot evidence`.

**Suggested fix:** calculate agent-facing evidence using the same visibility and field rules as
agent reads, including historical changes. Keep the owner's evidence calculation separate.
Do not offer pages that depend on hidden evidence for agent reuse; an opaque, consistently
unknown status must not vary with private edits. The current `evidenceState` uses the raw store.

### 2. High — old words can receive a fresh label without a new answer

**What:** a stale answer says “One task is blocked” after that task is completed. An agent can
answer its Refresh request by changing only the tab name: the evidence revision advances and
the answer becomes fresh. Alternatively, removing the data block with a widget operation
leaves the old words and old evidence revision, but freshness is recomputed from the remaining
blocks and becomes fresh. A prose-only answer is also certified fresh and offered for reuse
after the task it describes changes. There is no recorded dependency for those words.

**Reproduce:** [boundary tests](../../apps/server/src/views/boundaries.r11review.test.ts):
`keeps a stale answer stale when Refresh only renames the tab`,
`does not make old prose fresh by removing its evidence block with ops`, and
`does not certify a prose-only answer as fresh after its underlying task changes`.

**Suggested fix:** retain the dependencies used when the answer was built, independently of its
current layout. Renew evidence only on an explicit answer rebuild, with a matching page revision
and replacement answer content. If the evidence behind written claims is unknown, say so and
withhold confident reuse advice. Pharos cannot prove that an agent checked a sentence merely
because it saved a page.

### 3. High — changes through references and project settings are missed

**What:** tracking largely watches the type returned by a query, not everything needed to
render it. Changing a stage can remove tasks from a `stage.status` filter or rename their
displayed stage; changing a referenced vehicle can change a service-record query. Those edits
are missed. So are switching the project's current stage, renaming status options, changing a
record field's displayed unit, and renaming a file linked from a ClaimCard. The same missed
dependencies affect both changed dots and stale-answer detection.

**Reproduce:** [read tests](../../packages/schema/src/views/reads.r11review.test.ts):

- `counts a referenced stage change when a task query filters through stage.status`
- `counts a referenced label change displayed by a task table`
- `counts a referenced record change when a record query filters through that record`
- `counts project currentStage changes used by the $currentStage query value`
- `counts option-label changes that change how a task row is rendered`
- `counts a record field-unit change that changes a DataTable cell`
- `counts a linked file metadata change on a claim card`

**Suggested fix:** track references used by filters, displayed fields and linked evidence, plus
the relevant project settings. Compare query/render dependencies before and after a revision,
using the project and reference values from those times. Matching the changed vehicle as though
it were the service row does not find the service's dependency.

### 4. Medium — date-sensitive answers and timestamp filters can stay fresh incorrectly

**What:** all historical changes are matched using today's date when freshness is requested.
An edit that made a task match “due today” yesterday is missed when read tomorrow. Without any
revision at all, today's table can switch to a different task while yesterday's written answer
still gets “nothing has changed.” Queries on entity timestamps also miss changes: reconstructed
entities have empty `createdAt` and `updatedAt` fields.

**Reproduce:** [date/history tests](../../apps/server/src/views/reads-integration.r11review.test.ts):
`evaluates $today filters on the revision date when computing later freshness` and
`does not certify yesterday's written answer when a $today query changes overnight`;
[read tests](../../packages/schema/src/views/reads.r11review.test.ts):
`uses entity timestamps when a query selects by createdAt or updatedAt`.

**Suggested fix:** retain the date context of the evidence and evaluate historical filters in
their historical context. Treat a changed date-dependent result as changed evidence even without
a data revision. Restore real entity timestamps when reconstructing query inputs.

### 5. Medium — Refresh can finish in a different page, or reuse the stale one

**What:** `view_update` checks that a Refresh targets the original page, but `view_answer` can
create a new page and close the same request. A raw agent request update can instead link the
stale original answer and mark Refresh answered. The owner is left with the old page unchanged
and a completed request. The brief's instruction is not enforced across write paths.

**Reproduce:** [boundary tests](../../apps/server/src/views/boundaries.r11review.test.ts):
`refuses view_answer creating a different page for a Refresh request` and
`refuses linking a stale answer as the result of a Refresh through REST apply`.

**Suggested fix:** enforce completion rules in the store transaction: answering a Refresh must
rebuild its named page, and linking a stale answer must not satisfy it. Keep dismissal with an
explanation available when the request cannot be completed.

### 6. Medium — a valid one-block replacement is rejected by the new evidence stamp

**What:** an agent supplies all widgets with only the asked block changed, and supplies the
correct page revision. The block-scope check accepts the layout, but the new whole-board stamp
changes `evidenceRevision`; the store then refuses that extra field change. Widget operations
still work, and attempts to use Refresh to escape a block request remain refused.

**Reproduce:** [boundary tests](../../apps/server/src/views/boundaries.r11review.test.ts):
`allows replacing only the asked block without renewing evidence for the entire page`.

**Suggested fix:** when answering a block request, preserve the page's evidence revision even
when the submitted board is a complete representation. Decide whether to renew evidence from
the actual permitted change and request scope, not just the presence of `widgets`.

### 7. Medium — an older response can hide a newer stale warning

**What:** two freshness reads overlap after revisions arrive. The newer response marks the
answer stale; the older response arrives afterward and replaces it with fresh state. The page
can show that state until another event or visit. Forward-only seen marks do not protect the
displayed evidence from this ordering problem.

**Reproduce:** [web tests](../../apps/web/src/pages/freshness.r11review.test.tsx):
`does not replace a newer stale result with an older fresh response`.

**Suggested fix:** reject older results using the response's latest revision and a request
generation for the selected page. Apply the same ordering rule to the shared changed-dot load.

### 8. Medium — after a restart, a waiting question is called queued without a queued run

**What:** a recreated runner loses its last outcome and its queue. Existing open questions stay
idle until “Answer now” or another trigger calls `answerWaiting`; startup does not call it.
The new question-status formatter nevertheless says “Queued for the next run” whenever
answering is enabled. A previously failed or stopped question also loses its reason and retry
status on restart. The missing startup queue predates this batch; the new claim that it is
queued makes that behavior misleading.

**Reproduce:** [runner tests](../../apps/server/src/run-states.r11review.test.ts):
`loses lastRun and does not queue old open questions in a fresh runner instance` confirms the
underlying behavior; [web tests](../../apps/web/src/pages/freshness.r11review.test.tsx):
`does not label an idle unqueued request as scheduled after a restart` fails.

**Suggested fix:** show waiting unless the request's project is actually queued. Save enough
run outcome information to explain unanswered questions after restart, and define whether
startup should resume them or offer an explicit retry.

### 9. Low — a row the page never shows can produce a changed dot and stale warning

**What:** “one per song” selects the newest record. Editing an older record's notes still counts,
although the selected record and visible list are unchanged. Tracking drops sort, limit and
`onePer`, so its idea of what the page reads is broader than the displayed result. This matches
the notes' broad filter-based rule, but falls short of the requested “nothing visible changed”
check and can cause unnecessary refreshes.

**Reproduce:** [read tests](../../packages/schema/src/views/reads.r11review.test.ts):
`does not mark a change to an older onePer row when it stays hidden`.

**Suggested fix:** compare the actual selected results and displayed values. Include rows that
enter or leave the selected set, and aggregate inputs when they affect a shown total.

### 10. Low — invalid seen input is accepted, and malformed stored marks suppress news

**What:** malformed JSON on the seen route becomes an empty object and silently marks the page
seen through the latest revision. Separately, the saved setting is only shallowly checked: a
non-numeric view mark prevents later changes from being counted and can produce a non-finite
mark. The latter test injects damaged persisted data; no ordinary API path for writing that
string mark was found.

**Reproduce:** [boundary tests](../../apps/server/src/views/boundaries.r11review.test.ts):
`refuses malformed JSON instead of silently marking the page seen` and
`recovers a malformed stored view mark instead of suppressing future changes`.

**Suggested fix:** reject invalid JSON. Validate the full saved setting, including finite,
nonnegative integer marks and an object of view ids; discard or repair invalid entries.

## Protections confirmed

- All three reader routes refuse declared agents without moving marks or creating revisions.
  REST and MCP `apply` refuse a forged evidence revision. Ordinary agent view writes do not
  change the owner's seen marks.
- Refresh change labels filter out hidden file names, ids and folder paths. No direct hidden
  name or contents disclosure through those labels was reproduced; gap 1 concerns inference.
- A proper Refresh updates the same page, advances its evidence revision and closes its request.
  Wrong-page `view_update` and Refresh attempts that cross an open block scope are refused.
  Existing concurrent-edit and block-scope regressions continue to pass.
- Matching row edits, aggregate sum inputs, direct FileList metadata, deletions and owner Undo
  are tracked. Owner edits and Undo make evidence stale while staying out of the owner's changed
  dots. Views created after the baseline do not inherit earlier project changes.
- Seen marks move forward, clamp future input to the latest revision, reject negative/fractional
  revisions, and remain app settings rather than project revisions. Marking another page prunes
  deleted-view entries; nonexistent views and deleted projects return not found. Valid writes
  do not accumulate arbitrary ids without bound.
- Fake-runner tests confirm off/unavailable keep `enabled` false, even with either saved pause
  value. Pause aborts the active run; late resolution or rejection is recorded as stopped.
  Failure, timeout and rejection outcomes are distinct; quick resume waits for the stopping run
  before starting queued work. Run ids and request ids clear on completion.
- No newly introduced unguarded server background callback was found. The new reuse-log callback
  catches file-write errors, and a rejecting runner is caught and recorded. Older shell output
  logging behavior was excluded from findings because it is unchanged from the base commit.
- The existing 1,000-revision/20-view freshness budget test passes its 500 ms ceiling. Freshness
  still reads and parses history on demand; snapshots repeat the calculation for each evidence
  page, and reuse checks repeat it across questions. Much larger projects were not benchmarked.

## Verification and what could not be checked

The five new review files contain **44 tests: 21 pass and 23 deliberately fail on the gaps**.
Type checking, lint and formatting pass. The root `test` command, with the evaluation harness
excluded, stops on the nine new schema failures. Separate complete server and web package runs
cover the later packages; their failures are the review regressions. Existing tests pass with
the harness excluded. Web tests also print existing simulated iframe/network warnings.

The evaluation harness was unintentionally included by a delegated test command before its
exclusion was corrected. That harness attempts to start temporary servers, violating this
review's no-server instruction; six harness cases failed. Its command exited. Process inspection
was denied, so remaining child processes could not be independently checked. The harness was
excluded from every subsequent broad run. No live Pharos instance, home data directory, owner
source export or held private case was accessed.

Actual child-process termination, long-lived service restarts, browser appearance, mobile
interaction and clocks in different time zones were not exercised. Pause and restart behavior
were checked with controlled fake runners; calendar cases used fixed test dates. The owner still
needs a usability and release check. Declared agent headers are roles, not authentication: this
review assumes honest role declarations and does not establish a boundary against local
operating-system access or human impersonation.

## Fixed

2026-10-13, fix round F2 (Opus 5.5). All 44 review tests pass, with every earlier test.
docs/reframe/r11-notes.md has the behaviour.

1. **Hidden files through evidence.** Agent-facing evidence (`evidenceState`, used by the
   snapshot and the answer brief, and the brief's Refresh lines) is worked out through
   `AgentFiles`: hidden items' changes are dropped, other changes keep only fields agents can read,
   and the data is the agent dataset. Tests: `does not let MCP evidence reveal a guessed hidden
filename changing`, `does not expose withheld note changes through snapshot evidence`.
2. **Old words become fresh.** Evidence depends on the board as built (from the change log) plus
   the current board; a page reading no data is unknown (`reason: "no_data"`) and unknown answers
   aren't offered for linking. A Refresh must be answered with the whole page as widgets: ops and
   renames are refused. Tests: `does not make old prose fresh by removing its evidence block with
ops`, `does not certify a prose-only answer as fresh…`, `keeps a stale answer stale when Refresh
only renames the tab`. The last now expects the rename to be refused (it still checks the page
   stays stale and isn't offered), and `updates the same answer with a checked revision…` and
   R11's own refresh test answer with widgets instead of ops, as the brief for this round asks.
3. **References and project settings.** `changeTouches` follows items linked from selected ones
   (filters and displayed fields alike), items linked from named ones, `currentStageId`, option
   lists and record types. Tests: the seven `counts …` cases in `reads.r11review.test.ts`, plus
   precision cases in `reads.test.ts`.
4. **Dates and timestamps.** Each revision is judged on its own day; a dated page written on an
   earlier day is stale (`stale.calendar`) when its blocks select other items today; changed items
   keep their real timestamps and timestamp queries count every edit. Tests: `evaluates $today
filters on the revision date…`, `does not certify yesterday's written answer…`, `uses entity
timestamps…`; `a dated page written yesterday stays fresh while today selects the same items`.
5. **Refresh in another page.** `view_answer` refuses a Refresh request; `Store.apply` refuses
   marking a Refresh answered unless the same write rebuilds its view (dismissing still works).
   Tests: `refuses view_answer creating a different page…`, `refuses linking a stale answer…`,
   `a Refresh is answered only by rebuilding its page; it can still be dismissed`.
6. **Block reply as a whole board.** A block request never renews evidence. Test: `allows
replacing only the asked block without renewing evidence for the entire page`.
7. **Out-of-order responses.** The page's freshness and the shared changed-dot load drop responses
   older than the one shown. Tests: `does not replace a newer stale result with an older fresh
response`, `an older load finishing last never replaces a newer one`.
8. **Queued after a restart.** "Queued" only when the project is in the agent's queue; otherwise
   "Waiting: no run is set for it yet" with Try again. The runner itself is unchanged (no outcome
   saved across restarts, no automatic start for old questions): the owner starts them. Tests:
   `does not label an idle unqueued request as scheduled after a restart`; R11's own run-state test
   now checks queued and unqueued.
9. **Hidden onePer rows.** Queries cut by `limit` or `onePer` count a row only when it is shown
   before or after the change. Test: `does not mark a change to an older onePer row…`, and the
   limit case in `reads.test.ts`.
10. **Seen input.** Malformed JSON gets 400; stored marks are validated and repaired. Tests:
    `refuses malformed JSON…`, `recovers a malformed stored view mark…`, `repairs a damaged seen
setting and accepts an empty seen body`.
