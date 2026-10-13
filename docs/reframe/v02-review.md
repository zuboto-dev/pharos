# Pharos v0.2 independent review

2026-10-13 · written by GPT-6.1-Sol · commit 77fad51

**Verdict: needs fixes before the owner relies on the file boundaries, owner-only actions, or page checks.**
Ordinary money totals and due bands work, but agents can cross several editing boundaries, and a
green fact check can describe something the page does not show. Product code was left unchanged.

The review covers changes since `3c15ae2`. The new tests use made-up records, temporary folders,
in-memory databases and requests made directly to the app. No owner data or live Pharos instance
was used. A hard link means two filenames pointing to the same disk contents.

## Gaps, highest severity first

### 1. High — an allowed filename can expose a secret

**What:** a Markdown hard link to an excluded `.env` file is scanned, added by the agent and read
by `file_read_text`. The secret-name and symlink checks do not identify hard links. This requires
an alias already placed on disk; the test does not show an agent creating it through Pharos.

**Reproduce:** [file tests](../../apps/server/src/files/hardlink-secret.v02review.test.ts),
`never exposes a secret through an allowed alias in an approved contents folder`.

**Suggested fix:** reject multiply linked regular files during scanning and safe opening, or adopt
an explicit alias policy that preserves the secret boundary. Check the opened file itself, including
for browser serving, hashing and agent reads (`files/safety.ts`, `files/service.ts`).

### 2. High — folder approval can approve a replacement

**What:** an agent requests a folder; before the owner approves, its directory is replaced with a
link to a different, unapproved folder. Approval succeeds and the agent sees the replacement's
files. The name shown in the request no longer identifies the directory being approved.

**Reproduce:** [file tests](../../apps/server/src/files/hardlink-secret.v02review.test.ts),
`does not approve a different folder placed at the requested path afterward`.

**Suggested fix:** save the canonical path and directory identity when requested, compare both at
approval, and require a fresh request when either changes. Keep the existing home, system,
hidden-folder and overlap checks (`files/requests.ts:217`, `files/folders.ts:136`).

### 3. High — asking about one block does not constrain every write

**What:** the usual block update is checked, but an agent can undo an owner edit elsewhere on that
page, delete the page, or edit another page without supplying the request id. With two requests
open, it can edit the second block while marking the first request answered.

**Reproduce:** [block tests](../../apps/server/src/views/block-ask.v02review.test.ts):

- `an agent cannot revert an owner layout edit outside the asked block`
- `an agent cannot delete a view while its block request is open`
- `an open block request also prevents an agent edit to another view in the project`
- `cannot answer one block request by changing a different requested block`

**Suggested fix:** bind the answering run to its request, page and block. Enforce that scope inside
the store transaction for every resulting change, including deletions and Undo. Use the named
request's block, rather than the union of all requested blocks. The current checks sit in the HTTP
handler and view update service; the store and other view tools can bypass them.

### 4. High — omitting the revision check allows an old page to overwrite a newer one

**What:** `expectedRevision`, the page version an agent read, is optional. An agent can replace the
whole page from an old copy after the owner edits it. The owner edit disappears.

**Reproduce:** [block tests](../../apps/server/src/views/block-ask.v02review.test.ts),
`doesn't let a stale full-board update without expectedRevision overwrite an owner edit`.

**Suggested fix:** require a matching version for agent page updates and enforce it at the shared
write boundary. Include HTTP writes and Undo where appropriate (`views/service.ts:239`).

### 5. Medium — owner outcomes can be recorded or erased by an agent

**What:** `action_run` lets an agent mark a bill paid and create the spending entry. It records the
agent as author, but requires no owner confirmation. This is deliberately exposed by the written
action contract; it fails the owner-only boundary requested for this review. Separately, an agent
cannot change an owner's chosen option, but can delete the decision that holds it.

**Reproduce:** [action tests](../../apps/server/src/actions/actions.v02review.test.ts),
`refuses an agent Mark paid submission without changing project data`; and
[decision tests](../../apps/server/src/store/decisions.v02review.test.ts),
`does not let an agent delete a decision after the owner chooses it`.

**Suggested fix:** require owner confirmation for actions that attest to a real-world outcome such
as payment. Enforce it for ordinary writes and Undo as well as action submissions. Protect deletion
of answered decisions inside `agentDecisionIssue`; it currently skips deleted decisions.

