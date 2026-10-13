# R10 notes: act in place

2026-10-13 · Opus 5.5 · v0.2 track A batch 4 · R10.1–R10.4, R10.6–R10.15 (R10.5, R10.16 batched
into the end review; R10.17–R10.18 are the owner's check after R12)

## 1. The first actions (R10.2, proposed decision)

Compared for usefulness on the pack pages, how much validation they need, and reuse:

| Candidate                  | Useful on the page                                       | Validation                                              | Reuse                                  |
| -------------------------- | -------------------------------------------------------- | ------------------------------------------------------- | -------------------------------------- |
| **Log a service** (create) | The Car page's main chore; rolls the reminder it settles | Every field kind: reference, date, option, money, meter | Any "log an event": session, mix, fuel |
| **Mark paid** (done)       | The Money page's main chore; a DueTracker row button     | A repeating record, a date, money, a stale check        | Any "mark done": renewals, filings     |
| One task change (status)   | Pack pages have no tasks                                 | One option field                                        | Project pages only                     |

**Proposed:** the first contract supports two kinds, `create` (Log a service) and `done` (Mark
paid), not a task change. The R9 packs get the obvious equivalents as data: Music "Log a mix" and
"Log a session", Study "Log a session", Company documents "Mark renewed". The owner accepts or
sends this back in R10's owner check (R10.17), together with the conflict policy below.

## 2. The contract (R10.3)

`packages/schema/src/actions.ts`, version 1, transport-free (REST and MCP send the same object; no
A2UI, AG-UI or MCP Apps dependency).

**Where an action is defined.** In the page: the props of an `Action` block (`label`,
`recordType`, `does: "create" | "done"`, `fields`, `roll`, `raise`, `log`, `description`). Packs
ship them as data; agents add them with the view tools; the query checks refuse one whose record
type or fields the project lacks. A DueTracker's `action` names a done Action on the same page,
which puts its button on every due row.

**A submission** (`ActionSubmission`):

| Field                             | Meaning                                                                                                                                                                           |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `v`                               | `1`                                                                                                                                                                               |
| `projectId`, `viewId`, `widgetId` | The context: the server reads the action from that block of that saved page, never from the request                                                                               |
| `recordId`                        | done: the repeating record marked done                                                                                                                                            |
| `title`                           | create: the new record's title (default: the first option's label, else type and date)                                                                                            |
| `values`                          | By field key, typed from the record type: money `{amount (cents), currency}`, `YYYY-MM-DD`, option values, record ids. done: `date` (required), `meter`, and the `log.ask` fields |
| `idempotencyKey`                  | One per opened form, resent with every retry                                                                                                                                      |
| `expectedRevision`                | done: the record's `updatedRev` when the form was filled (required)                                                                                                               |

