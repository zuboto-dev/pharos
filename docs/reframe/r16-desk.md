# R16 · The desk

2026-10-21 · design for the beta (the owner chose "one desk across projects" on the Beta vision
page, 2026-10-21). Built after the answering-agent choice and the setup instructions merge.

## What it is

One page above the projects, **Desk**, that lists everything waiting on the owner in every
project, with about how long each takes and how long it has waited. The owner answers in place.
Agents add to it with one MCP call and read the answers on their next turn. It also shows what
ran without the owner: the night runs and the routines.

It is the live version of the Routines morning page ("20 items need you, about 93 min, across 7
projects"), built from Pharos data instead of each project's NEXT.md.

## Items

A desk item is derived, never stored: there is no new "item" entity, so nothing can disagree with
the data it comes from.

| Kind     | Comes from                                                         | Open while                                            | Answered by                    |
| -------- | ------------------------------------------------------------------ | ----------------------------------------------------- | ------------------------------ |
| decision | a decision with options                                            | no choice, no answer, not deferred past today         | choosing, answering, deferring |
| sheet    | a review-desk sheet in a report document (R15)                     | its state is open (`sheetSummaries`)                  | its decisions and checklist    |
| task     | a task assigned to a human assignee                                | not finished (done or cancelled)                      | Mark done (or its status)      |
| run      | a run that needs the owner: failed, or could not verify (see Runs) | until the owner marks it seen or a later run succeeds | "Seen"                         |

A decision shown in an open sheet appears once, as the sheet. Fields per item: `id` (the
entity's), `kind`, `projectId`, `project` (name), `title`, `ask` (one line: what it needs),
`minutes` (sheet time, task estimate, decision `minutes`, else none), `since` (when it started
waiting), `gate` (true for gate-tagged sheets or decisions), `href` (the view and anchor that
answers it, else the project's page for it).

Order: waiting more than 48 h first (the beta bar), then gates, then oldest. The header says
"Needs you: N items, about M min" and how many are over 48 h.

## Runs

New entity `run` (a revision like any other, so it has history):
`{ projectId?, kind: 'night' | 'routine' | 'answer' | 'other', name, agent, startedAt, endedAt?,
outcome: 'running' | 'ok' | 'partial' | 'failed', summary (≤ 300), counts?: { done, failed,
unverified }, viewId?, seenAt? }`. The answering agent's runs are written by Pharos itself
(`answer`). A routine or night runner writes its own with `run_report`.

The desk shows the last night run and each routine's last run in one strip ("Night 10-21: 19
tasks, 7 could not verify · Morning 08:00 ok · Evening 22:40 ok"), and a failed or partial run as
an item.

## MCP

- `ask_owner` (one call, the beta bar's third check): `{ projectId, title, ask?, minutes?,
gate?, options?: [{id,label,summary,asks?}] , viewId? }`. With options it creates a decision
  (status proposed); without, a task assigned to the project's human assignee (created if
  missing). Returns the id and the desk link.
- `desk_list({ projectId? })`: the open items (an agent's own project by default), and answers
  given since a revision (`since`), so an agent sees the owner's answer on its next turn.
- `run_report`: create or finish a run.

## Web

- Sidebar: "Desk" at the top with the item count; `/desk`.
- Desk page: header (items, minutes, over 48 h), the runs strip, then items grouped Overdue /
  Gates / Today by project, each a row: project dot, title, ask, minutes, waited, and the answer
  in place where it is small (a decision's options, Mark done); otherwise the row opens the sheet.
- Phone first: one column, rows tappable, answers one-handed (the owner checks in from the phone).

## Bridge to NEXT.md (later, after a few days of use)

The triage and evening routines write "Needs you" items with `ask_owner`; NEXT.md's "Needs you"
is generated from `desk_list`. Until then both exist, and the desk is checked against NEXT.md
each morning (items in one but not the other are listed on the Routines page).

## Proof

- Server: derived items for each kind (open/closed rules, the sheet de-duplication, ordering,
  48 h), `ask_owner` both shapes, `desk_list` answers since, `run_report`; agents can't mark a
  run seen or answer.
- Web: the page from made-up data at 1200 and 390 px, answering a decision and a task in place.
- Live: after a day of use, the desk's count against the Routines morning page's count.