### 6. Medium — Undo can change hidden file links

**What:** normal agent updates preserve the owner's hidden file links. Undo does not: an agent can
remove one or restore one by reverting a visible task's revision. The restoration test gets the
revision from agent-visible history without learning the hidden file id first. It does not reveal
file contents, but crosses the protected-link boundary.

**Reproduce:** [hidden-link tests](../../apps/server/src/store/undo-hidden-file-link.v02review.test.ts):

- `refuses to revert a visible entity change that adds an owner-only fileId`
- `refuses to revert a visible owner change that restores an owner-only fileId`

**Suggested fix:** inspect file references in the complete before/after changes during Undo, and
preserve hidden links or refuse the revision. Apply the same rule to record file fields
(`store/agent-files.ts`, `Store.transaction`).

### 7. Medium — query checks miss invalid alternatives and refuse valid ones

**What:** a known outer record type causes an unknown record type inside an alternative to be
skipped. The resulting page can show a false empty result. Conversely, valid alternatives over
two record types are checked against the first type's option list, so the second is refused.

**Reproduce:** [query tests](../../apps/server/src/packs/queries.v02review.test.ts):

- `rejects an unknown record type in anyOf even with a known outer recordType`
- `accepts valid anyOf branches with different option lists`

**Suggested fix:** compute each alternative's possible record types separately, intersect them
with the outer conditions, and check every record-type condition and field in its own scope
(`schema/views/check-queries.ts:156`, `:352`).

### 8. Medium — other save paths evade query validation

**What:** removing a record field from the project can invalidate an already saved total without
refusal. An old error can also be copied into another query inside the same block: error identity
ignores its location and number of occurrences. A project id used as a numeric comparison value,
and month grouping of a number, both pass the checks.

**Reproduce:** [query tests](../../apps/server/src/packs/queries.v02review.test.ts):

- `rejects record metadata edits that invalidate a saved page`
- `rejects a second occurrence of an old error inside the same widget`
- `rejects a project id used as a numeric comparison value`
- `rejects a month bucket on a numeric field`

**Suggested fix:** recheck dependent pages when their field definitions change. Compare old and
new errors by occurrence and query location, while still allowing unrelated resizes. Type-check
special values after resolving their meaning, and allow month/year grouping only on date fields.

### 9. Medium — impossible calendar dates reach saved records and queries

**What:** `2026-02-30` passes record-field validation and query validation. A due list can therefore
receive a date that never occurred. Shape checks such as “four digits, dash, two digits” are not
calendar checks; action forms already validate dates more strictly.

**Reproduce:** [query tests](../../apps/server/src/packs/queries.v02review.test.ts):

- `refuses impossible dates in records before they reach a due tracker`
- `rejects an impossible literal calendar date in a query`

**Suggested fix:** share real calendar-date validation across records, queries and actions
(`schema/records.ts:191`, `schema/views/check-queries.ts:225`).

### 10. Medium — the fact checker can approve something the page does not show

**What:** a plain counting chart sorts and limits its bars differently from the fact checker.
The regression renders only “Alpha”, while the checker passes a fact about “Zed”. It also refuses
correct displayed option labels and counts grouped by individual list members.

**Reproduce:** [rendered-page test](../../apps/web/src/catalog/facts.v02review.test.tsx),
`does not pass a fact about a bar excluded from the rendered chart`; and
[calculation tests](../../packages/schema/src/views/calculations.v02review.test.ts):

- `checks a displayed option label instead of its raw stored value`
- `checks each bar of a plain CountChart grouped by a list`

**Suggested fix:** share the final displayed bar calculation, including grouping, labels, ordering
and limits, with the checker. Share cell formatting too. Passing arithmetic from a different
representation is insufficient (`schema/packs/fact-check.ts`, web `components/generic.tsx`).

### 11. Low — two calculation edges select the wrong result

**What:** a daily fixed schedule stops advancing after 4,999 steps. Starting in 2000 and last
completed in October 2026, it reports September 2013 as the next due date. Also, descending date
sorting puts missing dates first; “one per song” can select an undated mix over a dated one.
The built-in music pack requires dates, but custom record types may make them optional.

**Reproduce:** [calculation tests](../../packages/schema/src/views/calculations.v02review.test.ts):