**What it writes**, as one revision through `Store.apply` with the author's attribution:
create adds the record; `roll` marks matching repeating records done (their `lastDate`, and
`lastMeter` from the new reading, never moving either back); `raise` lifts a reading on the
referenced record (the car's odometer), never lowering it. done sets the record's
`interval.lastDate` (and `lastMeter` from a reading) and, with `log`, adds a record built from
`"$date"`, `"$title"` and `"fields.<key>"` of the record marked done (a bill paid adds its
spending). Undo is reverting that revision.

**Three kinds of state, kept apart.** Local form state (what was typed, pending, the errors shown)
lives in the page and is never saved. A submission is one store write. Nothing in an action asks
an agent to reason; asking about a block is a request (section 4).

**Worked examples.** Mark paid on Rent, opened at revision 7:

```json
{
  "v": 1,
  "projectId": "prj_…",
  "viewId": "view_…",
  "widgetId": "mark-paid",
  "recordId": "rec_rent",
  "values": { "date": "2026-10-13", "amount": { "amount": 96000, "currency": "EUR" } },
  "idempotencyKey": "form-3f2c…",
  "expectedRevision": 7
}
```

→ `{ "status": "done", "revision": 120, "recordId": "rec_rent", "created": ["rec_spending"], "updated": ["rec_rent"] }`.
Sent again with the same key → `{ "status": "duplicate", … }` with the same revision and nothing
new. If the owner changed Rent at revision 9 meanwhile → `{ "status": "stale", "current":
{ "recordId": "rec_rent", "revision": 9, "lastDate": "2026-10-10" } }` and nothing written.

Log a service: `{ "widgetId": "log-service", "title": "Oil and filter", "values": { "vehicle":
"rec_car", "date": "2026-10-13", "kind": "oil", "odometer": 61950, "cost": { "amount": 15900,
"currency": "EUR" } }, … }` → one revision with the service, the oil reminder rolled to today and
61,950 km, and the car's odometer raised to 61,950.

## 3. Validation and results (R10.4)

The server checks, before writing: the project, page and block exist and belong together; the
record (done) is in this project, of the action's type and repeats; every value fits its field
(text up to 200 characters, finite numbers, non-negative meters and money in whole cents with an
ISO currency, real calendar dates, listed option values, references to records of the right type
in this project, files in this project); required fields are present; no unknown keys. The author
is the request's (`X-Pharos-Author` over REST, the MCP client's name over MCP). Store.apply checks
the rest again (record types, references, agents' file rules).

| Result      | HTTP | When                                                                                             | The page                                                                      |
| ----------- | ---- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `done`      | 200  | Saved as one revision                                                                            | The form closes; every block reloads; a toast offers Undo                     |
| `duplicate` | 200  | The key was saved before: the first result, no second revision (`undone` if it was undone since) | As done ("Already saved")                                                     |
| `invalid`   | 400  | `fieldErrors` by field (`form` for the whole); also a key reused with other values               | Errors under their fields, focus on the first; nothing sent again until fixed |
| `stale`     | 409  | done: the record changed since the form was filled                                               | An alert says what changed; "Send again" sends with the current revision      |
| `not_found` | 404  | Project, page, block or record is gone or in another project                                     | An alert; nothing saved                                                       |
| `failed`    | 500  | Anything unexpected; the key is freed, so the same form can retry                                | "Nothing was saved; try again", what was typed is kept                        |

Idempotency keys live in the `action_submissions` table (app data beside revisions, like the file
scan cache): reserved just before the write, settled with the result, released if the write
fails. A key is only taken by a submission that passed every check.

## 4. Conflict policy (W6, proposed, folded into R10's owner check)

- **Record actions:** per record. A done action carries the record's `expectedRevision`; any newer
  revision of that record refuses it (`stale`) with the current values. Creates can't overwrite
  anyone's work; their retries are covered by the idempotency key. `roll` and `raise` only move
  dates and readings forward, so they never undo a person's newer value.
- **Views (agents):** per view. `view_get` and `view_list` return `revision`; `view_update` takes
  `expectedRevision` and refuses a stale write (`conflict`) instead of replacing newer work; the
  agent reads again and redoes its change on what the view shows now. Unrelated edits to other
  views or records never block.
- **Ask about one block:** while a "change this block" request is open, an agent may change only
  that block of that view (see 5); people are never limited.
- **Undo:** reverting an action or a block change is one revert of one revision. If something
  changed it since, the revert is refused and the toast says so and points at History.

## 5. Ask about one block (R10.7, UX)

- **Where:** the "Ask" button on a block (on hover, and always reachable by Tab) opens the ask box.
  Asked from a block it offers "Change this block" (the default) or "Answer in a new view".
- **What is sent:** a request with `mode: "block"`, the view and widget ids and the question; the
  answering agent's brief adds the block's component, title, width and props, and the exact
  `view_update` call to make.
- **While waiting:** the answering run holds a presence mark on that block ("Claude Code is
  editing…" on the block, v0.2 B5). The questions menu lists it as "Change …".
- **After:** the block updates live; a toast says "Your agent changed … : <reply>" with Undo (one
  revert undoes the block change and reopens the request). If the agent can't do it in that block,
  it dismisses the request with a reply, shown plainly as "Your agent didn't change …: <why>".
- **Enforced:** `view_update` (and REST `/api/apply` for agents) refuses, while the request is
  open, any change to another block, adding, removing or moving blocks, and view-level changes.
  `requestId` marks it answered in the same revision as the change.
- **Keyboard:** Tab to the block's Ask, Enter opens the box with focus in the question, arrow keys
  pick the mode, Cmd/Ctrl+Enter sends, Escape closes, focus returns to the Ask button.