- `advances a fixed daily schedule beyond 5000 elapsed occurrences`
- `does not choose an undated row as newest when onePer uses descending dates`

**Suggested fix:** calculate the next fixed occurrence without a silently truncating loop. Keep
missing sort values last in either direction (`schema/views/due.ts:26`, `run-query.ts:324`).

### 12. Low — presence notifications can disappear incorrectly

**What:** finishing one run clears another agent's marks in the same project. A read that removes
an expired mark also prevents the timer from publishing its removal. The built-in browser expires
timed marks locally, so the second issue does not leave its mark permanently stuck. No cross-project
display leak was reproduced.

**Reproduce:** [presence tests](../../apps/server/src/presence.v02review.test.ts):

- `does not clear another agent active in the same project when a run ends`
- `publishes an expiry when a read prunes an overdue mark before its timer runs`

**Suggested fix:** clear marks by the ending run's source, and publish removals consistently without
silently mutating state in a read (`presence.ts:113`, `:124`).

## Protections confirmed

- Agents cannot approve folders through their declared agent role. Home, system, hidden and
  overlapping folder requests are refused; approval repeats the forbidden-folder checks.
- Agent file additions, including raw `apply`, require a scanned path in an approved, visible
  folder. Hidden folders, secrets by name, escaping links, forged scan fields, file removal and
  moves are refused. Normal reads hide hidden files and locations; Details folders refuse text
  contents. Existing path, symlink, folder-replacement and browser-origin regressions pass.
- Ordinary hidden-file links survive agent edits and disappear from agent reads. Direct file
  Undo rules, including files changed on disk since removal, still hold; the visible-entity link
  exception above is separate.
- Audio byte ranges return bounded bytes with matching length and range headers. Suffix ranges,
  clamping and out-of-bounds requests behave correctly. Unsupported or multiple ranges produce
  a full response; downloads and non-audio content ignore ranges. No Range-specific leak was found.
- Unknown ordinary query fields are refused atomically with corrections. Intentional empty
  results are allowed, mixed-record warnings are returned, and unrelated edits to old broken
  pages remain possible.
- Money sums, table totals, monthly bars and category totals agree with hand-calculated values.
  Uncategorized spending is retained. EUR and USD stay separate; currencies with zero and three
  decimal places format correctly. Wrong expected totals and unbound numbers in prose fail checks.
- Date and km urgency thresholds, the more urgent of the two, fixed versus rolling intervals,
  leap years, month ends, year boundaries and arithmetic across daylight-saving dates pass.
  “One per song” selects the newest dated entry after sorting and before limiting.
- Stale record actions write nothing and do not reserve their retry key. Successful retries
  become duplicates without another revision. Forged page/block ids are refused. Mark-paid Undo
  restores the exact record set and field data. Existing invalid-submission tests pass.
- Direct decision choice, answer, deferral, clearing owner fields, changing chosen options and
  reverting owner choices are refused to agents. A decision block cannot be submitted as an action.
  Presence display filters keep separate projects separate.

## Verification and what could not be checked

`npx pnpm@12.9.1 typecheck`, `lint` and `format:check` pass. The required `test` command fails
on the new calculation regressions; its recursive run stops at the schema package. Separate full
package runs cover the server and web code. The new review suites contain **61 tests: 35 pass and
26 deliberately fail on the gaps above**.

The full server run also has six failures in the existing evaluation harness, returning
`harness_error`. That harness allocates a local port and starts a separate server; its behavior
cannot be verified under the no-server rule. The subsequent server run excludes that harness.
These failures are separate from the review regressions; their underlying cause was not diagnosed.
No harness or product code was changed. With that harness excluded, the existing server tests pass;
the existing schema and web tests pass too.

This was a defensive code and regression review, not the owner's usability or release check.
Actual Safari playback/seeking, Finder handoff, iCloud downloads, visual transitions and long-lived
live runs were not exercised. Time arithmetic was checked with explicit calendar dates; different
browser/server local clocks around midnight were not simulated. The owner's source exports and
held private case were not read.

The HTTP author header declares a role; it does not authenticate it. The confirmed agent-role
protections therefore assume clients declare themselves honestly. This review does not establish
protection from an agent impersonating a human or from arbitrary local operating-system access.

## Fixed

2026-10-13 · fix round by Opus 5.5. All 61 review tests pass; nothing was weakened except one
contradictory test (gap 5). New tests sit next to each fix in `*/v02-fixes.test.ts`.

| Gap | What changed                                                                                                                                                                                                                                                                                                | Proven by                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | A file with more than one name (a hard link) is never listed by the scan, added, or opened: `isMultiplyLinked` in `files/safety.ts`, checked on the path and on the opened handle.                                                                                                                          | `never exposes a secret through an allowed alias…`; `files/v02-fixes.test.ts`                                   |
| 2   | A folder request records the directory's identity; approval refuses (and removes) a request whose path is now a link or another directory, so the agent must ask again.                                                                                                                                     | `does not approve a different folder placed at the requested path afterward`; `files/v02-fixes.test.ts`         |
| 3   | `Store.transaction` checks every agent revision (view_update, REST apply, deletes, Undo) against open block requests (`agentBlockScopeIssue`): only asked blocks change in place; a revision answering a request may change only that request's block; other views in the project wait; new views are fine. | the four block-scope tests in `block-ask.v02review.test.ts`; `views/v02-fixes.test.ts`                          |
| 4   | An agent replacing a whole board (`widgets` or `resetToTemplate`) without `expectedRevision` is refused when someone other than that agent changed the view last. `ops` still apply to the current board; Undo was already conflict-checked.                                                                | `doesn't let a stale full-board update…`; `views/v02-fixes.test.ts`                                             |
| 5   | Agents can't move an existing record's `interval.lastDate`/`lastMeter` (apply, actions, Undo), so Mark paid and Log a service's reminder roll are the owner's; `action_run` refuses those actions up front. Agents can't delete a decision the owner chose, answered or deferred.                           | `refuses an agent Mark paid submission…`; `does not let an agent delete a decision…`; `store/v02-fixes.test.ts` |
| 6   | `AgentFiles.changesIssue` compares links to hidden items (ref fields, record file fields, decision option claims) before and after every agent change, Undo included; an agent update rewriting a record's fields or a decision's options keeps hidden values it wasn't shown.                              | both tests in `undo-hidden-file-link.v02review.test.ts`; `store/v02-fixes.test.ts`                              |
| 7   | Each anyOf alternative is checked in its own record types (within the outer where's); every named record type must exist; a value is fine when it fits the field in any of the query's record types.                                                                                                        | `rejects an unknown record type in anyOf…`; `accepts valid anyOf branches…`; `schema views/v02-fixes.test.ts`   |
| 8   | Changing a project's record types or options may not break a saved page; finding identity includes the location inside its widget; `$project`/`$currentStage` only match ids, references and text; month/year buckets need a date field.                                                                    | the four tests under gap 8                                                                                      |
| 9   | `isCalendarDate` (schema `views/dates.ts`) is shared by record fields, queries and action forms.                                                                                                                                                                                                            | `refuses impossible dates in records…`; `rejects an impossible literal calendar date…`                          |
| 10  | `chartBars` computes plain count bars (list members apiece, option labels, colours and order, then the limit) and the web CountChart renders its result; fact-check cells show option labels. The `music-latest-mix` case now expects "Demo" (v2).                                                          | `does not pass a fact about a bar excluded…`; the two fact-check calculation tests                              |
| 11  | The next fixed occurrence is estimated from elapsed days and corrected, with no capped loop; rows without a sort value go last in either direction.                                                                                                                                                         | `advances a fixed daily schedule…`; `does not choose an undated row…`                                           |
| 12  | `clearProjects` clears only the run's agent's marks; `Presence.state()` publishes a removal it prunes.                                                                                                                                                                                                      | both presence tests                                                                                             |

Changed tests: the review's `keeps an agent action attributed to the agent, including Mark paid`
made the same call as `refuses an agent Mark paid submission…` and expected the opposite result.
It now checks attribution on the owner's Mark paid. Existing R10 tests that had an agent mark a
bill paid or log a service now expect the refusal; agent `action_run` is still tested with an
action that only adds a record. `app.test.ts` was unaffected: agent full-board writes to a view
Pharos made, or the agent itself changed last, need no revision.

The six evaluation-harness failures don't reproduce: `src/eval-harness.test.ts` passes (9 of 9)
in a normal checkout. The harness starts its own server on a free port (never 4300), which the
review sandbox didn't allow, so they were sandbox-specific and nothing was changed.
